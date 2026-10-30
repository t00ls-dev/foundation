import { describe, expect, it, vi } from "vitest";

import {
  acceptInvitation,
  createInvitation,
  hashInvitationToken,
  InvalidInvitationError,
  normalizeInvitationEmail,
  resolveTenantContext,
  switchTenant,
  TenantAccessDeniedError,
  TenantContextRequiredError,
  type TenantInvitation,
} from "../src/index.js";

describe("tenant context", () => {
  it("requires an active tenant and a matching membership", async () => {
    const findMembership = vi.fn().mockResolvedValue(null);
    const repository = { findMembership };

    await expect(
      resolveTenantContext({
        activeTenantId: null,
        repository,
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TenantContextRequiredError);
    expect(findMembership).not.toHaveBeenCalled();

    await expect(
      resolveTenantContext({
        activeTenantId: "tenant-1",
        repository,
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
  });

  it("switches the session only after resolving membership", async () => {
    const membership = {
      id: "membership-1",
      role: "admin" as const,
      tenantId: "tenant-1",
      userId: "user-1",
    };
    const setActiveTenant = vi.fn().mockResolvedValue(undefined);

    await expect(
      switchTenant({
        repository: { findMembership: vi.fn().mockResolvedValue(membership) },
        sessionId: "session-1",
        sessions: { setActiveTenant },
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      membershipId: "membership-1",
      role: "admin",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(setActiveTenant).toHaveBeenCalledWith("session-1", "tenant-1");
  });
});

describe("tenant invitations", () => {
  it("normalizes email addresses and stores only a hash of a random token", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const record = vi.fn().mockResolvedValue(undefined);

    const result = await createInvitation({
      actorId: "user-1",
      audit: { record },
      email: " Person@Example.COM ",
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      id: "invitation-1",
      repository: { create },
      role: "member",
      tenantId: "tenant-1",
    });

    expect(normalizeInvitationEmail(" Person@Example.COM ")).toBe(
      "person@example.com",
    );
    expect(result.token).toMatch(/^[\w-]{43}$/);
    expect(result.invitation.tokenHash).toBe(
      await hashInvitationToken(result.token),
    );
    expect(result.invitation.tokenHash).not.toBe(result.token);
    expect(create).toHaveBeenCalledWith(result.invitation);
    expect(record).toHaveBeenCalledWith({
      action: "tenant.invitation.created",
      actorId: "user-1",
      targetId: "invitation-1",
      tenantId: "tenant-1",
    });
  });

  it("accepts through the repository with normalized, hashed credentials", async () => {
    const invitation: TenantInvitation<"member"> = {
      acceptedAt: new Date("2026-09-16T00:00:00.000Z"),
      email: "person@example.com",
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      id: "invitation-1",
      role: "member",
      tenantId: "tenant-1",
      tokenHash: await hashInvitationToken("secret-token"),
    };
    const consume = vi.fn().mockResolvedValue(invitation);
    const record = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-09-16T00:00:00.000Z");

    await expect(
      acceptInvitation({
        audit: { record },
        email: " Person@Example.com ",
        now,
        repository: { consume },
        token: "secret-token",
        userId: "user-2",
      }),
    ).resolves.toBe(invitation);
    expect(consume).toHaveBeenCalledWith({
      email: "person@example.com",
      now,
      tokenHash: invitation.tokenHash,
      userId: "user-2",
    });
    expect(record).toHaveBeenCalledWith({
      action: "tenant.invitation.accepted",
      actorId: "user-2",
      targetId: "invitation-1",
      tenantId: "tenant-1",
    });
  });

  it("rejects invalid invitations without recording acceptance", async () => {
    const record = vi.fn();

    await expect(
      acceptInvitation({
        audit: { record },
        email: "person@example.com",
        repository: {
          consume: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        token: "invalid",
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
    expect(record).not.toHaveBeenCalled();
  });
});
