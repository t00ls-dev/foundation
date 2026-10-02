import { describe, expect, it } from "vitest";
import {
  AuthConfigurationError,
  resolveGoogleConfig,
} from "../../src/server/auth.js";

describe("optional Google server configuration", () => {
  it.each([
    {},
    { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" },
    { GOOGLE_CLIENT_ID: " \n", GOOGLE_CLIENT_SECRET: "\t" },
  ])("disables Google when both values are absent: %j", (env) => {
    expect(resolveGoogleConfig(env)).toBeUndefined();
  });

  it("enables Google only with a complete, trimmed pair", () => {
    expect(
      resolveGoogleConfig({
        GOOGLE_CLIENT_ID: " client-id ",
        GOOGLE_CLIENT_SECRET: " client-secret ",
      }),
    ).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
  });

  it.each([
    { GOOGLE_CLIENT_ID: "sensitive-id" },
    { GOOGLE_CLIENT_SECRET: "sensitive-secret" },
    { GOOGLE_CLIENT_ID: "sensitive-id", GOOGLE_CLIENT_SECRET: "  " },
    { GOOGLE_CLIENT_ID: " \t", GOOGLE_CLIENT_SECRET: "sensitive-secret" },
  ])("rejects either incomplete pair with the same sanitized error", (env) => {
    expect(() => resolveGoogleConfig(env)).toThrow(AuthConfigurationError);
    expect(() => resolveGoogleConfig(env)).toThrow(
      "Authentication is temporarily unavailable.",
    );
    try {
      resolveGoogleConfig(env);
    } catch (error) {
      expect(String(error)).not.toMatch(
        /sensitive|GOOGLE_CLIENT|clientId|clientSecret/,
      );
    }
  });
});
