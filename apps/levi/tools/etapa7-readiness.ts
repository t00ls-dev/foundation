import { createInterface } from "node:readline/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { devMigrationTarget } from "./dev-migration-config.js";
import {
  capturePreservation,
  guardedRead,
  preservationDifferences,
  verifyCheckpoint,
} from "./etapa7-verification.js";
import type { Checkpoint, Preservation } from "./etapa7-verification.js";

// Cliente de leitura independente do migrator e publicador; não executa SQL fornecido pelo usuário.
let baseline: Preservation | undefined;
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (process.argv.length !== 2) throw new Error();
  const url = devMigrationTarget(process.env, "status");
  const identity = {
    database: "levi_dev",
    role: "levi_dev_migrator",
    project: "divine-violet-20368018",
    branch: "br-dawn-base-b68erh5e",
    endpoint: "ep-morning-wildflower-b6hjki5i",
  };
  if (
    process.env.LEVI_DEV_DATABASE_NAME !== identity.database ||
    process.env.LEVI_DEV_DATABASE_HOST !==
      "ep-morning-wildflower-b6hjki5i.c-2.sa-east-1.aws.neon.tech"
  )
    throw new Error();
  // Startup somente na sessão, antes da primeira consulta e sem parâmetro persistente.
  process.env.PGOPTIONS =
    "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000 -c application_name=levi-etapa7-readiness";
  const checkpoints: Checkpoint[] = [
    "baseline",
    "expand7",
    "expand8",
    "converted",
    "contracted",
  ];
  for (const checkpoint of checkpoints) {
    if (checkpoint !== "baseline") {
      const answer = await input.question(
        `Conexão anterior fechada. Digite ${checkpoint} após a operação autorizada, ou sair: `,
      );
      if (answer === "sair") break;
      if (answer !== checkpoint) throw new Error();
    }
    const { client } = await createPostgresDatabase(url);
    try {
      await guardedRead(client, identity);
      const result = await verifyCheckpoint(client, checkpoint);
      const snapshot = await capturePreservation(client, checkpoint);
      const preservation = baseline
        ? preservationDifferences(baseline, snapshot)
        : [];
      console.info(JSON.stringify({ checkpoint, ...result, preservation }));
      if (preservation.some((r) => r.differences !== 0)) throw new Error();
      baseline ??= snapshot;
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  }
} catch {
  // Nunca serializar erros do driver/asserts: podem conter SQL, dados ou credenciais.
  console.error(
    "Leitura etapa 7 interrompida. Não avançar; conferir identidade, fase, integridade e ACLs em ambiente protegido.",
  );
  process.exitCode = 1;
} finally {
  baseline?.clear();
  input.close();
}
