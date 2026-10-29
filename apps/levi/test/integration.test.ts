import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createApp } from "../src/app.js";
import { createAbuseProtection } from "../src/abuse.js";
import { createAdaptorServer } from "@hono/node-server";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { applicationDatabaseUrl } from "./runtime-acl-fixture.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (!databaseUrl || process.env.LEVI_LOCAL_DATABASE !== "1")
  throw new Error("Use npm run test:integration para um banco descartável.");
const observer = await createPostgresDatabase(databaseUrl);
after(async () => {
  await observer.client.end();
});

void test("DEV público: limites duráveis por IP/destinatário, concorrência e respostas sem enumeração", async (t) => {
  const fixedNow = Date.now() + 60_000;
  t.mock.method(Date, "now", () => fixedNow);
  const messages: Array<{ to: string }> = [];
  const publicApp = createApp({
    databaseUrl: applicationDatabaseUrl(databaseUrl),
    baseURL: origin,
    secret: "synthetic-public-secret-with-more-than-32-characters",
    publicAbuseProtection: true,
    email: {
      send: async (input) => {
        messages.push(input);
        return Promise.resolve();
      },
    },
  });
  const email = `${randomUUID()}@example.test`;
  const sendPublic = (address: string, forwarded: string) =>
    publicApp.request(
      new Request(new URL("/api/onboarding/email", origin), {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.220",
          "x-forwarded-for": forwarded,
        },
        body: JSON.stringify({ email: address }),
      }),
    );
  const results = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      Promise.resolve(sendPublic(email, `198.51.100.${i}`)),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 2);
  assert.equal(messages.length, 3);
  const denied = results.find((r) => r.status === 429)!;
  assert.ok(Number(denied.headers.get("retry-after")) > 0);
  assert.equal(readObject(await denied.json()).erro, "LIMITE_DE_SOLICITACOES");
  const allowedBodies = await Promise.all(
    results.filter((r) => r.status === 200).map((r) => r.json()),
  );
  assert.ok(
    allowedBodies.every(
      (value) => JSON.stringify(value) === JSON.stringify(allowedBodies[0]),
    ),
  );
  const counters = await observer.client.query<Record<string, unknown>>(
    "SELECT key FROM abuse_counters",
  );
  assert.ok(!JSON.stringify(counters.rows).includes(email));
  assert.ok(!JSON.stringify(counters.rows).includes("192.0.2.220"));
});

void test("DEV público: orçamento diário atômico entre conexões, expiração e falha fechada", async () => {
  const other = await createPostgresDatabase(databaseUrl);
  const key = `email-day:${Math.floor(Date.now() / 86_400_000) * 86_400_000}`;
  try {
    await observer.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,88,now()+interval '1 day') ON CONFLICT(key) DO UPDATE SET count=88",
      [key],
    );
    const messages: unknown[] = [];
    const providers = [observer, other].map((database) =>
      createAbuseProtection(database.client, "synthetic-secret").protectEmail({
        send: async (input) => {
          messages.push(input);
          return Promise.resolve();
        },
      }),
    );
    await Promise.all(
      providers.map(async (provider) => {
        for (let i = 0; i < 6; i++)
          await provider.send({
            to: `${randomUUID()}@example.test`,
            subject: "synthetic",
            text: "synthetic",
          });
      }),
    );
    assert.equal(messages.length, 2);
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT count FROM abuse_counters WHERE key=$1",
          [key],
        )
      ).rows[0]?.count,
      100,
    );
    await observer.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES('expired-synthetic',1,now()-interval '1 second')",
    );
    await createAbuseProtection(
      other.client,
      "synthetic-secret",
    ).store.increment("fresh-synthetic", Date.now() + 60_000);
    assert.equal(
      (
        await observer.client.query(
          "SELECT key FROM abuse_counters WHERE key='expired-synthetic'",
        )
      ).rowCount,
      0,
    );
    await observer.client.query(
      "ALTER TABLE abuse_counters RENAME TO unavailable_abuse_counters",
    );
    try {
      await assert.rejects(
        providers[0]!.send({
          to: `${randomUUID()}@example.test`,
          subject: "synthetic",
          text: "synthetic",
        }),
      );
      assert.equal(messages.length, 2);
    } finally {
      await observer.client.query(
        "ALTER TABLE unavailable_abuse_counters RENAME TO abuse_counters",
      );
    }
  } finally {
    await observer.client.query("DELETE FROM abuse_counters WHERE key=$1", [
      key,
    ]);
    await other.client.end();
  }
});
const origin = "http://localhost:3000";
const sent: Array<{ to: string; subject: string; text: string }> = [];
const app = createApp({
  databaseUrl: applicationDatabaseUrl(databaseUrl),
  baseURL: origin,
  secret: "synthetic-test-secret-with-more-than-32-characters",
  email: {
    send: async (input) => {
      sent.push(input);
      return Promise.resolve();
    },
  },
});

