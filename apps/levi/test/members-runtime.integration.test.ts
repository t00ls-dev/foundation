import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import {
  applicationDatabaseUrl,
  legacyRuntimeGrants,
  localTestDatabaseUrl,
} from "./runtime-acl-fixture.js";

const observerUrl = process.env.LEVI_DATABASE_URL;
const migratorUrl = process.env.LEVI_TEST_MIGRATOR_DATABASE_URL;
assert.ok(observerUrl && migratorUrl);
assert.ok(process.env.LEVI_TEST_RUNTIME_DATABASE_URL);
const runtimeUrl = applicationDatabaseUrl(observerUrl);
assert.equal(
  localTestDatabaseUrl(migratorUrl, "levi_dev_migrator").host,
  new URL(observerUrl).host,
);
const observer = await createPostgresDatabase(observerUrl);
const migrator = await createPostgresDatabase(migratorUrl);
const runtime = await createPostgresDatabase(runtimeUrl);
after(async () => {
  await Promise.all(
    [observer, migrator, runtime].map((connection) => connection.client.end()),
  );
});

void test("ACLs reais: três logins independentes, journal e ownership corretos", async () => {
  const identities = [];
  for (const [connection, role] of [
    [observer, "levi_test"],
    [migrator, "levi_dev_migrator"],
    [runtime, "levi_dev_runtime"],
  ] as const) {
    const { rows } = await connection.client.query<Record<string, unknown>>(
      "SELECT current_user, session_user, current_database(), pg_backend_pid() AS pid, version()",
    );
    assert.equal(rows[0]?.current_user, role);
    assert.equal(rows[0]?.session_user, role);
    assert.equal(rows[0]?.current_database, "levi_test");
    identities.push(rows[0]?.pid);
    if (role === "levi_test") console.info(rows[0]?.version);
  }
  assert.equal(new Set(identities).size, 3);
  const journal = JSON.parse(
    await readFile("migrations/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  const applied = (
    await observer.client.query<Record<string, unknown>>(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    )
  ).rows;
  assert.equal(applied.length, journal.entries.length);
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(applied[index]?.created_at, String(entry.when));
    assert.equal(
      applied[index]?.hash,
      createHash("sha256")
        .update(await readFile(`migrations/${entry.tag}.sql`))
        .digest("hex"),
    );
  }
  const owners = await observer.client.query<Record<string, unknown>>(
    `SELECT relname, pg_get_userbyid(relowner) AS owner FROM pg_class
     WHERE relnamespace='public'::regnamespace AND relkind='r'`,
  );
  assert.ok(owners.rowCount! >= 14);
  for (const row of owners.rows) assert.equal(row.owner, "levi_dev_migrator");
});

