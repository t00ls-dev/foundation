import { describe, expect, it } from "vitest";
import {
  enrollmentSecret,
  passwordChallenge,
  totpError,
} from "../../src/client/totp.js";
import { authDestination } from "../../src/client/auth-destination.js";
import { authFormSchema } from "../../src/client/auth-validation.js";

describe("TOTP UI contracts", () => {
  it("keeps codes as six-digit strings including leading zero", () => {
    expect(authFormSchema(["code"]).safeParse({ code: "012345" }).success).toBe(
      true,
    );
    for (const code of ["12345", "12a345", "1234567", ""])
      expect(authFormSchema(["code"]).safeParse({ code }).success).toBe(false);
  });
  it("accepts only the configured local enrollment shape", () => {
    const uri =
      "otpauth://totp/Links?secret=ABCDEFGHIJKLMNOP&issuer=Links&digits=6&period=30";
    expect(enrollmentSecret(uri)).toBe("ABCDEFGHIJKLMNOP");
    for (const invalid of [
      uri.replace("otpauth:", "https:"),
      uri.replace("issuer=Links", "issuer=Other"),
      uri.replace("digits=6", "digits=8"),
      uri.replace("period=30", "period=60"),
      uri.replace("ABCDEFGHIJKLMNOP", "not-a-key"),
    ])
      expect(() => enrollmentSecret(invalid)).toThrow();
  });
  it("distinguishes challenge availability from a completed sign-in", () => {
    expect(
      passwordChallenge({
        twoFactorRedirect: true,
        twoFactorMethods: ["totp"],
      }),
    ).toEqual({ available: true });
    expect(
      passwordChallenge({ twoFactorRedirect: true, twoFactorMethods: [] }),
    ).toEqual({ available: false });
    expect(
      passwordChallenge({ twoFactorRedirect: true, twoFactorMethods: ["otp"] }),
    ).toEqual({ available: false });
    expect(passwordChallenge({ user: { id: "reader" } })).toBeNull();
    expect(passwordChallenge({ twoFactorRedirect: true })).toEqual({
      available: false,
    });
    expect(authDestination("//attacker.example")).toBe("/bookmarks");
  });
  it("separates code, consumed/expired, lockout and rate limiting from unknown outcomes", () => {
    expect(totpError({ code: "INVALID_CODE", status: 401 }).kind).toBe("code");
    for (const code of [
      "INVALID_TWO_FACTOR_COOKIE",
      "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    ])
      expect(totpError({ code, status: 401 }).kind).toBe("expired");
    expect(
      totpError({ code: "ACCOUNT_TEMPORARILY_LOCKED", status: 429 }).kind,
    ).toBe("locked");
    expect(totpError({ status: 429 }).kind).toBe("rate");
    expect(totpError({ code: "TOTP_NOT_ENABLED", status: 400 }).kind).toBe(
      "setup",
    );
    expect(
      totpError({ code: "AUTH_STATE_INDETERMINATE", status: 500 }).kind,
    ).toBe("indeterminate");
    expect(
      totpError({ code: "UNEXPECTED_DETAIL", status: 500 }).message,
    ).not.toContain("UNEXPECTED_DETAIL");
  });
});
