import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRuntimeGrants,
  prepareRuntimeRoles,
} from "../test/runtime-acl-fixture.js";

// A conversão sintética exige seu próprio histórico anterior ao corte.
if (
  !process.argv.some((arg) =>
    ["--churches", "--files", "--browser", "--worker"].includes(arg),
  )
) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "tools/test-integration.ts",
      "--churches",
      ...(process.argv.includes("--runtime-acls") ? ["--runtime-acls"] : []),
    ],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0)
    throw new Error("O ensaio sintético de igrejas falhou.");
}
// Somente este container recém-criado é usado e removido. Sem banco externo.
const image =
  "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const container = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--detach",
    "--label",
    "levi.integration=true",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=levi_test",
    "--env",
    "POSTGRES_USER=levi_test",
    "--env",
    "POSTGRES_PASSWORD=synthetic-only",
    image,
  ],
  { encoding: "utf8" },
).trim();
let mailDirectory: string | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "levi_test",
        "-d",
        "levi_test",
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(100);
  }
  if (!ready) throw new Error("O PostgreSQL descartável não ficou disponível.");
  const mapping = execFileSync("docker", ["port", container, "5432/tcp"], {
    encoding: "utf8",
  }).trim();
  const port = mapping.split(":").at(-1);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    LEVI_DATABASE_URL: `postgresql://levi_test:synthetic-only@127.0.0.1:${port}/levi_test`,
    LEVI_LOCAL_DATABASE: "1",
    // O modo padrão não deve herdar alvos do modo restrito de outra execução.
    LEVI_TEST_RUNTIME_DATABASE_URL: "",
    LEVI_TEST_MIGRATOR_DATABASE_URL: "",
  };
  function run(args: string[], overrides: Record<string, string> = {}) {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env: { ...env, ...overrides },
      stdio: "inherit",
    });
    if (result.status !== 0)
      throw new Error("A validação de integração falhou.");
  }
  const restricted = process.argv.includes("--runtime-acls");
  if (restricted) {
    process.env.NODE_ENV = "test";
    const { migratorUrl, runtimeUrl } = await prepareRuntimeRoles(
      env.LEVI_DATABASE_URL,
    );
    run(["tools/migrate.ts"], { LEVI_DATABASE_URL: migratorUrl });
    run(["tools/migrate.ts"], { LEVI_DATABASE_URL: migratorUrl });
    await applyRuntimeGrants(migratorUrl);
    Object.assign(env, {
      LEVI_TEST_RUNTIME_DATABASE_URL: runtimeUrl,
      LEVI_TEST_MIGRATOR_DATABASE_URL: migratorUrl,
    });
  } else {
    run(["tools/migrate.ts"]);
    run(["tools/migrate.ts"]); // reaplicação do journal deve ser inócua
  }
  if (!process.argv.includes("--churches"))
    run(["tools/prepare-church-test.ts"]);
  if (process.argv.includes("--files")) {
    run([
      "--test",
      "--test-concurrency=1",
      ...process.argv
        .slice(process.argv.indexOf("--files") + 1)
        .filter((arg) => arg !== "--runtime-acls"),
    ]);
  } else if (process.argv.includes("--churches")) {
    run([
      "--test",
      "--test-concurrency=1",
      "test/churches.integration.test.ts",
    ]);
  } else if (process.argv.includes("--browser")) {
    mailDirectory = await mkdtemp(join(tmpdir(), "levi-browser-"));
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        ...process.argv
          .slice(process.argv.indexOf("--browser") + 1)
          .filter((argument) => argument !== "--runtime-acls"),
      ],
      {
        env: { ...env, LEVI_TEST_MAIL_DIR: mailDirectory },
        stdio: "inherit",
      },
    );
    if (result.status !== 0)
      throw new Error("A validação no navegador falhou.");
  } else if (process.argv.includes("--worker")) {
    run(["--test", "--test-concurrency=1", "test/worker.integration.test.ts"]);
  } else
    run([
      "--test",
      "--test-concurrency=1",
      "test/runtime-acl-fixture.test.ts",
      "test/integration.test.ts",
      "test/administration.integration.test.ts",
      "test/migration-history.integration.test.ts",
      "test/members.integration.test.ts",
      restricted
        ? "test/members-runtime.integration.test.ts"
        : "test/runtime-update.integration.test.ts",
    ]);
} finally {
  execFileSync("docker", ["stop", container], { stdio: "ignore" });
  if (mailDirectory) await rm(mailDirectory, { recursive: true, force: true });
}
