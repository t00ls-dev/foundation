import type { BetterAuthPlugin } from "better-auth";
import { captcha } from "better-auth/plugins";

export type TurnstileOperation =
  "signIn" | "signUp" | "magicLink" | "passwordReset";
export type TurnstileActions = Record<TurnstileOperation, string>;
export type FoundationTurnstileOptions =
  | {
      secretKey: string;
      allowedHostnames: readonly string[];
      actions?: TurnstileActions;
    }
  | { unavailable: true };

const paths: Record<string, TurnstileOperation> = {
  "/sign-in/email": "signIn",
  "/sign-up/email": "signUp",
  "/sign-in/magic-link": "magicLink",
  "/request-password-reset": "passwordReset",
};
const defaults: TurnstileActions = {
  signIn: "sign-in",
  signUp: "sign-up",
  magicLink: "magic-link",
  passwordReset: "password-reset",
};

export const turnstileUnavailableCode = "TURNSTILE_UNAVAILABLE";
function unavailable() {
  return {
    response: Response.json(
      {
        code: turnstileUnavailableCode,
        message: "Verification is temporarily unavailable. Please try again.",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    ),
  };
}

/** Public hook bridge only. Better Auth is the sole Siteverify implementation.
 * Native 1.7.7 accepts truthy non-boolean success; this V1 preserves that known
 * limitation rather than claiming arbitrary upstream payloads fail closed. */
export function turnstilePlugin(
  options: FoundationTurnstileOptions,
): BetterAuthPlugin {
  const configured = "unavailable" in options ? null : options;
  const actions = configured?.actions ?? defaults;
  const valid =
    configured &&
    configured.secretKey.trim() &&
    configured.allowedHostnames.length > 0 &&
    configured.allowedHostnames.every(
      (host) => host.trim() === host && host.length > 0,
    ) &&
    Object.values(paths).every(
      (operation) =>
        typeof actions[operation] === "string" &&
        /^[A-Za-z0-9_-]{1,32}$/.test(actions[operation]),
    );
  const delegates = new Map(
    Object.entries(paths).map(([path, operation]) => [
      path,
      valid
        ? captcha({
            provider: "cloudflare-turnstile",
            secretKey: configured.secretKey,
            allowedHostnames: [...configured.allowedHostnames],
            expectedAction: actions[operation],
            endpoints: [path],
          })
        : null,
    ]),
  );
  return {
    id: "foundation-turnstile",
    async onRequest(request, context) {
      if (request.method !== "POST") return;
      const base = context.options.basePath ?? "/api/auth";
      let path = new URL(request.url).pathname;
      if (path.startsWith(base)) path = path.slice(base.length);
      path = path.replace(/\/{2,}/g, "/");
      if (!path.startsWith("/")) path = `/${path}`;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      if (!Object.hasOwn(paths, path)) return;
      const delegate = delegates.get(path);
      if (!delegate) return unavailable();
      const result = await delegate.onRequest(request, context);
      // Only this direct hook rejection proves the endpoint has not run. Never
      // reinterpret UNKNOWN_ERROR from a later auth response as CAPTCHA failure.
      if (result?.response.status === 500) return unavailable();
      result?.response.headers.set("Cache-Control", "private, no-store");
      return result;
    },
  };
}
