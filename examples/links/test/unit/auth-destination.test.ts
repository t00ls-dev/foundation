import { describe, expect, it } from "vitest";
import {
  authDestination,
  authPath,
} from "../../src/client/auth-destination.js";

describe("authentication return targets", () => {
  it("defaults to the private library", () => {
    expect(authDestination(null)).toBe("/bookmarks");
    expect(authPath("/login", "/bookmarks")).toBe("/login");
  });
  it("preserves known private deep links and query/fragment", () => {
    for (const path of [
      "/bookmarks/new",
      "/account",
      "/bookmarks/missing/edit",
      "/bookmarks/873e3c4d-51a1-416d-bd86-4b1f2ac2d5ec/edit?source=link#title",
    ])
      expect(authDestination(path)).toBe(path);
  });
  it("canonicalizes the legacy account deep link", () => {
    expect(authDestination("/account/security?source=link#security")).toBe(
      "/account?source=link#security",
    );
  });
  it.each([
    "https://evil.example/bookmarks",
    "//evil.example/bookmarks",
    "/\\evil.example/bookmarks",
    "javascript:alert(1)",
    "/api/auth/sign-out",
    "/reset-password?token=secret",
    "/login?next=/login",
  ])("rejects external and non-application targets: %s", (path) => {
    expect(authDestination(path)).toBe("/bookmarks");
  });
  it("encodes return paths without overwriting existing auth parameters", () => {
    const result = new URL(
      authPath("/login?oauth=failed", "/bookmarks/new"),
      "https://links.invalid",
    );
    expect(result.searchParams.get("oauth")).toBe("failed");
    expect(result.searchParams.get("next")).toBe("/bookmarks/new");
    expect(result.searchParams.size).toBe(2);
  });
});
