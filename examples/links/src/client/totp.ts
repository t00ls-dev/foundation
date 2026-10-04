import { z } from "zod";

export const totpPolicy =
  "Authenticator codes protect password sign-in only. Magic Link and Google remain alternative sign-in methods without a Links authenticator challenge.";
export const totpUnconfirmed =
  "We couldn't confirm the outcome. Don't repeat this request automatically. Check your session or use Magic Link or Google to recover access.";

export function enrollmentSecret(uri: string) {
  const url = new URL(uri);
  const secret = url.searchParams.get("secret") ?? "";
  if (
    url.protocol !== "otpauth:" ||
    url.hostname !== "totp" ||
    url.searchParams.get("issuer") !== "Links" ||
    !/^[A-Z2-7]{16,128}$/i.test(secret) ||
    url.searchParams.get("digits") !== "6" ||
    url.searchParams.get("period") !== "30"
  )
    throw new Error("Invalid authenticator setup");
  return secret;
}

export function totpError(error: {
  status?: number | undefined;
  code?: string | undefined;
}) {
  const code = error.code;
  if (code === "INVALID_CODE")
    return {
      kind: "code",
      message:
        "That code is incorrect or expired. Enter a current six-digit code.",
    } as const;
  if (
    code === "INVALID_TWO_FACTOR_COOKIE" ||
    code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
  )
    return {
      kind: "expired",
      message:
        "This sign-in challenge expired, was used, or exhausted its attempts. Start a new password sign-in.",
    } as const;
  if (code === "ACCOUNT_TEMPORARILY_LOCKED")
    return {
      kind: "locked",
      message:
        "Authenticator sign-in is temporarily locked. Wait fifteen minutes before a new password sign-in, or use Magic Link or Google.",
    } as const;
  if (code === "TOTP_NOT_ENABLED" || code === "TOTP_ALREADY_ENABLED")
    return {
      kind: "setup",
      message:
        "Authenticator setup needs to be checked. Use an alternative sign-in method, then finish interrupted setup or turn it off in Account.",
    } as const;
  if (code === "INVALID_PASSWORD")
    return {
      kind: "password",
      message: "Current password is incorrect.",
    } as const;
  if (error.status === 429)
    return {
      kind: "rate",
      message: "Too many requests. Wait before trying again.",
    } as const;
  return { kind: "indeterminate", message: totpUnconfirmed } as const;
}

export type PasswordChallenge = {
  email: string;
  destination: string;
  available: boolean;
  uncertain: boolean;
};

export function passwordChallenge(data: unknown) {
  const parsed = z
    .object({
      twoFactorRedirect: z.literal(true),
      twoFactorMethods: z.array(z.string()).catch([]),
    })
    .safeParse(data);
  return parsed.success
    ? { available: parsed.data.twoFactorMethods.includes("totp") }
    : null;
}
