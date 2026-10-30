import { readFile } from "node:fs/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { localTestDatabaseUrl } from "../test/runtime-acl-fixture.js";
const url = process.env.LEVI_DATABASE_URL ?? "";
localTestDatabaseUrl(url, "levi_test");
if (process.env.NODE_ENV !== "test" || process.env.LEVI_LOCAL_DATABASE !== "1")
  throw new Error("Use o harness descartável.");
const database = await createPostgresDatabase(url);
try {
  await database.client.query("BEGIN");
  for (const name of ["converter"])
    await database.client.query(
      await readFile(
        new URL(`../ops/etapa3/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  await database.client.query("COMMIT");
  if (process.env.LEVI_TEST_MIGRATOR_DATABASE_URL) {
    const migrator = await createPostgresDatabase(
      process.env.LEVI_TEST_MIGRATOR_DATABASE_URL,
    );
    try {
      await migrator.client.query(
        await readFile(
          new URL("../ops/etapa3/runtime-acls.sql", import.meta.url),
          "utf8",
        ),
      );
    } finally {
      await migrator.client.end();
    }
  }
  if (process.env.LEVI_TEST_MIGRATOR_DATABASE_URL)
    await database.client.query(
      await readFile(
        new URL("../ops/etapa3/bootstrap-acls.sql", import.meta.url),
        "utf8",
      ),
    );
  await database.client.query("BEGIN");
  await database.client.query(
    await readFile(
      new URL("../ops/etapa3/contract.sql", import.meta.url),
      "utf8",
    ),
  );
  await database.client.query("COMMIT");
} finally {
  await database.client.end();
}
