import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createApp } from "../src/app.js";
import { applicationDatabaseUrl } from "./runtime-acl-fixture.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  new URL(databaseUrl).hostname !== "127.0.0.1" ||
  new URL(databaseUrl).pathname !== "/levi_test"
)
  throw new Error("Use o harness PostgreSQL descartável.");
const observer = await createPostgresDatabase(databaseUrl);
after(async () => {
  await observer.client.end();
});
const origin = "http://localhost:3000";
const sent: { to: string; text: string }[] = [];
const options = {
  databaseUrl: applicationDatabaseUrl(databaseUrl),
  baseURL: origin,
  secret: "synthetic-members-secret-with-more-than-32-characters",
  email: {
    send: async (input: { to: string; text: string }) => {
      sent.push(input);
      return Promise.resolve();
    },
  },
};
const app = createApp(options);
async function request(path: string, body?: object, cookie = "", key?: string) {
  let expected = "";
  if (path.startsWith("/api/members")) {
    const response = await app.request(
      new Request(new URL("/api/context", origin), { headers: { cookie } }),
    );
    const context = readObject(await response.json());
    if (typeof context.churchId === "string") expected = context.churchId;
  }
  return app.request(
    new Request(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: {
        origin,
        "X-Levi-Church": expected,
        cookie,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
function link(email: string) {
  return new URL(
    sent
      .findLast((item) => item.to === email)!
      .text.match(/https?:\/\/\S+/)![0],
  );
}
async function account(contacts: object = {}) {
  const email = `${randomUUID()}@example.test`;
  assert.equal((await request("/api/onboarding/email", { email })).status, 200);
  const url = link(email);
  const response = await request(url.pathname + url.search);
  assert.equal(response.status, 302);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const id = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [email],
    )
  ).rows[0]?.id;
  assert.ok(id);
  assert.equal(
    (await request("/api/onboarding/password-email", {}, cookie)).status,
    200,
  );
  const token = link(email).pathname.split("/").at(-1);
  assert.equal(
    (
      await request(
        "/api/onboarding/password",
        { token, newPassword: "synthetic-members-password" },
        cookie,
      )
    ).status,
    200,
  );
  const provision = await request(
    "/api/churches",
    {
      name: "Igreja sintética de membros",
      ...contacts,
    },
    cookie,
    randomUUID(),
  );
  assert.equal(provision.status, 201);
  const result = (await provision.json()) as {
    churchId: string;
  };
  const backup = randomUUID();
  await observer.client.query(
    `INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,'Backup',$2,true,now(),now())`,
    [backup, `${backup}@example.test`],
  );
  await observer.client.query(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [result.churchId, backup],
  );
  return { id, cookie, email, ...result };
}
type Account = Awaited<ReturnType<typeof account>>;
function create(who: Account, input: object = {}, key: string = randomUUID()) {
  return request(
    "/api/members",
    {
      name: "Pessoa sintética",
      churchId: who.churchId,
      status: "Ativo",
      ...input,
    },
    who.cookie,
    key,
  );
}
async function created(who: Account, input: object = {}) {
  const response = await create(who, input);
  assert.equal(response.status, 201);
  return (await response.json()) as {
    churchId: string;
    memberId: string;
  };
}
async function count(tenantId: string) {
  return (
    await observer.client.query<Record<string, unknown>>(
      `SELECT (SELECT count(*)::int FROM members WHERE church_id=$1) members, (SELECT count(*)::int FROM member_history WHERE church_id=$1) history, (SELECT count(*)::int FROM audit_events WHERE church_id=$1 AND action='member.created') audit, (SELECT count(*)::int FROM member_creation_requests WHERE church_id=$1) receipts`,
      [tenantId],
    )
  ).rows[0];
}

void test("membros PostgreSQL: cadastro mínimo, opcionais, homônimos e contatos compartilhados sem contas novas", async () => {
  const who = await account();
  const before = (
    await observer.client.query<Record<string, unknown>>(
      'SELECT (SELECT count(*) FROM "user") users, (SELECT count(*) FROM account) accounts, (SELECT count(*) FROM church_memberships) memberships',
    )
  ).rows[0];
  const minimal = await created(who);
  const detailResponse = await request(
    `/api/members/${minimal.memberId}`,
    undefined,
    who.cookie,
  );
  assert.equal(detailResponse.status, 200);
  const detail = readObject(readObject(await detailResponse.json()).member);
  assert.ok(typeof detail.id === "string");
  assert.match(
    detail.id,
    /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/,
  );
  for (const key of [
    "birthDate",
    "phone",
    "email",
    "joinedOn",
    "address",
    "baptismDate",
    "churchRole",
  ])
    assert.equal(detail[key], null);
  assert.equal(detail.status, "Ativo");
  const input = {
    name: "Pessoa sintética",
    status: "Inativo",
    birthDate: "2000-02-29",
    phone: "+55 11 0000-0000",
    email: who.email,
    joinedOn: "2020-01-01",
    address: "Endereço sintético",
    baptismDate: "2021-03-01",
    churchRole: "Função sintética",
  };
  const full = await created(who, input);
  const other = await created(who, input);
  assert.notEqual(full.memberId, other.memberId);
  const value = readObject(
    readObject(
      await (
        await request(`/api/members/${full.memberId}`, undefined, who.cookie)
      ).json(),
    ).member,
  );
  for (const [key, field] of Object.entries(input))
    assert.equal(value[key], field);
  const afterCounts = (
    await observer.client.query<Record<string, unknown>>(
      'SELECT (SELECT count(*) FROM "user") users, (SELECT count(*) FROM account) accounts, (SELECT count(*) FROM church_memberships) memberships',
    )
  ).rows[0];
  assert.deepEqual(afterCounts, before);
  assert.deepEqual(await count(who.churchId), {
    members: 3,
    history: 3,
    audit: 3,
    receipts: 3,
  });
  const event = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM audit_events WHERE target=$1",
      [full.memberId],
    )
  ).rows[0];
  assert.ok(event);
  assert.equal(event.action, "member.created");
  assert.equal(event.actor, who.id);
  assert.deepEqual(event.metadata, {});
  assert.ok(!JSON.stringify(event).includes(who.email));
  assert.ok(!JSON.stringify(event).includes(input.name));
  const history = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM member_history WHERE member_id=$1",
      [full.memberId],
    )
  ).rows[0];
  assert.ok(history);
  assert.equal(history.church_id, who.churchId);
  assert.equal(history.initial_status, "Inativo");
  assert.equal(history.church_name, "Igreja sintética de membros");
});

