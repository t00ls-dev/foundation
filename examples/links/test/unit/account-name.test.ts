import { describe, expect, it } from "vitest";
import { accountUpdateSchema } from "../../src/shared/account.js";

describe("account name", () => {
  it("trims edges and preserves international names and punctuation", () => {
    expect(
      accountUpdateSchema.parse({ name: "  Zoë 李 O’Connor-Silva  " }),
    ).toEqual({ name: "Zoë 李 O’Connor-Silva" });
  });
  it.each(["", "   ", "a".repeat(201), "Name\u0000", "First\nLast"])(
    "rejects empty, long or control-character names: %s",
    (name) => {
      expect(accountUpdateSchema.safeParse({ name }).success).toBe(false);
    },
  );
  it("accepts both length boundaries and only the name field", () => {
    expect(accountUpdateSchema.safeParse({ name: "a" }).success).toBe(true);
    expect(
      accountUpdateSchema.safeParse({ name: "a".repeat(200) }).success,
    ).toBe(true);
    expect(
      accountUpdateSchema.safeParse({
        name: "Reader",
        email: "other@example.com",
      }).success,
    ).toBe(false);
  });
});
