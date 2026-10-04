import { createD1Database } from "@t00ls-dev/db/d1";
import { describe, expect, it } from "vitest";
import { bookmark, user, twoFactor, rateLimit } from "../../src/schema.js";
import { applyMigrations, createTestDatabase } from "../d1.js";

describe("Links migrations on real local D1", () => {
  it("installs from scratch and enforces JSON and owner constraints", async () => {
    const { miniflare, binding } = await createTestDatabase();
    try {
      await applyMigrations(binding);
      const db = createD1Database(binding);
      await expect(
        db.insert(bookmark).values({
          id: crypto.randomUUID(),
          userId: "missing",
          title: "Test",
          url: "https://example.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow();
      const tables = await binding
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all<{ name: string }>();
      expect(tables.results.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "user",
          "session",
          "account",
          "verification",
          "bookmark",
        ]),
      );
    } finally {
      await miniflare.dispose();
    }
  });

  it("upgrades without losing identity data and cascades bookmarks", async () => {
    const { miniflare, binding } = await createTestDatabase();
    try {
      await applyMigrations(binding, "0001_better_auth.sql");
      const db = createD1Database(binding);
      // Old schema fixture: the new Drizzle user definition includes TOTP.
      await binding
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          "existing",
          "Existing",
          "existing@example.com",
          1,
          1700000000,
          1700000000,
        )
        .run();
      await binding
        .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          "session-existing",
          2000000000,
          "existing-token",
          1700000000,
          1700000000,
          null,
          null,
          "existing",
        )
        .run();
      await applyMigrations(binding, "0002_links.sql");
      await applyMigrations(binding, "0003_links_totp.sql");
      expect(await db.select().from(user)).toHaveLength(1);
      expect((await db.select().from(user))[0]?.twoFactorEnabled).toBe(false);
      expect(await binding.prepare("SELECT id FROM session").first()).toEqual({
        id: "session-existing",
      });
      await db.insert(bookmark).values({
        id: crypto.randomUUID(),
        userId: "existing",
        title: "Test",
        url: "https://example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        binding.prepare("UPDATE bookmark SET tags = ?").bind("{}").run(),
      ).rejects.toThrow();
      await db.delete(user);
      expect(await db.select().from(bookmark)).toEqual([]);
      expect(
        await binding.prepare("SELECT id FROM session").first(),
      ).toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });

  it("persists plugin defaults, D1 dates and numeric rate timestamps with indexes and cascading ownership", async () => {
    const { miniflare, binding } = await createTestDatabase();
    try {
      await applyMigrations(binding);
      const db = createD1Database(binding);
      const date = new Date("2026-10-04T12:00:00Z");
      // Schema constraints only; behavioral TOTP tests use public auth APIs.
      await db.insert(user).values({
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        createdAt: date,
        updatedAt: date,
      });
      await db.insert(twoFactor).values({
        id: "schema-fixture",
        userId: "owner",
        secret: "schema-only",
        backupCodes: "[]",
        lockedUntil: date,
      });
      const row = (await db.select().from(twoFactor))[0]!;
      expect(row.verified).toBe(true);
      expect(row.failedVerificationCount).toBe(0);
      expect(row.lockedUntil?.getTime()).toBe(date.getTime());
      await db.insert(rateLimit).values({
        id: "limiter",
        key: "schema-key",
        count: 1,
        lastRequest: date.getTime(),
      });
      expect((await db.select().from(rateLimit))[0]?.lastRequest).toBe(
        date.getTime(),
      );
      await expect(
        db.insert(rateLimit).values({
          id: "duplicate",
          key: "schema-key",
          count: 1,
          lastRequest: date.getTime(),
        }),
      ).rejects.toThrow();
      const indexes = await binding
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all<{ name: string }>();
      expect(indexes.results.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          "two_factor_user_id_idx",
          "two_factor_secret_idx",
          "rate_limit_key_unique",
          "rate_limit_last_request_idx",
        ]),
      );
      await db.delete(user);
      expect(await db.select().from(twoFactor)).toEqual([]);
    } finally {
      await miniflare.dispose();
    }
  });
});