void test("membros PostgreSQL: anônimo, campos inválidos, igreja obrigatória e isolamento não expõem outro tenant", async () => {
  const first = await account();
  const second = await account();
  const foreign = await created(second);
  for (const path of [
    "/api/members",
    `/api/members/${foreign.memberId}`,
    `/api/members/requests/${randomUUID()}`,
  ])
    assert.equal((await request(path)).status, 401);
  assert.equal(
    (await request("/api/members", { name: "Pessoa" }, "", randomUUID()))
      .status,
    401,
  );
  for (const change of [
    { name: " " },
    { status: "Outro" },
    { churchId: null },
    { churchId: undefined },
    { churchId: "inválido" },
    { birthDate: "2023-02-29" },
    { id: randomUUID() },
    { organizationId: second.churchId },
    { email: "invalido" },
    { churchRole: { role: "admin" } },
  ])
    assert.equal((await create(first, change)).status, 400);
  assert.equal((await create(first, {}, "short")).status, 400);
  const invalidChurch = await create(first, { churchId: randomUUID() });
  const foreignChurch = await create(first, { churchId: second.churchId });
  assert.equal(invalidChurch.status, 404);
  assert.equal(foreignChurch.status, 404);
  assert.deepEqual(await invalidChurch.json(), await foreignChurch.json());
  const foreignResponse = await request(
    `/api/members/${foreign.memberId}`,
    undefined,
    first.cookie,
  );
  const missingResponse = await request(
    `/api/members/${randomUUID()}`,
    undefined,
    first.cookie,
  );
  assert.equal(foreignResponse.status, 404);
  assert.deepEqual(await foreignResponse.json(), await missingResponse.json());
  assert.deepEqual(
    readObject(
      await (
        await request(
          `/api/members?churchId=${second.churchId}`,
          undefined,
          first.cookie,
        )
      ).json(),
    ).members,
    [],
  );
  assert.deepEqual(
    readObject(
      await (await request("/api/members", undefined, first.cookie)).json(),
    ).members,
    [],
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO members(church_id,name,status) VALUES($1,'Sintético','Ativo')",
      [randomUUID()],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO members(church_id,name,status) VALUES($1,'Sintético','Outro')",
      [first.churchId],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    observer.client.query(
      "INSERT INTO member_history(church_id,member_id,actor_id,church_name,initial_status) VALUES($1,$2,$3,'Sintética','Ativo')",
      [first.churchId, foreign.memberId, first.id],
    ),
    { code: "23503" },
  );
  assert.deepEqual(await count(first.churchId), {
    members: 0,
    history: 0,
    audit: 0,
    receipts: 0,
  });
});

