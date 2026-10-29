import assert from "node:assert/strict";
import { after, beforeEach, test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createApp } from "../src/app.js";
import { createAuth, type Database } from "../src/auth.js";
import { requireGlobalAdministrator } from "../src/admin-access.js";
import {
  featureAvailable,
  listFeatureFlags,
  updateFeatureFlag,
} from "../src/feature-flags.js";
import {
  bootstrapAdministrator,
  readBootstrapInput,
} from "../tools/bootstrap-admin-operation.js";
import {
  applicationDatabaseUrl,
  localTestDatabaseUrl,
} from "./runtime-acl-fixture.js";
import { RequestError } from "../src/contracts.js";

const observerUrl = process.env.LEVI_DATABASE_URL;
assert.ok(observerUrl && process.env.LEVI_LOCAL_DATABASE === "1");
localTestDatabaseUrl(observerUrl, "levi_test");
const runtimeUrl = applicationDatabaseUrl(observerUrl);
const observer = await createPostgresDatabase(observerUrl);
const runtime = await createPostgresDatabase(runtimeUrl);
const bootstrapUrl = new URL(observerUrl);
bootstrapUrl.username = "levi_dev_bootstrap";
bootstrapUrl.password = "synthetic-runtime-acls-only";
const restricted = !!process.env.LEVI_TEST_RUNTIME_DATABASE_URL;
if (!restricted) {
  await observer.client.query(
    "CREATE ROLE levi_dev_bootstrap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-runtime-acls-only'",
  );
  await observer.client.query(
    "GRANT CONNECT ON DATABASE levi_test TO levi_dev_bootstrap",
  );
  await observer.client.query(
    await readFile("ops/administracao-bootstrap-acls.sql", "utf8"),
  );
}
const bootstrap = await createPostgresDatabase(bootstrapUrl.toString());

// Reset exclusivo do cluster sintético: somente seu owner pode desligar o trigger.
async function resetAdministrativeFixtures() {
  await observer.client.query(
    "ALTER TABLE admin_bootstrap DISABLE TRIGGER admin_bootstrap_permanent",
  );
  try {
    await observer.client.query(
      "TRUNCATE feature_flag_organizations, feature_flags, global_administrators, admin_bootstrap",
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE admin_bootstrap ENABLE TRIGGER admin_bootstrap_permanent",
    );
  }
}
beforeEach(async () => {
  await resetAdministrativeFixtures();
  options.adminEmail = owner.email;
});
after(async () => {
  await resetAdministrativeFixtures();
  await Promise.all([runtime.client.end(), bootstrap.client.end()]);
  if (!restricted) {
    await observer.client.query("DROP OWNED BY levi_dev_bootstrap");
    await observer.client.query("DROP ROLE levi_dev_bootstrap");
  }
  await observer.client.end();
});

