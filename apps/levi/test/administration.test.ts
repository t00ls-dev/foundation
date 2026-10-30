import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { administrativeEmail } from "../src/admin-config.js";
import { knownFeature, readFeaturePolicy } from "../src/feature-contracts.js";
import { readBootstrapInput } from "../tools/bootstrap-admin-operation.js";
import { bootstrapTarget } from "../tools/bootstrap-admin-config.js";

await test("contratos administrativos: catálogo fechado e três políticas sem estados contraditórios", () => {
  const id = randomUUID();
  assert.ok(knownFeature("members"));
  assert.equal(knownFeature("unknown"), false);
  assert.deepEqual(readFeaturePolicy({ kind: "all" }), { kind: "all" });
  assert.deepEqual(readFeaturePolicy({ kind: "disabled" }), {
    kind: "disabled",
  });
  assert.deepEqual(
    readFeaturePolicy({
      kind: "selected",
      churchIds: [id.toUpperCase()],
    }),
    { kind: "selected", churchIds: [id] },
  );
  for (const input of [
    null,
    true,
    { kind: "unknown" },
    { kind: "selected" },
    { kind: "selected", churchIds: [] },
    { kind: "selected", churchIds: [id, id] },
    { kind: "selected", churchIds: ["*"] },
    { kind: "selected", churchIds: [id], extra: true },
    { kind: "all", churchIds: [id] },
    { kind: "disabled", enabled: true },
  ])
    assert.throws(() => readFeaturePolicy(input));
});

await test("bootstrap exige confirmação assistida e não aceita alvo de conexão ambíguo", () => {
  const userId = randomUUID();
  const input = {
    ADMIN_EMAIL: "  Owner@Example.test  ",
    LEVI_ADMIN_USER_ID: userId,
    LEVI_ADMIN_SESSION_ID: randomUUID(),
    LEVI_ADMIN_OPERATION_ID: randomUUID(),
    LEVI_ADMIN_IDENTITY_CONFIRMATION: `IDENTIDADE-CONFERIDA:${userId}`,
  };
  assert.equal(readBootstrapInput(input).email, "owner@example.test");
  for (const override of [
    { ADMIN_EMAIL: "" },
    { LEVI_ADMIN_USER_ID: "invalid" },
    { LEVI_ADMIN_SESSION_ID: "" },
    { LEVI_ADMIN_IDENTITY_CONFIRMATION: "" },
  ])
    assert.throws(() => readBootstrapInput({ ...input, ...override }));
  const host = "ep-synthetic-only.us-east-2.aws.neon.tech";
  const env = {
    LEVI_ADMIN_DATABASE_URL: `postgresql://levi_dev_bootstrap:synthetic-only@${host}/levi_dev?sslmode=verify-full`,
    LEVI_ADMIN_DATABASE_HOST: host,
    LEVI_ADMIN_DATABASE_NAME: "levi_dev",
    LEVI_ADMIN_TARGET_CONFIRMATION: `BOOTSTRAP:${host}/levi_dev`,
  };
  assert.equal(bootstrapTarget(env), env.LEVI_ADMIN_DATABASE_URL);
  for (const override of [
    { LEVI_ADMIN_TARGET_CONFIRMATION: "" },
    { LEVI_ADMIN_DATABASE_HOST: "other.example" },
    ...[
      "&host=other.example",
      "&user=levi_dev_migrator",
      "&sslmode=require",
      "#fragment",
    ].map((suffix) => ({
      LEVI_ADMIN_DATABASE_URL: env.LEVI_ADMIN_DATABASE_URL + suffix,
    })),
    {
      LEVI_ADMIN_DATABASE_URL: env.LEVI_ADMIN_DATABASE_URL.replace(
        "verify-full",
        "require",
      ),
    },
    {
      LEVI_ADMIN_DATABASE_URL: env.LEVI_ADMIN_DATABASE_URL.replace(
        "levi_dev_bootstrap:",
        "levi_dev_migrator:",
      ),
    },
    {
      LEVI_ADMIN_DATABASE_URL: env.LEVI_ADMIN_DATABASE_URL.replace(
        "ep-synthetic-only.",
        "ep-synthetic-only-pooler.",
      ),
    },
  ])
    assert.throws(() => bootstrapTarget({ ...env, ...override }));
});

await test("painel preserva allowlist pública e runner operacional sem avaliar flags nos membros", async () => {
  for (const path of ["src/app.ts", "src/worker.ts", "src/local.ts"])
    assert.ok(!(await readFile(path, "utf8")).includes("bootstrap-admin"));
  assert.ok(
    !(await readFile("src/members.ts", "utf8")).includes("featureAvailable"),
  );
  const paths = await readFile("src/web-paths.ts", "utf8");
  assert.ok(!paths.includes('"/admin"'));
});

await test("e-mail administrativo único: normalização, ausência e entradas inválidas", () => {
  assert.equal(
    administrativeEmail("  Owner@Example.test  "),
    "owner@example.test",
  );
  assert.equal(
    administrativeEmail("owner+tag@example.test"),
    "owner+tag@example.test",
  );
  for (const input of [
    undefined,
    null,
    [],
    {},
    "",
    "  ",
    "*",
    "invalid",
    "a@example.test,b@example.test",
    "a@example.test;b@example.test",
    "Name <a@example.test>",
    "a b@example.test",
    "x".repeat(255) + "@example.test",
  ])
    assert.equal(administrativeEmail(input), null);
});