void test("membros PostgreSQL: revogação e role desconhecida bloqueiam leitura, criação e recuperação", async () => {
  const who = await account();
  const key = randomUUID();
  const result = await create(who, {}, key);
  const { memberId } = readObject(await result.json());
  assert.ok(typeof memberId === "string");
  await assert.rejects(
    observer.client.query(
      "UPDATE church_memberships SET role='unknown' WHERE church_id=$1 AND user_id=$2",
      [who.churchId, who.id],
    ),
  );
  for (const role of [null]) {
    void role;
    await observer.client.query(
      "DELETE FROM church_memberships WHERE church_id=$1 AND user_id=$2",
      [who.churchId, who.id],
    );
    for (const path of [
      "/api/members",
      `/api/members/${memberId}`,
      `/api/members/requests/${key}`,
    ])
      assert.equal((await request(path, undefined, who.cookie)).status, 403);
    assert.equal((await create(who, {}, key)).status, 403);
  }
  assert.deepEqual(await count(who.churchId), {
    members: 1,
    history: 1,
    audit: 1,
    receipts: 1,
  });
});

void test("membros PostgreSQL: filtros literais, ordenação estável e paginação sempre organizacionais", async () => {
  const who = await account();
  const second = await account();
  const church = second.churchId;
  const ids = [];
  for (const name of ["Alfa", "Alfa", "Beta", "100%_literal", "Outra"])
    ids.push(
      (
        await created(who, {
          name,
          status: name === "Beta" ? "Inativo" : "Ativo",
          churchId: who.churchId,
        })
      ).memberId,
    );
  await created(second, { name: "Alfa" });
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const response = await request(
      `/api/members?pageSize=2&page=${page}`,
      undefined,
      who.cookie,
    );
    assert.equal(response.status, 200);
    const value = readObject(await response.json());
    pages.push(value);
    assert.equal(value.churchId, who.churchId);
    assert.equal(value.hasNext, page < 3);
  }
  const ordered = pages.flatMap((page) =>
    readObjects(page.members).map((member) => member.id),
  );
  assert.equal(new Set(ordered).size, 5);
  assert.deepEqual(new Set(ordered), new Set(ids));
  assert.deepEqual(
    await (
      await request("/api/members?pageSize=2&page=1", undefined, who.cookie)
    ).json(),
    pages[0],
  );
  for (const [query, expected] of [
    ["name=alfa", 2],
    ["name=%25_", 1],
    ["status=Inativo", 1],
    [`churchId=${church}`, 0],
    [`churchId=${church}&name=Alfa`, 0],
    ["page=10", 0],
  ] as const)
    assert.equal(
      readObjects(
        readObject(
          await (
            await request(`/api/members?${query}`, undefined, who.cookie)
          ).json(),
        ).members,
      ).length,
      expected,
    );
  for (const query of ["page=0", "pageSize=101", "tenant=x", "name=a&name=b"])
    assert.equal(
      (await request(`/api/members?${query}`, undefined, who.cookie)).status,
      400,
    );
});

void test("membros PostgreSQL: reenvios concorrentes retornam um membro, histórico, auditoria e recibo", async () => {
  const who = await account();
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => Promise.resolve(create(who, {}, key))),
  );
  for (const result of results) assert.equal(result.status, 201);
  const bodies = await Promise.all(results.map((result) => result.json()));
  for (const value of bodies) assert.deepEqual(value, bodies[0]);
  assert.deepEqual(await count(who.churchId), {
    members: 1,
    history: 1,
    audit: 1,
    receipts: 1,
  });
  assert.deepEqual(
    await (
      await request(`/api/members/requests/${key}`, undefined, who.cookie)
    ).json(),
    bodies[0],
  );
  assert.equal((await create(who, { name: "Divergente" }, key)).status, 409);
  const other = await account();
  assert.equal(
    (await request(`/api/members/requests/${key}`, undefined, other.cookie))
      .status,
    404,
  );
  await observer.client.query(
    "INSERT INTO church_memberships(church_id,user_id,role) VALUES($1,$2,'admin')",
    [who.churchId, other.id],
  );
  await request(
    "/api/context/church",
    { churchId: who.churchId },
    other.cookie,
  );
  assert.equal(
    (await request(`/api/members/requests/${key}`, undefined, other.cookie))
      .status,
    404,
  );
});