const origin = "http://localhost:3000";
const secret = "synthetic-administrative-secret-with-32-characters";
const messages: Array<{ to: string; text: string }> = [];
const options = {
  databaseUrl: runtimeUrl,
  baseURL: origin,
  secret,
  adminEmail: "",
  email: {
    send: async (message: { to: string; text: string }) => {
      messages.push(message);
      return Promise.resolve();
    },
  },
};
const app = createApp(options);
async function send(path: string, body?: object, cookie = "") {
  return app.request(
    new Request(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
function link(email: string) {
  const url = messages
    .findLast((message) => message.to === email)
    ?.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(url);
  return new URL(url);
}
async function account(email = `${randomUUID()}@example.test`) {
  assert.equal((await send("/api/onboarding/email", { email })).status, 200);
  const url = link(email);
  const response = await send(url.pathname + url.search);
  assert.equal(response.status, 302);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.equal(
    (await send("/api/onboarding/password-email", {}, cookie)).status,
    200,
  );
  const token = link(email).pathname.split("/").at(-1);
  assert.ok(token);
  assert.equal(
    (
      await send(
        "/api/onboarding/password",
        { token, newPassword: "synthetic-administrative-password" },
        cookie,
      )
    ).status,
    200,
  );
  const { data: identity } = await createAuth(runtime, options).resolveSession(
    new Headers({ cookie }),
  );
  assert.ok(identity);
  return {
    email,
    cookie,
    identity,
    userId: identity.user.id,
    sessionId: identity.session.id,
  };
}
type Account = Awaited<ReturnType<typeof account>>;
function confirmation(candidate: Account) {
  return readBootstrapInput({
    ADMIN_EMAIL: candidate.email,
    LEVI_ADMIN_USER_ID: candidate.userId,
    LEVI_ADMIN_SESSION_ID: candidate.sessionId,
    LEVI_ADMIN_OPERATION_ID: randomUUID(),
    LEVI_ADMIN_IDENTITY_CONFIRMATION: `IDENTIDADE-CONFERIDA:${candidate.userId}`,
  });
}
async function boot(candidate: Account) {
  return bootstrapAdministrator({
    database: bootstrap,
    confirmation: confirmation(candidate),
  });
}
function denied(status = 404, code?: string) {
  return (error: unknown) =>
    error instanceof RequestError &&
    error.status === status &&
    (!code || error.code === code);
}
async function otherConnections<T>(
  run: (a: Database, b: Database) => Promise<T>,
) {
  const a = await createPostgresDatabase(runtimeUrl);
  const b = await createPostgresDatabase(runtimeUrl);
  try {
    return await run(a, b);
  } finally {
    await Promise.all([a.client.end(), b.client.end()]);
  }
}
async function rejectAudit() {
  await observer.client
    .query(`CREATE FUNCTION reject_admin_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic-audit-failure'; END; $$;
    CREATE TRIGGER reject_admin_test_audit BEFORE INSERT ON audit_events FOR EACH ROW
    WHEN (NEW.action LIKE 'admin.%' OR NEW.action LIKE 'feature_flag.%') EXECUTE FUNCTION reject_admin_test_audit()`);
}
async function restoreAudit() {
  await observer.client.query(
    "DROP TRIGGER reject_admin_test_audit ON audit_events; DROP FUNCTION reject_admin_test_audit()",
  );
}

// Contas verificadas pelo fluxo real Better Auth, sem criar identidades pelo runner.
const owner = await account();
const second = await account();
await account();

void test("bootstrap: identidade inválida, ambiguidade e sessão inadequadas não concedem", async () => {
  const base = confirmation(owner);
  for (const candidate of [
    { ...base, userId: second.userId },
    { ...base, sessionId: second.sessionId },
    { ...base, email: second.email },
  ])
    await assert.rejects(
      bootstrapAdministrator({ database: bootstrap, confirmation: candidate }),
      denied(),
    );
  for (const [mutate, restore] of [
    [
      'UPDATE "user" SET email_verified=false WHERE id=$1',
      'UPDATE "user" SET email_verified=true WHERE id=$1',
    ],
  ]) {
    await observer.client.query(mutate!, [owner.userId]);
    try {
      await assert.rejects(boot(owner), denied());
    } finally {
      await observer.client.query(restore!, [owner.userId]);
    }
  }
  for (const [assignment, status] of [
    ["created_at=now()-interval '11 minutes'", 403],
    ["expires_at=now()-interval '1 second'", 404],
    ["created_at=now()+interval '1 day'", 404],
    ["created_at='infinity'", 404],
    ["expires_at='infinity'", 404],
  ] as const) {
    await observer.client.query(
      `UPDATE session SET ${assignment} WHERE id=$1`,
      [owner.sessionId],
    );
    try {
      await assert.rejects(boot(owner), denied(status));
    } finally {
      await observer.client.query(
        "UPDATE session SET created_at=now(),expires_at=now()+interval '1 day' WHERE id=$1",
        [owner.sessionId],
      );
    }
  }
  await observer.client.query(
    "INSERT INTO \"user\"(name,email,email_verified) VALUES('Colisão sintética',$1,true)",
    [owner.email.toUpperCase()],
  );
  try {
    await assert.rejects(boot(owner), denied());
  } finally {
    await observer.client.query('DELETE FROM "user" WHERE email=$1', [
      owner.email.toUpperCase(),
    ]);
  }
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM global_administrators",
      )
    ).rows[0]?.n,
    0,
  );
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM admin_bootstrap",
      )
    ).rows[0]?.n,
    0,
  );
});

void test("bootstrap concorrente é único, auditado e nunca restaura acesso pelo e-mail", async () => {
  const other = await createPostgresDatabase(bootstrapUrl.toString());
  try {
    const results = await Promise.all([
      bootstrapAdministrator({
        database: bootstrap,
        confirmation: confirmation(owner),
      }),
      bootstrapAdministrator({
        database: other,
        confirmation: confirmation(second),
      }),
    ]);
    assert.deepEqual(results.map((r) => r.kind).sort(), [
      "already-completed",
      "completed",
    ]);
    const receipt = (
      await observer.client.query<Record<string, unknown>>(
        "SELECT * FROM admin_bootstrap",
      )
    ).rows[0];
    assert.ok(receipt);
    const event = await observer.client.query<Record<string, unknown>>(
      "SELECT actor,target,tenant,metadata FROM audit_events WHERE request_id=$1",
      [receipt.operation_id],
    );
    assert.equal(event.rowCount, 1);
    assert.deepEqual(event.rows[0], {
      actor: receipt.bootstrapped_user_id,
      target: receipt.bootstrapped_user_id,
      tenant: null,
      metadata: {},
    });
    await observer.client.query(
      "UPDATE global_administrators SET revoked_at=now(),version=version+1",
    );
    assert.equal((await boot(owner)).kind, "already-completed");
    assert.equal((await boot(second)).kind, "already-completed");
    await assert.rejects(
      requireGlobalAdministrator(runtime, owner.identity),
      denied(),
    );
    await assert.rejects(
      requireGlobalAdministrator(runtime, second.identity),
      denied(),
    );
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT count(*)::int AS n FROM global_administrators WHERE revoked_at IS NULL",
        )
      ).rows[0]?.n,
      0,
    );
    for (const sql of [
      "UPDATE admin_bootstrap SET operation_id=operation_id",
      "DELETE FROM admin_bootstrap",
      "TRUNCATE admin_bootstrap",
    ])
      await assert.rejects(observer.client.query(sql), { code: "42501" });
  } finally {
    await other.client.end();
  }
});

async function waitBlocked(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      (
        await observer.client.query(
          "SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted",
          [pid],
        )
      ).rowCount
    )
      return;
    await setTimeout(10);
  }
  assert.fail("A operação não aguardou o lock esperado.");
}

