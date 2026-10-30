import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { inspectMigrationHistory } from "../tools/migration-history.js";
import {
  migrationSelection,
  selectedMigrationFolder,
} from "../tools/migration-selection.js";
import { rm } from "node:fs/promises";
import { devMigrationTarget } from "../tools/dev-migration-config.js";

const artifacts = readMigrationFiles({ migrationsFolder: "migrations" });
const rows = artifacts.map((migration, index) => ({
  id: index + 1,
  hash: migration.hash,
  created_at: String(migration.folderMillis),
}));
function executor(history: typeof rows, exists = true) {
  return {
    async query<T>(text: string) {
      assert.ok(text.startsWith("SELECT "), "Somente consultas de leitura");
      if (text.includes("to_regclass"))
        return Promise.resolve({
          rows: [
            { relation: exists ? "drizzle.__drizzle_migrations" : null },
          ] as T[],
        });
      return Promise.resolve({ rows: history as T[] });
    },
  } as unknown as Parameters<typeof inspectMigrationHistory>[0];
}

void test("histórico compara hashes imutáveis das migrations versionadas e prefixos válidos", async () => {
  assert.deepEqual(
    artifacts.slice(0, 4).map((migration) => migration.hash),
    [
      "3c443822590ebe28afbe52b12874636b23329db4ef72f543e59467cc23b0b7e0",
      "930df1c2212b60f402c68874cb5e718eddd927f999909f10afa7899527db616d",
      "5e312156d4261078857698fe7e9ef2dba30d98d8822b55d761eb171c8bdba2ae",
      "10cc56118569f1a7b0fa64db2fbfa6640ffed47688debcf92a135d883b7f0dae",
    ],
  );
  for (const length of [0, 2, 4, 5]) {
    const status = await inspectMigrationHistory(
      executor(rows.slice(0, length)),
    );
    assert.equal(status.applied.length, length);
    assert.equal(status.pending.length, artifacts.length - length);
  }
  assert.equal(
    (await inspectMigrationHistory(executor([], false))).pending.length,
    artifacts.length,
  );
});

void test("histórico recusa hash divergente, lacuna, duplicação, ordem e registro adicional", async () => {
  for (const history of [
    [{ ...rows[0]!, hash: "0".repeat(64) }],
    rows.slice(1),
    [rows[0]!, rows[0]!],
    [...rows].reverse(),
    [...rows, rows[3]!],
  ])
    await assert.rejects(inspectMigrationHistory(executor(history)));
});

void test("status DEV exige confirmação distinta e mantém guardas de identidade e TLS", () => {
  const host = "ep-synthetic-only.us-east-2.aws.neon.tech";
  const env = {
    LEVI_DEV_DATABASE_URL: `postgresql://levi_dev_migrator:synthetic-only@${host}/levi_dev?sslmode=verify-full`,
    LEVI_DEV_DATABASE_HOST: host,
    LEVI_DEV_DATABASE_NAME: "levi_dev",
    LEVI_DEV_MIGRATION_CONFIRMATION: `CONSULTAR:${host}/levi_dev`,
  };
  assert.equal(devMigrationTarget(env, "status"), env.LEVI_DEV_DATABASE_URL);
  assert.throws(() => devMigrationTarget(env));
  assert.throws(() =>
    devMigrationTarget(
      { ...env, LEVI_DEV_MIGRATION_CONFIRMATION: `APLICAR:${host}/levi_dev` },
      "status",
    ),
  );
  assert.throws(() =>
    devMigrationTarget(
      {
        ...env,
        LEVI_DEV_DATABASE_URL: env.LEVI_DEV_DATABASE_URL.replace(
          "verify-full",
          "require",
        ),
      },
      "status",
    ),
  );
});