for (const table of [
  "member_history",
  "audit_events",
  "member_creation_requests",
])
  void test(`membros PostgreSQL: rollback integral após falha tardia em ${table}`, async () => {
    const who = await account();
    const key = randomUUID();
    const column = table === "audit_events" ? "church_id" : "church_id";
    await observer.client.query(
      `CREATE FUNCTION fail_member_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.${column}='${who.churchId}'::uuid THEN RAISE EXCEPTION 'falha sintética'; END IF; RETURN NEW; END; $$`,
    );
    await observer.client.query(
      `CREATE TRIGGER fail_member BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_member_test()`,
    );
    try {
      const response = await create(who, {}, key);
      assert.equal(response.status, 503);
      assert.ok(
        !JSON.stringify(await response.json()).includes("falha sintética"),
      );
      assert.deepEqual(await count(who.churchId), {
        members: 0,
        history: 0,
        audit: 0,
        receipts: 0,
      });
    } finally {
      await observer.client.query(`DROP TRIGGER fail_member ON ${table}`);
      await observer.client.query("DROP FUNCTION fail_member_test()");
    }
    assert.equal((await create(who, {}, key)).status, 201);
    assert.deepEqual(await count(who.churchId), {
      members: 1,
      history: 1,
      audit: 1,
      receipts: 1,
    });
  });

void test("membros PostgreSQL: datas DATE não mudam com fuso da sessão e histórico/recibo são elimináveis com a ficha", async () => {
  const who = await account();
  const { memberId } = await created(who, {
    birthDate: "2000-02-29",
    joinedOn: "2026-10-22",
    baptismDate: "2020-01-01",
  });
  for (const zone of [
    "Pacific/Kiritimati",
    "America/Sao_Paulo",
    "Pacific/Pago_Pago",
  ]) {
    await observer.client.query("SELECT set_config('TimeZone',$1,false)", [
      zone,
    ]);
    const date = (
      await observer.client.query<Record<string, unknown>>(
        "SELECT birth_date::text, joined_on::text FROM members WHERE id=$1",
        [memberId],
      )
    ).rows[0];
    assert.deepEqual(date, {
      birth_date: "2000-02-29",
      joined_on: "2026-10-22",
    });
    const detail = readObject(
      readObject(
        await (
          await request(`/api/members/${memberId}`, undefined, who.cookie)
        ).json(),
      ).member,
    );
    assert.equal(detail.birthDate, "2000-02-29");
    assert.equal(detail.baptismDate, "2020-01-01");
  }
  await observer.client.query("SET TIME ZONE 'UTC'");
  await assert.rejects(
    observer.client.query("DELETE FROM churches WHERE id=$1", [who.churchId]),
    { code: "23503" },
  );
  // Prova de FK/cascade em banco sintético; nenhuma API de exclusão é introduzida.
  await observer.client.query("DELETE FROM members WHERE id=$1", [memberId]);
  assert.deepEqual(await count(who.churchId), {
    members: 0,
    history: 0,
    audit: 1,
    receipts: 0,
  });
});

void test("membros PostgreSQL: disponibilidade padrão exige sessão e permite cadastro autorizado", async () => {
  const defaultApp = createApp(options);
  for (const path of [
    "/api/members",
    `/api/members/${randomUUID()}`,
    `/api/members/requests/${randomUUID()}`,
  ])
    assert.equal(
      (await defaultApp.request(new Request(new URL(path, origin)))).status,
      401,
    );
  const who = await account();
  assert.equal(
    (
      await defaultApp.request(
        new Request(new URL("/api/members", origin), {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: who.cookie,
            "X-Levi-Church": who.churchId,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            name: "Sintética",
            churchId: who.churchId,
            status: "Ativo",
          }),
        }),
      )
    ).status,
    201,
  );
});