void test("flags: catálogo fechado, seleção validada, all inclui tenant futuro e versões conflitam", async () => {
  await boot(owner);
  const orgs = (
    await observer.client.query<Record<string, unknown>>(
      "INSERT INTO tenants(name) VALUES('Flag A'),('Flag B') RETURNING id",
    )
  ).rows.map((r) => String(r.id));
  const [orgA, orgB] = orgs;
  assert.ok(orgA && orgB);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "unknown",
      organizationId: orgA,
    }),
    false,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    false,
  );
  const update = (
    policy: unknown,
    expectedVersion: number,
    database = runtime,
  ) =>
    updateFeatureFlag({
      database,
      identity: owner.identity,
      adminEmail: options.adminEmail,
      key: "members",
      policy,
      expectedVersion,
      operationId: randomUUID(),
    });
  await assert.rejects(
    update({ kind: "selected", organizationIds: [randomUUID()] }, 0),
    denied(400),
  );
  const selected = await update(
    { kind: "selected", organizationIds: [orgA] },
    0,
  );
  assert.equal(selected.version, 1);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    true,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgB,
    }),
    false,
  );
  const future = String(
    (
      await observer.client.query<Record<string, unknown>>(
        "INSERT INTO tenants(name) VALUES('Flag futura') RETURNING id",
      )
    ).rows[0]?.id,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: future,
    }),
    false,
  );
  await assert.rejects(update({ kind: "all" }, 0), denied(409));
  await otherConnections(async (a, b) => {
    const results = await Promise.allSettled([
      update({ kind: "all" }, 1, a),
      update({ kind: "disabled" }, 1, b),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });
  const all = await update({ kind: "all" }, 2);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: future,
    }),
    true,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: randomUUID(),
    }),
    false,
  );
  const disabled = await update({ kind: "disabled" }, all.version);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    false,
  );
  const listed = await listFeatureFlags({
    database: runtime,
    identity: owner.identity,
    adminEmail: options.adminEmail,
  });
  assert.equal(listed[0]?.version, disabled.version);
  assert.deepEqual(listed[0]?.organizationIds, []);
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        "SELECT count(*)::int AS n FROM feature_flag_organizations",
      )
    ).rows[0]?.n,
    0,
  );
  await assert.rejects(
    updateFeatureFlag({
      database: runtime,
      identity: second.identity,
      adminEmail: options.adminEmail,
      key: "members",
      policy: { kind: "all" },
      expectedVersion: disabled.version,
      operationId: randomUUID(),
    }),
    denied(),
  );
});

void test("auditoria e persistência: rollback conjunto e negação diante de banco indisponível", async () => {
  await rejectAudit();
  try {
    await assert.rejects(boot(owner));
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT count(*)::int AS n FROM admin_bootstrap",
        )
      ).rows[0]?.n,
      0,
    );
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT count(*)::int AS n FROM global_administrators",
        )
      ).rows[0]?.n,
      0,
    );
  } finally {
    await restoreAudit();
  }
  await boot(owner);
  const org = String(
    (
      await observer.client.query<Record<string, unknown>>(
        "INSERT INTO tenants(name) VALUES('Flag rollback') RETURNING id",
      )
    ).rows[0]?.id,
  );
  const selected = await updateFeatureFlag({
    database: runtime,
    identity: owner.identity,
    adminEmail: options.adminEmail,
    key: "members",
    policy: { kind: "selected", organizationIds: [org] },
    expectedVersion: 0,
    operationId: randomUUID(),
  });
  await rejectAudit();
  try {
    await assert.rejects(
      updateFeatureFlag({
        database: runtime,
        identity: owner.identity,
        adminEmail: options.adminEmail,
        key: "members",
        policy: { kind: "disabled" },
        expectedVersion: 1,
        operationId: randomUUID(),
      }),
    );
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT version FROM feature_flags WHERE id=$1",
          [selected.id],
        )
      ).rows[0]?.version,
      1,
    );
    assert.equal(
      await featureAvailable({
        database: runtime,
        key: "members",
        organizationId: org,
      }),
      true,
    );
  } finally {
    await restoreAudit();
  }
  await observer.client.query(
    "ALTER TABLE global_administrators RENAME TO unavailable_global_administrators",
  );
  try {
    assert.equal(
      await requireGlobalAdministrator(
        runtime,
        owner.identity,
        options.adminEmail,
      ),
      owner.userId,
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE unavailable_global_administrators RENAME TO global_administrators",
    );
  }
  await observer.client.query(
    "ALTER TABLE feature_flags RENAME TO unavailable_feature_flags",
  );
  try {
    await assert.rejects(
      featureAvailable({
        database: runtime,
        key: "members",
        organizationId: org,
      }),
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE unavailable_feature_flags RENAME TO feature_flags",
    );
  }
});

void test("escopo da auditoria preserva eventos organizacionais e append-only", async () => {
  const insert = (action: string, tenant: string | null) =>
    observer.client.query<Record<string, unknown>>(
      "INSERT INTO audit_events(actor,action,target,tenant,timestamp,metadata,result) VALUES($1,$2,$3,$4,now(),'{}','success')",
      [owner.userId, action, owner.userId, tenant],
    );
  const tenant = String(
    (
      await observer.client.query<Record<string, unknown>>(
        "INSERT INTO tenants(name) VALUES('Audit sintético') RETURNING id",
      )
    ).rows[0]?.id,
  );
  await insert("member.created", tenant);
  await insert("admin.granted", null);
  for (const action of [
    "member.created",
    "unknown",
    "feature_flag.organization_added",
  ])
    await assert.rejects(insert(action, null), { code: "23514" });
  await assert.rejects(insert("admin.granted", tenant), { code: "23514" });
  for (const sql of [
    "UPDATE audit_events SET result=result WHERE false",
    "DELETE FROM audit_events WHERE false",
  ])
    await assert.rejects(observer.client.query(sql));
});

