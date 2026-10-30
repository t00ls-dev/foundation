import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { workerOptions, type WorkerEnv } from "../src/worker-config.js";
import {
  devCutoverAdminTarget,
  devMigrationTarget,
} from "../tools/dev-migration-config.js";
import { createApp } from "../src/app.js";
import worker from "../src/worker.js";

const env: WorkerEnv = {
  ASSETS: { fetch: async () => Promise.resolve(new Response("synthetic")) },
  HYPERDRIVE: { connectionString: "postgresql://synthetic-only" },
  LEVI_PUBLIC_ORIGIN: "https://levi.t00ls.dev",
  LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
  RESEND_API_KEY: "synthetic-only-not-a-real-key",
  LEVI_EMAIL_FROM: "Levi <levi@example.test>",
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

void test("política final de headers preserva no-referrer também no runtime Node", async () => {
  const app = createApp(workerOptions(env));
  const response = await app.request("https://levi.t00ls.dev/unknown");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.has("content-security-policy"));
});

void test("Worker sem secrets/configuração completa responde 503 sanitizado, sem tentar a API", async () => {
  const response = await worker.fetch(new Request("https://levi.t00ls.dev/"), {
    ...env,
    RESEND_API_KEY: "",
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(!(await response.text()).includes(env.LEVI_AUTH_SECRET));
});

void test("DEV compõe somente origem HTTPS fixa e callbacks seguros", () => {
  assert.equal(workerOptions(env).baseURL, "https://levi.t00ls.dev");
  assert.equal(workerOptions(env).onboardingReturnPath, "/onboarding");
  for (const changes of [
    { LEVI_PUBLIC_ORIGIN: "http://levi.t00ls.dev" },
    { LEVI_PUBLIC_ORIGIN: "https://levi.t00ls.dev/path" },
    { LEVI_AUTH_SECRET: "" },
    { RESEND_API_KEY: "" },
    { LEVI_EMAIL_FROM: "" },
  ])
    assert.throws(() => workerOptions({ ...env, ...changes }));
});

void test("adapter Resend publicado aceita destinatários públicos sem allowlist", async () => {
  const messages: Array<{ from: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    const requestBody = init?.body;
    assert.ok(typeof requestBody === "string");
    const message: unknown = JSON.parse(requestBody);
    assert.ok(message && typeof message === "object" && "from" in message);
    messages.push(message);
    return Promise.resolve(Response.json({ id: "synthetic" }));
  };
  const { email } = workerOptions(env);
  await email.send({
    to: "other@example.test",
    subject: "synthetic",
    text: "synthetic",
  });
  assert.equal(messages.length, 1);
  await email.send({
    to: "TESTER@example.test",
    subject: "synthetic",
    text: "synthetic",
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.from, env.LEVI_EMAIL_FROM);
});

void test("rejeição do provider não é declarada como envio confirmado", async () => {
  globalThis.fetch = async () =>
    Promise.resolve(Response.json({}, { status: 429 }));
  await assert.rejects(
    workerOptions(env).email.send({
      to: "tester@example.test",
      subject: "synthetic",
      text: "synthetic",
    }),
  );
});

void test("guarda de migrations aceita somente alvo Neon DEV direto e explícito, sem conectar", () => {
  const host = "ep-synthetic-only.us-east-2.aws.neon.tech";
  const valid: NodeJS.ProcessEnv = {
    LEVI_DEV_DATABASE_URL: `postgresql://levi_dev_migrator:synthetic-only@${host}/levi_dev?sslmode=verify-full`,
    LEVI_DEV_DATABASE_HOST: host,
    LEVI_DEV_DATABASE_NAME: "levi_dev",
    LEVI_DEV_MIGRATION_CONFIRMATION: `APLICAR:${host}/levi_dev`,
  };
  assert.equal(devMigrationTarget(valid), valid.LEVI_DEV_DATABASE_URL);
  for (const changes of [
    { LEVI_DEV_MIGRATION_CONFIRMATION: "" },
    { LEVI_DEV_DATABASE_HOST: "ep-another.us-east-2.aws.neon.tech" },
    { LEVI_DEV_DATABASE_NAME: "levi_prod" },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "verify-full",
        "require",
      ),
    },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "levi_dev_migrator",
        "owner",
      ),
    },
    { LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL! + "&options=unsafe" },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        host,
        "127.0.0.1",
      ),
    },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "ep-synthetic-only.",
        "ep-synthetic-only-pooler.",
      ),
    },
  ])
    assert.throws(
      () => devMigrationTarget({ ...valid, ...changes }),
      /Migração DEV recusada/,
    );
  assert.throws(() => devMigrationTarget({}));
});

