import { createD1Database } from "@t00ls-dev/db/d1";
import { describe, expect, it } from "vitest";
import { bookmark, user } from "../../src/schema.js";
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
      await db.insert(user).values({
        id: "existing",
        name: "Existing",
        email: "existing@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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
      expect(await db.select().from(user)).toHaveLength(1);
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
});