void test("runner externo no cluster sintético: preflight, confirmação, consumo único e saída sanitizada", () => {
  const input = confirmation(owner);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    LEVI_LOCAL_DATABASE: "1",
    ADMIN_EMAIL: owner.email,
    LEVI_ADMIN_USER_ID: input.userId,
    LEVI_ADMIN_SESSION_ID: input.sessionId,
    LEVI_ADMIN_OPERATION_ID: input.operationId,
    LEVI_ADMIN_IDENTITY_CONFIRMATION: `IDENTIDADE-CONFERIDA:${input.userId}`,
    LEVI_ADMIN_DATABASE_URL: bootstrapUrl.toString(),
    LEVI_ADMIN_DATABASE_HOST: bootstrapUrl.hostname,
    LEVI_ADMIN_DATABASE_NAME: "levi_test",
    LEVI_ADMIN_TARGET_CONFIRMATION: "BOOTSTRAP:127.0.0.1/levi_test",
  };
  const run = () =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tools/bootstrap-admin.ts"],
      { env, encoding: "utf8" },
    );
  assert.ok(run().includes('"resultado":"completed"'));
  const output = run();
  assert.ok(output.includes('"resultado":"already-completed"'));
  for (const privateValue of [
    owner.email,
    owner.sessionId,
    bootstrapUrl.password,
    bootstrapUrl.toString(),
  ])
    assert.ok(!output.includes(privateValue));
});

void test("ACL bootstrap separa privilégios; runtime restrita não altera recibo, chaves ou auditoria", async () => {
  await boot(owner);
  for (const statement of [
    "UPDATE global_administrators SET revoked_at=now()",
    "DELETE FROM global_administrators",
    "UPDATE admin_bootstrap SET id=id",
    "DELETE FROM admin_bootstrap",
    "TRUNCATE admin_bootstrap",
    'UPDATE "user" SET email=email',
    'UPDATE "user" SET email_verified=true',
    "UPDATE account SET password=password",
    "INSERT INTO tenants(name) VALUES('forbidden')",
    "SELECT * FROM feature_flags",
    "SELECT * FROM audit_events",
    "CREATE TABLE forbidden_admin_fixture(id int)",
    "ALTER TABLE admin_bootstrap DISABLE TRIGGER admin_bootstrap_permanent",
  ])
    await assert.rejects(bootstrap.client.query(statement), { code: "42501" });
  if (restricted) {
    for (const statement of [
      "SELECT * FROM admin_bootstrap",
      "DELETE FROM admin_bootstrap",
      "TRUNCATE admin_bootstrap",
      "UPDATE audit_events SET result=result",
      "DELETE FROM audit_events",
      "TRUNCATE audit_events",
      "DELETE FROM global_administrators",
      "UPDATE global_administrators SET user_id=user_id",
      "DELETE FROM feature_flags",
      "UPDATE feature_flags SET key=key",
      "UPDATE feature_flags SET id=id",
    ])
      await assert.rejects(runtime.client.query(statement), { code: "42501" });
    await runtime.client.query(
      "INSERT INTO global_administrators(user_id) VALUES($1)",
      [second.userId],
    );
  }
});

void test("ACLs administrativas exatas por coluna, sem grant option e sem ampliar as legadas", async () => {
  const globalColumns = [
    "user_id",
    "granted_at",
    "granted_by",
    "revoked_at",
    "version",
  ];
  const flagColumns = [
    "id",
    "key",
    "policy",
    "version",
    "updated_at",
    "updated_by",
  ];
  const receiptColumns = [
    "id",
    "bootstrapped_user_id",
    "completed_at",
    "operation_id",
  ];
  const bootstrapGroups: [string, string, string[]][] = [
    ["user", "SELECT", ["id", "email", "email_verified"]],
    ["user", "UPDATE", ["updated_at"]],
    [
      "account",
      "SELECT",
      ["id", "user_id", "provider_id", "account_id", "password"],
    ],
    ["account", "UPDATE", ["updated_at"]],
    ["session", "SELECT", ["id", "user_id", "created_at", "expires_at"]],
    ["session", "UPDATE", ["updated_at"]],
    ["global_administrators", "SELECT", ["user_id"]],
    ["global_administrators", "INSERT", globalColumns],
    ["admin_bootstrap", "SELECT", receiptColumns],
    ["admin_bootstrap", "INSERT", receiptColumns],
    [
      "audit_events",
      "INSERT",
      [
        "id",
        "actor",
        "action",
        "target",
        "tenant",
        "timestamp",
        "metadata",
        "request_id",
        "result",
      ],
    ],
  ];
  const runtimeGroups: [string, string, string[]][] = [
    ["global_administrators", "SELECT", globalColumns],
    ["global_administrators", "INSERT", globalColumns],
    [
      "global_administrators",
      "UPDATE",
      ["granted_at", "granted_by", "revoked_at", "version"],
    ],
    ["feature_flags", "SELECT", flagColumns],
    ["feature_flags", "INSERT", flagColumns],
    [
      "feature_flags",
      "UPDATE",
      ["policy", "version", "updated_at", "updated_by"],
    ],
    [
      "feature_flag_organizations",
      "SELECT",
      ["feature_flag_id", "organization_id"],
    ],
    [
      "feature_flag_organizations",
      "INSERT",
      ["feature_flag_id", "organization_id"],
    ],
  ];
  const roles = restricted
    ? ["levi_dev_bootstrap", "levi_dev_runtime"]
    : ["levi_dev_bootstrap"];
  for (const role of roles) {
    const groups =
      role === "levi_dev_bootstrap" ? bootstrapGroups : runtimeGroups;
    const { rows } = await observer.client.query<{
      table: string;
      column: string;
      privilege: string;
      grantable: boolean;
    }>(
      `
      SELECT c.relname AS table, a.attname AS column, x.privilege_type AS privilege, x.is_grantable AS grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) x
      WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND x.grantee=$1::text::regrole
      AND ($1 = 'levi_dev_bootstrap' OR c.relname IN ('global_administrators','feature_flags','feature_flag_organizations','admin_bootstrap'))`,
      [role],
    );
    assert.deepEqual(
      rows.map((r) => `${r.table}.${r.column}:${r.privilege}`).sort(),
      groups
        .flatMap(([table, privilege, columns]) =>
          columns.map((column) => `${table}.${column}:${privilege}`),
        )
        .sort(),
    );
    assert.ok(rows.every((row) => !row.grantable));
    const tableAcl = await observer.client.query<{
      table: string;
      privilege: string;
    }>(
      `
      SELECT c.relname AS table,x.privilege_type AS privilege FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
      WHERE c.relnamespace='public'::regnamespace AND x.grantee=$1::text::regrole
      AND ($1 = 'levi_dev_bootstrap' OR c.relname IN ('global_administrators','feature_flags','feature_flag_organizations','admin_bootstrap'))`,
      [role],
    );
    assert.deepEqual(
      tableAcl.rows,
      role === "levi_dev_bootstrap"
        ? []
        : [{ table: "feature_flag_organizations", privilege: "DELETE" }],
    );
  }
});

