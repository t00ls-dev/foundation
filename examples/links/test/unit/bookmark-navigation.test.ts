import { describe, expect, it } from "vitest";
import {
  bookmarkReturnPath,
  bookmarkTaskPath,
  libraryFilters,
  libraryPath,
} from "../../src/client/bookmark-navigation.js";

describe("bookmark navigation", () => {
  it("round trips applied filters and pagination without changing default routes", () => {
    const filters = libraryFilters(
      new URLSearchParams({ q: " A & B ", tag: "DOCS", offset: "20" }),
    );
    expect(filters).toEqual({ q: "A & B", tag: "docs", offset: 20 });
    const path = libraryPath(filters);
    expect(bookmarkReturnPath(path)).toBe(path);
    expect(
      new URL(
        bookmarkTaskPath("/bookmarks/new", filters),
        "https://links.invalid",
      ).searchParams.get("returnTo"),
    ).toBe(path);
    expect(
      bookmarkTaskPath("/bookmarks/new", { q: "", tag: "", offset: 0 }),
    ).toBe("/bookmarks/new");
  });

  it("only returns to the library, never an external or unrelated destination", () => {
    for (const candidate of [
      null,
      "https://evil.example/bookmarks",
      "//evil.example/bookmarks",
      "/account",
      "/bookmarks/new",
      "/bookmarks#redirect",
      "/bookmarks\\evil",
      "/bookmarks/../account",
    ])
      expect(bookmarkReturnPath(candidate)).toBe("/bookmarks");
    expect(
      bookmarkReturnPath("/bookmarks?q=docs&offset=20&unknown=discarded"),
    ).toBe("/bookmarks?q=docs&offset=20");
  });

  it("rejects invalid filters and out-of-contract offsets", () => {
    for (const params of [
      new URLSearchParams({ offset: "-20" }),
      new URLSearchParams({ offset: "not-a-number" }),
      new URLSearchParams({ offset: "1000001" }),
      new URLSearchParams({ q: "x".repeat(201) }),
    ])
      expect(libraryFilters(params)).toEqual({ q: "", tag: "", offset: 0 });
  });
});
