import { hashInvitationToken } from "@t00ls-dev/tenant";
import {
  sendInvitation,
  listInvitations,
  cancelInvitation,
  acceptChurchInvitation,
} from "../src/invitations.js";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import type { FoundationSession } from "@t00ls-dev/auth";
import {
  applicationDatabaseUrl,
  localTestDatabaseUrl,
} from "./runtime-acl-fixture.js";
import {
  createChurch,
  listChurches,
  selectChurch,
  editChurch,
  changeAccess,
  churchContext,
} from "../src/churches.js";
import { createMember, findMember, listMembers } from "../src/members.js";
import { RequestError } from "../src/contracts.js";

const url = process.env.LEVI_DATABASE_URL ?? "";
localTestDatabaseUrl(url, "levi_test");
const owner = await createPostgresDatabase(url);
const runtime = await createPostgresDatabase(applicationDatabaseUrl(url));
after(async () => {
  await runtime.client.end();
  await owner.client.end();
});
const script = (name: string) =>
  readFile(new URL(`../ops/etapa3/${name}.sql`, import.meta.url), "utf8");
async function identity(): Promise<FoundationSession> {
  const id = randomUUID(),
    sid = randomUUID(),
    now = new Date(),
    expiresAt = new Date(Date.now() + 3600000);
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO \"user\"(id,name,email,email_verified,created_at,updated_at) VALUES($1,'Sintético',$2,true,now(),now())",
    [id, `${id}@example.test`],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now())",
    [sid, id, randomUUID(), expiresAt],
  );
  return {
    user: {
      id,
      name: "Sintético",
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      image: null,
    },
    session: {
      id: sid,
      userId: id,
      token: randomUUID(),
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}
async function error(task: Promise<unknown>, status: number) {
  await assert.rejects(
    task,
    (e: unknown) => e instanceof RequestError && e.status === status,
  );
}
const memberInput = (churchId: string) => ({
  churchId,
  name: "Membro sintético",
  status: "Ativo" as const,
  birthDate: null,
  phone: null,
  email: null,
  joinedOn: null,
  address: null,
  baptismDate: null,
  churchRole: null,
});

void test("conversão determinística preserva UUIDs, acesso exato, históricos e auditoria; expansão aceita escritor antigo", async () => {
  const who = await identity();
  const zero = randomUUID(),
    one = randomUUID(),
    many = randomUUID();
  for (const id of [zero, one, many]) {
    await owner.client.query<Record<string, unknown>>(
      "INSERT INTO tenants(id,name) VALUES($1,'Legado')",
      [id],
    );
    await owner.client.query<Record<string, unknown>>(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [id, who.user.id],
    );
  }
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [i, id] of ids.entries())
    await owner.client.query<Record<string, unknown>>(
      "INSERT INTO churches(id,tenant_id,name) VALUES($1,$2,'Igreja legada')",
      [id, i === 0 ? one : many],
    );
  const mid = randomUUID();
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO members(id,tenant_id,church_id,name,status) VALUES($1,$2,$3,'Legado','Ativo')",
    [mid, one, ids[0]],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO member_history(tenant_id,member_id,actor_id,church_name,initial_status) VALUES($1,$2,$3,'Snapshot','Ativo')",
    [one, mid, who.user.id],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO audit_events(actor,target,tenant,action,timestamp,metadata,result) VALUES($1,$2,$3,'member.created',now(),'{}','success')",
    [who.user.id, mid, one],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO member_creation_requests(tenant_id,member_id,actor_id,request_key,request_hash) VALUES($1,$2,$3,'legacy-request','preserved-hash')",
    [one, mid, who.user.id],
  );
  await owner.client.query<Record<string, unknown>>(
    "UPDATE tenant_memberships SET role='unknown' WHERE tenant_id=$1",
    [zero],
  );
  await owner.client.query<Record<string, unknown>>("BEGIN");
  await assert.rejects(
    owner.client.query<Record<string, unknown>>(await script("converter")),
    /desconhecidos/,
  );
  await owner.client.query<Record<string, unknown>>("ROLLBACK");
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT count(*)::int n FROM church_memberships",
      )
    ).rows[0]?.n,
    0,
  );
  await owner.client.query<Record<string, unknown>>(
    "UPDATE tenant_memberships SET role='admin' WHERE tenant_id=$1",
    [zero],
  );
  await owner.client.query<Record<string, unknown>>("BEGIN");
  const orphanOrganization = randomUUID();
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO tenants(id,name) VALUES($1,'Sem admin')",
    [orphanOrganization],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Órfã')",
    [orphanOrganization],
  );
  await assert.rejects(
    owner.client.query<Record<string, unknown>>(await script("converter")),
    /sem administrador/,
  );
  await owner.client.query<Record<string, unknown>>("ROLLBACK");
  const single = await identity();
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [one, single.user.id],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO tenant_sessions(session_id,active_tenant_id) VALUES($1,$2),($3,$4)",
    [who.session.id, many, single.session.id, one],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO onboarding_provisions(user_id,tenant_id,church_id,request_key,request_hash) VALUES($1,$2,$3,'old-onboarding-key','old-onboarding-hash')",
    [who.user.id, one, ids[0]],
  );
  const flagId = randomUUID();
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO feature_flags(id,key,policy,version,updated_by) VALUES($1,'members','selected',7,$2)",
    [flagId, who.user.id],
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO feature_flag_organizations(feature_flag_id,organization_id) VALUES($1,$2),($1,$3)",
    [flagId, many, zero],
  );
  const flagBefore = (
    await owner.client.query<Record<string, unknown>>(
      "SELECT * FROM feature_flags WHERE id=$1",
      [flagId],
    )
  ).rows;
  const archivedTables = [
    "tenants",
    "tenant_memberships",
    "tenant_sessions",
    "onboarding_provisions",
    "feature_flag_organizations",
  ];
  const archivedBefore = [];
  for (const table of archivedTables)
    archivedBefore.push(
      (
        await owner.client.query<Record<string, unknown>>(
          `SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
    );
  const previous = (
    await owner.client.query<Record<string, unknown>>(
      "SELECT * FROM audit_events",
    )
  ).rows;
  await owner.client.query<Record<string, unknown>>("BEGIN");
  await owner.client.query<Record<string, unknown>>(await script("converter"));
  await owner.client.query<Record<string, unknown>>("COMMIT");
  assert.deepEqual(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT * FROM audit_events",
      )
    ).rows,
    previous,
  );
  assert.deepEqual(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT church_id FROM church_memberships WHERE user_id=$1 ORDER BY church_id",
        [who.user.id],
      )
    ).rows.map((r) => r.church_id),
    ids.sort(),
  );
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT church_id FROM member_history WHERE member_id=$1",
        [mid],
      )
    ).rows[0]?.church_id,
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT church_id FROM members WHERE id=$1",
        [mid],
      )
    ).rows[0]?.church_id,
  );
  await owner.client.query<Record<string, unknown>>("BEGIN");
  await owner.client.query<Record<string, unknown>>(await script("converter"));
  await owner.client.query<Record<string, unknown>>("COMMIT");

  const migratorUrl = process.env.LEVI_TEST_MIGRATOR_DATABASE_URL;
  if (migratorUrl) {
    const migrator = await createPostgresDatabase(migratorUrl);
    try {
      await migrator.client.query<Record<string, unknown>>(
        await script("runtime-acls"),
      );
    } finally {
      await migrator.client.end();
    }
  }
  await owner.client.query<Record<string, unknown>>("BEGIN");
  await owner.client.query<Record<string, unknown>>(await script("contract"));
  await owner.client.query<Record<string, unknown>>("COMMIT");
  assert.deepEqual(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT * FROM feature_flags WHERE id=$1",
        [flagId],
      )
    ).rows,
    flagBefore,
  );
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT count(*)::int n FROM feature_flag_churches WHERE feature_flag_id=$1",
        [flagId],
      )
    ).rows[0]?.n,
    2,
  );
  for (const [index, table] of archivedTables.entries()) {
    assert.deepEqual(
      (
        await owner.client.query<Record<string, unknown>>(
          `SELECT to_jsonb(t) AS row FROM levi_legacy.${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows,
      archivedBefore[index],
    );
    await assert.rejects(
      owner.client.query<Record<string, unknown>>(
        `DELETE FROM levi_legacy.${table} WHERE false`,
      ),
    );
    if (process.env.LEVI_TEST_RUNTIME_DATABASE_URL)
      await assert.rejects(
        runtime.client.query<Record<string, unknown>>(
          `SELECT * FROM levi_legacy.${table}`,
        ),
        { code: "42501" },
      );
  }
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT active_church_id FROM church_sessions WHERE session_id=$1",
        [single.session.id],
      )
    ).rows[0]?.active_church_id,
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT church_id FROM levi_legacy.church_organizations WHERE organization_id=$1",
        [one],
      )
    ).rows[0]?.church_id,
  );
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT count(*)::int n FROM church_sessions WHERE session_id=$1",
        [who.session.id],
      )
    ).rows[0]?.n,
    0,
  );
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT request_hash FROM member_creation_requests WHERE request_key='legacy-request'",
      )
    ).rows[0]?.request_hash,
    "preserved-hash",
  );
});
void test("conta sem igreja, criação concorrente idempotente, várias igrejas, edição por versão e rollback", async () => {
  const who = await identity();
  assert.deepEqual((await listChurches(runtime, who)).churches, []);
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  try {
    const [a, b] = await Promise.all([
      createChurch(runtime, who, { name: "A" }, "same-request-key-01"),
      createChurch(other, who, { name: "A" }, "same-request-key-01"),
    ]);
    assert.equal(a.churchId, b.churchId);
    await error(
      createChurch(runtime, who, { name: "Divergente" }, "same-request-key-01"),
      409,
    );
    const c = await createChurch(
      runtime,
      who,
      { name: "B" },
      "new-request-key-001",
    );
    assert.notEqual(a.churchId, c.churchId);
    assert.equal((await listChurches(runtime, who)).churches.length, 2);
    const edits = await Promise.allSettled([
      editChurch(runtime, who, a.churchId, { name: "C" }, 1),
      editChurch(other, who, a.churchId, { name: "D" }, 1),
    ]);
    assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
    const empty = await identity();
    await error(selectChurch(runtime, empty, a.churchId), 403);
  } finally {
    await other.client.end();
  }
});
void test("admin em A, colaborador em B, IDOR, recibos, seleção antiga, revogação e membro separado", async () => {
  const who = await identity(),
    boss = await identity();
  const a = await createChurch(runtime, who, { name: "A" }, randomUUID()),
    b = await createChurch(runtime, boss, { name: "B" }, randomUUID());
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'collaborator')",
    [b.churchId, who.user.id],
  );
  await selectChurch(runtime, who, b.churchId);
  const context = await churchContext(runtime, who);
  assert.equal(context.role, "collaborator");
  await error(editChurch(runtime, who, b.churchId, { name: "Negado" }, 1), 403);
  const receipt = await createMember(
    runtime,
    who,
    memberInput(b.churchId),
    randomUUID(),
    context,
  );
  assert.equal(
    (await findMember(runtime, who, receipt.memberId)).member.name,
    "Membro sintético",
  );
  await error(
    createMember(runtime, who, memberInput(a.churchId), randomUUID(), context),
    404,
  );
  await selectChurch(runtime, who, a.churchId);
  await error(
    createMember(runtime, who, memberInput(b.churchId), randomUUID(), context),
    409,
  );
  await error(
    findMember(
      runtime,
      who,
      receipt.memberId,
      await churchContext(runtime, who),
    ),
    404,
  );
  const counts = await owner.client.query<Record<string, unknown>>(
    "SELECT count(*)::int n FROM church_memberships WHERE user_id=$1",
    [who.user.id],
  );
  assert.equal(counts.rows[0]?.n, 2);
  await selectChurch(runtime, who, b.churchId);
  const access = (
    await owner.client.query<Record<string, unknown>>(
      "SELECT * FROM church_memberships WHERE church_id=$1 AND user_id=$2",
      [b.churchId, who.user.id],
    )
  ).rows[0];
  assert.ok(access);
  assert.equal(typeof access.id, "string");
  if (typeof access.id !== "string") assert.fail("ID esperado");
  await changeAccess(runtime, boss, b.churchId, access.id, 1, null);
  await error(
    listMembers(
      runtime,
      who,
      { name: "", churchId: null, status: null, page: 1, pageSize: 20 },
      context,
    ),
    403,
  );
});
void test("último admin: serviço, SQL direto, cascade de usuário, duas remoções concorrentes", async () => {
  const a = await identity(),
    b = await identity();
  const c = await createChurch(
    runtime,
    a,
    { name: "Integridade" },
    randomUUID(),
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [c.churchId, b.user.id],
  );
  const rows = (
    await owner.client.query<Record<string, unknown>>(
      "SELECT * FROM church_memberships WHERE church_id=$1 ORDER BY user_id",
      [c.churchId],
    )
  ).rows;
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  try {
    const firstId = rows[0]?.id,
      secondId = rows[1]?.id;
    assert.ok(typeof firstId === "string" && typeof secondId === "string");
    const results = await Promise.allSettled([
      changeAccess(runtime, a, c.churchId, firstId, 1, null),
      changeAccess(other, b, c.churchId, secondId, 1, null),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const last = (
      await owner.client.query<Record<string, unknown>>(
        "SELECT * FROM church_memberships WHERE church_id=$1",
        [c.churchId],
      )
    ).rows[0];
    assert.ok(last);
    await assert.rejects(
      owner.client.query<Record<string, unknown>>(
        "DELETE FROM church_memberships WHERE id=$1",
        [last.id],
      ),
      /administrador/,
    );
    await assert.rejects(
      owner.client.query<Record<string, unknown>>(
        'DELETE FROM "user" WHERE id=$1',
        [last.user_id],
      ),
    );
    await assert.rejects(
      owner.client.query<Record<string, unknown>>(
        "INSERT INTO churches(name) VALUES('Sem admin')",
      ),
      /administrador/,
    );
  } finally {
    await other.client.end();
  }
});

void test("revogação e rebaixamento enquanto a operação aguarda a igreja invalidam a autoridade anterior", async () => {
  const who = await identity(),
    backup = await identity();
  const key = randomUUID();
  const c = await createChurch(runtime, who, { name: "Revogação" }, key);
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [c.churchId, backup.user.id],
  );
  const context = await churchContext(runtime, who);
  const blocker = await createPostgresDatabase(url);
  try {
    await blocker.client.query<Record<string, unknown>>("BEGIN");
    await blocker.client.query<Record<string, unknown>>(
      "SELECT id FROM churches WHERE id=$1 FOR UPDATE",
      [c.churchId],
    );
    const pending = editChurch(
      runtime,
      who,
      c.churchId,
      { name: "Recusada" },
      1,
    );
    await waitForChurchLock();
    await blocker.client.query<Record<string, unknown>>(
      "UPDATE church_memberships SET role='collaborator',version=version+1 WHERE church_id=$1 AND user_id=$2",
      [c.churchId, who.user.id],
    );
    await blocker.client.query<Record<string, unknown>>("COMMIT");
    await error(pending, 403);
    await blocker.client.query<Record<string, unknown>>("BEGIN");
    await blocker.client.query<Record<string, unknown>>(
      "SELECT id FROM churches WHERE id=$1 FOR UPDATE",
      [c.churchId],
    );
    const pendingMember = createMember(
      runtime,
      who,
      memberInput(c.churchId),
      randomUUID(),
      context,
    );
    await waitForChurchLock();
    await blocker.client.query<Record<string, unknown>>(
      "DELETE FROM church_memberships WHERE church_id=$1 AND user_id=$2",
      [c.churchId, who.user.id],
    );
    await blocker.client.query<Record<string, unknown>>("COMMIT");
    await error(pendingMember, 403);
    await error(createChurch(runtime, who, { name: "Revogação" }, key), 403);
    assert.equal(
      (
        await owner.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM members WHERE church_id=$1",
          [c.churchId],
        )
      ).rows[0]?.n,
      0,
    );
    await createChurch(runtime, who, { name: "Independente" }, randomUUID());
  } finally {
    await blocker.client.query<Record<string, unknown>>("ROLLBACK");
    await blocker.client.end();
  }
});
async function waitForChurchLock() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await owner.client.query<Record<string, unknown>>(
      "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%churches%' AND query ILIKE '%for update%'",
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("A operação deve aguardar lock real de outra conexão");
}
void test("falha tardia na auditoria desfaz igreja, acesso, seleção e recibo; retry conserva idempotência", async () => {
  const who = await identity(),
    key = randomUUID();
  await owner.client.query<Record<string, unknown>>(
    `CREATE FUNCTION fail_church_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor='${who.user.id}'::uuid THEN RAISE EXCEPTION 'Falha sintética'; END IF; RETURN NEW; END $$`,
  );
  await owner.client.query<Record<string, unknown>>(
    "CREATE TRIGGER fail_church_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_church_audit()",
  );
  try {
    await assert.rejects(createChurch(runtime, who, { name: "Rollback" }, key));
    assert.deepEqual((await listChurches(runtime, who)).churches, []);
    assert.equal(
      (
        await owner.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM church_creation_requests WHERE user_id=$1",
          [who.user.id],
        )
      ).rows[0]?.n,
      0,
    );
    assert.equal(
      (
        await owner.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM church_sessions WHERE session_id=$1",
          [who.session.id],
        )
      ).rows[0]?.n,
      0,
    );
  } finally {
    await owner.client.query<Record<string, unknown>>(
      "DROP TRIGGER fail_church_audit ON audit_events",
    );
    await owner.client.query<Record<string, unknown>>(
      "DROP FUNCTION fail_church_audit()",
    );
  }
  await createChurch(runtime, who, { name: "Rollback" }, key);
});
void test("runtime restrita não contorna último admin, FK composta, imutabilidade e proibição de exclusão", async () => {
  const who = await identity(),
    another = await identity();
  const a = await createChurch(runtime, who, { name: "A" }, randomUUID());
  const b = await createChurch(runtime, another, { name: "B" }, randomUUID());
  const context = await churchContext(runtime, who);
  const member = await createMember(
    runtime,
    who,
    memberInput(a.churchId),
    randomUUID(),
    context,
  );
  await assert.rejects(
    runtime.client.query<Record<string, unknown>>(
      "DELETE FROM church_memberships WHERE church_id=$1",
      [a.churchId],
    ),
    /administrador/,
  );
  await assert.rejects(
    runtime.client.query<Record<string, unknown>>(
      "INSERT INTO member_history(church_id,member_id,actor_id,church_name,initial_status) VALUES($1,$2,$3,'Estranha','Ativo')",
      [b.churchId, member.memberId, who.user.id],
    ),
  );
  if (process.env.LEVI_TEST_RUNTIME_DATABASE_URL) {
    for (const statement of [
      "DELETE FROM churches",
      "TRUNCATE church_memberships",
      "CREATE TABLE forbidden(id integer)",
      'DELETE FROM "user"',
    ])
      await assert.rejects(
        runtime.client.query<Record<string, unknown>>(statement),
        { code: "42501" },
      );
  }
});