void test("upgrade 0000–0004 para schema administrativo preserva dados e não ativa funcionalidades", async () => {
  const directory = await mkdtemp(join(tmpdir(), "levi-admin-upgrade-"));
  const url = new URL(observerUrl);
  url.pathname = "/levi_admin_upgrade_test";
  await observer.client.query("CREATE DATABASE levi_admin_upgrade_test");
  const old = await createPostgresDatabase(url.toString());
  try {
    await cp("migrations", directory, { recursive: true });
    const journal: unknown = JSON.parse(
      await readFile(join(directory, "meta/_journal.json"), "utf8"),
    );
    assert.ok(
      journal &&
        typeof journal === "object" &&
        "entries" in journal &&
        Array.isArray(journal.entries),
    );
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) }),
    );
    await migrate(old.db, { migrationsFolder: directory });
    const userId = String(
      (
        await old.client.query<Record<string, unknown>>(
          "INSERT INTO \"user\"(name,email,email_verified) VALUES('Conta preservada','upgrade@example.test',true) RETURNING id",
        )
      ).rows[0]?.id,
    );
    const tenant = String(
      (
        await old.client.query<Record<string, unknown>>(
          "INSERT INTO tenants(name) VALUES('Tenant preservado') RETURNING id",
        )
      ).rows[0]?.id,
    );
    const church = String(
      (
        await old.client.query<Record<string, unknown>>(
          "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja preservada') RETURNING id",
          [tenant],
        )
      ).rows[0]?.id,
    );
    const member = String(
      (
        await old.client.query<Record<string, unknown>>(
          "INSERT INTO members(tenant_id,church_id,name,status) VALUES($1,$2,'Ficha preservada','Ativo') RETURNING id",
          [tenant, church],
        )
      ).rows[0]?.id,
    );
    await old.client.query(
      "INSERT INTO audit_events(actor,action,target,tenant,timestamp,metadata,result) VALUES($1,'member.created',$2,$3,now(),'{}','success')",
      [userId, member, tenant],
    );
    async function preservedRows() {
      const result = [];
      for (const table of [
        "user",
        "tenants",
        "churches",
        "members",
        "audit_events",
      ])
        result.push(
          (
            await old.client.query<Record<string, unknown>>(
              `SELECT * FROM "${table}"`,
            )
          ).rows,
        );
      return result;
    }
    const before = await preservedRows();
    await migrate(old.db, { migrationsFolder: "migrations" });
    await migrate(old.db, { migrationsFolder: "migrations" });
    assert.deepEqual(await preservedRows(), before);
    for (const table of [
      "global_administrators",
      "admin_bootstrap",
      "feature_flags",
      "feature_flag_organizations",
    ])
      assert.equal(
        (
          await old.client.query<Record<string, unknown>>(
            `SELECT count(*)::int AS n FROM ${table}`,
          )
        ).rows[0]?.n,
        0,
      );
  } finally {
    await old.client.end();
    await observer.client.query("DROP DATABASE levi_admin_upgrade_test");
    await rm(directory, { recursive: true, force: true });
  }
});

// O lock é PostgreSQL real; somente a passagem do tempo é acelerada no teste.
async function denyAfterAuditWait(input: {
  context: TestContext;
  database: Database;
  operation: () => Promise<unknown>;
  advanceTo: number;
  status: number;
}) {
  const pid = Number(
    (
      await input.database.client.query<Record<string, unknown>>(
        "SELECT pg_backend_pid() AS pid",
      )
    ).rows[0]?.pid,
  );
  await observer.client.query("BEGIN");
  await observer.client.query("LOCK TABLE audit_events IN SHARE MODE");
  const outcome = input.operation().then(
    () => ({ kind: "accepted" }) as const,
    (error: unknown) => ({ kind: "denied", error }) as const,
  );
  try {
    try {
      await waitBlocked(pid);
      input.context.mock.method(Date, "now", () => input.advanceTo);
    } finally {
      await observer.client.query("COMMIT");
    }
    const result = await outcome;
    assert.equal(
      result.kind,
      "denied",
      "A sessão deixou de satisfazer o contrato durante a espera por auditoria.",
    );
    if (result.kind === "denied") assert.ok(denied(input.status)(result.error));
  } finally {
    await outcome;
    input.context.mock.restoreAll();
  }
}