function request(
  path: string,
  body?: object,
  cookie = "",
  extraHeaders: Record<string, string> = {},
) {
  return app.request(
    new Request(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
function mailUrl(email: string) {
  const message = sent.findLast((mail) => mail.to === email);
  assert.ok(message);
  const link = message.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(link);
  return new URL(link);
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function verifiedAccount() {
  const email = `${randomUUID()}@example.test`;
  assert.equal((await request("/api/onboarding/email", { email })).status, 200);
  const url = mailUrl(email);
  const response = await request(url.pathname + url.search);
  assert.equal(response.status, 302);
  const result = await observer.client.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email=$1',
    [email],
  );
  assert.ok(result.rows[0]);
  return { email, cookie: cookies(response), id: result.rows[0]?.id };
}

async function passwordToken(account: { cookie: string; email: string }) {
  assert.equal(
    (await request("/api/onboarding/password-email", {}, account.cookie))
      .status,
    200,
  );
  const token = mailUrl(account.email).pathname.split("/").at(-1);
  assert.ok(token);
  return token;
}

async function readyAccount() {
  const account = await verifiedAccount();
  const token = await passwordToken(account);
  assert.equal(
    (
      await request(
        "/api/onboarding/password",
        { token, newPassword: "synthetic-password" },
        account.cookie,
      )
    ).status,
    200,
  );
  return account;
}

const provisionBody = {
  organizationName: "Organização sintética",
  churchName: "Primeira igreja sintética",
};
function provision(cookie: string, key = randomUUID(), body = provisionBody) {
  return request("/api/organizations", body, cookie, {
    "Idempotency-Key": key,
  });
}
async function provisionedAccount() {
  const account = await readyAccount();
  const key = randomUUID();
  const response = await provision(account.cookie, key);
  assert.equal(response.status, 201);
  const result = (await response.json()) as {
    organizationId: string;
    churchId: string;
  };
  return { ...account, key, ...result };
}

void test("rate limiting contextual: sessões reais, mesmo IP, tenant, revogação e falsificação", async () => {
  const account = await provisionedAccount();
  const other = await provisionedAccount();
  const secret = "synthetic-test-secret-with-more-than-32-characters";
  const publicApp = createApp({
    databaseUrl: applicationDatabaseUrl(databaseUrl),
    baseURL: origin,
    secret,
    publicAbuseProtection: true,
    email: {
      send: async () => {
        return Promise.resolve();
      },
    },
  });
  const send = (
    path: string,
    cookie: string,
    body?: object,
    extra: Record<string, string> = {},
  ) =>
    publicApp.request(
      new Request(new URL(path, origin), {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.210",
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const signedIn = await request("/api/auth/sign-in/email", {
    email: account.email,
    password: "synthetic-password",
  });
  assert.equal(signedIn.status, 200);
  const secondCookie = cookies(signedIn);
  assert.notEqual(secondCookie, account.cookie);
  // Acesso cruzado negado antes de preparar um segundo vínculo legítimo.
  assert.equal(
    (await send(`/api/churches/${other.churchId}`, account.cookie)).status,
    404,
  );
  assert.equal(
    (
      await send("/api/tenant", account.cookie, {
        organizationId: other.organizationId,
      })
    ).status,
    403,
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [other.organizationId, account.id],
  );
  assert.equal(
    (
      await send("/api/tenant", account.cookie, {
        organizationId: other.organizationId,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send("/api/tenant", account.cookie, {
        organizationId: account.organizationId,
      })
    ).status,
    200,
  );
  const digest = createHmac("sha256", secret)
    .update(`user:${account.id}`)
    .digest("hex");
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  const keys = [start, start + 60_000].map(
    (window) => `v2:read:${digest}:${window}`,
  );
  for (let i = 0; i < keys.length; i++)
    await observer.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,299,$2) ON CONFLICT(key) DO UPDATE SET count=299",
      [keys[i], new Date(start + (i + 1) * 60_000)],
    );
  try {
    const allowed = await send("/api/organizations", account.cookie);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("ratelimit-limit"), "300");
    const denied = await send("/api/churches", secondCookie, undefined, {
      "cf-connecting-ip": "198.51.100.210",
      "x-user-id": other.id,
      "x-organization-id": other.organizationId,
    });
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.equal(denied.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await send("/api/organizations", other.cookie)).status, 200);
    // Trocar tenant não concede novo orçamento de leitura.
    assert.equal(
      (
        await send("/api/tenant", secondCookie, {
          organizationId: other.organizationId,
        })
      ).status,
      200,
    );
    assert.equal((await send("/api/churches", secondCookie)).status, 429);
    const fake = await send(
      "/api/organizations",
      "better-auth.session_token=forged",
      undefined,
      { "x-user-id": account.id },
    );
    assert.equal(fake.status, 401);
    assert.equal(fake.headers.get("ratelimit-limit"), "60");
    const logout = await send("/api/auth/sign-out", account.cookie, {});
    assert.equal(logout.status, 200);
    assert.equal(logout.headers.get("ratelimit-limit"), "30");
    const revoked = await send("/api/organizations", account.cookie);
    assert.equal(revoked.status, 401);
    assert.equal(revoked.headers.get("ratelimit-limit"), "60");
    // Outra sessão da mesma conta continua válida, mas compartilha a quota.
    assert.equal((await send("/api/organizations", secondCookie)).status, 429);
    await observer.client.query(
      "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [account.id],
    );
    const expired = await send("/api/organizations", secondCookie);
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get("ratelimit-limit"), "60");
  } finally {
    await observer.client.query(
      "DELETE FROM abuse_counters WHERE key=ANY($1::text[])",
      [keys],
    );
  }
});

void test("store contextual: incremento atômico entre conexões e limpeza não espera expirados bloqueados", async () => {
  const connections = await Promise.all(
    Array.from({ length: 4 }, () =>
      createPostgresDatabase(applicationDatabaseUrl(databaseUrl)),
    ),
  );
  const key = `synthetic-concurrent:${randomUUID()}`;
  const expired = `synthetic-locked:${randomUUID()}`;
  const locker = await createPostgresDatabase(databaseUrl);
  try {
    const stores = connections.map(
      (db) => createAbuseProtection(db.client, "synthetic").store,
    );
    const counts = (
      await Promise.all(
        stores.map(async (store) => {
          const values: number[] = [];
          for (let i = 0; i < 20; i++)
            values.push(await store.increment(key, Date.now() + 60_000));
          return values;
        }),
      )
    ).flat();
    assert.deepEqual(
      counts.sort((a, b) => a - b),
      Array.from({ length: 80 }, (_, i) => i + 1),
    );
    await locker.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,1,now()-interval '1 minute')",
      [expired],
    );
    await locker.client.query("BEGIN");
    await locker.client.query(
      "SELECT key FROM abuse_counters WHERE key=$1 FOR UPDATE",
      [expired],
    );
    // Timeout apenas na conexão sintética; SKIP LOCKED deve evitar espera.
    await connections[0]!.client.query("SET statement_timeout='2s'");
    assert.equal(await stores[0]!.increment(key, Date.now() + 60_000), 81);
    await locker.client.query("ROLLBACK");
    assert.equal(await stores[0]!.increment(key, Date.now() + 60_000), 82);
    assert.equal(
      (
        await observer.client.query(
          "SELECT key FROM abuse_counters WHERE key=$1",
          [expired],
        )
      ).rowCount,
      0,
    );
  } finally {
    await locker.client.query("ROLLBACK");
    await observer.client.query(
      "DELETE FROM abuse_counters WHERE key=ANY($1::text[])",
      [[key, expired]],
    );
    await Promise.all([...connections, locker].map((db) => db.client.end()));
  }
});

void test("prova pública: Magic Link verifica antes da primeira senha e permite retomada", async () => {
  const email = `${randomUUID()}@example.test`;
  assert.equal((await request("/api/onboarding/email", { email })).status, 200);
  assert.equal(
    (
      await observer.client.query('SELECT id FROM "user" WHERE email=$1', [
        email,
      ])
    ).rowCount,
    0,
  );
  const blocked = await request("/api/auth/sign-up/email", {
    email,
    password: "synthetic-password",
    name: "Atalho",
  });
  assert.equal(blocked.status, 404);
  const link = mailUrl(email);
  const verified = await request(link.pathname + link.search);
  assert.equal(verified.status, 302);
  const cookie = cookies(verified);
  assert.ok(cookie.includes("session_token="));
  assert.deepEqual(
    await (await request("/api/onboarding", undefined, cookie)).json(),
    { etapa: "organizacao" },
  );
  const sentBeforePassword = sent.length;
  assert.equal(
    (
      await request(
        "/api/onboarding/password",
        { newPassword: "synthetic-password" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(sent.length, sentBeforePassword);
  assert.deepEqual(
    await (await request("/api/onboarding", undefined, cookie)).json(),
    { etapa: "organizacao" },
  );
  const login = await request("/api/auth/sign-in/email", {
    email,
    password: "synthetic-password",
  });
  assert.equal(login.status, 200);
  assert.ok(cookies(login).includes("session_token="));
  assert.equal(
    (
      await request(
        "/api/onboarding/password",
        { newPassword: "other-synthetic-password" },
        cookie,
      )
    ).status,
    400,
  );
  const replay = await request(link.pathname + link.search);
  assert.equal(replay.status, 302);
  assert.ok(replay.headers.get("location")?.includes("error="));
  assert.equal(cookies(replay), "");
});

void test("sessão sem senha pode provisionar, sem contornar a allowlist", async () => {
  assert.equal((await provision("")).status, 401);
  const account = await verifiedAccount();
  assert.equal((await provision(account.cookie)).status, 201);
  for (const path of [
    "sign-up/email",
    "set-password",
    "change-password",
    "change-email",
    "request-password-reset",
    "reset-password",
    "sign-in/magic-link",
    "get-session",
    "update-user",
    "sign-up/email/",
  ]) {
    const response = await request(
      `/api/auth/${path}`,
      {
        email: account.email,
        password: "synthetic-password",
        token: "invalid",
      },
      account.cookie,
    );
    assert.equal(response.status, 404, path);
  }
  assert.equal(
    (
      await request("/api/onboarding/password", {
        token: "invalid",
        newPassword: "synthetic-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/onboarding/password-email",
        { email: account.email },
        account.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/onboarding/email", {
        email: account.email,
        id: randomUUID(),
      })
    ).status,
    400,
  );
  await observer.client.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [account.id],
  );
  assert.equal(
    (await request("/api/onboarding/password-email", {}, account.cookie))
      .status,
    403,
  );
  assert.equal((await provision(account.cookie)).status, 403);
});

void test("conta existente retoma o fluxo sem exigir credencial", async () => {
  const account = await readyAccount();
  assert.equal(
    (await request("/api/onboarding/email", { email: account.email })).status,
    200,
  );
  const url = mailUrl(account.email);
  const response = await request(url.pathname + url.search);
  const cookie = cookies(response);
  assert.deepEqual(
    await (await request("/api/onboarding", undefined, cookie)).json(),
    { etapa: "organizacao" },
  );
  const rows = await observer.client.query<Record<string, unknown>>(
    'SELECT id FROM "user" WHERE email=$1',
    [account.email],
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0]?.id, account.id);
  // Simula estado anterior não verificado usando apenas dados sintéticos.
  await observer.client.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [account.id],
  );
  await request("/api/onboarding/email", { email: account.email });
  const newLink = mailUrl(account.email);
  const promoted = await request(newLink.pathname + newLink.search);
  assert.equal(promoted.status, 302);
  assert.deepEqual(
    await (
      await request("/api/onboarding", undefined, cookies(promoted))
    ).json(),
    { etapa: "organizacao" },
  );
  assert.equal((await provision(cookie)).status, 401); // Better Auth revogou a sessão anterior
});

void test("Magic Links inválidos, expirados e concorrentes não concedem duas sessões", async () => {
  const invalid = await request("/api/auth/magic-link/verify?token=invalido");
  assert.equal(cookies(invalid), "");
  assert.ok(invalid.headers.get("location")?.includes("error="));
  assert.equal((await request(invalid.headers.get("location")!)).status, 400);
  const email = `${randomUUID()}@example.test`;
  await request("/api/onboarding/email", { email });
  const expiredLink = mailUrl(email);
  await observer.client.query(
    "UPDATE verification SET expires_at=now()-interval '1 second' WHERE identifier=$1",
    [`magic-link:${expiredLink.searchParams.get("token")}`],
  );
  const expired = await request(expiredLink.pathname + expiredLink.search);
  assert.equal(cookies(expired), "");
  assert.ok(expired.headers.get("location")?.includes("error="));
  assert.equal(
    (
      await observer.client.query('SELECT id FROM "user" WHERE email=$1', [
        email,
      ])
    ).rowCount,
    0,
  );
  await request("/api/onboarding/email", { email });
  const link = mailUrl(email);
  const results = await Promise.all([
    request(link.pathname + link.search),
    request(link.pathname + link.search),
  ]);
  assert.equal(
    results.filter((response) => cookies(response).includes("session_token="))
      .length,
    1,
  );
  assert.equal(
    results.filter((response) =>
      response.headers.get("location")?.includes("error="),
    ).length,
    1,
  );
  assert.equal(
    (
      await observer.client.query('SELECT id FROM "user" WHERE email=$1', [
        email,
      ])
    ).rowCount,
    1,
  );
});

void test("primeira senha direta exige sessão verificada recente, CSRF e resiste a concorrência", async () => {
  const account = await verifiedAccount();
  const body = { newPassword: "synthetic-direct-password" };
  assert.equal((await request("/api/onboarding/password", body)).status, 401);
  assert.equal(
    (
      await request("/api/onboarding/password", body, account.cookie, {
        origin: "https://unrelated.example",
      })
    ).status,
    403,
  );
  await observer.client.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [account.id],
  );
  assert.equal(
    (await request("/api/onboarding/password", body, account.cookie)).status,
    403,
  );
  await observer.client.query(
    'UPDATE "user" SET email_verified=true WHERE id=$1',
    [account.id],
  );
  await observer.client.query(
    "UPDATE session SET created_at=now()-interval '2 days' WHERE user_id=$1",
    [account.id],
  );
  assert.equal(
    (await request("/api/onboarding/password", body, account.cookie)).status,
    400,
  );
  await observer.client.query(
    "UPDATE session SET created_at=now() WHERE user_id=$1",
    [account.id],
  );
  const results = await Promise.all([
    request("/api/onboarding/password", body, account.cookie),
    request("/api/onboarding/password", body, account.cookie),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (
      await observer.client.query("SELECT id FROM account WHERE user_id=$1", [
        account.id,
      ])
    ).rowCount,
    1,
  );
  assert.equal(
    (await request("/api/onboarding/password", body, account.cookie)).status,
    400,
  );
});

void test("primeira senha direta recusa sessão expirada ou revogada sem criar credencial", async () => {
  for (const revoked of [false, true]) {
    const account = await verifiedAccount();
    if (revoked)
      await observer.client.query("DELETE FROM session WHERE user_id=$1", [
        account.id,
      ]);
    else
      await observer.client.query(
        "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [account.id],
      );
    assert.equal(
      (
        await request(
          "/api/onboarding/password",
          { newPassword: "synthetic-expired-password" },
          account.cookie,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await observer.client.query("SELECT id FROM account WHERE user_id=$1", [
          account.id,
        ])
      ).rowCount,
      0,
    );
  }
});

void test("primeira senha exige sessão correspondente e token nativo válido de uso único", async () => {
  const account = await verifiedAccount();
  const other = await verifiedAccount();
  const token = await passwordToken(account);
  assert.equal(
    (
      await request(
        "/api/onboarding/password",
        { token, newPassword: "synthetic-password" },
        other.cookie,
      )
    ).status,
    400,
  );
  await observer.client.query(
    "UPDATE verification SET expires_at=now()-interval '1 second' WHERE identifier=$1",
    [`reset-password:${token}`],
  );
  const expired = await request(
    "/api/onboarding/password",
    { token, newPassword: "synthetic-password" },
    account.cookie,
  );
  assert.equal(expired.status, 400);
  assert.equal(
    (
      await observer.client.query("SELECT id FROM account WHERE user_id=$1", [
        account.id,
      ])
    ).rowCount,
    0,
  );
  const fresh = await passwordToken(account);
  const callback = await request(
    mailUrl(account.email).pathname + mailUrl(account.email).search,
  );
  assert.equal(callback.status, 302);
  assert.ok(callback.headers.get("location")?.includes(`token=${fresh}`));
  const responses = await Promise.all([
    request(
      "/api/onboarding/password",
      { token: fresh, newPassword: "synthetic-password" },
      account.cookie,
    ),
    request(
      "/api/onboarding/password",
      { token: fresh, newPassword: "synthetic-password" },
      account.cookie,
    ),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (
      await observer.client.query("SELECT id FROM account WHERE user_id=$1", [
        account.id,
      ])
    ).rowCount,
    1,
  );
});

void test("provisionamento é atômico, gera UUIDs e grava somente auditoria mínima", async () => {
  const account = await provisionedAccount();
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  for (const id of [account.id, account.organizationId, account.churchId])
    assert.match(id, uuid);
  // Observador é outra conexão, sem compartilhar a transação da aplicação.
  const counts = await observer.client.query<Record<string, unknown>>(
    `SELECT
    (SELECT count(*)::int FROM tenants WHERE id=$1) AS tenants,
    (SELECT count(*)::int FROM churches WHERE tenant_id=$1) AS churches,
    (SELECT count(*)::int FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2) AS memberships,
    (SELECT count(*)::int FROM onboarding_provisions WHERE tenant_id=$1 AND user_id=$2) AS receipts,
    (SELECT count(*)::int FROM audit_events WHERE tenant=$1) AS audit`,
    [account.organizationId, account.id],
  );
  assert.deepEqual(counts.rows[0], {
    tenants: 1,
    churches: 1,
    memberships: 1,
    receipts: 1,
    audit: 1,
  });
  const events = await observer.client.query<Record<string, unknown>>(
    "SELECT * FROM audit_events WHERE tenant=$1",
    [account.organizationId],
  );
  const event = events.rows[0];
  assert.ok(event);
  assert.deepEqual(event.metadata, {});
  assert.equal(event.actor, account.id);
  assert.equal(event.target, account.organizationId);
  assert.equal(event.action, "organization.provisioned");
  assert.equal(event.request_id, null);
  assert.equal(event.result, "success");
  assert.ok(event.timestamp instanceof Date);
  assert.ok(!JSON.stringify(event).includes(account.email));
  assert.ok(!JSON.stringify(event).includes("synthetic-password"));
  for (const table of [
    "session",
    "account",
    "tenant_memberships",
    "audit_events",
  ]) {
    const rows = await observer.client.query<{ id: string }>(
      `SELECT id FROM "${table}"`,
    );
    for (const row of rows.rows) assert.match(row.id, uuid);
  }
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        "SELECT count(*)::int AS members FROM members WHERE tenant_id=$1",
        [account.organizationId],
      )
    ).rows[0]?.members,
    0,
  );
  await assert.rejects(
    observer.client.query(
      "UPDATE audit_events SET result='changed' WHERE tenant=$1",
      [account.organizationId],
    ),
  );
  await assert.rejects(
    observer.client.query("DELETE FROM audit_events WHERE tenant=$1", [
      account.organizationId,
    ]),
  );
  assert.deepEqual(
    await (await request("/api/onboarding", undefined, account.cookie)).json(),
    { etapa: "concluido" },
  );
});

void test("repetições concorrentes serializam o primeiro onboarding sem duplicar resultados", async () => {
  const account = await readyAccount();
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      Promise.resolve(provision(account.cookie, key)),
    ),
  );
  for (const response of results) assert.equal(response.status, 201);
  const bodies = await Promise.all(results.map((response) => response.json()));
  for (const body of bodies) assert.deepEqual(body, bodies[0]);
  const receipt = await observer.client.query<Record<string, unknown>>(
    "SELECT tenant_id FROM onboarding_provisions WHERE user_id=$1",
    [account.id],
  );
  assert.equal(receipt.rowCount, 1);
  assert.equal(
    (
      await observer.client.query(
        "SELECT id FROM audit_events WHERE tenant=$1",
        [receipt.rows[0]?.tenant_id],
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (
      await provision(account.cookie, key, {
        ...provisionBody,
        churchName: "Outra igreja",
      })
    ).status,
    409,
  );
  assert.equal((await provision(account.cookie, randomUUID())).status, 409);
  assert.equal(
    (await request("/api/organizations", provisionBody, account.cookie)).status,
    400,
  );
});

for (const failure of ["audit", "domain"] as const) {
  void test(`rollback observado por outra conexão após falha real de ${failure}`, async () => {
    const account = await readyAccount();
    const countsBefore = await observer.client.query<Record<string, unknown>>(
      "SELECT (SELECT count(*)::int FROM tenants) tenants, (SELECT count(*)::int FROM churches) churches, (SELECT count(*)::int FROM audit_events) audit",
    );
    // A falha de domínio acontece depois das escritas de organização/igreja/vínculo.
    const table =
      failure === "audit" ? "audit_events" : "onboarding_provisions";
    const column = failure === "audit" ? "actor" : "user_id";
    await observer.client.query(
      `CREATE FUNCTION test_fail_provision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${column}='${account.id}'::uuid THEN RAISE EXCEPTION 'falha sintética'; END IF; RETURN NEW; END; $$`,
    );
    await observer.client.query(
      `CREATE TRIGGER test_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION test_fail_provision()`,
    );
    const key = randomUUID();
    try {
      const response = await provision(account.cookie, key);
      assert.equal(response.status, 503);
      assert.ok(
        !JSON.stringify(await response.json()).includes("falha sintética"),
      );
      assert.equal(
        (
          await observer.client.query(
            "SELECT id FROM tenant_memberships WHERE user_id=$1",
            [account.id],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await observer.client.query(
            "SELECT user_id FROM onboarding_provisions WHERE user_id=$1",
            [account.id],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await observer.client.query(
            "SELECT ts.session_id FROM tenant_sessions ts JOIN session s ON s.id=ts.session_id WHERE s.user_id=$1",
            [account.id],
          )
        ).rowCount,
        0,
      );
      assert.deepEqual(
        (
          await observer.client.query<Record<string, unknown>>(
            "SELECT (SELECT count(*)::int FROM tenants) tenants, (SELECT count(*)::int FROM churches) churches, (SELECT count(*)::int FROM audit_events) audit",
          )
        ).rows,
        countsBefore.rows,
      );
      assert.equal(
        (
          await observer.client.query('SELECT id FROM "user" WHERE id=$1', [
            account.id,
          ])
        ).rowCount,
        1,
      );
    } finally {
      await observer.client.query(`DROP TRIGGER test_fail ON ${table}`);
      await observer.client.query("DROP FUNCTION test_fail_provision()");
    }
    assert.equal((await provision(account.cookie, key)).status, 201);
  });
}

void test("duas organizações ficam isoladas e administrador acessa múltiplas igrejas da sua organização", async () => {
  const first = await provisionedAccount();
  const second = await provisionedAccount();
  const church = await observer.client.query<Record<string, unknown>>(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Segunda igreja sintética') RETURNING id",
    [first.organizationId],
  );
  const listed = await request("/api/churches", undefined, first.cookie);
  assert.equal(listed.status, 200);
  const listing = (await listed.json()) as {
    organizationId: string;
    churches: { id: string }[];
  };
  assert.equal(listing.organizationId, first.organizationId);
  assert.deepEqual(
    new Set(listing.churches.map((c) => c.id)),
    new Set([first.churchId, church.rows[0]?.id]),
  );
  assert.equal(
    (await request(`/api/churches/${second.churchId}`, undefined, first.cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/tenant",
        { organizationId: second.organizationId },
        first.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/context", undefined, first.cookie)).status,
    200,
  );
  assert.deepEqual(
    await (await request("/api/context", undefined, first.cookie)).json(),
    {
      organizationId: first.organizationId,
      organizationName: provisionBody.organizationName,
      role: "admin",
      membersEnabled: true,
    },
  );
  // Contexto adulterado no banco também não concede autoridade sem vínculo.
  await observer.client.query(
    "UPDATE tenant_sessions SET active_tenant_id=$1 WHERE session_id IN (SELECT id FROM session WHERE user_id=$2)",
    [second.organizationId, first.id],
  );
  assert.equal(
    (await request("/api/churches", undefined, first.cookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/tenant",
        { organizationId: first.organizationId },
        first.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/churches/id-invalido", undefined, first.cookie))
      .status,
    400,
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [first.organizationId, randomUUID()],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO churches(tenant_id,name) VALUES($1,'Órfã')",
      [randomUUID()],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    observer.client.query(
      "UPDATE onboarding_provisions SET church_id=$1 WHERE user_id=$2",
      [second.churchId, first.id],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO tenant_sessions(session_id,active_tenant_id) VALUES($1,$2)",
      [randomUUID(), first.organizationId],
    ),
    { code: "23503" },
  );
});

void test("nova sessão retoma organização existente; revogação e roles desconhecidas nunca concedem acesso", async () => {
  const account = await provisionedAccount();
  const login = await request("/api/auth/sign-in/email", {
    email: account.email,
    password: "synthetic-password",
  });
  const cookie = cookies(login);
  assert.equal((await request("/api/churches", undefined, cookie)).status, 403);
  const organizations = (await (
    await request("/api/organizations", undefined, cookie)
  ).json()) as { organizations: { id: string }[] };
  assert.deepEqual(
    organizations.organizations.map((o) => o.id),
    [account.organizationId],
  );
  assert.equal(
    (
      await request(
        "/api/tenant",
        { organizationId: account.organizationId },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal((await request("/api/churches", undefined, cookie)).status, 200);
  await observer.client.query(
    "UPDATE tenant_memberships SET role='desconhecida' WHERE user_id=$1",
    [account.id],
  );
  assert.equal((await request("/api/churches", undefined, cookie)).status, 403);
  assert.equal(
    (
      await request(
        "/api/tenant",
        { organizationId: account.organizationId },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal((await provision(cookie, account.key)).status, 403);
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE user_id=$1",
    [account.id],
  );
  assert.equal((await request("/api/churches", undefined, cookie)).status, 403);
  assert.equal((await provision(cookie, account.key)).status, 403);
  assert.deepEqual(
    await (await request("/api/organizations", undefined, cookie)).json(),
    { organizations: [] },
  );
});

void test("CSRF, falha de autenticação e falha de banco não viram autorização", async () => {
  const account = await provisionedAccount();
  const malicious = await request(
    "/api/tenant",
    { organizationId: account.organizationId },
    account.cookie,
    { origin: "https://malicioso.example" },
  );
  assert.equal(malicious.status, 403);
  assert.equal(
    (
      await app.request(
        new Request(`${origin}/api/tenant`, {
          method: "POST",
          headers: {
            cookie: account.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ organizationId: account.organizationId }),
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/churches",
        undefined,
        "better-auth.session_token=invalido",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/sign-in/email", {
        email: account.email,
        password: "senha-errada",
      })
    ).status,
    401,
  );
  await observer.client.query(
    'ALTER TABLE "session" RENAME TO session_unavailable',
  );
  try {
    const response = await request("/api/churches", undefined, account.cookie);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes("SELECT"));
    assert.ok(!body.includes(account.email));
    assert.equal(cookies(response), "");
  } finally {
    await observer.client.query(
      'ALTER TABLE session_unavailable RENAME TO "session"',
    );
  }
  assert.equal(
    (await request("/api/churches", undefined, account.cookie)).status,
    200,
  );
});

for (const failDelete of [false, true])
  void test(`logout direto com sessão renovável: ${failDelete ? "falha não confirma revogação" : "limpa cookies nativos e revoga"}`, async () => {
    const account = await provisionedAccount();
    const publicApp = createApp({
      databaseUrl: applicationDatabaseUrl(databaseUrl),
      baseURL: origin,
      secret: "synthetic-test-secret-with-more-than-32-characters",
      publicAbuseProtection: true,
      email: {
        send: async () => {
          return Promise.resolve();
        },
      },
    });
    await observer.client.query(
      "UPDATE session SET updated_at=now()-interval '2 days', expires_at=now()+interval '1 day' WHERE user_id=$1",
      [account.id],
    );
    if (failDelete)
      await observer.client.query(`
      CREATE FUNCTION test_reject_logout_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha sintética de logout'; END; $$;
      CREATE TRIGGER test_reject_logout_delete BEFORE DELETE ON session
      FOR EACH ROW EXECUTE FUNCTION test_reject_logout_delete()`);
    try {
      // Nenhuma consulta HTTP pode renovar a sessão entre o ajuste e o logout.
      const response = await publicApp.request(
        new Request(`${origin}/api/auth/sign-out`, {
          method: "POST",
          headers: {
            origin,
            cookie: account.cookie,
            "content-type": "application/json",
            "cf-connecting-ip": "192.0.2.212",
          },
          body: "{}",
        }),
      );
      assert.equal(response.status, failDelete ? 503 : 200);
      assert.equal(response.headers.get("ratelimit-limit"), "30");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const cookieHeaders = response.headers.getSetCookie();
      if (failDelete) assert.equal(cookieHeaders.length, 0);
      else {
        for (const name of ["session_token", "session_data", "dont_remember"])
          assert.ok(
            cookieHeaders.some((value) =>
              value.startsWith(`better-auth.${name}=;`),
            ),
            `Limpar ${name}`,
          );
        assert.ok(
          cookieHeaders.every(
            (value) =>
              /^[^=]+=;/.test(value) &&
              /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(value),
          ),
          "Nenhum cookie positivo de renovação no logout",
        );
      }
      const sessions = await observer.client.query<Record<string, unknown>>(
        "SELECT id FROM session WHERE user_id=$1",
        [account.id],
      );
      assert.equal(sessions.rowCount, failDelete ? 1 : 0);
      if (!failDelete) {
        assert.equal(
          (
            await observer.client.query(
              "SELECT session_id FROM tenant_sessions WHERE active_tenant_id=$1",
              [account.organizationId],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await request("/api/organizations", undefined, account.cookie))
            .status,
          401,
        );
      }
    } finally {
      if (failDelete)
        await observer.client.query(
          "DROP TRIGGER test_reject_logout_delete ON session; DROP FUNCTION test_reject_logout_delete()",
        );
    }
  });

void test("HEAD autenticado consome a leitura de GET e não contorna seu limite", async () => {
  const account = await readyAccount();
  const secret = "synthetic-test-secret-with-more-than-32-characters";
  const publicApp = createApp({
    databaseUrl: applicationDatabaseUrl(databaseUrl),
    baseURL: origin,
    secret,
    publicAbuseProtection: true,
    email: {
      send: async () => {
        return Promise.resolve();
      },
    },
  });
  const digest = createHmac("sha256", secret)
    .update(`user:${account.id}`)
    .digest("hex");
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  const keys = [start, start + 60_000].map(
    (window) => `v2:read:${digest}:${window}`,
  );
  const send = (method: string, cookie = account.cookie) =>
    publicApp.request(
      new Request(`${origin}/api/organizations`, {
        method,
        headers: { origin, cookie, "cf-connecting-ip": "192.0.2.213" },
      }),
    );
  try {
    const head = await send("HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("ratelimit-limit"), "300");
    assert.equal(head.headers.get("ratelimit-remaining"), "299");
    assert.equal(await head.text(), "");
    // Esgota também a próxima janela para não depender da virada do minuto.
    for (let i = 0; i < keys.length; i++)
      await observer.client.query(
        "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,300,$2) ON CONFLICT(key) DO UPDATE SET count=300",
        [keys[i], new Date(start + (i + 1) * 60_000)],
      );
    for (const method of ["GET", "HEAD"]) {
      const denied = await send(method);
      assert.equal(denied.status, 429);
      assert.ok(Number(denied.headers.get("retry-after")) > 0);
    }
    const anonymous = await send("HEAD", "");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("ratelimit-limit"), "60");
    assert.equal(await anonymous.text(), "");
  } finally {
    await observer.client.query(
      "DELETE FROM abuse_counters WHERE key=ANY($1::text[])",
      [keys],
    );
  }
});

void test("cookies de renovação e logout nativos são preservados", async () => {
  const account = await provisionedAccount();
  await observer.client.query(
    "UPDATE session SET updated_at=now()-interval '2 days', expires_at=now()+interval '1 day' WHERE user_id=$1",
    [account.id],
  );
  const refreshed = await request("/api/context", undefined, account.cookie);
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.headers.getSetCookie().length > 0);
  assert.ok(
    refreshed.headers
      .getSetCookie()
      .every((cookie) => cookie.includes("HttpOnly")),
  );
  assert.equal(refreshed.headers.get("cache-control"), "private, no-store");
  const logout = await request("/api/auth/sign-out", {}, account.cookie);
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().length > 0);
  assert.equal(
    (await request("/api/churches", undefined, account.cookie)).status,
    401,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT ts.session_id FROM tenant_sessions ts JOIN session s ON s.id=ts.session_id WHERE s.user_id=$1",
        [account.id],
      )
    ).rowCount,
    0,
  );
});

void test("API executa por HTTP Node e não executa migrations na inicialização", async () => {
  await observer.client.query("CREATE DATABASE levi_empty_startup");
  const emptyUrl = new URL(databaseUrl);
  emptyUrl.pathname = "/levi_empty_startup";
  const empty = await createPostgresDatabase(emptyUrl.toString());
  const emptyApp = createApp({
    databaseUrl: emptyUrl.toString(),
    baseURL: origin,
    secret: "synthetic-test-secret-with-more-than-32-characters",
    email: {
      send: async () => {
        return Promise.reject(new Error("Envio não esperado"));
      },
    },
  });
  let executableApp = emptyApp;
  const server = createAdaptorServer({
    fetch: (request) => executableApp.fetch(request),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/onboarding`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { etapa: "email" });
    assert.equal(
      (
        await empty.client.query<Record<string, unknown>>(
          "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
        )
      ).rows[0]?.count,
      0,
    );
    // Depois da prova de não-migração, exerce o fluxo inteiro via HTTP real.
    const httpOrigin = `http://127.0.0.1:${address.port}`;
    executableApp = createApp({
      databaseUrl: applicationDatabaseUrl(databaseUrl),
      baseURL: httpOrigin,
      secret: "synthetic-test-secret-with-more-than-32-characters",
      email: {
        send: async (input) => {
          sent.push(input);
          return Promise.resolve();
        },
      },
    });
    const send = (
      path: string,
      body?: object,
      cookie = "",
      extraHeaders: Record<string, string> = {},
    ) =>
      fetch(new URL(path, httpOrigin), {
        method: body ? "POST" : "GET",
        redirect: "manual",
        headers: {
          origin: httpOrigin,
          cookie,
          "content-type": "application/json",
          ...extraHeaders,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const email = `${randomUUID()}@example.test`;
    assert.equal((await send("/api/onboarding/email", { email })).status, 200);
    const magicUrl = mailUrl(email);
    magicUrl.searchParams.set("callbackURL", "https://malicioso.example");
    const verified = await send(magicUrl.pathname + magicUrl.search);
    assert.equal(verified.status, 302);
    assert.equal(
      new URL(verified.headers.get("location")!, httpOrigin).origin,
      httpOrigin,
    );
    const cookie = cookies(verified);
    assert.equal(
      (await send("/api/onboarding/password-email", {}, cookie)).status,
      200,
    );
    const token = mailUrl(email).pathname.split("/").at(-1);
    assert.equal(
      (
        await send(
          "/api/onboarding/password",
          { token, newPassword: "synthetic-password" },
          cookie,
        )
      ).status,
      200,
    );
    const provisioned = await send(
      "/api/organizations",
      provisionBody,
      cookie,
      { "Idempotency-Key": randomUUID() },
    );
    assert.equal(provisioned.status, 201);
    const ids = (await provisioned.json()) as { churchId: string };
    const listed = await send("/api/churches", undefined, cookie);
    assert.equal(listed.status, 200);
    const churches = (await listed.json()) as { churches: { id: string }[] };
    assert.deepEqual(
      churches.churches.map((church) => church.id),
      [ids.churchId],
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await empty.client.end();
  }
});

void test("sessão revogada enquanto o provisionamento aguarda lock não pode criar organização", async () => {
  const account = await readyAccount();
  const blocker = await createPostgresDatabase(databaseUrl);
  await blocker.client.query("BEGIN");
  await blocker.client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
    account.id,
  ]);
  const pending = provision(account.cookie);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const locks = await observer.client.query<Record<string, unknown>>(
        "SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%for update%'",
      );
      if (locks.rowCount) {
        waiting = true;
        break;
      }
      await setTimeout(10);
    }
    assert.ok(
      waiting,
      "A requisição deve aguardar o lock real antes da revogação",
    );
    await observer.client.query("DELETE FROM session WHERE user_id=$1", [
      account.id,
    ]);
  } finally {
    await blocker.client.query("ROLLBACK");
    await blocker.client.end();
  }
  assert.equal((await pending).status, 401);
  assert.equal(
    (
      await observer.client.query(
        "SELECT user_id FROM onboarding_provisions WHERE user_id=$1",
        [account.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT id FROM tenant_memberships WHERE user_id=$1",
        [account.id],
      )
    ).rowCount,
    0,
  );
});

void test("troca do segredo invalida cookie antigo sem perder senha, vínculos ou tokens aleatórios persistidos", async () => {
  const account = await provisionedAccount();
  const resetToken = await passwordToken(account);
  assert.equal(
    (await request("/api/onboarding/email", { email: account.email })).status,
    200,
  );
  const oldMagicLink = mailUrl(account.email);
  const snapshot = async () =>
    (
      await observer.client.query<Record<string, unknown>>(
        `SELECT
      (SELECT to_jsonb(t) FROM tenants t WHERE id=$1) AS organization,
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM churches c WHERE tenant_id=$1) AS churches,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM tenant_memberships m WHERE tenant_id=$1) AS memberships,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE tenant=$1) AS audit`,
        [account.organizationId],
      )
    ).rows;
  const persisted = await snapshot();
  const passwordHash = async () =>
    (
      await observer.client.query<{ password: string }>(
        `SELECT password FROM account WHERE user_id=$1 AND provider_id='credential'`,
        [account.id],
      )
    ).rows[0]?.password;
  const previousHash = await passwordHash();
  assert.ok(previousHash);
  const rotated = createApp({
    databaseUrl: applicationDatabaseUrl(databaseUrl),
    baseURL: origin,
    secret: "synthetic-rotated-secret-with-more-than-32-characters",
    email: {
      send: async (input) => {
        sent.push(input);
        return Promise.resolve();
      },
    },
  });
  const rotatedRequest = (path: string, body?: object, cookie = "") =>
    rotated.request(
      new Request(new URL(path, origin), {
        method: body ? "POST" : "GET",
        headers: { origin, cookie, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  assert.equal(
    (await rotatedRequest("/api/organizations", undefined, account.cookie))
      .status,
    401,
  );
  assert.equal(
    (await rotatedRequest("/admin", undefined, account.cookie)).status,
    404,
  );
  // A assinatura deixou de ser aceita; não houve DELETE/revogação durável das sessões.
  assert.equal(
    (await request("/api/organizations", undefined, account.cookie)).status,
    200,
  );
  const login = await rotatedRequest("/api/auth/sign-in/email", {
    email: account.email,
    password: "synthetic-password",
  });
  assert.equal(login.status, 200);
  const cookie = cookies(login);
  assert.ok(cookie.includes("session_token="));
  assert.equal(
    (await rotatedRequest("/api/organizations", undefined, cookie)).status,
    200,
  );
  assert.equal(
    (await request("/api/organizations", undefined, cookie)).status,
    401,
  );
  assert.equal(await passwordHash(), previousHash);
  assert.deepEqual(await snapshot(), persisted);
  // Os tokens de link são aleatórios e persistidos; a troca de segredo não os revoga.
  const magic = await rotatedRequest(
    oldMagicLink.pathname + oldMagicLink.search,
  );
  assert.equal(magic.status, 302);
  assert.ok(cookies(magic).includes("session_token="));
  const replay = await rotatedRequest(
    oldMagicLink.pathname + oldMagicLink.search,
  );
  assert.equal(replay.status, 302);
  assert.equal(cookies(replay), "");
  assert.ok(replay.headers.get("location")?.includes("error="));
  assert.equal(
    (
      await rotatedRequest(
        "/api/onboarding/password",
        { token: resetToken, newPassword: "synthetic-password" },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await rotatedRequest(
        "/api/onboarding/password",
        { token: resetToken, newPassword: "synthetic-password" },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await rotatedRequest("/api/auth/sign-in/email", {
        email: account.email,
        password: "synthetic-password",
      })
    ).status,
    200,
  );
  assert.deepEqual(await snapshot(), persisted);
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        'SELECT id FROM "user" WHERE email=$1',
        [account.email],
      )
    ).rows[0]?.id,
    account.id,
  );
});

function readObject(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

void test("etapa autoritativa: conta nova, múltiplos vínculos, revogação e isolamento de recibos", async () => {
  const existing = await provisionedAccount();
  const fresh = await readyAccount();
  async function stage(cookie: string, query = "") {
    const result = await request(`/api/onboarding${query}`, undefined, cookie);
    assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control") ?? "", /no-store/);
    const value: unknown = await result.json();
    return value;
  }
  assert.deepEqual(await stage(""), { etapa: "email" });
  assert.deepEqual(await stage(fresh.cookie, `?userId=${existing.id}`), {
    etapa: "organizacao",
  });
  assert.deepEqual(await stage(existing.cookie), { etapa: "concluido" });
  const second = (
    await observer.client.query<{ id: string }>(
      "INSERT INTO tenants(name) VALUES('Segundo vínculo sintético') RETURNING id",
    )
  ).rows[0]!;
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [second.id, existing.id],
  );
  const organizations = await request(
    "/api/organizations",
    undefined,
    existing.cookie,
  );
  assert.deepEqual(
    readObject(await organizations.json()).organizations,
    [
      { id: existing.organizationId, nome: "Organização sintética" },
      { id: second.id, nome: "Segundo vínculo sintético" },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
  assert.deepEqual(await stage(existing.cookie), { etapa: "concluido" });
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [existing.organizationId, existing.id],
  );
  assert.deepEqual(await stage(existing.cookie), { etapa: "concluido" });
  assert.equal(
    (await request("/api/context", undefined, existing.cookie)).status,
    403,
  );
  await observer.client.query(
    "UPDATE tenant_memberships SET role='desconhecida' WHERE user_id=$1",
    [existing.id],
  );
  assert.deepEqual(await stage(existing.cookie), { etapa: "sem-acesso" });
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE user_id=$1",
    [existing.id],
  );
  assert.deepEqual(await stage(existing.cookie, `?userId=${fresh.id}`), {
    etapa: "sem-acesso",
  });
  assert.deepEqual(await stage(fresh.cookie), { etapa: "organizacao" });
  assert.deepEqual(
    await (
      await request("/api/organizations", undefined, existing.cookie)
    ).json(),
    { organizations: [] },
  );
  assert.equal(
    (
      await request(
        "/api/tenant",
        { organizationId: second.id },
        existing.cookie,
      )
    ).status,
    403,
  );
  assert.equal((await provision(existing.cookie, existing.key)).status, 403);
  assert.equal((await provision(existing.cookie)).status, 409);
  const receipt = await observer.client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM onboarding_provisions WHERE user_id=$1",
    [existing.id],
  );
  assert.equal(receipt.rows[0]?.count, 1);
  // Conta independente continua apta a provisionar apesar do recibo da outra.
  assert.equal((await provision(fresh.cookie)).status, 201);
});

void test("contexto de sessão: autenticação, IDs internos, isolamento, expiração e logout", async () => {
  assert.equal((await request("/api/session-context")).status, 401);
  const first = await verifiedAccount();
  const second = await readyAccount();
  const expected = (
    await observer.client.query<{ id: string; token: string }>(
      "SELECT id,token FROM session WHERE user_id=$1",
      [first.id],
    )
  ).rows[0];
  assert.ok(expected);
  const result = await request(
    `/api/session-context?userId=${second.id}`,
    undefined,
    first.cookie,
  );
  assert.equal(result.status, 200);
  assert.match(result.headers.get("cache-control") ?? "", /private/);
  assert.match(result.headers.get("cache-control") ?? "", /no-store/);
  const value: unknown = await result.json();
  assert.deepEqual(value, { userId: first.id, sessionId: expected.id });
  assert.ok(!JSON.stringify(value).includes(expected.token));
  assert.equal(
    (await request("/api/session-context", {}, first.cookie)).status,
    404,
  );
  await observer.client.query(
    "UPDATE session SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expected.id],
  );
  assert.equal(
    (await request("/api/session-context", undefined, first.cookie)).status,
    401,
  );
  const secondContext = await request(
    "/api/session-context",
    undefined,
    second.cookie,
  );
  assert.equal(secondContext.status, 200);
  assert.equal(
    (await request("/api/auth/sign-out", {}, second.cookie)).status,
    200,
  );
  assert.equal(
    (await request("/api/session-context", undefined, second.cookie)).status,
    401,
  );
});
