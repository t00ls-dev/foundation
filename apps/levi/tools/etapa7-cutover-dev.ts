import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import {
  devCutoverAdminTarget,
  devMigrationTarget,
} from "./dev-migration-config.js";
import {
  capturePreservation,
  guardedRead,
  preservationDifferences,
  verifyCheckpoint,
} from "./etapa7-verification.js";
import type { Checkpoint, Preservation } from "./etapa7-verification.js";

type Client = Awaited<ReturnType<typeof createPostgresDatabase>>["client"];
type BarrierState = {
  runtime_can_login: boolean;
  runtime_usage: { database: string | null; backends: number }[];
  active_transactions: number;
  locks: number;
  prepared: number;
  runtime_memberships: number;
  signal_member: boolean;
  runtime_member: boolean;
  runtime_admin_option: boolean;
  operator_super: boolean;
  operator_createrole: boolean;
  runtime_privileged: boolean;
};

const adminIdentity = {
  database: "levi_dev",
  role: "neondb_owner",
  project: "divine-violet-20368018",
  branch: "br-dawn-base-b68erh5e",
  endpoint: "ep-morning-wildflower-b6hjki5i",
};
const migratorIdentity = {
  ...adminIdentity,
  role: "levi_dev_migrator",
};

class CutoverError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

let step = "start";
let barrierApplied = false;

function fail(code: string): never {
  throw new CutoverError(code);
}

async function assertAdminIdentity(client: Client) {
  const { rows } = await client.query<{
    database: string;
    role: string;
    login: string;
    project: string | null;
    branch: string | null;
    endpoint: string | null;
  }>(
    `SELECT current_database() AS database, current_user AS role,
      session_user AS login, current_setting('neon.project_id', true) AS project,
      current_setting('neon.branch_id', true) AS branch,
      current_setting('neon.endpoint_id', true) AS endpoint`,
  );
  const row = rows[0];
  if (
    !row ||
    row.database !== adminIdentity.database ||
    row.role !== adminIdentity.role ||
    row.login !== adminIdentity.role ||
    row.project !== adminIdentity.project ||
    row.branch !== adminIdentity.branch ||
    row.endpoint !== adminIdentity.endpoint
  )
    fail("admin_identity");
}

async function barrierState(client: Client): Promise<BarrierState> {
  const { rows } = await client.query<BarrierState>(
    `SELECT
      (SELECT rolcanlogin FROM pg_roles WHERE rolname='levi_dev_runtime') AS runtime_can_login,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('database', datname, 'backends', n)), '[]'::jsonb)
        FROM (SELECT datname, count(*)::int AS n FROM pg_stat_activity
          WHERE usename='levi_dev_runtime' GROUP BY datname) s) AS runtime_usage,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid() AND xact_start IS NOT NULL) AS active_transactions,
      (SELECT count(*)::int FROM pg_locks WHERE pid<>pg_backend_pid()
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS locks,
      (SELECT count(*)::int FROM pg_prepared_xacts) AS prepared,
      (SELECT count(*)::int FROM pg_auth_members
        WHERE member='levi_dev_runtime'::regrole) AS runtime_memberships,
      pg_has_role(current_user, 'pg_signal_backend', 'MEMBER') AS signal_member,
      pg_has_role(current_user, 'levi_dev_runtime', 'MEMBER') AS runtime_member,
      (SELECT admin_option FROM pg_auth_members m
        JOIN pg_roles p ON p.oid=m.roleid JOIN pg_roles c ON c.oid=m.member
        WHERE p.rolname='levi_dev_runtime' AND c.rolname=current_user) AS runtime_admin_option,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS operator_super,
      (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) AS operator_createrole,
      (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
        FROM pg_roles WHERE rolname='levi_dev_runtime') AS runtime_privileged`,
  );
  const row = rows[0];
  if (!row) fail("barrier_state");
  return row;
}

async function waitForQuiet(client: Client): Promise<BarrierState> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await barrierState(client);
    if (
      state.active_transactions === 0 &&
      state.locks === 0 &&
      state.prepared === 0
    )
      return state;
    await sleep(500);
  }
  fail("concurrent_activity");
}