void test("ACLs reais: exatamente pares por coluna revisados para igrejas; nenhum grant option ou privilégio amplo novo", async () => {
  const tableAcl = (
    await observer.client.query<{ relname: string; privilege_type: string }>(`
    SELECT c.relname, x.privilege_type FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) x
    WHERE c.relnamespace='public'::regnamespace

      AND x.grantee='levi_dev_runtime'::regrole
  `)
  ).rows;
  assert.deepEqual(
    tableAcl.map((row) => `${row.relname}:${row.privilege_type}`).sort(),
    [
      ...legacyRuntimeGrants.filter(
        ([table]) =>
          ![
            "tenants",
            "tenant_memberships",
            "tenant_sessions",
            "onboarding_provisions",
          ].includes(table),
      ),
      ["church_memberships", "SELECT, INSERT, DELETE"],
      ["church_sessions", "SELECT, INSERT"],
      ["church_creation_requests", "SELECT, INSERT"],
      ["feature_flag_churches", "DELETE"],
    ]
      .flatMap(([table, privileges]) =>
        privileges.split(", ").map((privilege) => `${table}:${privilege}`),
      )
      .sort(),
  );
  const memberColumns = [
    "id",
    "church_id",
    "name",
    "status",
    "birth_date",
    "phone",
    "email",
    "joined_on",
    "address",
    "baptism_date",
    "church_role",
    "created_at",
  ];
  const receiptColumns = [
    "church_id",
    "actor_id",
    "request_key",
    "request_hash",
    "member_id",
  ];
  const groups = [
    ["members", "SELECT", memberColumns],
    ["members", "INSERT", memberColumns],
    ["members", "SELECT", ["version"]],
    ["members", "INSERT", ["version"]],
    [
      "members",
      "UPDATE",
      [
        "name",
        "birth_date",
        "phone",
        "email",
        "joined_on",
        "address",
        "baptism_date",
        "church_role",
        "version",
      ],
    ],
    [
      "member_profile_history",
      "INSERT",
      [
        "id",
        "church_id",
        "member_id",
        "actor_id",
        "version",
        "previous_profile",
        "created_at",
      ],
    ],
    [
      "member_history",
      "INSERT",
      [
        "id",
        "church_id",
        "member_id",
        "actor_id",
        "church_name",
        "initial_status",
        "created_at",
      ],
    ],
    ["member_creation_requests", "SELECT", receiptColumns],
    ["member_creation_requests", "INSERT", receiptColumns],
    [
      "churches",
      "UPDATE",
      ["name", "address", "phone", "email", "version", "updated_at"],
    ],
    ["churches", "SELECT", ["version", "updated_at"]],
    ["church_memberships", "UPDATE", ["role", "version"]],
    ["church_sessions", "UPDATE", ["active_church_id", "updated_at"]],
    ["audit_events", "INSERT", ["church_id"]],
  ] as const;
  const expected = groups
    .flatMap(([table, privilege, columns]) =>
      columns.map((column) => `${table}.${column}:${privilege}`),
    )
    .sort();
  const { rows } = await observer.client.query<{
    relname: string;
    attname: string;
    privilege_type: string;
    is_grantable: boolean;
    grantor: string;
  }>(`
    SELECT c.relname, a.attname, x.privilege_type, x.is_grantable,
           pg_get_userbyid(x.grantor) AS grantor
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE c.relnamespace='public'::regnamespace AND a.attnum>0
      AND c.relname NOT IN ('global_administrators', 'feature_flags', 'feature_flag_churches')
      AND x.grantee='levi_dev_runtime'::regrole
  `);
  assert.equal(rows.length, expected.length);
  assert.deepEqual(
    rows.map((r) => `${r.relname}.${r.attname}:${r.privilege_type}`).sort(),
    expected,
  );
  for (const row of rows) {
    assert.equal(row.grantor, "levi_dev_migrator");
    assert.equal(row.is_grantable, false);
  }
  for (const [table, privilege, columns] of groups) {
    for (const column of columns)
      assert.equal(
        (
          await runtime.client.query<Record<string, unknown>>(
            "SELECT has_column_privilege(current_user,$1,$2,$3) AS allowed",
            [`public.${table}`, column, privilege],
          )
        ).rows[0]?.allowed,
        true,
      );
    assert.equal(
      (
        await runtime.client.query<Record<string, unknown>>(
          "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
          [`public.${table}`, privilege],
        )
      ).rows[0]?.allowed,
      tableAcl.some(
        (row) => row.relname === table && row.privilege_type === privilege,
      ),
    );
  }
  for (const table of [
    "members",
    "member_history",
    "member_creation_requests",
    "churches",
    "church_memberships",
  ])
    for (const privilege of [
      "DELETE",
      "TRIGGER",
      "TRUNCATE",
      "REFERENCES",
      "MAINTAIN",
    ])
      assert.equal(
        (
          await runtime.client.query<Record<string, unknown>>(
            "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
            [`public.${table}`, privilege],
          )
        ).rows[0]?.allowed,
        table === "church_memberships" && privilege === "DELETE",
      );
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(`
    SELECT count(*)::int AS count FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) x
    WHERE x.grantee='levi_dev_runtime'::regrole AND x.is_grantable
  `)
    ).rows[0]?.count,
    0,
  );
  for (const table of [
    "member_history",
    "member_profile_history",
    "audit_events",
  ])
    await assert.rejects(
      runtime.client.query(`SELECT * FROM ${table} LIMIT 1`),
      { code: "42501" },
    );
});

