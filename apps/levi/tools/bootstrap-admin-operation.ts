import { sql } from "drizzle-orm";
import type { Database } from "../src/auth.js";
import {
  lockAdministrativeChanges,
  lockReadyIdentity,
} from "../src/admin-access.js";
import { appendAdministrativeAudit } from "../src/admin-audit.js";
import { RequestError, requireUuid } from "../src/contracts.js";
import {
  adminBootstrap,
  globalAdministrators,
  user,
} from "../src/data/schema.js";

export function readBootstrapInput(env: NodeJS.ProcessEnv) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const userId = requireUuid(env.LEVI_ADMIN_USER_ID ?? "").toLowerCase();
  const sessionId = requireUuid(env.LEVI_ADMIN_SESSION_ID ?? "").toLowerCase();
  const operationId = requireUuid(
    env.LEVI_ADMIN_OPERATION_ID ?? "",
  ).toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    env.LEVI_ADMIN_IDENTITY_CONFIRMATION !== `IDENTIDADE-CONFERIDA:${userId}`
  )
    throw new Error(
      "Confirme a identidade assistida, o e-mail e os UUIDs da operação.",
    );
  return { email, userId, sessionId, operationId };
}

/** Operação exclusiva do runner externo; não importar pela aplicação. */
export async function bootstrapAdministrator(input: {
  database: Database;
  confirmation: ReturnType<typeof readBootstrapInput>;
}) {
  return input.database.db.transaction(async (tx) => {
    await lockAdministrativeChanges(tx);
    const [receipt] = await tx.select().from(adminBootstrap);
    if (receipt) return { kind: "already-completed" } as const;
    const existing = await tx
      .select({ id: globalAdministrators.userId })
      .from(globalAdministrators)
      .limit(1);
    if (existing.length)
      throw new Error(
        "Estado administrativo inconsistente; bootstrap recusado.",
      );
    const confirmation = input.confirmation;
    const candidates = await tx
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(trim(${user.email})) = ${confirmation.email}`);
    if (candidates.length !== 1 || candidates[0]?.id !== confirmation.userId)
      throw new RequestError(404, "NAO_ENCONTRADO", "Recurso não encontrado.");
    const current = await lockReadyIdentity(tx, confirmation, true);
    if (current.email.trim().toLowerCase() !== confirmation.email)
      throw new RequestError(404, "NAO_ENCONTRADO", "Recurso não encontrado.");
    await tx
      .insert(globalAdministrators)
      .values({ userId: current.id, grantedBy: null });
    await tx.insert(adminBootstrap).values({
      id: 1,
      userId: current.id,
      operationId: confirmation.operationId,
    });
    await appendAdministrativeAudit(tx, {
      actor: current.id,
      target: current.id,
      operationId: confirmation.operationId,
      churchId: null,
      action: "admin.bootstrapped",
    });
    // Uma espera na persistência/auditoria não pode consumir a sessão e ainda
    // confirmar concessão e recibo. Todos permanecem na mesma transação.
    await lockReadyIdentity(tx, confirmation, true);
    return { kind: "completed" } as const;
  });
}