void test("SQL concorrente com runtime: dois rebaixamentos ou remoções não retiram todos os administradores", async () => {
  const a = await identity(),
    b = await identity();
  const church = await createChurch(
    runtime,
    a,
    { name: "SQL concorrente" },
    randomUUID(),
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [church.churchId, b.user.id],
  );
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  try {
    for (const command of [
      "UPDATE church_memberships SET role='collaborator' WHERE user_id=$1 AND church_id=$2",
      "DELETE FROM church_memberships WHERE user_id=$1 AND church_id=$2",
    ]) {
      const results = await Promise.allSettled([
        runtime.client.query<Record<string, unknown>>(command, [
          a.user.id,
          church.churchId,
        ]),
        other.client.query<Record<string, unknown>>(command, [
          b.user.id,
          church.churchId,
        ]),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const rejected = results.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      const reason: unknown = rejected.reason;
      assert.ok(reason && typeof reason === "object" && "code" in reason);
      assert.equal(reason.code, "23514");
      assert.equal(
        (
          await owner.client.query<Record<string, unknown>>(
            "SELECT count(*)::int n FROM church_memberships WHERE church_id=$1 AND role='admin'",
            [church.churchId],
          )
        ).rows[0]?.n,
        1,
      );
      if (command.startsWith("UPDATE"))
        await owner.client.query<Record<string, unknown>>(
          "UPDATE church_memberships SET role='admin' WHERE church_id=$1",
          [church.churchId],
        );
    }
  } finally {
    await other.client.end();
  }
});

void test("último administrador permanece protegido com snapshots REPEATABLE READ concorrentes", async () => {
  const a = await identity(),
    b = await identity();
  const church = await createChurch(
    runtime,
    a,
    { name: "Snapshot concorrente" },
    randomUUID(),
  );
  await owner.client.query<Record<string, unknown>>(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [church.churchId, b.user.id],
  );
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  const connections = [runtime, other];
  try {
    for (const database of connections) {
      await database.client.query<Record<string, unknown>>(
        "BEGIN ISOLATION LEVEL REPEATABLE READ",
      );
      await database.client.query<Record<string, unknown>>(
        "SELECT id FROM church_memberships WHERE church_id=$1",
        [church.churchId],
      );
    }
    const results = await Promise.allSettled(
      connections.map(async (database, index) => {
        try {
          await database.client.query<Record<string, unknown>>(
            "UPDATE church_memberships SET role='collaborator' WHERE church_id=$1 AND user_id=$2",
            [church.churchId, index === 0 ? a.user.id : b.user.id],
          );
          await database.client.query<Record<string, unknown>>("COMMIT");
        } catch (error) {
          await database.client.query<Record<string, unknown>>("ROLLBACK");
          throw error;
        }
      }),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    const reason: unknown = rejected.reason;
    assert.ok(reason && typeof reason === "object" && "code" in reason);
    assert.equal(reason.code, "40001");
    assert.equal(
      (
        await owner.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM church_memberships WHERE church_id=$1 AND role='admin'",
          [church.churchId],
        )
      ).rows[0]?.n,
      1,
    );
  } finally {
    for (const database of connections)
      await database.client.query<Record<string, unknown>>("ROLLBACK");
    await other.client.end();
  }
});

// Convites usam somente dados e destinatários sintéticos; nenhum envio externo.
async function invitationFixture() {
  const issuer = await identity(),
    recipient = await identity();
  const { churchId } = await createChurch(
    runtime,
    issuer,
    { name: "Convites sintéticos" },
    randomUUID(),
  );
  const messages: { to: string; text: string }[] = [];
  const email = {
    send(input: { to: string; text: string }) {
      messages.push(input);
      return Promise.resolve();
    },
  };
  const issue = (
    destination = recipient,
    role: "admin" | "collaborator" = "collaborator",
  ) =>
    sendInvitation({
      database: runtime,
      identity: issuer,
      churchId,
      recipient: { email: destination.user.email, role },
      email,
      baseURL: "https://example.test",
    });
  const token = () => {
    const value = messages.at(-1)?.text.match(/#convite=([\w-]{43})/)?.[1];
    assert.ok(value);
    return value;
  };
  return { issuer, recipient, churchId, messages, email, issue, token };
}
void test("convite: isolamento, papel explícito, auditoria mínima e uso único concorrente", async () => {
  const f = await invitationFixture();
  const receipt = await f.issue(f.recipient, "admin"),
    token = f.token();
  const page = await listInvitations(runtime, f.issuer, f.churchId);
  assert.equal(page.invitations[0]?.role, "admin");
  assert.ok(!JSON.stringify(page).includes(token));
  assert.ok(!JSON.stringify(page).includes("tokenHash"));
  await assert.rejects(listInvitations(runtime, f.recipient, f.churchId), {
    code: "ACESSO_NEGADO",
  });
  await assert.rejects(
    sendInvitation({
      database: runtime,
      identity: f.recipient,
      churchId: f.churchId,
      recipient: { email: f.issuer.user.email, role: "admin" },
      email: f.email,
      baseURL: "https://example.test",
    }),
    { code: "ACESSO_NEGADO" },
  );
  await assert.rejects(acceptChurchInvitation(runtime, f.issuer, token), {
    code: "CONVITE_INDISPONIVEL",
  });
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  try {
    const results = await Promise.allSettled([
      acceptChurchInvitation(runtime, f.recipient, token),
      acceptChurchInvitation(other, f.recipient, token),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await other.client.end();
  }
  await assert.rejects(acceptChurchInvitation(runtime, f.recipient, token), {
    code: "CONVITE_INDISPONIVEL",
  });
  const rows = await owner.client.query<Record<string, unknown>>(
    "SELECT role FROM church_memberships WHERE church_id=$1 AND user_id=$2",
    [f.churchId, f.recipient.user.id],
  );
  assert.equal(rows.rows[0]?.role, "admin");
  assert.equal(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT count(*)::int n FROM members WHERE church_id=$1",
        [f.churchId],
      )
    ).rows[0]?.n,
    0,
  );
  assert.deepEqual(
    (
      await owner.client.query<Record<string, unknown>>(
        "SELECT metadata FROM audit_events WHERE action='invitation.accepted' AND target=$1",
        [receipt.id],
      )
    ).rows[0]?.metadata,
    {},
  );
});
void test("convite: substituição, cancelamento, expiração, vínculo existente e emissor rebaixado", async () => {
  const f = await invitationFixture();
  const a = await f.issue(),
    old = f.token();
  const b = await f.issue(),
    current = f.token();
  assert.notEqual(old, current);
  await assert.rejects(acceptChurchInvitation(runtime, f.recipient, old), {
    code: "CONVITE_INDISPONIVEL",
  });
  await assert.rejects(
    sendInvitation({
      database: runtime,
      identity: f.issuer,
      churchId: f.churchId,
      recipient: { id: a.id },
      email: f.email,
      baseURL: "https://example.test",
    }),
    { code: "CONVITE_INDISPONIVEL" },
  );
  await cancelInvitation(runtime, f.issuer, f.churchId, b.id);
  await assert.rejects(acceptChurchInvitation(runtime, f.recipient, current), {
    code: "CONVITE_INDISPONIVEL",
  });
  const c = await f.issue(),
    expired = f.token();
  await owner.client.query(
    "UPDATE church_invitations SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=$1",
    [c.id],
  );
  await assert.rejects(acceptChurchInvitation(runtime, f.recipient, expired), {
    code: "CONVITE_INDISPONIVEL",
  });
  await f.issue();
  const valid = f.token();
  await owner.client.query(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'collaborator')",
    [f.churchId, f.recipient.user.id],
  );
  await assert.rejects(acceptChurchInvitation(runtime, f.recipient, valid), {
    code: "VINCULO_EXISTENTE",
  });
  await owner.client.query(
    "UPDATE church_memberships SET role='admin' WHERE church_id=$1 AND user_id=$2",
    [f.churchId, f.recipient.user.id],
  );
  await owner.client.query(
    "UPDATE church_memberships SET role='collaborator' WHERE church_id=$1 AND user_id=$2",
    [f.churchId, f.issuer.user.id],
  );
  const fresh = await identity();
  await owner.client.query(
    "UPDATE church_invitations SET email=$2 WHERE token_hash=$1",
    [await hashInvitationToken(valid), fresh.user.email],
  );
  await assert.rejects(acceptChurchInvitation(runtime, fresh, valid), {
    code: "CONVITE_INDISPONIVEL",
  });
  await assert.rejects(acceptChurchInvitation(runtime, fresh, "invalid"), {
    code: "CONVITE_INDISPONIVEL",
  });
});
void test("convite: falha do envio preserva convite anterior e não deixa concessão ou auditoria parcial", async () => {
  const f = await invitationFixture();
  await f.issue();
  const token = f.token();
  await assert.rejects(
    sendInvitation({
      database: runtime,
      identity: f.issuer,
      churchId: f.churchId,
      recipient: { email: f.recipient.user.email, role: "admin" },
      email: {
        send() {
          return Promise.reject(new Error("provider sintético indisponível"));
        },
      },
      baseURL: "https://example.test",
    }),
  );
  assert.equal(
    (await listInvitations(runtime, f.issuer, f.churchId)).invitations.length,
    1,
  );
  await acceptChurchInvitation(runtime, f.recipient, token);
});
void test("convite: reenviar versus aceitar e cancelar versus aceitar são serializados", async () => {
  for (const operation of ["resend", "cancel"]) {
    const f = await invitationFixture();
    const receipt = await f.issue(),
      token = f.token();
    const other = await createPostgresDatabase(applicationDatabaseUrl(url));
    try {
      const results = await Promise.allSettled([
        acceptChurchInvitation(runtime, f.recipient, token),
        operation === "cancel"
          ? cancelInvitation(other, f.issuer, f.churchId, receipt.id)
          : sendInvitation({
              database: other,
              identity: f.issuer,
              churchId: f.churchId,
              recipient: { id: receipt.id },
              email: f.email,
              baseURL: "https://example.test",
            }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    } finally {
      await other.client.end();
    }
  }
});

void test("convite revalida emissor após esperar lock e não aceita concessão revogada", async () => {
  const f = await invitationFixture();
  await f.issue();
  const token = f.token();
  const backup = await identity();
  await owner.client.query(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [f.churchId, backup.user.id],
  );
  const blocker = await createPostgresDatabase(url);
  try {
    await blocker.client.query("BEGIN");
    await blocker.client.query(
      "SELECT id FROM churches WHERE id=$1 FOR UPDATE",
      [f.churchId],
    );
    // A alteração mantém o lock até o commit; aceite só pode examinar autoridade depois.
    await blocker.client.query(
      "UPDATE church_memberships SET role='collaborator' WHERE church_id=$1 AND user_id=$2",
      [f.churchId, f.issuer.user.id],
    );
    const acceptance = acceptChurchInvitation(runtime, f.recipient, token);
    const rejected = assert.rejects(acceptance, {
      code: "CONVITE_INDISPONIVEL",
    });
    await blocker.client.query("COMMIT");
    await rejected;
    assert.equal(
      (
        await owner.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM church_memberships WHERE church_id=$1 AND user_id=$2",
          [f.churchId, f.recipient.user.id],
        )
      ).rows[0]?.n,
      0,
    );
  } finally {
    await blocker.client.query("ROLLBACK");
    await blocker.client.end();
  }
});
void test("convites concorrentes: só um reenvio confirma; ID de outra igreja não é consultável", async () => {
  const f = await invitationFixture();
  const receipt = await f.issue();
  const { churchId: otherChurch } = await createChurch(
    runtime,
    f.issuer,
    { name: "Outra igreja" },
    randomUUID(),
  );
  await assert.rejects(
    cancelInvitation(runtime, f.issuer, otherChurch, receipt.id),
    { code: "CONVITE_INDISPONIVEL" },
  );
  const other = await createPostgresDatabase(applicationDatabaseUrl(url));
  try {
    const results = await Promise.allSettled(
      [runtime, other].map((database) =>
        sendInvitation({
          database,
          identity: f.issuer,
          churchId: f.churchId,
          recipient: { id: receipt.id },
          email: f.email,
          baseURL: "https://example.test",
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rows = (await listInvitations(runtime, f.issuer, f.churchId))
      .invitations;
    assert.equal(rows.filter((row) => !row.cancelledAt).length, 1);
  } finally {
    await other.client.end();
  }
});

void test("convite não altera acesso existente nem restaura papel após alteração ou revogação explícita", async () => {
  for (const role of ["collaborator", null] as const) {
    const f = await invitationFixture();
    await f.issue(f.recipient, "admin");
    const token = f.token();
    const membership = await owner.client.query<{ id: string }>(
      "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'collaborator') RETURNING id",
      [f.churchId, f.recipient.user.id],
    );
    await assert.rejects(f.issue(), { code: "VINCULO_EXISTENTE" });
    const target = membership.rows[0];
    assert.ok(target);
    await changeAccess(runtime, f.issuer, f.churchId, target.id, 1, role);
    await assert.rejects(acceptChurchInvitation(runtime, f.recipient, token), {
      code: "CONVITE_INDISPONIVEL",
    });
  }
});
