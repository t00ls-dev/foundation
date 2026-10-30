import { rm } from "node:fs/promises";
import {
  migrationSelection,
  selectedMigrationFolder,
} from "./migration-selection.js";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { devMigrationTarget } from "./dev-migration-config.js";
import { inspectMigrationHistory } from "./migration-history.js";

// Nunca importado pela aplicação ou pelo build/deploy. Ação administrativa explícita.
try {
  const selected = migrationSelection(process.argv.slice(2));
  const statusOnly = selected === null;
  const databaseUrl = devMigrationTarget(
    process.env,
    statusOnly ? "status" : "apply",
  );
  const { client, db } = await createPostgresDatabase(databaseUrl);
  try {
    const identity = await client.query<{
      database: string;
      role: string;
      login: string;
      schema: string;
    }>(
      "SELECT current_database() AS database, current_user AS role, session_user AS login, current_schema() AS schema",
    );
    if (
      identity.rows[0]?.database !== process.env.LEVI_DEV_DATABASE_NAME ||
      identity.rows[0]?.role !== "levi_dev_migrator" ||
      identity.rows[0]?.login !== "levi_dev_migrator" ||
      identity.rows[0]?.schema !== "public"
    )
      throw new Error();
    if (statusOnly) {
      await client.query("BEGIN READ ONLY");
      try {
        const status = await inspectMigrationHistory(client);
        console.info(
          JSON.stringify({ operacao: "migration-dev-status", ...status }),
        );
      } finally {
        await client.query("ROLLBACK");
      }
    } else {
      const lock = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(715463, 1) AS locked",
      );
      if (!lock.rows[0]?.locked) throw new Error();
      const before = await inspectMigrationHistory(client);
      console.info(
        JSON.stringify({
          operacao: "migration-dev",
          pendentes: before.pending.length,
        }),
      );
      if (selected === null) throw new Error();
      const folder = await selectedMigrationFolder(selected, before.pending);
      try {
        await migrate(db, { migrationsFolder: folder });
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
      const after = await inspectMigrationHistory(client);
      if (
        after.applied.length !== before.applied.length + 1 ||
        after.applied.at(-1) !== selected
      )
        throw new Error();
      console.info(
        JSON.stringify({
          operacao: "migration-dev",
          pendentes: after.pending.length,
          aplicadas: after.applied.length,
        }),
      );
    }
  } finally {
    // A conexão direta encerrada também libera o lock administrativo.
    await client.end();
  }
} catch {
  console.error(
    "Não foi possível confirmar a migração DEV. Verifique o alvo e o journal; nenhuma repetição será automática.",
  );
  process.exitCode = 1;
}
