import { readFile } from "node:fs/promises";
import type { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { inspectMigrationHistory } from "./migration-history.js";

type Client = Awaited<ReturnType<typeof createPostgresDatabase>>["client"];
export type Checkpoint =
  "baseline" | "expand7" | "expand8" | "converted" | "contracted";
export type Identity = {
  database: string;
  role: string;
  project: string | null;
  branch: string | null;
  endpoint: string | null;
};
export type Preservation = Map<string, string[]>;
const archived = [
  "tenants",
  "tenant_memberships",
  "tenant_sessions",
  "onboarding_provisions",
  "feature_flag_organizations",
];

function requireCondition(ok: boolean, label: string): void {
  if (!ok) throw new Error(`Verificação recusada: ${label}.`);
}

// O chamador fecha esta transação e a conexão antes de qualquer operação externa.
export async function guardedRead(client: Client, identity: Identity) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL lock_timeout='2s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  await client.query("SET LOCAL search_path=pg_catalog,public");
  await client.query("SET LOCAL timezone='UTC'");
  const { rows } = await client.query(`SELECT current_database() AS database,
    current_user AS role, session_user AS login, current_setting('transaction_read_only') AS readonly,
    current_setting('neon.project_id',true) AS project,
    current_setting('neon.branch_id',true) AS branch,
    current_setting('neon.endpoint_id',true) AS endpoint`);
  const row: unknown = rows[0];
  requireCondition(
    typeof row === "object" && row !== null,
    "identidade ausente",
  );
  if (typeof row !== "object" || row === null) return;
  for (const [key, expected] of Object.entries({
    ...identity,
    login: identity.role,
    readonly: "on",
  }))
    requireCondition(
      key in row && Reflect.get(row, key) === expected,
      "identidade SQL divergente",
    );
}

export async function capturePreservation(
  client: Client,
  phase: Checkpoint,
): Promise<Preservation> {
  const snapshot: Preservation = new Map();
  const legacy = phase === "contracted" ? "levi_legacy" : "public";
  const queries = new Map<string, string>([
    ...[
      "user",
      "account",
      "session",
      "verification",
      "feature_flags",
      "global_administrators",
      "admin_bootstrap",
    ].map<[string, string]>((table) => [
      table,
      `SELECT to_jsonb(t)::text AS value FROM public."${table}" t`,
    ]),
    [
      "churches",
      "SELECT (to_jsonb(t)-'tenant_id'-'version'-'updated_at')::text AS value FROM public.churches t",
    ],
    [
      "members",
      "SELECT (to_jsonb(t)-'tenant_id')::text AS value FROM public.members t",
    ],
    ...[
      "member_history",
      "member_profile_history",
      "member_creation_requests",
    ].map<[string, string]>((table) => [
      table,
      `SELECT (to_jsonb(t)-'tenant_id'-'church_id')::text AS value FROM public.${table} t`,
    ]),
    [
      "audit_events",
      "SELECT (to_jsonb(t)-'church_id')::text AS value FROM public.audit_events t",
    ],
    ...archived.map<[string, string]>((table) => [
      table,
      `SELECT to_jsonb(t)::text AS value FROM ${legacy}.${table} t`,
    ]),
    [
      "church_organizations",
      phase === "contracted"
        ? "SELECT to_jsonb(t)::text AS value FROM levi_legacy.church_organizations t"
        : "SELECT jsonb_build_object('church_id',id,'organization_id',tenant_id)::text AS value FROM public.churches WHERE tenant_id IS NOT NULL",
    ],
  ]);
  for (const table of [
    "members",
    "member_history",
    "member_profile_history",
    "member_creation_requests",
  ]) {
    const tenant =
      phase === "contracted"
        ? "(SELECT organization_id FROM levi_legacy.church_organizations o WHERE o.church_id=t.church_id)"
        : "t.tenant_id";
    queries.set(
      `legacy_scope_${table}`,
      `SELECT jsonb_build_object('row',to_jsonb(t)-'tenant_id'-'church_id','tenant_id',${tenant})::text AS value FROM public.${table} t`,
    );
  }
  for (const [name, sql] of queries) {
    const { rows } = await client.query<{ value: string }>(sql);
    snapshot.set(name, rows.map((r) => r.value).sort());
  }
  return snapshot;
}