void test("ACLs reais: FOR SHARE conserva locks e UPDATE real/no-op/sem linhas é rejeitado pelo trigger", async () => {
  const user = randomUUID(),
    church = randomUUID(),
    membership = randomUUID();
  await migrator.client.query("BEGIN");
  await migrator.client.query(
    `INSERT INTO "user"(id,name,email) VALUES($1,'Conta ACL',$2)`,
    [user, `${user}@example.test`],
  );
  await migrator.client.query(
    "INSERT INTO churches(id,name) VALUES($1,'Igreja ACL')",
    [church],
  );
  await migrator.client.query(
    "INSERT INTO church_memberships(id,church_id,user_id,role) VALUES($1,$2,$3,'admin')",
    [membership, church, user],
  );
  await migrator.client.query("COMMIT");
  for (const [table, id] of [
    ["churches", church],
    ["church_memberships", membership],
  ] as const) {
    const before = (
      await observer.client.query<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE id=$1`,
        [id],
      )
    ).rows;
    await runtime.client.query("BEGIN");
    try {
      assert.equal(
        (
          await runtime.client.query(
            `SELECT * FROM ${table} WHERE id=$1 FOR SHARE`,
            [id],
          )
        ).rowCount,
        1,
      );
      await assert.rejects(
        migrator.client.query(
          `SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,
          [id],
        ),
        { code: "55P03" },
      );
    } finally {
      await runtime.client.query("ROLLBACK");
    }
    for (const sql of [
      `UPDATE ${table} SET created_at='2000-01-01' WHERE id=$1`,
      `UPDATE ${table} SET created_at=created_at WHERE id=$1`,
      `UPDATE ${table} SET created_at=now() WHERE id=$1 AND false`,
    ])
      await assert.rejects(runtime.client.query(sql, [id]), {
        code: "42501",
      });
    assert.deepEqual(
      (
        await observer.client.query<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE id=$1`,
          [id],
        )
      ).rows,
      before,
    );
    // A mesma instrução legítima da owner continua funcionando.
    assert.equal(
      (
        await migrator.client.query(
          `UPDATE ${table} SET created_at=created_at WHERE id=$1`,
          [id],
        )
      ).rowCount,
      1,
    );
  }
});

void test("ACLs reais: runtime não altera proteção, assume roles, cria wrappers ou amplia ACLs", async () => {
  const role = (
    await observer.client.query<Record<string, unknown>>(`
    SELECT rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname='levi_dev_runtime'
  `)
  ).rows[0];
  assert.ok(role);
  assert.ok(Object.values(role).every((value) => value === false));
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(`
    SELECT count(*)::int AS count FROM pg_auth_members
    WHERE member='levi_dev_runtime'::regrole
  `)
    ).rows[0]?.count,
    0,
  );
  assert.equal(
    (
      await observer.client.query<Record<string, unknown>>(`
    SELECT count(*)::int AS count FROM pg_proc WHERE prosecdef
  `)
    ).rows[0]?.count,
    0,
  );
  for (const sql of [
    "ALTER TABLE churches DISABLE TRIGGER USER",
    "ALTER TABLE church_memberships DISABLE TRIGGER USER",
    "DROP TRIGGER church_admin_required ON churches",
    "ALTER FUNCTION public.reject_dev_runtime_update() SECURITY DEFINER",
    "CREATE OR REPLACE FUNCTION public.reject_dev_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
    "SET session_replication_role = replica",
    "SET ROLE levi_dev_migrator",
    "SET ROLE levi_test",
    "SET SESSION AUTHORIZATION levi_dev_migrator",
    "CREATE ROLE synthetic_escalation",
    "GRANT levi_dev_migrator TO levi_dev_runtime",
    "CREATE FUNCTION public.synthetic_wrapper() RETURNS void LANGUAGE sql SECURITY DEFINER AS 'SELECT NULL'",
    "CREATE TEMP TABLE synthetic_shadow(id uuid)",
  ])
    await assert.rejects(runtime.client.query(sql), {
      code: "42501",
    });
  // GRANT sem grant option pode apenas emitir WARNING: verificar efeito, não só erro.
  for (const sql of [
    "GRANT SELECT ON member_history TO levi_dev_runtime",
    "GRANT SELECT ON members TO levi_dev_runtime",
    "GRANT UPDATE ON churches TO levi_dev_runtime",
  ]) {
    try {
      await runtime.client.query(sql);
    } catch (error) {
      assert.equal((error as { code: string }).code, "42501");
    }
  }
  for (const [table, privilege] of [
    ["member_history", "SELECT"],
    ["members", "SELECT"],
    ["churches", "UPDATE"],
  ])
    assert.equal(
      (
        await runtime.client.query<Record<string, unknown>>(
          "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
          [table, privilege],
        )
      ).rows[0]?.allowed,
      false,
    );
  const protection = (
    await observer.client.query<Record<string, unknown>>(`
    SELECT t.tgtype,t.tgenabled,p.prosecdef,p.proconfig,
      has_function_privilege('levi_dev_runtime',p.oid,'EXECUTE') AS can_execute
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE p.oid='public.church_has_admin()'::regprocedure
  `)
  ).rows;
  assert.equal(protection.length, 2);
  for (const row of protection) {
    assert.equal(row.tgenabled, "O");
    assert.equal(row.prosecdef, false);
    assert.equal(row.can_execute, false);
    assert.deepEqual(row.proconfig, ["search_path=pg_catalog"]);
  }
});

void test("edição ACL: runtime não altera tenant, igreja, situação, identificadores ou histórico", async () => {
  for (const column of ["id", "church_id", "church_id", "status", "created_at"])
    await assert.rejects(
      runtime.client.query(
        `UPDATE members SET ${column}=${column} WHERE false`,
      ),
      { code: "42501" },
    );
  for (const sql of [
    "UPDATE member_profile_history SET version=version WHERE false",
    "DELETE FROM member_profile_history WHERE false",
    "SELECT * FROM member_profile_history",
  ])
    await assert.rejects(runtime.client.query(sql), {
      code: "42501",
    });
});