void test("membros PostgreSQL: cadastro e ficha preservam datas com fusos diferentes na própria conexão da aplicação", async () => {
  const who = await account();
  const dates = {
    birthDate: "2000-02-29",
    joinedOn: "2026-10-24",
    baptismDate: "2020-01-01",
  };
  for (const zone of [
    "Pacific/Kiritimati",
    "America/Sao_Paulo",
    "Pacific/Pago_Pago",
  ]) {
    const zonedUrl = new URL(options.databaseUrl);
    zonedUrl.searchParams.set("options", `-c timezone=${zone}`);
    const zonedApp = createApp({
      ...options,
      databaseUrl: zonedUrl.toString(),
    });
    const send = (path: string, body?: object) =>
      zonedApp.request(
        new Request(new URL(path, origin), {
          method: body ? "POST" : "GET",
          headers: {
            origin,
            cookie: who.cookie,
            "X-Levi-Church": who.churchId,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    const response = await send("/api/members", {
      name: "Pessoa sintética com datas civis",
      churchId: who.churchId,
      status: "Ativo",
      ...dates,
    });
    assert.equal(response.status, 201);
    const { memberId } = readObject(await response.json());
    assert.ok(typeof memberId === "string");
    const detail = await send(`/api/members/${memberId}`);
    assert.equal(detail.status, 200);
    const member = readObject(readObject(await detail.json()).member);
    for (const [key, value] of Object.entries(dates))
      assert.equal(member[key], value);
    assert.deepEqual(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT birth_date::text,joined_on::text,baptism_date::text FROM members WHERE id=$1",
          [memberId],
        )
      ).rows[0],
      {
        birth_date: dates.birthDate,
        joined_on: dates.joinedOn,
        baptism_date: dates.baptismDate,
      },
    );
  }
  assert.deepEqual(await count(who.churchId), {
    members: 3,
    history: 3,
    audit: 3,
    receipts: 3,
  });
});

for (const revoke of ["session", "membership", "context"] as const)
  void test(`membros PostgreSQL: revalida ${revoke} após aguardar lock de idempotência`, async () => {
    const who = await account();
    const key = randomUUID();
    const blocker = await createPostgresDatabase(databaseUrl);
    await blocker.client.query("BEGIN");
    await blocker.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [JSON.stringify([who.churchId, who.id, key])],
    );
    const pending = create(who, {}, key);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await observer.client.query<Record<string, unknown>>(
          "SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%pg_advisory_xact_lock%'",
        );
        if (result.rowCount) {
          waiting = true;
          break;
        }
        await setTimeout(10);
      }
      assert.ok(
        waiting,
        "A criação deve aguardar o lock real antes de revalidar",
      );
      if (revoke === "session")
        await observer.client.query("DELETE FROM session WHERE user_id=$1", [
          who.id,
        ]);
      else if (revoke === "membership")
        await observer.client.query(
          "DELETE FROM church_memberships WHERE church_id=$1 AND user_id=$2",
          [who.churchId, who.id],
        );
      else
        await observer.client.query(
          "UPDATE church_sessions SET active_church_id=NULL WHERE session_id IN (SELECT id FROM session WHERE user_id=$1)",
          [who.id],
        );
    } finally {
      await blocker.client.query("ROLLBACK");
      await blocker.client.end();
    }
    assert.equal(
      (await pending).status,
      revoke === "session" ? 401 : revoke === "context" ? 409 : 403,
    );
    assert.deepEqual(await count(who.churchId), {
      members: 0,
      history: 0,
      audit: 0,
      receipts: 0,
    });
  });