// Nenhum valor ou digest de dados sensíveis sai da memória do operador.
export function preservationDifferences(
  before: Preservation,
  after: Preservation,
) {
  return [...before].map(([table, values]) => {
    const current = after.get(table) ?? [];
    return {
      table,
      differences:
        values.length === current.length &&
        values.every((value, index) => value === current[index])
          ? 0
          : 1,
    };
  });
}

async function difference(
  client: Client,
  label: string,
  expected: string,
  actual: string,
) {
  const { rows } = await client.query<{
    differences: number;
  }>(`SELECT count(*)::int AS differences FROM (
    ((${expected}) EXCEPT ALL (${actual})) UNION ALL ((${actual}) EXCEPT ALL (${expected}))
    ) delta`);
  const count = rows[0]?.differences;
  requireCondition(count === 0, label);
  return { check: label, differences: count };
}

export async function verifyCheckpoint(client: Client, phase: Checkpoint) {
  const history = await inspectMigrationHistory(client);
  const expected = phase === "baseline" ? 7 : phase === "expand7" ? 8 : 9;
  requireCondition(history.applied.length === expected, "journal fora da fase");
  const contracted = phase === "contracted";
  const legacy = contracted ? "levi_legacy" : "public";
  const archiveSchema = await client.query<{ present: boolean }>(
    "SELECT to_regnamespace('levi_legacy') IS NOT NULL AS present",
  );
  requireCondition(
    archiveSchema.rows[0]?.present === contracted,
    "arquivo legado fora da fase",
  );
  const absent = contracted
    ? archived.map((t) => `public.${t}`)
    : phase === "baseline"
      ? [
          "church_memberships",
          "church_sessions",
          "church_creation_requests",
          "feature_flag_churches",
          "church_invitations",
        ].map((t) => `public.${t}`)
      : phase === "expand7"
        ? ["public.church_invitations"]
        : [];
  for (const relation of absent) {
    const found = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [relation],
    );
    requireCondition(
      found.rows[0]?.present === false,
      "relação inesperada para fase",
    );
  }

  const results = [];
  if (phase === "converted" || contracted) {
    const mapping = contracted
      ? "levi_legacy.church_organizations"
      : "(SELECT id AS church_id,tenant_id AS organization_id FROM public.churches)";
    results.push(
      await difference(
        client,
        "acessos administrativos exatos",
        `SELECT c.church_id,m.user_id,m.role,m.created_at FROM ${legacy}.tenant_memberships m JOIN ${mapping} c ON c.organization_id=m.tenant_id WHERE m.role='admin'`,
        "SELECT church_id,user_id,role,created_at FROM public.church_memberships",
      ),
    );
    results.push(
      await difference(
        client,
        "seleções inequívocas",
        `SELECT ts.session_id,min(c.church_id::text)::uuid FROM ${legacy}.tenant_sessions ts JOIN public.session s ON s.id=ts.session_id JOIN ${mapping} c ON c.organization_id=ts.active_tenant_id JOIN public.church_memberships m ON m.church_id=c.church_id AND m.user_id=s.user_id GROUP BY ts.session_id HAVING count(*)=1`,
        "SELECT session_id,active_church_id FROM public.church_sessions",
      ),
    );
    results.push(
      await difference(
        client,
        "flags exatas",
        `SELECT f.feature_flag_id,c.church_id FROM ${legacy}.feature_flag_organizations f JOIN ${mapping} c ON c.organization_id=f.organization_id`,
        "SELECT feature_flag_id,church_id FROM public.feature_flag_churches",
      ),
    );
    for (const table of [
      "member_history",
      "member_profile_history",
      "member_creation_requests",
    ])
      results.push(
        await difference(
          client,
          `${table}: escopo exato`,
          `SELECT h.member_id,m.church_id FROM public.${table} h JOIN public.members m ON m.id=h.member_id`,
          `SELECT member_id,church_id FROM public.${table}`,
        ),
      );
    const invalid = await client.query<{ n: number }>(
      `SELECT count(*)::int n FROM public.churches c WHERE c.version<>1 OR c.updated_at IS NULL OR NOT EXISTS (SELECT 1 FROM public.church_memberships m WHERE m.church_id=c.id AND m.role='admin')`,
    );
    requireCondition(
      invalid.rows[0]?.n === 0,
      "igrejas sem admin ou expansão divergente",
    );
    const audit = await client.query<{ n: number }>(
      "SELECT count(*)::int n FROM public.audit_events WHERE church_id IS NOT NULL",
    );
    requireCondition(audit.rows[0]?.n === 0, "auditoria histórica reatribuída");
  }
  if (phase === "converted" || contracted) {
    const acl = await client.query<{ check: string; differences: number }>(
      await readFile(
        new URL("../ops/etapa7/acl-checks.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const result of acl.rows) {
      requireCondition(result.differences === 0, result.check);
      results.push(result);
    }
  }
  const relations = [
    "user",
    "account",
    "session",
    "verification",
    "churches",
    "members",
    "member_history",
    "member_profile_history",
    "member_creation_requests",
    "audit_events",
    ...archived.map((t) => `${contracted ? "levi_legacy" : "public"}.${t}`),
  ];
  if (phase !== "baseline")
    relations.push(
      "church_memberships",
      "church_sessions",
      "church_creation_requests",
      "feature_flag_churches",
    );
  if (phase !== "baseline" && phase !== "expand7")
    relations.push("church_invitations");
  if (contracted) relations.push("levi_legacy.church_organizations");
  for (const name of relations) {
    const relation = name.includes(".") ? name : `public.${name}`;
    const found = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [relation],
    );
    requireCondition(
      found.rows[0]?.present === true,
      "relação esperada ausente",
    );
  }
  const structure = await client.query<{ n: number }>(
    `SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','levi_legacy','drizzle') AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner)<>current_user`,
  );
  requireCondition(structure.rows[0]?.n === 0, "owner divergente");
  const invalidStructure = await client.query<{ n: number }>(`SELECT (
    (SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','levi_legacy','drizzle') AND NOT k.convalidated) +
    (SELECT count(*) FROM pg_index x JOIN pg_class c ON c.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','levi_legacy','drizzle') AND (NOT x.indisvalid OR NOT x.indisready)))::int n`);
  requireCondition(
    invalidStructure.rows[0]?.n === 0,
    "constraint ou índice inválido",
  );
  if (phase === "converted" || contracted) {
    const pk = await client.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.member_creation_requests'::regclass AND contype='p'",
    );
    requireCondition(
      pk.rows[0]?.definition ===
        "PRIMARY KEY (church_id, actor_id, request_key)",
      "chave do recibo",
    );
    const premature = await client.query<{ n: number }>(
      "SELECT ((SELECT count(*) FROM public.church_creation_requests)+(SELECT count(*) FROM public.church_invitations))::int n",
    );
    requireCondition(
      premature.rows[0]?.n === 0,
      "DML funcional antes da validação",
    );
  }
  if (contracted) {
    for (const [relation, name] of [
      ["public.churches", "church_admin_required"],
      ["public.church_memberships", "membership_admin_required"],
      ["public.church_memberships", "church_access_lock"],
      ["public.audit_events", "audit_no_new_legacy"],
      ["public.audit_events", "audit_events_append_only"],
      ...[...archived, "church_organizations"].map((t) => [
        `levi_legacy.${t}`,
        "legacy_closed",
      ]),
    ]) {
      const trigger = await client.query<{ n: number }>(
        "SELECT count(*)::int n FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled='O'",
        [relation, name],
      );
      requireCondition(
        trigger.rows[0]?.n === 1,
        "trigger de contract ausente/desativado",
      );
    }
    for (const name of [
      "church_has_admin",
      "lock_church_access",
      "reject_legacy_audit",
    ]) {
      const fn = await client.query<{ n: number }>(
        "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1 AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']",
        [name],
      );
      requireCondition(fn.rows[0]?.n === 1, "função de contract divergente");
    }
  }
  const { rows } = await client.query<{ catalog: unknown }>(
    await readFile(
      new URL("../ops/etapa7/catalog.sql", import.meta.url),
      "utf8",
    ),
  );
  return { history, results, catalog: rows[0]?.catalog };
}
