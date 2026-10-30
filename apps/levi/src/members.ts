import { createHash } from "node:crypto";
import type { FoundationSession } from "@t00ls-dev/auth";

import { and, asc, eq, ilike, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { RequestError } from "./contracts.js";
import {
  access,
  churchContext,
  lockChurch,
  lockSession,
  appendChurchAudit,
} from "./churches.js";
import {
  churches,
  members,
  memberHistory,
  memberProfileHistory,
  memberCreationRequests,
} from "./data/schema.js";
import type {
  MemberInput,
  MemberEditInput,
  MemberProfile,
} from "./member-types.js";
import type { readMemberFilters } from "./member-contracts.js";

type ResolvedContext = Awaited<ReturnType<typeof churchContext>>;
async function context(
  database: Database,
  identity: FoundationSession,
  permission: "members:read" | "members:create" | "members:update",
  resolved?: ResolvedContext,
) {
  const current = resolved ?? (await churchContext(database, identity));
  if (!access.can(current.role, permission))
    throw new RequestError(
      403,
      "ACESSO_NEGADO",
      "O vínculo administrativo não permite esta operação.",
    );
  return current;
}
const churchJoin = eq(members.churchId, churches.id);
function notFound(): never {
  throw new RequestError(404, "NAO_ENCONTRADO", "Recurso não encontrado.");
}
export async function listMembers(
  database: Database,
  identity: FoundationSession,
  filters: ReturnType<typeof readMemberFilters>,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:read", resolved);
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, current.churchId, "members:read", true);
    // Escapa curingas: nome é trecho literal, sem distinção de caixa e sem busca global.
    const literalName = filters.name.replace(/[\\%_]/g, "\\$&");
    const rows = await tx
      .select({
        id: members.id,
        name: members.name,
        churchId: members.churchId,
        churchName: churches.name,
        status: members.status,
      })
      .from(members)
      .innerJoin(churches, churchJoin)
      .where(
        and(
          eq(members.churchId, current.churchId),
          filters.name ? ilike(members.name, `%${literalName}%`) : undefined,
          filters.churchId ? eq(members.churchId, filters.churchId) : undefined,
          filters.status ? eq(members.status, filters.status) : undefined,
        ),
      )
      .orderBy(asc(members.name), asc(members.id))
      .limit(filters.pageSize + 1)
      .offset((filters.page - 1) * filters.pageSize);
    return {
      churchId: current.churchId,
      members: rows.slice(0, filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      hasNext: rows.length > filters.pageSize,
    };
  });
}
export async function findMember(
  database: Database,
  identity: FoundationSession,
  id: string,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:read", resolved);
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, current.churchId, "members:read", true);
    const [row] = await tx
      .select({ member: members, churchName: churches.name })
      .from(members)
      .innerJoin(churches, churchJoin)
      .where(and(eq(members.churchId, current.churchId), eq(members.id, id)));
    if (!row) notFound();
    const member = row.member;
    return {
      churchId: current.churchId,
      member: {
        ...member,
        churchName: row.churchName,
        createdAt: member.createdAt.toISOString(),
      },
    };
  });
}
export async function createMember(
  database: Database,
  identity: FoundationSession,
  input: Required<MemberInput>,
  requestKey: string,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:create", resolved);
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return database.db.transaction(async (tx) => {
    // Uma mesma tentativa concorre somente consigo; o lock é liberado no rollback/commit.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([current.churchId, identity.user.id, requestKey])},0))`,
    );
    await lockChurch(tx, identity, current.churchId, "members:create", true);
    const [previous] = await tx
      .select()
      .from(memberCreationRequests)
      .where(
        and(
          eq(memberCreationRequests.churchId, current.churchId),
          eq(memberCreationRequests.actorId, identity.user.id),
          eq(memberCreationRequests.requestKey, requestKey),
        ),
      );
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new RequestError(
          409,
          "TENTATIVA_DIVERGENTE",
          "Esta tentativa já foi usada com outros dados. Consulte o resultado antes de cadastrar novamente.",
        );
      return { churchId: current.churchId, memberId: previous.memberId };
    }
    const [church] = await tx
      .select()
      .from(churches)
      .where(
        and(eq(churches.id, input.churchId), eq(churches.id, current.churchId)),
      )
      .for("share");
    if (!church) notFound();
    const [member] = await tx
      .insert(members)
      .values({ ...input, churchId: current.churchId })
      .returning({ id: members.id });
    if (!member) throw new Error("Cadastro não confirmado.");
    await tx.insert(memberHistory).values({
      churchId: current.churchId,
      memberId: member.id,
      actorId: identity.user.id,
      churchName: church.name,
      initialStatus: input.status,
    });
    await appendChurchAudit(
      tx,
      identity,
      current.churchId,
      "member.created",
      member.id,
    );
    await tx.insert(memberCreationRequests).values({
      churchId: current.churchId,
      actorId: identity.user.id,
      requestKey,
      requestHash,
      memberId: member.id,
    });
    await lockSession(tx, identity);
    return { churchId: current.churchId, memberId: member.id };
  });
}

export async function findMemberRequest(
  database: Database,
  identity: FoundationSession,
  requestKey: string,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:read", resolved);
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, current.churchId, "members:read", true);
    const [receipt] = await tx
      .select({ memberId: memberCreationRequests.memberId })
      .from(memberCreationRequests)
      .where(
        and(
          eq(memberCreationRequests.churchId, current.churchId),
          eq(memberCreationRequests.actorId, identity.user.id),
          eq(memberCreationRequests.requestKey, requestKey),
        ),
      );
    if (!receipt) notFound();
    return { churchId: current.churchId, memberId: receipt.memberId };
  });
}

export async function editMember(
  database: Database,
  identity: FoundationSession,
  id: string,
  input: MemberEditInput,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:update", resolved);
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, current.churchId, "members:update", true);
    const [previous] = await tx
      .select()
      .from(members)
      .where(and(eq(members.churchId, current.churchId), eq(members.id, id)))
      .for("update");
    if (!previous) notFound();
    if (previous.version !== input.version)
      throw new RequestError(
        409,
        "MEMBRO_ALTERADO",
        "Este cadastro foi atualizado em outra sessão. Consulte a ficha atual antes de editar novamente.",
      );
    const { version, ...profile } = input;
    // Allowlist validada antes de entrar aqui. Igreja, situação e metadados são imutáveis neste fluxo.
    const previousProfile: MemberProfile = {
      name: previous.name,
      birthDate: previous.birthDate,
      phone: previous.phone,
      email: previous.email,
      joinedOn: previous.joinedOn,
      address: previous.address,
      baptismDate: previous.baptismDate,
      churchRole: previous.churchRole,
    };
    await tx
      .update(members)
      .set({ ...profile, version: version + 1 })
      .where(
        and(
          eq(members.churchId, current.churchId),
          eq(members.churchId, previous.churchId),
          eq(members.id, id),
          eq(members.version, version),
        ),
      );
    await tx.insert(memberProfileHistory).values({
      churchId: current.churchId,
      memberId: id,
      actorId: identity.user.id,
      version,
      previousProfile,
    });
    await appendChurchAudit(
      tx,
      identity,
      current.churchId,
      "member.updated",
      id,
    );
    await lockSession(tx, identity);
    return {
      churchId: current.churchId,
      memberId: id,
      version: version + 1,
    };
  });
}
