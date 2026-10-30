export interface TenantInvitation<TRole extends string = string> {
  id: string;
  tenantId: string;
  email: string;
  role: TRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export interface InvitationRepository<TRole extends string> {
  create(invitation: TenantInvitation<TRole>): Promise<void>;
  consume(input: {
    email: string;
    tokenHash: string;
    userId: string;
    now: Date;
  }): Promise<TenantInvitation<TRole> | null>;
}

export interface InvitationAudit {
  record(event: {
    action: "tenant.invitation.created" | "tenant.invitation.accepted";
    actorId: string;
    targetId: string;
    tenantId: string;
  }): Promise<void>;
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}

export async function createInvitation<TRole extends string>(input: {
  actorId: string;
  audit: InvitationAudit;
  email: string;
  expiresAt: Date;
  id?: string;
  repository: Pick<InvitationRepository<TRole>, "create"> &
    Partial<Pick<InvitationRepository<TRole>, "consume">>;
  role: TRole;
  tenantId: string;
}): Promise<{ invitation: TenantInvitation<TRole>; token: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const invitation: TenantInvitation<TRole> = {
    acceptedAt: null,
    email: normalizeInvitationEmail(input.email),
    expiresAt: input.expiresAt,
    id: input.id ?? crypto.randomUUID(),
    role: input.role,
    tenantId: input.tenantId,
    tokenHash: await hashInvitationToken(token),
  };
  await input.repository.create(invitation);
  await input.audit.record({
    action: "tenant.invitation.created",
    actorId: input.actorId,
    targetId: invitation.id,
    tenantId: input.tenantId,
  });
  return { invitation, token };
}

export async function acceptInvitation<TRole extends string>(input: {
  audit: InvitationAudit;
  email: string;
  now?: Date;
  repository: Pick<InvitationRepository<TRole>, "consume"> &
    Partial<Pick<InvitationRepository<TRole>, "create">>;
  token: string;
  userId: string;
}): Promise<TenantInvitation<TRole>> {
  const invitation = await input.repository.consume({
    email: normalizeInvitationEmail(input.email),
    now: input.now ?? new Date(),
    tokenHash: await hashInvitationToken(input.token),
    userId: input.userId,
  });
  if (!invitation) throw new InvalidInvitationError();
  await input.audit.record({
    action: "tenant.invitation.accepted",
    actorId: input.userId,
    targetId: invitation.id,
    tenantId: invitation.tenantId,
  });
  return invitation;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export class InvalidInvitationError extends Error {
  constructor() {
    super(
      "Invitation is invalid, expired, already used, or belongs to another email",
    );
    this.name = "InvalidInvitationError";
  }
}