void test("barreira DEV aceita somente owner administrativo, alvo direto e confirmação explícita", () => {
  const host = "ep-synthetic-only.us-east-2.aws.neon.tech";
  const valid: NodeJS.ProcessEnv = {
    LEVI_DEV_ADMIN_DATABASE_URL: `postgresql://neondb_owner:synthetic-only@${host}/levi_dev?sslmode=verify-full`,
    LEVI_DEV_DATABASE_HOST: host,
    LEVI_DEV_DATABASE_NAME: "levi_dev",
    LEVI_DEV_CUTOVER_CONFIRMATION: `PREPARAR:${host}/levi_dev`,
  };
  assert.equal(
    devCutoverAdminTarget(valid, "prepare"),
    valid.LEVI_DEV_ADMIN_DATABASE_URL,
  );
  assert.equal(
    devCutoverAdminTarget(
      {
        ...valid,
        LEVI_DEV_ADMIN_DATABASE_URL:
          valid.LEVI_DEV_ADMIN_DATABASE_URL + "&channel_binding=require",
      },
      "prepare",
    ),
    valid.LEVI_DEV_ADMIN_DATABASE_URL + "&channel_binding=require",
  );
  for (const changes of [
    { LEVI_DEV_CUTOVER_CONFIRMATION: "" },
    { LEVI_DEV_CUTOVER_CONFIRMATION: `RETOMAR:${host}/levi_dev` },
    { LEVI_DEV_DATABASE_HOST: "ep-another.us-east-2.aws.neon.tech" },
    { LEVI_DEV_DATABASE_NAME: "levi_prod" },
    {
      LEVI_DEV_ADMIN_DATABASE_URL: valid.LEVI_DEV_ADMIN_DATABASE_URL!.replace(
        "verify-full",
        "require",
      ),
    },
    {
      LEVI_DEV_ADMIN_DATABASE_URL: valid.LEVI_DEV_ADMIN_DATABASE_URL!.replace(
        "neondb_owner",
        "levi_dev_migrator",
      ),
    },
    {
      LEVI_DEV_ADMIN_DATABASE_URL:
        valid.LEVI_DEV_ADMIN_DATABASE_URL! + "&options=unsafe",
    },
    {
      LEVI_DEV_ADMIN_DATABASE_URL:
        valid.LEVI_DEV_ADMIN_DATABASE_URL! + "&channel_binding=prefer",
    },
    {
      LEVI_DEV_ADMIN_DATABASE_URL: valid.LEVI_DEV_ADMIN_DATABASE_URL!.replace(
        host,
        "127.0.0.1",
      ),
    },
    {
      LEVI_DEV_ADMIN_DATABASE_URL: valid.LEVI_DEV_ADMIN_DATABASE_URL!.replace(
        "ep-synthetic-only.",
        "ep-synthetic-only-pooler.",
      ),
    },
  ])
    assert.throws(
      () => devCutoverAdminTarget({ ...valid, ...changes }, "prepare"),
      /Barreira DEV recusada/,
    );
  assert.throws(() => devCutoverAdminTarget({}, "status"));
});

void test("Worker sem configuração preserva 404 administrativo antes de qualquer binding ou validação", async () => {
  for (const path of [
    "/admin",
    "/admin/",
    "/api/admin",
    "/api/admin/features",
    "/api/%61dmin",
  ])
    for (const method of ["GET", "POST", "DELETE", "OPTIONS"]) {
      const response = await worker.fetch(
        new Request("https://levi.t00ls.dev" + path, {
          method,
          headers: { origin: "https://hostil.example" },
          ...(!["GET"].includes(method) ? { body: "invalid" } : {}),
        }),
        { ...env, RESEND_API_KEY: "" },
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        erro: "NAO_ENCONTRADO",
        mensagem: "Recurso não encontrado.",
      });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
    }
});

void test("ausência ou e-mail administrativo inválido não libera APIs nem impede páginas comuns", async () => {
  for (const email of [undefined, "", "invalid"]) {
    const configured = { ...env, LEVI_ADMIN_EMAIL: email };
    assert.equal(workerOptions(configured).adminEmail, email);
    const response = await worker.fetch(
      new Request("https://levi.t00ls.dev/admin", {
        headers: { cookie: "synthetic" },
      }),
      configured,
    );
    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes("synthetic"));
  }
});
