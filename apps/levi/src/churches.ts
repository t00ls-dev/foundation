import { createHash } from "node:crypto";
import type { FoundationSession } from "@t00ls-dev/auth";
import { createAccessControl } from "@t00ls-dev/access";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { RequestError } from "./contracts.js";
import {
  churches,
  churchMemberships,
  churchSessions,
  churchCreationRequests,
  session,
  user,
  auditEvents,
} from "./data/schema.js";

export type Transaction = Parameters<
  Parameters<Database["db"]["transaction"]>[0]
>[0];
const memberPermissions = [
  "churches:read",
  "members:read",
  "members:create",
  "members:update",
] as const;
export const access = createAccessControl({
  admin: [...memberPermissions, "churches:update", "accesses:manage"] as const,
  collaborator: memberPermissions,
});
export type Permission = Parameters<typeof access.can>[1];
export function denied(): never {
  throw new RequestError(
    403,
    "ACESSO_NEGADO",
    "Seu acesso atual não permite esta operação.",
  );
}
export function conflict(): never {
  throw new RequestError(
    409,
    "VERSAO_DIVERGENTE",
    "O contexto ou registro foi alterado. Atualize antes de continuar.",
  );
}
export async function lockSession(
  tx: Transaction,
  identity: FoundationSession,
) {
  const [valid] = await tx
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, identity.session.id),
        eq(session.userId, identity.user.id),
        gt(session.expiresAt, new Date()),
      ),
    )
    .for("share");
  if (!valid)
    throw new RequestError(
      401,
      "SESSAO_NECESSARIA",
      "Entre na sua conta para continuar.",
    );
}
// Ordem única: sessão, seleção, igreja, vínculos, recurso. Autoridade após a espera.
export async function lockChurch(
  tx: Transaction,
  identity: FoundationSession,
  churchId: string,
  permission: Permission,
  selected = false,
) {
  await lockSession(tx, identity);
  if (selected) {
    const [active] = await tx
      .select()
      .from(churchSessions)
      .where(eq(churchSessions.sessionId, identity.session.id))
      .for("share");
    if (active?.activeChurchId !== churchId) conflict();
  }
  const [church] = await tx
    .select()
    .from(churches)
    .where(eq(churches.id, churchId))
    .for("update");
  const [membership] = await tx
    .select()
    .from(churchMemberships)
    .where(
      and(
        eq(churchMemberships.churchId, churchId),
        eq(churchMemberships.userId, identity.user.id),
      ),
    )
    .for("share");
  if (!church || !membership || !access.can(membership.role, permission))
    denied();
  await lockSession(tx, identity);
  return { churchId, role: membership.role, church };
}
export async function appendChurchAudit(
  tx: Transaction,
  identity: FoundationSession,
  churchId: string,
  action: string,
  target: string,
) {
  await tx.insert(auditEvents).values({
    actor: identity.user.id,
    action,
    target,
    churchId,
    timestamp: new Date(),
    metadata: {},
    requestId: null,
    result: "success",
  });
}
export async function churchContext(
  database: Database,
  identity: FoundationSession,
) {
  return database.db.transaction(async (tx) => {
    await lockSession(tx, identity);
    const [active] = await tx
      .select()
      .from(churchSessions)
      .where(eq(churchSessions.sessionId, identity.session.id))
      .for("share");
    if (!active?.activeChurchId)
      throw new RequestError(
        403,
        "CONTEXTO_NECESSARIO",
        "Selecione uma igreja.",
      );
    const context = await lockChurch(
      tx,
      identity,
      active.activeChurchId,
      "churches:read",
    );
    return {
      churchId: context.churchId,
      role: context.role,
      churchName: context.church.name,
      membersEnabled: true,
    };
  });
}
export async function selectChurch(
  database: Database,
  identity: FoundationSession,
  churchId: string,
) {
  return database.db.transaction(async (tx) => {
    await lockSession(tx, identity);
    // Cria a linha antes de adquirir a igreja; seleção também segue a ordem canônica.
    await tx
      .insert(churchSessions)
      .values({ sessionId: identity.session.id })
      .onConflictDoNothing();
    await tx
      .select()
      .from(churchSessions)
      .where(eq(churchSessions.sessionId, identity.session.id))
      .for("update");
    await lockChurch(tx, identity, churchId, "churches:read");
    await tx
      .update(churchSessions)
      .set({ activeChurchId: churchId, updatedAt: new Date() })
      .where(eq(churchSessions.sessionId, identity.session.id));
    await lockSession(tx, identity);
    return { churchId };
  });
}
export async function listChurches(
  database: Database,
  identity: FoundationSession,
  after?: string,
) {
  return database.db.transaction(async (tx) => {
    await lockSession(tx, identity);
    const rows = await tx
      .select({
        id: churches.id,
        nome: churches.name,
        role: churchMemberships.role,
        version: churches.version,
      })
      .from(churchMemberships)
      .innerJoin(churches, eq(churches.id, churchMemberships.churchId))
      .where(
        and(
          eq(churchMemberships.userId, identity.user.id),
          after ? gt(churches.id, after) : undefined,
        ),
      )
      .orderBy(churches.id)
      .limit(101);
    return {
      churches: rows.slice(0, 100),
      next: rows.length > 100 ? (rows[99]?.id ?? null) : null,
    };
  });
}
export async function findChurch(
  database: Database,
  identity: FoundationSession,
  churchId: string,
) {
  return database.db.transaction(async (tx) => {
    const context = await lockChurch(tx, identity, churchId, "churches:read");
    const { id, name, version } = context.church;
    if (context.role === "collaborator") return { id, nome: name, version };
    const { address, phone, email } = context.church;
    return { id, nome: name, version, address, phone, email };
  });
}
export type ChurchInput = Pick<
  typeof churches.$inferInsert,
  "name" | "address" | "phone" | "email"