void test("runner DEV separa status/aplicação, libera conexão e interrompe em identidade, lock ou journal divergente", async () => {
  const source = await readFile("tools/migrate-dev.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  for (const mode of [
    "status",
    "apply",
    "identity",
    "lock",
    "journal",
  ] as const) {
    const queries: string[] = [];
    const output: string[] = [];
    let migrations = 0;
    let inspections = 0;
    let closed = 0;
    const process = {
      argv: [
        "node",
        "runner",
        ...(mode === "status" ? ["--status"] : ["--through", "0000"]),
      ],
      env: { LEVI_DEV_DATABASE_NAME: "levi_dev" },
      exitCode: 0,
    };
    const modules: Record<string, unknown> = {
      "node:fs/promises": { rm: async () => {} },
      "./migration-selection.js": {
        migrationSelection: () => (mode === "status" ? null : "0000"),
        selectedMigrationFolder: () => Promise.resolve("synthetic"),
      },
      "@t00ls-dev/db/postgres": {
        createPostgresDatabase: async () =>
          Promise.resolve({
            db: {},
            client: {
              query: async (sql: string) => {
                queries.push(sql);
                if (sql.includes("current_database"))
                  return Promise.resolve({
                    rows: [
                      {
                        database: "levi_dev",
                        role: "levi_dev_migrator",
                        login:
                          mode === "identity" ? "other" : "levi_dev_migrator",
                        schema: "public",
                      },
                    ],
                  });
                if (sql.includes("pg_try_advisory_lock"))
                  return Promise.resolve({
                    rows: [{ locked: mode !== "lock" }],
                  });
                return Promise.resolve({ rows: [] });
              },
              end: async () => {
                closed++;
                return Promise.resolve();
              },
            },
          }),
      },
      "drizzle-orm/node-postgres/migrator": {
        migrate: async () => {
          migrations++;
          return Promise.resolve();
        },
      },
      "./dev-migration-config.js": {
        devMigrationTarget: (_env: unknown, operation: string) => {
          assert.equal(operation, mode === "status" ? "status" : "apply");
          return "synthetic-only";
        },
      },
      "./migration-history.js": {
        inspectMigrationHistory: async () => {
          inspections++;
          if (mode === "journal") throw new Error("private-database-error");
          return Promise.resolve({
            applied: migrations ? ["0000"] : [],
            pending: migrations ? [] : ["0000"],
          });
        },
      },
    };
    await runInNewContext(`(async () => { ${compiled} })()`, {
      require: (name: string) => {
        assert.ok(name in modules);
        return modules[name];
      },
      exports: {},
      process,
      console: {
        info: (value: string) => output.push(value),
        error: (value: string) => output.push(value),
      },
    });
    assert.equal(closed, 1);
    assert.equal(migrations, mode === "apply" ? 1 : 0);
    assert.equal(process.exitCode, ["status", "apply"].includes(mode) ? 0 : 1);
    assert.equal(queries.includes("BEGIN READ ONLY"), mode === "status");
    assert.equal(queries.includes("ROLLBACK"), mode === "status");
    assert.equal(
      inspections,
      mode === "apply" ? 2 : ["status", "journal"].includes(mode) ? 1 : 0,
    );
    assert.ok(!output.join("").includes("private-"));
  }
});

void test("seleção exige revisão explícita e recusa lote, contract, reset e revisão futura", async () => {
  for (const args of [
    [],
    ["--status", "--reset"],
    ["--through", "contract"],
    ["--through", "0009_future"],
    ["--reset"],
  ])
    assert.throws(() => migrationSelection(args));
  assert.equal(migrationSelection(["--status"]), null);
  for (const tag of ["0007_igrejas-expand", "0008_convites-igreja"]) {
    assert.equal(migrationSelection(["--through", tag]), tag);
    await assert.rejects(selectedMigrationFolder(tag, []));
    await assert.rejects(
      selectedMigrationFolder(tag, ["0000_onboarding", tag]),
    );
    const folder = await selectedMigrationFolder(tag, [tag]);
    try {
      const selected = readMigrationFiles({ migrationsFolder: folder });
      assert.equal(selected.length, tag.startsWith("0007") ? 8 : 9);
      assert.deepEqual(selected, artifacts.slice(0, selected.length));
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
});