void test("flag: sessão expirada após autorização e antes do commit desfaz política e auditoria", async (t) => {
  await boot(owner);
  const operationId = randomUUID();
  const { rows } = await observer.client.query<{ expires_at: Date }>(
    "SELECT expires_at FROM session WHERE id=$1",
    [owner.sessionId],
  );
  assert.ok(rows[0]);
  await denyAfterAuditWait({
    context: t,
    database: runtime,
    advanceTo: rows[0].expires_at.getTime() + 1,
    status: 404,
    operation: () =>
      updateFeatureFlag({
        database: runtime,
        identity: owner.identity,
        adminEmail: options.adminEmail,
        key: "members",
        policy: { kind: "all" },
        expectedVersion: 0,
        operationId,
      }),
  });
  assert.equal(
    (await observer.client.query("SELECT 1 FROM feature_flags")).rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1",
        [operationId],
      )
    ).rowCount,
    0,
  );
});

void test("bootstrap: recência vencida durante a auditoria não consome recibo nem concede acesso", async (t) => {
  const confirmed = confirmation(owner);
  await denyAfterAuditWait({
    context: t,
    database: bootstrap,
    advanceTo: Date.now() + 11 * 60_000,
    status: 403,
    operation: () =>
      bootstrapAdministrator({ database: bootstrap, confirmation: confirmed }),
  });
  assert.equal(
    (await observer.client.query("SELECT 1 FROM admin_bootstrap")).rowCount,
    0,
  );
  assert.equal(
    (await observer.client.query("SELECT 1 FROM global_administrators"))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1",
        [confirmed.operationId],
      )
    ).rowCount,
    0,
  );
});

void test("HTTP administrativo oculta HTML, métodos, aliases e validação antes de autorizar", async () => {
  const common = await account();
  const provisioned = await app.request(
    new Request(origin + "/api/organizations", {
      method: "POST",
      headers: {
        cookie: common.cookie,
        origin,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        organizationName: "Owner sem concessão global",
        churchName: "Igreja",
      }),
    }),
  );
  assert.equal(provisioned.status, 201);
  const protectedApp = createApp(options);
  const { mountWeb } = await import("../src/web.js");
  mountWeb(protectedApp);
  const paths = [
    "/admin",
    "/admin/",
    "/admin/qualquer",
    "/api/admin",
    "/api/admin/features",
    "/api/admin/accounts/find",
    "/api/admin/administrators/invalido",
    "/api/admin/nao-existe",
    "/ADMIN",
    "/%61dmin",
    "/api/%61dmin",
    "/api/admin%2ffeatures",
    "//admin",
    "/api//admin/features",
  ];
  for (const cookie of [
    "",
    "better-auth.session_token=invalida",
    common.cookie,
  ])
    for (const path of paths)
      for (const method of [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ]) {
        const response = await protectedApp.request(
          new Request(origin + path, {
            method,
            headers: {
              cookie,
              origin: "https://hostil.example",
              "content-type": "text/plain",
            },
            ...(!["GET", "HEAD"].includes(method)
              ? { body: "x".repeat(20_000) }
              : {}),
          }),
        );
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.equal(response.headers.get("ratelimit-limit"), null);
        assert.equal(response.headers.get("x-frame-options"), "DENY");
      }
});

void test("HTTP administrativo permite conta sem organização e não concede acesso ao tenant", async () => {
  const actor = await account();
  options.adminEmail = actor.email;
  const protectedApp = createApp(options);
  const { mountWeb } = await import("../src/web.js");
  mountWeb(protectedApp);
  const html = await protectedApp.request(
    new Request(origin + "/admin", { headers: { cookie: actor.cookie } }),
  );
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(html.headers.get("cache-control"), "private, no-store");
  assert.ok(html.headers.get("content-security-policy"));
  const sessionResponse = await send(
    "/api/admin/session",
    undefined,
    actor.cookie,
  );
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), {
    userId: actor.userId,
    sessionId: actor.sessionId,
  });
  const organizations = await send(
    "/api/admin/organizations",
    undefined,
    actor.cookie,
  );
  assert.equal(organizations.status, 200);
  const orgs = (await organizations.json()) as { items: object[] };
  for (const org of orgs.items)
    assert.deepEqual(Object.keys(org).sort(), ["id", "name"]);
  assert.equal(
    (await send("/api/context", undefined, actor.cookie)).status,
    403,
  );
  assert.equal(
    (await send("/api/churches", undefined, actor.cookie)).status,
    403,
  );
  const catalog = await send("/api/admin/features", undefined, actor.cookie);
  assert.deepEqual(await catalog.json(), {
    features: [
      { key: "members", policy: "disabled", version: 0, organizationIds: [] },
    ],
  });
  const csrf = await protectedApp.request(
    new Request(origin + "/api/admin/accounts/find", {
      method: "POST",
      headers: {
        cookie: actor.cookie,
        origin: "https://hostil.example",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  assert.equal(csrf.status, 403);
  const oversized = await protectedApp.request(
    new Request(origin + "/api/admin/accounts/find", {
      method: "POST",
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "x".repeat(20_000) }),
    }),
  );
  assert.equal(oversized.status, 413);
});