>;
export async function createChurch(
  database: Database,
  identity: FoundationSession,
  input: ChurchInput,
  requestKey: string,
) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        input.name,
        input.address ?? null,
        input.phone ?? null,
        input.email ?? null,
      ]),
    )
    .digest("hex");
  return database.db.transaction(async (tx) => {
    await lockSession(tx, identity);
    await tx
      .insert(churchSessions)
      .values({ sessionId: identity.session.id })
      .onConflictDoNothing();
    await tx
      .select()
      .from(churchSessions)
      .where(eq(churchSessions.sessionId, identity.session.id))
      .for("update");
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([identity.user.id, requestKey])},0))`,
    );
    const [account] = await tx
      .select()
      .from(user)
      .where(eq(user.id, identity.user.id))
      .for("share");
    if (!account?.emailVerified) denied();
    const [previous] = await tx
      .select()
      .from(churchCreationRequests)
      .where(
        and(
          eq(churchCreationRequests.userId, identity.user.id),
          eq(churchCreationRequests.requestKey, requestKey),
        ),
      );
    if (previous) {
      if (previous.requestHash !== hash) conflict();
      await lockChurch(tx, identity, previous.churchId, "churches:read");
      return { churchId: previous.churchId };
    }
    const [church] = await tx.insert(churches).values(input).returning();
    if (!church) throw new Error("Criação não confirmada");
    await tx
      .insert(churchMemberships)
      .values({ churchId: church.id, userId: identity.user.id, role: "admin" });
    await tx.insert(churchCreationRequests).values({
      userId: identity.user.id,
      requestKey,
      requestHash: hash,
      churchId: church.id,
    });
    await tx
      .update(churchSessions)
      .set({ activeChurchId: church.id, updatedAt: new Date() })
      .where(eq(churchSessions.sessionId, identity.session.id));
    await appendChurchAudit(
      tx,
      identity,
      church.id,
      "church.created",
      church.id,
    );
    await lockSession(tx, identity);
    return { churchId: church.id };
  });
}
export async function editChurch(
  database: Database,
  identity: FoundationSession,
  churchId: string,
  input: ChurchInput,
  version: number,
) {
  return database.db.transaction(async (tx) => {
    const context = await lockChurch(tx, identity, churchId, "churches:update");
    if (context.church.version !== version) conflict();
    await tx
      .update(churches)
      .set({ ...input, version: version + 1, updatedAt: new Date() })
      .where(eq(churches.id, churchId));
    await appendChurchAudit(tx, identity, churchId, "church.updated", churchId);
    await lockSession(tx, identity);
    return { churchId, version: version + 1 };
  });
}
export async function listAccesses(
  database: Database,
  identity: FoundationSession,
  churchId: string,
  after?: string,
) {
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, churchId, "accesses:manage");
    const rows = await tx
      .select({
        id: churchMemberships.id,
        churchId: churchMemberships.churchId,
        userId: churchMemberships.userId,
        role: churchMemberships.role,
        version: churchMemberships.version,
        createdAt: churchMemberships.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(churchMemberships)
      .innerJoin(user, eq(user.id, churchMemberships.userId))
      .where(
        and(
          eq(churchMemberships.churchId, churchId),
          after ? gt(churchMemberships.id, after) : undefined,
        ),
      )
      .orderBy(churchMemberships.id)
      .limit(101);
    const accesses = rows.slice(0, 100);
    return {
      accesses,
      next: rows.length > 100 ? (accesses.at(-1)?.id ?? null) : null,
    };
  });
}
export async function changeAccess(
  database: Database,
  identity: FoundationSession,
  churchId: string,
  membershipId: string,
  version: number,
  role: "admin" | "collaborator" | null,
) {
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, churchId, "accesses:manage");
    const rows = await tx
      .select()
      .from(churchMemberships)
      .where(eq(churchMemberships.churchId, churchId))
      .orderBy(churchMemberships.id)
      .for("update");
    const target = rows.find((row) => row.id === membershipId);
    if (!target)
      throw new RequestError(404, "NAO_ENCONTRADO", "Acesso não encontrado.");
    if (target.version !== version) conflict();
    if (
      target.role === "admin" &&
      role !== "admin" &&
      rows.filter((row) => row.role === "admin").length === 1
    )
      throw new RequestError(
        409,
        "ULTIMO_ADMINISTRADOR",
        "A igreja precisa manter um administrador.",
      );
    if (role === null)
      await tx
        .delete(churchMemberships)
        .where(eq(churchMemberships.id, membershipId));
    else
      await tx
        .update(churchMemberships)
        .set({ role, version: version + 1 })
        .where(eq(churchMemberships.id, membershipId));
    await appendChurchAudit(
      tx,
      identity,
      churchId,
      role === null ? "access.revoked" : "access.updated",
      membershipId,
    );
    await lockSession(tx, identity);
    return { churchId };
  });
}
