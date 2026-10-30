import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  createInvitation,
  hashInvitationToken,
  normalizeInvitationEmail,
} from "@t00ls-dev/tenant";
import type { FoundationSession, FoundationEmail } from "@t00ls-dev/auth";
import type { Database } from "./auth.js";
import {
  lockChurch,
  lockSession,
  appendChurchAudit,
  denied,
} from "./churches.js";
import {
  churchInvitations,
  churchMemberships,
  churches,
  user,
} from "./data/schema.js";
import { RequestError, readString } from "./contracts.js";

export function invitationToken(body: Record<string, unknown>) {
  const token = readString(body, "token", 43, 43, false);
  if (!/^[\w-]{43}$/.test(token)) invalid();
  return token;
}
function invalid(): never {
  throw new RequestError(
    409,
    "CONVITE_INDISPONIVEL",
    "Convite inválido, expirado, cancelado, utilizado ou indisponível para esta conta. Solicite um novo convite ao administrador.",
  );
}
export function invitationInput(body: Record<string, unknown>) {
  const email = normalizeInvitationEmail(readString(body, "email", 3, 254));
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (body.role !== "admin" && body.role !== "collaborator")
  )
    throw new RequestError(
      400,
      "ENTRADA_INVALIDA",
      "Informe um e-mail e um papel válidos.",
    );
  return {
    email,
    role:
      body.role === "admin" ? ("admin" as const) : ("collaborator" as const),
  };
}
export async function listInvitations(
  database: Database,
  identity: FoundationSession,
  churchId: string,
  after?: string,
) {
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, churchId, "accesses:manage");
    const rows = await tx
      .select({
        id: churchInvitations.id,
        email: churchInvitations.email,
        role: churchInvitations.role,
        issuerId: churchInvitations.issuerId,
        expiresAt: churchInvitations.expiresAt,
        acceptedAt: churchInvitations.acceptedAt,
        cancelledAt: churchInvitations.cancelledAt,
      })
      .from(churchInvitations)
      .where(
        and(
          eq(churchInvitations.churchId, churchId),
          after ? gt(churchInvitations.id, after) : undefined,
        ),
      )
      .orderBy(churchInvitations.id)
      .limit(101);
    return {
      invitations: rows.slice(0, 100),
      next: rows.length > 100 ? rows[99]?.id : null,
    };
  });
}
export async function cancelInvitation(
  database: Database,
  identity: FoundationSession,
  churchId: string,
  id: string,
) {
  return database.db.transaction(async (tx) => {
    await lockChurch(tx, identity, churchId, "accesses:manage");
    const [row] = await tx
      .update(churchInvitations)
      .set({ cancelledAt: new Date(), cancelledBy: identity.user.id })
      .where(
        and(
          eq(churchInvitations.id, id),
          eq(churchInvitations.churchId, churchId),
          isNull(churchInvitations.acceptedAt),
          isNull(churchInvitations.cancelledAt),
        ),
      )
      .returning({ id: churchInvitations.id });
    if (!row) invalid();
    await appendChurchAudit(tx, identity, churchId, "invitation.cancelled", id);
    return { ok: true };
  });
}
export async function sendInvitation(input: {
  database: Database;
  identity: FoundationSession;
  churchId: string;
  recipient: ReturnType<typeof invitationInput> | { id: string };
  email: FoundationEmail;
  baseURL: string;
}) {
  const { database, identity, churchId } = input;
  // Envio dentro do lock: aceitação/cancelamento/reenvio aguardam o resultado.
  // Falha do provider faz rollback; entrega de e-mail e commit não são atômicos.
  return database.db.transaction(async (tx) => {
    const { church } = await lockChurch(
      tx,
      identity,
      churchId,
      "accesses:manage",
    );
    let recipient;
    if ("id" in input.recipient) {
      const [previous] = await tx
        .select()
        .from(churchInvitations)
        .where(
          and(
            eq(churchInvitations.id, input.recipient.id),
            eq(churchInvitations.churchId, churchId),
          ),
        );
      if (!previous || previous.acceptedAt || previous.cancelledAt) invalid();
      recipient = { email: previous.email, role: previous.role };
    } else recipient = input.recipient;
    const [existingAccess] = await tx
      .select({ id: churchMemberships.id })
      .from(churchMemberships)
      .innerJoin(user, eq(user.id, churchMemberships.userId))
      .where(
        and(
          eq(churchMemberships.churchId, churchId),
          sql`lower(trim(${user.email})) = ${recipient.email}`,
        ),
      );
    if (existingAccess)
      throw new RequestError(
        409,
        "VINCULO_EXISTENTE",
        "Esta pessoa já possui acesso à igreja. Ajuste seu papel na gestão de acessos.",
      );
    // Substitui todos os convites abertos para o mesmo destino na igreja.
    const replaced = await tx
      .update(churchInvitations)
      .set({ cancelledAt: new Date(), cancelledBy: identity.user.id })
      .where(
        and(
          eq(churchInvitations.churchId, churchId),
          eq(churchInvitations.email, recipient.email),
          isNull(churchInvitations.acceptedAt),
          isNull(churchInvitations.cancelledAt),
        ),
      )
      .returning({ id: churchInvitations.id });
    for (const row of replaced)
      await appendChurchAudit(
        tx,
        identity,
        churchId,
        "invitation.superseded",
        row.id,
      );
    const { invitation, token } = await createInvitation({
      actorId: identity.user.id,
      email: recipient.email,
      role: recipient.role,
      tenantId: churchId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600000),
      repository: {
        async create(row) {
          await tx.insert(churchInvitations).values({
            id: row.id,
            churchId,
            email: row.email,
            role: row.role,
            issuerId: identity.user.id,
            tokenHash: row.tokenHash,
            expiresAt: row.expiresAt,
          });
        },
        consume() {
          return Promise.reject(
            new Error("Use a aceitação transacional do Levi."),
          );
        },
      },
      audit: {
        async record(event) {
          await appendChurchAudit(
            tx,
            identity,
            churchId,
            "invitation.created",
            event.targetId,
          );
        },
      },
    });
    await input.email.send({
      to: recipient.email,
      subject: "Convite para acessar uma igreja no Levi",
      text: `Você recebeu um convite para ${church.name} como ${recipient.role === "admin" ? "Administrador" : "Colaborador"}. Válido por 7 dias. Entre com o e-mail convidado. Nenhum membro da congregação será criado.\n\n${input.baseURL}/convite#convite=${token}`,
    });
    await lockSession(tx, identity);
    return { id: invitation.id };
  });
}
export async function acceptChurchInvitation(
  database: Database,
  identity: FoundationSession,
  token: string,
) {
  const hash = await hashInvitationToken(token);
  return database.db.transaction(async (tx) => {
    await lockSession(tx, identity);
    const [hint] = await tx
      .select({ churchId: churchInvitations.churchId })
      .from(churchInvitations)
      .where(eq(churchInvitations.tokenHash, hash));
    if (!hint) invalid();
    // Mesmo lock das alterações de acesso; revalida tudo após a espera.
    await tx
      .select({ id: churches.id })
      .from(churches)
      .where(eq(churches.id, hint.churchId))
      .for("update");
    const [row] = await tx
      .select()
      .from(churchInvitations)
      .where(eq(churchInvitations.tokenHash, hash))
      .for("update");
    const [account] = await tx
      .select()
      .from(user)
      .where(eq(user.id, identity.user.id))
      .for("share");
    if (
      !row ||
      row.acceptedAt ||
      row.cancelledAt ||
      row.expiresAt <= new Date() ||
      !account?.emailVerified ||
      normalizeInvitationEmail(account.email) !== row.email
    )
      invalid();
    const [issuer] = await tx
      .select()
      .from(churchMemberships)
      .where(
        and(
          eq(churchMemberships.churchId, row.churchId),
          eq(churchMemberships.userId, row.issuerId),
        ),
      )
      .for("share");
    if (issuer?.role !== "admin") invalid();
    const [existing] = await tx
      .select()
      .from(churchMemberships)
      .where(
        and(
          eq(churchMemberships.churchId, row.churchId),
          eq(churchMemberships.userId, identity.user.id),
        ),
      );
    // Nunca promove/rebaixa um vínculo existente através de um convite.
    if (existing)
      throw new RequestError(
        409,
        "VINCULO_EXISTENTE",
        "Você já possui acesso a esta igreja. O administrador pode ajustar seu papel na gestão de acessos.",
      );
    if (!identity.user.emailVerified) denied();
    await tx.insert(churchMemberships).values({
      churchId: row.churchId,
      userId: identity.user.id,
      role: row.role,
    });
    await tx
      .update(churchInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: identity.user.id })
      .where(eq(churchInvitations.id, row.id));
    await appendChurchAudit(
      tx,
      identity,
      row.churchId,
      "invitation.accepted",
      row.id,
    );
    await lockSession(tx, identity);
    return { churchId: row.churchId };
  });
}
