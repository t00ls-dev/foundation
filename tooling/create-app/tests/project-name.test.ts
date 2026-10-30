import { describe, expect, it } from "vitest";
import { projectName } from "../src/project-name.js";

describe("projectName", () => {
  it.each([
    ["My D1 App", "my-d1-app"],
    ["._-App", "app"],
    ["App-_.", "app"],
    ["._-App-_.", "app"],
    ["A._--B", "a._--b"],
    ["! A !! B ?", "a-b"],
    ["._-A!!._-B-_.", "a-._-b"],
    ["ÉAPP😀Name", "app-name"],
    ["İApp", "i-app"],
    ["parent/._-APP-_.", "app"],
    ["0", "0"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(projectName(input)).toBe(expected);
  });

  it.each(["", ".", "..", "._-", "!!!", "😀"])(
    "rejects a name without alphanumeric characters: %s",
    (input) => {
      expect(() => projectName(input)).toThrow(
        "Target directory must produce a valid package name.",
      );
    },
  );

  it("handles long separator runs at both ends and in the middle", () => {
    const separators = "._-".repeat(100_000);
    expect(projectName(`${separators}A${separators}B${separators}`)).toBe(
      `a${separators}b`,
    );
    expect(projectName(`a${separators}b`)).toBe(`a${separators}b`);
    expect(() => projectName(separators)).toThrow("valid package name");
    expect(projectName(`${"!".repeat(300_000)}App`)).toBe("app");
  });
});