async function readPreservation(url: string, phase: Checkpoint) {
  const { client } = await createPostgresDatabase(url);
  try {
    await guardedRead(client, migratorIdentity);
    return await capturePreservation(client, phase);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function runOperation(url: string, name: string) {
  const { client } = await createPostgresDatabase(url);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query(
      await readFile(
        new URL(`../ops/etapa3/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function verifyConverted(url: string, before: Preservation) {
  const { client } = await createPostgresDatabase(url);
  try {
    await guardedRead(client, migratorIdentity);
    const result = await verifyCheckpoint(client, "converted");
    const after = await capturePreservation(client, "converted");
    const preservation = preservationDifferences(before, after);
    if (preservation.some((entry) => entry.differences !== 0))
      fail("preservation_mismatch");
    return {
      history: {
        applied: result.history.applied.length,
        pending: result.history.pending.length,
      },
      checks: result.results.length,
      preservation,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function prepare(adminUrl: string, migratorUrl: string) {
  const { client } = await createPostgresDatabase(adminUrl);
  try {
    await assertAdminIdentity(client);
    let state = await waitForQuiet(client);
    if (state.runtime_can_login !== true) fail("runtime_already_blocked");
    if (
      state.operator_createrole !== true ||
      state.signal_member !== true ||
      state.runtime_member !== true ||
      state.runtime_admin_option !== true
    )
      fail("operator_privileges");
    if (state.runtime_privileged) fail("runtime_privileges");
    if (state.runtime_memberships !== 0) fail("runtime_memberships");
    if (
      state.runtime_usage.some(
        (entry) => entry.database !== adminIdentity.database,
      )
    )
      fail("runtime_other_database");

    step = "barrier";
    await client.query("ALTER ROLE levi_dev_runtime NOLOGIN");
    barrierApplied = true;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await barrierState(client);
      if (state.runtime_usage.length === 0) break;
      await client.query(
        `SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity
          WHERE usename='levi_dev_runtime' AND datname='levi_dev'
          AND pid<>pg_backend_pid()`,
      );
      await sleep(250);
    }
    state = await barrierState(client);
    if (state.runtime_can_login !== false) fail("nologin_not_applied");
    if (state.runtime_usage.length !== 0) fail("runtime_backends_remain");
    if (
      state.active_transactions !== 0 ||
      state.locks !== 0 ||
      state.prepared !== 0
    )
      fail("concurrent_activity_after_barrier");
    console.info(
      JSON.stringify({
        operacao: "cutover-dev-barreira",
        runtimeCanLogin: false,
        backends: 0,
      }),
    );

    step = "preservation_before";
    const before = await readPreservation(migratorUrl, "expand8");
    step = "conversion";
    await runOperation(migratorUrl, "converter");
    step = "acls";
    await runOperation(migratorUrl, "runtime-acls");
    step = "verification";
    const result = await verifyConverted(migratorUrl, before);
    console.info(
      JSON.stringify({
        operacao: "cutover-dev-prepare",
        runtimeCanLogin: false,
        journal: result.history,
        checks: result.checks,
        preservation: result.preservation,
      }),
    );
  } catch (error) {
    if (barrierApplied)
      console.error(
        JSON.stringify({
          operacao: "cutover-dev-prepare",
          estado: "interrompido",
          runtimeCanLogin: false,
          passo: step,
        }),
      );
    throw error;
  } finally {
    await client.end();
  }
}

async function resume(adminUrl: string) {
  const { client } = await createPostgresDatabase(adminUrl);
  try {
    await assertAdminIdentity(client);
    let state = await waitForQuiet(client);
    if (
      state.operator_createrole !== true ||
      state.runtime_member !== true ||
      state.runtime_admin_option !== true
    )
      fail("operator_privileges");
    if (state.runtime_can_login === true) {
      console.info(
        JSON.stringify({
          operacao: "cutover-dev-resume",
          runtimeCanLogin: true,
          estado: "ja_habilitado",
        }),
      );
      return;
    }
    if (state.runtime_usage.length !== 0) fail("runtime_backends_present");
    step = "resume";
    await client.query("ALTER ROLE levi_dev_runtime LOGIN");
    state = await barrierState(client);
    if (state.runtime_can_login !== true) fail("login_not_restored");
    console.info(
      JSON.stringify({
        operacao: "cutover-dev-resume",
        runtimeCanLogin: true,
        backends: 0,
      }),
    );
  } finally {
    await client.end();
  }
}

async function status(adminUrl: string) {
  const { client } = await createPostgresDatabase(adminUrl);
  try {
    await assertAdminIdentity(client);
    await guardedRead(client, adminIdentity);
    const state = await barrierState(client);
    console.info(JSON.stringify({ operacao: "cutover-dev-status", ...state }));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

try {
  const operation =
    process.argv[2] === "--status"
      ? "status"
      : process.argv[2] === "--prepare"
        ? "prepare"
        : process.argv[2] === "--resume"
          ? "resume"
          : null;
  if (!operation || process.argv.length !== 3) fail("usage");
  let adminUrl: string;
  try {
    adminUrl = devCutoverAdminTarget(process.env, operation);
  } catch {
    fail("target_rejected");
  }
  if (operation === "prepare") {
    let migratorUrl: string;
    try {
      migratorUrl = devMigrationTarget(process.env, "apply");
    } catch {
      fail("migrator_target_rejected");
    }
    await prepare(adminUrl, migratorUrl);
  } else if (operation === "resume") {
    await resume(adminUrl);
  } else {
    await status(adminUrl);
  }
} catch (error) {
  const code = error instanceof CutoverError ? error.code : "unexpected";
  console.error(
    JSON.stringify({ operacao: "cutover-dev", passo: step, erro: code }),
  );
  process.exitCode = 1;
}
