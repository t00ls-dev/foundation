import { describe, expect, it } from "vitest";
import {
  bookmarkInputSchema,
  bookmarkQuerySchema,
  bookmarkUpdateSchema,
} from "../../src/shared/bookmarks.js";

const valid = {
  title: "  Foundation  ",
  url: "https://example.com",
  description: " ",
  tags: [" Work ", "WORK", "docs"],
};

describe("bookmark contracts", () => {
  it("rejects comma-containing tags in creation and updates", () => {
    expect(
      bookmarkInputSchema.safeParse({ ...valid, tags: ["one,two"] }).success,
    ).toBe(false);
    expect(bookmarkUpdateSchema.safeParse({ tags: ["one,two"] }).success).toBe(
      false,
    );
    expect(bookmarkUpdateSchema.parse({ title: "Changed" })).not.toHaveProperty(
      "tags",
    );
  });
  it("defaults optional creation fields without resetting omitted PATCH fields", () => {
    expect(
      bookmarkInputSchema.parse({ title: "Minimal", url: valid.url }),
    ).toEqual({
      title: "Minimal",
      url: valid.url,
      description: null,
      tags: [],
    });
    expect(bookmarkUpdateSchema.parse({ title: "Changed" })).toEqual({
      title: "Changed",
    });
  });
  it("normalizes optional text and tags", () => {
    expect(bookmarkInputSchema.parse(valid)).toEqual({
      ...valid,
      title: "Foundation",
      description: null,
      tags: ["work", "docs"],
    });
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,test",
    "ftp://example.com",
    "/relative",
    "not a url",
  ])("rejects unsafe or invalid URL %s", (url) => {
    expect(bookmarkInputSchema.safeParse({ ...valid, url }).success).toBe(
      false,
    );
  });
  it("rejects injected ownership, oversized inputs and empty updates", () => {
    for (const input of [
      { ...valid, userId: "other" },
      { ...valid, title: " " },
      { ...valid, tags: Array<string>(11).fill("tag") },
      { ...valid, description: "x".repeat(2001) },
      { ...valid, tags: ["İ".repeat(40)] },
    ]) {
      expect(bookmarkInputSchema.safeParse(input).success).toBe(false);
    }
    expect(bookmarkUpdateSchema.safeParse({}).success).toBe(false);
    expect(bookmarkUpdateSchema.parse({ description: null })).toEqual({
      description: null,
    });
  });
  it("bounds pagination and normalizes filters", () => {
    expect(bookmarkQuerySchema.parse({})).toEqual({
      q: "",
      tag: "",
      limit: 20,
      offset: 0,
    });
    expect(
      bookmarkQuerySchema.parse({ tag: " Docs ", limit: "2", offset: "3" }),
    ).toMatchObject({ tag: "docs", limit: 2, offset: 3 });
    for (const input of [
      { limit: "0" },
      { limit: "101" },
      { offset: "-1" },
      { offset: "1.5" },
      { userId: "other" },
    ]) {
      expect(bookmarkQuerySchema.safeParse(input).success).toBe(false);
    }
  });
});
