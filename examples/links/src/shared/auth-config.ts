import { z } from "zod";

export const linksTurnstileActions = {
  signIn: "links-sign-in",
  signUp: "links-sign-up",
  magicLink: "links-magic-link",
  passwordReset: "links-password-reset",
} as const;

export const turnstileCapabilitySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disabled") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict(),
  z
    .object({ status: z.literal("enabled"), siteKey: z.string().min(1) })
    .strict(),
]);
export type TurnstileCapability = z.infer<typeof turnstileCapabilitySchema>;

export const publicAuthConfigSchema = z
  .object({ googleEnabled: z.boolean(), turnstile: turnstileCapabilitySchema })
  .strict();