void test("edição: allowlist, isolamento, versão, persistência e histórico/auditoria atômicos", async () => {
  const who = await account();
  const other = await account();
  const receipt = await created(who, {
    phone: "Contato anterior",
    birthDate: "2000-02-29",
  });
  const path = `/api/members/${receipt.memberId}`;
  const edit = (
    body: object,
    cookie = who.cookie,
    target = path,
    originHeader = origin,
  ) =>
    app.request(
      new Request(new URL(target, origin), {
        method: "PATCH",
        headers: {
          origin: originHeader,
          cookie,
          "X-Levi-Church":
            cookie === who.cookie ? who.churchId : other.churchId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  const profile = {
    version: 1,
    name: "Pessoa atualizada",
    birthDate: "2000-02-29",
    phone: null,
    email: "novo@example.test",
    joinedOn: null,
    address: "Endereço atualizado",
    baptismDate: null,
    churchRole: "Função atualizada",
  };
  assert.equal((await edit(profile, "")).status, 401);
  assert.equal((await edit(profile, other.cookie)).status, 404);
  assert.equal(
    (await edit(profile, who.cookie, `/api/members/${randomUUID()}`)).status,
    404,
  );
  assert.equal(
    (await edit(profile, who.cookie, path, "https://external.example.test"))
      .status,
    403,
  );
  for (const forbidden of [
    "church_id",
    "tenantId",
    "id",
    "churchId",
    "status",
    "createdAt",
    "actorId",
    "history",
    "metadata",
  ])
    assert.equal(
      (await edit({ ...profile, [forbidden]: randomUUID() })).status,
      400,
    );
  for (const input of [
    { ...profile, name: " " },
    { ...profile, email: "inválido" },
    { ...profile, birthDate: "2001-02-29" },
    { ...profile, version: 0 },
  ])
    assert.equal((await edit(input)).status, 400);
  const before = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM members WHERE id=$1",
      [receipt.memberId],
    )
  ).rows[0];
  const concurrent = await Promise.all([
    edit(profile),
    edit({ ...profile, name: "Concorrente" }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  const stored = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM members WHERE id=$1",
      [receipt.memberId],
    )
  ).rows[0];
  assert.ok(stored && before);
  assert.equal(stored.version, 2);
  for (const column of ["id", "church_id", "church_id", "status", "created_at"])
    assert.deepEqual(stored[column], before[column]);
  const history = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM member_profile_history WHERE member_id=$1",
      [receipt.memberId],
    )
  ).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0]?.version, 1);
  assert.equal(
    readObject(history[0]?.previous_profile).phone,
    "Contato anterior",
  );
  assert.equal(history[0]?.actor_id, who.id);
  const audit = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT * FROM audit_events WHERE target=$1 AND action='member.updated'",
      [receipt.memberId],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0]?.metadata, {});
  const detail = await request(path, undefined, who.cookie);
  assert.equal(readObject(readObject(await detail.json()).member).version, 2);
  // Falha de auditoria deve desfazer perfil e histórico, observados por outra conexão.
  await observer.client.query(
    `CREATE FUNCTION fail_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='member.updated' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
  );
  await observer.client.query(
    "CREATE TRIGGER fail_profile_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_profile_audit()",
  );
  try {
    assert.equal((await edit({ ...profile, version: 2 })).status, 503);
    assert.deepEqual(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT * FROM members WHERE id=$1",
          [receipt.memberId],
        )
      ).rows[0],
      stored,
    );
    assert.equal(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT count(*)::int n FROM member_profile_history WHERE member_id=$1",
          [receipt.memberId],
        )
      ).rows[0]?.n,
      1,
    );
  } finally {
    await observer.client.query(
      "DROP TRIGGER fail_profile_audit ON audit_events",
    );
    await observer.client.query("DROP FUNCTION fail_profile_audit()");
  }
  await assert.rejects(
    observer.client.query(
      "UPDATE church_memberships SET role='unknown' WHERE church_id=$1 AND user_id=$2",
      [who.churchId, who.id],
    ),
  );
  await observer.client.query(
    "DELETE FROM church_memberships WHERE church_id=$1 AND user_id=$2",
    [who.churchId, who.id],
  );
  assert.equal((await edit({ ...profile, version: 2 })).status, 403);
});

void test("onboarding: contatos da igreja opcionais persistem normalizados e são isolados", async () => {
  const who = await account({
    address: " Endereço sintético ",
    phone: " 00 0000-0000 ",
    email: " igreja@example.test ",
  });
  const response = await request(
    `/api/churches/${who.churchId}`,
    undefined,
    who.cookie,
  );
  assert.equal(response.status, 200);
  const result = readObject(await response.json());
  assert.equal(result.id, who.churchId);
  assert.equal(result.address, "Endereço sintético");
  assert.equal(result.phone, "00 0000-0000");
  assert.equal(result.email, "igreja@example.test");
  const other = await account();
  assert.equal(
    (await request(`/api/churches/${who.churchId}`, undefined, other.cookie))
      .status,
    403,
  );
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(
        "SELECT address FROM churches WHERE id=$1",
        [other.churchId],
      )
    ).rows[0]?.address,
    null,
  );
});

function readObject(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

function readObjects(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map((item: unknown) => readObject(item));
}
