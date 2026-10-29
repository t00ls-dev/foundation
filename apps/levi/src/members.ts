import { createHash } from "node:crypto";
import type { FoundationSession } from "@t00ls-dev/auth";
import { createAuditEvent } from "@t00ls-dev/audit";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { and, asc, eq, gt, ilike } from "drizzle-orm";
import type { Database } from "./auth.js";
import { RequestError } from "./contracts.js";
import { access, organizationContext } from "./organizations.js";
import {
  churches,
  members,
  memberHistory,
  memberProfileHistory,
  memberCreationRequests,
  session,
  tenantMemberships,
  tenantSessions,
} from "./data/schema.js";
import type {
  MemberInput,
  MemberEditInput,
  MemberProfile,
} from "./member-types.js";
import type { readMemberFilters } from "./member-contracts.js";

type ResolvedContext = Awaited<ReturnType<typeof organizationContext>>;
async function context(
  database: Database,
  identity: FoundationSession,
  permission: "members:read" | "members:create" | "members:update",
  resolved?: ResolvedContext,
) {
  const current = resolved ?? (await organizationContext(database, identity));
  if (current.role !== "admin" || !access.can(current.role, permission))
    throw new RequestError(
      403,
      "ACESSO_NEGADO",
      "O vínculo administrativo não permite esta operação.",
    );
  return current;
}
const churchJoin = and(
  eq(members.churchId, churches.id),
  eq(members.tenantId, churches.tenantId),
);
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
  // Escapa curingas: nome é trecho literal, sem distinção de caixa e sem busca global.
  const literalName = filters.name.replace(/[\\%_]/g, "\\$&");
  const rows = await database.db
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
        eq(members.tenantId, current.tenantId),
        filters.name ? ilike(members.name, `%${literalName}%`) : undefined,
        filters.churchId ? eq(members.churchId, filters.churchId) : undefined,
        filters.status ? eq(members.status, filters.status) : undefined,
      ),
    )
    .orderBy(asc(members.name), asc(members.id))
    .limit(filters.pageSize + 1)
    .offset((filters.page - 1) * filters.pageSize);
  return {
    organizationId: current.tenantId,
    members: rows.slice(0, filters.pageSize),
    page: filters.page,
    pageSize: filters.pageSize,
    hasNext: rows.length > filters.pageSize,
  };
}
export async function findMember(
  database: Database,
  identity: FoundationSession,
  id: string,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:read", resolved);
  const [row] = await database.db
    .select({ member: members, churchName: churches.name })
    .from(members)
    .innerJoin(churches, churchJoin)
    .where(and(eq(members.tenantId, current.tenantId), eq(members.id, id)));
  if (!row) notFound();
  const { tenantId, ...member } = row.member;
  return {
    organizationId: tenantId,
    member: {
      ...member,
      churchName: row.churchName,
      createdAt: member.createdAt.toISOString(),
    },
  };
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
    await database.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [JSON.stringify([current.tenantId, identity.user.id, requestKey])],
    );
    await lockWriteContext(tx, identity, current.tenantId);
    const [previous] = await tx
      .select()
      .from(memberCreationRequests)
      .where(
        and(
          eq(memberCreationRequests.tenantId, current.tenantId),
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
      return { organizationId: current.tenantId, memberId: previous.memberId };
    }
    const [church] = await tx
      .select()
      .from(churches)
      .where(
        and(
          eq(churches.id, input.churchId),
          eq(churches.tenantId, current.tenantId),
        ),
      )
      .for("share");
    if (!church) notFound();
    const [member] = await tx
      .insert(members)
      .values({ ...input, tenantId: current.tenantId })
      .returning({ id: members.id });
    if (!member) throw new Error("Cadastro não confirmado.");
    await tx.insert(memberHistory).values({
      tenantId: current.tenantId,
      memberId: member.id,
      actorId: identity.user.id,
      churchName: church.name,
      initialStatus: input.status,
    });
    await createPostgresAuditStore(database.client).append(
      createAuditEvent({
        actor: identity.user.id,
        action: "member.created",
        target: member.id,
        tenant: current.tenantId,
        timestamp: new Date(),
        metadata: {},
        requestId: null,
        result: "success",
      }),
    );
    await tx.insert(memberCreationRequests).values({
      tenantId: current.tenantId,
      actorId: identity.user.id,
      requestKey,
      requestHash,
      memberId: member.id,
    });
    return { organizationId: current.tenantId, memberId: member.id };
  });
}

export async function findMemberRequest(
  database: Database,
  identity: FoundationSession,
  requestKey: string,
  resolved?: ResolvedContext,
) {
  const current = await context(database, identity, "members:read", resolved);
  const [receipt] = await database.db
    .select({ memberId: memberCreationRequests.memberId })
    .from(memberCreationRequests)
    .where(
      and(
        eq(memberCreationRequests.tenantId, current.tenantId),
        eq(memberCreationRequests.actorId, identity.user.id),
        eq(memberCreationRequests.requestKey, requestKey),
      ),
    );
  if (!receipt) notFound();
  return { organizationId: current.tenantId, memberId: receipt.memberId };
}

type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
async function lockWriteContext(
  tx: Transaction,
  identity: FoundationSession,
  tenantId: string,
) {
  // Revalida após aguardar e impede revogação/troca de contexto durante a escrita.
  const [validSession] = await tx
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
  if (!validSession)
    throw new RequestError(
      401,
      "SESSAO_NECESSARIA",
      "Entre na sua conta para continuar.",
    );
  const [active] = await tx
    .select()
    .from(tenantSessions)
    .where(eq(tenantSessions.sessionId, identity.session.id))
    .for("share");
  const [membership] = await tx
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, identity.user.id),
        eq(tenantMemberships.tenantId, tenantId),
      ),
    )
    .for("share");
  if (active?.activeTenantId !== tenantId || membership?.role !== "admin")
    throw new RequestError(
      403,
      "ACESSO_NEGADO",
      "Selecione uma organização com vínculo administrativo atual.",
    );
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
    await lockWriteContext(tx, identity, current.tenantId);
    const [previous] = await tx
      .select()
      .from(members)
      .where(and(eq(members.tenantId, current.tenantId), eq(members.id, id)))
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
          eq(members.tenantId, current.tenantId),
          eq(members.churchId, previous.churchId),
          eq(members.id, id),
          eq(members.version, version),
        ),
      );
    await tx.insert(memberProfileHistory).values({
      tenantId: current.tenantId,
      memberId: id,
      actorId: identity.user.id,
      version,
      previousProfile,
    });
    await createPostgresAuditStore(database.client).append(
      createAuditEvent({
        actor: identity.user.id,
        action: "member.updated",
        target: id,
        tenant: current.tenantId,
        timestamp: new Date(),
        metadata: {},
        requestId: null,
        result: "success",
      }),
    );
    return {
      organizationId: current.tenantId,
      memberId: id,
      version: version + 1,
    };
  });
}
