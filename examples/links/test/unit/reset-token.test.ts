import { describe, expect, it } from "vitest";
import { resetTokenResult } from "../../src/client/reset-token.js";

const origin = "https://links.example";
const response = { ok: true, status: 200, redirected: true };
describe("official reset callback result", () => {
  it("accepts only the exact expected token or official invalid result", () => {
    expect(
      resetTokenResult(
        { ...response, url: `${origin}/reset-password?token=expected` },
        "expected",
        origin,
      ),
    ).toBe("ready");
    expect(
      resetTokenResult(
        { ...response, url: `${origin}/reset-password?error=INVALID_TOKEN` },
        "expected",
        origin,
      ),
    ).toBe("invalid");
  });
  it.each([
    "https://evil.example/reset-password?token=expected",
    `${origin}/other?token=expected`,
    `${origin}/reset-password?token=other`,
    `${origin}/reset-password?token=expected&token=expected`,
    `${origin}/reset-password?token=expected&extra=1`,
    `${origin}/reset-password?error=INVALID_TOKEN&token=expected`,
    `${origin}/reset-password?error=UNKNOWN`,
    `${origin}/reset-password?token=expected#checked`,
    "https://user:password@links.example/reset-password?token=expected",
    "",
  ])("treats unexpected final URLs as verification errors: %s", (url) => {
    expect(resetTokenResult({ ...response, url }, "expected", origin)).toBe(
      "error",
    );
  });
  it("never treats HTTP errors or a missing redirect as token invalidity", () => {
    const url = `${origin}/reset-password?error=INVALID_TOKEN`;
    expect(
      resetTokenResult(
        { ...response, ok: false, status: 503, url },
        "expected",
        origin,
      ),
    ).toBe("error");
    expect(
      resetTokenResult(
        { ...response, redirected: false, url },
        "expected",
        origin,
      ),
    ).toBe("error");
  });
});