async function adminMutation(
  path: string,
  method: string,
  body: object,
  actor: Account,
) {
  return app.request(
    new Request(origin + path, {
      method,
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

void test("API de flags valida catálogo, confirmação all, seleções e versão sem mudar membros", async () => {
  const actor = await account();
  options.adminEmail = actor.email;
  const owner = await account();
  const organization = await send(
    "/api/organizations",
    { organizationName: "Organização de seleção", churchName: "Igreja" },
    owner.cookie,
  );
  // Provisionamento exige chave de idempotência; usa o contrato público existente.
  assert.equal(organization.status, 400);
  const provision = await app.request(
    new Request(origin + "/api/organizations", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        organizationName: "Organização de seleção",
        churchName: "Igreja",
      }),
    }),
  );
  assert.equal(provision.status, 201);
  const { organizationId } = (await provision.json()) as {
    organizationId: string;
  };
  const path = "/api/admin/features/members";
  assert.equal(
    (
      await adminMutation(
        path,
        "PUT",
        { policy: { kind: "all" }, expectedVersion: 0 },
        actor,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await adminMutation(
        "/api/admin/features/arbitraria",
        "PUT",
        { policy: { kind: "disabled" }, expectedVersion: 0 },
        actor,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await adminMutation(
        path,
        "PUT",
        {
          policy: { kind: "selected", organizationIds: [randomUUID()] },
          expectedVersion: 0,
        },
        actor,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await adminMutation(
        path,
        "PUT",
        {
          policy: { kind: "selected", organizationIds: [organizationId] },
          expectedVersion: 0,
        },
        actor,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await adminMutation(
        path,
        "PUT",
        { policy: { kind: "disabled" }, expectedVersion: 0 },
        actor,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await adminMutation(
        path,
        "PUT",
        { policy: { kind: "all" }, expectedVersion: 1, confirmAll: true },
        actor,
      )
    ).status,
    200,
  );
  const flags = await send("/api/admin/features", undefined, actor.cookie);
  assert.deepEqual(await flags.json(), {
    features: [
      { key: "members", policy: "all", version: 2, organizationIds: [] },
    ],
  });
  assert.equal(
    (await send("/api/members", undefined, owner.cookie)).status,
    200,
  );
  assert.equal(
    (await send("/api/churches", undefined, actor.cookie)).status,
    403,
  );
  const delta = await observer.client.query<Record<string, unknown>>(
    "SELECT tenant FROM audit_events WHERE action='feature_flag.organization_added' AND tenant=$1",
    [organizationId],
  );
  assert.equal(delta.rowCount, 1);
});

void test("quota administrativa ocorre só após autorização, inclusive quando esgotada", async () => {
  const actor = await account();
  options.adminEmail = actor.email;
  const { createHmac } = await import("node:crypto");
  const digest = createHmac("sha256", secret)
    .update(`user:${actor.userId}`)
    .digest("hex");
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  for (const window of [start, start + 60_000])
    await observer.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,60,$2) ON CONFLICT(key) DO UPDATE SET count=60",
      [`v2:admin:${digest}:${window}`, new Date(window + 60_000)],
    );
  const limited = await send("/api/admin/features", undefined, actor.cookie);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  assert.equal((await send("/api/admin/features")).status, 404);
  assert.equal(
    (await send("/api/admin/features", undefined, (await account()).cookie))
      .status,
    404,
  );
});

void test("API preserva seleção de 1000 organizações e falha fechada se não pode consultar autoridade", async () => {
  const actor = await account();
  options.adminEmail = actor.email;
  const ids = Array.from({ length: 1000 }, () => randomUUID());
  await observer.client.query(
    "INSERT INTO tenants(id,name) SELECT id,'Seleção sintética' FROM unnest($1::uuid[]) AS id",
    [ids],
  );
  const response = await adminMutation(
    "/api/admin/features/members",
    "PUT",
    { policy: { kind: "selected", organizationIds: ids }, expectedVersion: 0 },
    actor,
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as {
    feature: { organizationIds: string[] };
  };
  assert.deepEqual(result.feature.organizationIds, [...ids].sort());
  const unavailableUrl = new URL(runtimeUrl);
  unavailableUrl.pathname = "/levi_admin_nonexistent_test";
  const unavailable = createApp({
    ...options,
    databaseUrl: unavailableUrl.toString(),
  });
  for (const path of ["/admin", "/api/admin/session", "/api/admin/features"])
    assert.equal(
      (
        await unavailable.request(
          new Request(origin + path, { headers: { cookie: actor.cookie } }),
        )
      ).status,
      404,
    );
});

void test("e-mail configurado é a única autoridade; sessão e identidade atuais são obrigatórias", async () => {
  assert.equal(
    await requireGlobalAdministrator(
      runtime,
      owner.identity,
      `  ${owner.email.toUpperCase()}  `,
    ),
    owner.userId,
  );
  await observer.client.query(
    "INSERT INTO global_administrators(user_id) VALUES($1)",
    [second.userId],
  );
  for (const configuration of [
    undefined,
    "",
    "  ",
    "inválido",
    `${owner.email},${second.email}`,
    second.email,
  ]) {
    await assert.rejects(
      requireGlobalAdministrator(runtime, owner.identity, configuration),
      denied(),
    );
  }
  await assert.rejects(
    requireGlobalAdministrator(runtime, second.identity, owner.email),
    denied(),
  );
  await assert.rejects(
    requireGlobalAdministrator(runtime, null, owner.email),
    denied(),
  );
  for (const statement of [
    `UPDATE "user" SET email_verified=false WHERE id=$1`,
    `UPDATE "user" SET email='changed@example.test' WHERE id=$1`,
    `UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1`,
    `UPDATE session SET created_at=now()+interval '1 day' WHERE user_id=$1`,
  ]) {
    const table = statement.includes('UPDATE "user"')
      ? "user"
      : statement.includes("UPDATE session")
        ? "session"
        : "account";
    const previous = await observer.client.query<Record<string, unknown>>(
      `SELECT * FROM "${table}" WHERE ${table === "user" ? "id" : "user_id"}=$1`,
      [owner.userId],
    );
    await observer.client.query(statement, [owner.userId]);
    try {
      await assert.rejects(
        requireGlobalAdministrator(runtime, owner.identity, owner.email),
        denied(),
      );
    } finally {
      if (table === "user")
        await observer.client.query(
          'UPDATE "user" SET email=$2,email_verified=$3 WHERE id=$1',
          [
            owner.userId,
            previous.rows[0]?.email,
            previous.rows[0]?.email_verified,
          ],
        );
      if (table === "session")
        for (const row of previous.rows)
          await observer.client.query(
            "UPDATE session SET expires_at=$2,created_at=$3 WHERE id=$1",
            [row.id, row.expires_at, row.created_at],
          );
      if (table === "account")
        for (const row of previous.rows)
          await observer.client.query(
            "UPDATE account SET password=$2 WHERE id=$1",
            [row.id, row.password],
          );
    }
  }
  for (const configured of [undefined, "", "invalid", second.email]) {
    const deniedApp = createApp({ ...options, adminEmail: configured });
    for (const path of ["/admin", "/api/admin/session", "/api/admin/features"])
      assert.equal(
        (
          await deniedApp.request(
            new Request(origin + path, { headers: { cookie: owner.cookie } }),
          )
        ).status,
        404,
      );
  }
  const response = await send("/api/admin/session", undefined, owner.cookie);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(owner.email));
  for (const [method, path] of [
    ["GET", "/api/admin/administrators"],
    ["POST", "/api/admin/accounts/find"],
    ["PATCH", `/api/admin/administrators/${second.userId}`],
  ] as const) {
    const response = await app.request(
      new Request(origin + path, {
        method,
        headers: { origin, cookie: owner.cookie },
      }),
    );
    assert.equal(response.status, 404);
  }
});

void test("mudança de identidade enquanto a política aguarda lock nega a mutation sem auditoria", async () => {
  await otherConnections(async (a, b) => {
    const pid = Number(
      (
        await a.client.query<Record<string, unknown>>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows[0]?.pid,
    );
    await b.client.query("BEGIN");
    await b.client.query("SELECT pg_advisory_xact_lock(715463,2)");
    const pending = assert.rejects(
      updateFeatureFlag({
        database: a,
        identity: owner.identity,
        adminEmail: owner.email,
        key: "members",
        policy: { kind: "all" },
        expectedVersion: 0,
        operationId: randomUUID(),
      }),
      denied(),
    );
    try {
      await waitBlocked(pid);
      await observer.client.query(
        'UPDATE "user" SET email_verified=false WHERE id=$1',
        [owner.userId],
      );
    } finally {
      await b.client.query("COMMIT");
    }
    try {
      await pending;
    } finally {
      await observer.client.query(
        'UPDATE "user" SET email_verified=true WHERE id=$1',
        [owner.userId],
      );
    }
    assert.equal(
      (await observer.client.query("SELECT 1 FROM feature_flags")).rowCount,
      0,
    );
  });
});

void test("identidade ambígua, aliases, sessão removida e identidade forjada não concedem acesso", async () => {
  const duplicate = randomUUID();
  await observer.client.query(
    'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
    [duplicate, "Conta sintética ambígua", owner.email.toUpperCase()],
  );
  try {
    await assert.rejects(
      requireGlobalAdministrator(runtime, owner.identity, owner.email),
      denied(),
    );
  } finally {
    await observer.client.query('DELETE FROM "user" WHERE id=$1', [duplicate]);
  }
  await assert.rejects(
    requireGlobalAdministrator(
      runtime,
      {
        ...owner.identity,
        user: { ...owner.identity.user, emailVerified: false },
      },
      owner.email,
    ),
    denied(),
  );
  await assert.rejects(
    requireGlobalAdministrator(
      runtime,
      {
        ...owner.identity,
        session: { ...owner.identity.session, id: second.sessionId },
      },
      owner.email,
    ),
    denied(),
  );
  await assert.rejects(
    requireGlobalAdministrator(
      runtime,
      owner.identity,
      owner.email.replace("@", "+tag@"),
    ),
    denied(),
  );
  const actor = await account();
  const configured = createApp({ ...options, adminEmail: actor.email });
  const path = origin + "/api/admin/session";
  assert.equal(
    (
      await configured.request(
        new Request(path, { headers: { cookie: actor.cookie } }),
      )
    ).status,
    200,
  );
  await observer.client.query("DELETE FROM session WHERE id=$1", [
    actor.sessionId,
  ]);
  assert.equal(
    (
      await configured.request(
        new Request(path, { headers: { cookie: actor.cookie } }),
      )
    ).status,
    404,
  );
  await assert.rejects(
    requireGlobalAdministrator(runtime, actor.identity, actor.email),
    denied(),
  );
});

void test("administrador configurado mantém autoridade sem senha; conta comum continua negada", async () => {
  await observer.client.query(
    "UPDATE account SET password=NULL WHERE user_id=$1",
    [owner.userId],
  );
  assert.equal(
    await requireGlobalAdministrator(runtime, owner.identity, owner.email),
    owner.userId,
  );
  await assert.rejects(
    requireGlobalAdministrator(runtime, second.identity, owner.email),
    denied(),
  );
});
