import {
  csrfProtection,
  foundationSecurityHeaders,
  privateResponseHeaders,
} from "@t00ls-dev/security";
import { Hono, type MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
  AuthConfigurationError,
  createRequestAuth,
  resolveGoogleConfig,
  resolveTurnstileCapability,
  resendEmail,
  type AppEnvironment,
  type EmailFactory,
} from "./auth.js";
import { bookmarkRoutes } from "./bookmarks.js";
import { requireSession } from "./require-session.js";
import { accountSecurityRoutes } from "./account-security.js";
import { accountUpdateSchema } from "../shared/account.js";

export function createApp(emailFactory: EmailFactory = resendEmail) {
  const app = new Hono<AppEnvironment>();
  app.use(
    "*",
    createMiddleware<AppEnvironment>((c, next) => {
      const headers: MiddlewareHandler<AppEnvironment> =
        foundationSecurityHeaders({
          turnstile: resolveTurnstileCapability(c.env).status !== "disabled",
        });
      return headers(c, next);
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    privateResponseHeaders(new Headers()).forEach((value, name) =>
      c.header(name, value),
    );
  });
  app.onError((error, c) => {
    if (error instanceof AuthConfigurationError) {
      c.header("Cache-Control", "private, no-store");
      return c.json(
        {
          error: {
            code: "AUTH_CONFIGURATION_INVALID",
            message: "Authentication is temporarily unavailable.",
          },
        },
        503,
      );
    }
    return c.json(
      {
        error: {
          code: "INTERNAL",
          message: "Something went wrong. Please try again.",
        },
      },
      500,
    );
  });

  app.get("/api/config", (c) =>
    c.json({
      googleEnabled: Boolean(resolveGoogleConfig(c.env)),
      turnstile: resolveTurnstileCapability(c.env),
    }),
  );

  app.get("/health", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      await c.env.DB.prepare("SELECT 1").first();
      return c.json({ status: "ok", checks: { worker: "ok", database: "ok" } });
    } catch {
      return c.json(
        { status: "error", checks: { worker: "ok", database: "error" } },
        503,
      );
    }
  });
  app.on(["GET", "POST"], "/api/auth/**", async (c) => {
    let request = c.req.raw;
    if (c.req.method === "POST" && c.req.path === "/api/auth/update-user") {
      const input: unknown = await request
        .clone()
        .json()
        .catch(() => null);
      const parsed = accountUpdateSchema.safeParse(input);
      if (!parsed.success)
        return c.json(
          {
            code: "INVALID_NAME",
            message:
              "Enter a name of 1–200 characters without control characters.",
          },
          400,
        );
      // Validation only; Better Auth owns writes, session cookies and CSRF.
      request = new Request(request, { body: JSON.stringify(parsed.data) });
    }
    return createRequestAuth(c.env, emailFactory).auth.handler(request);
  });

  const privateRoutes = new Hono<AppEnvironment>();
  privateRoutes.use(
    "*",
    createMiddleware<AppEnvironment>(async (c, next) => {
      const protection: MiddlewareHandler<AppEnvironment> = csrfProtection({
        trustedOrigins: [new URL(c.env.BASE_URL).origin],
      });
      const response = await protection(c, next);
      if (response instanceof Response && response.status === 403) {
        return c.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Request origin is not allowed",
            },
          },
          403,
        );
      }
    }),
  );
  privateRoutes.use("*", requireSession(emailFactory));
  privateRoutes.route("/", bookmarkRoutes);
  app.route("/api/bookmarks", privateRoutes);
  app.route("/api/account", accountSecurityRoutes(emailFactory));

  app.notFound(async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/"))
      return c.json({ error: "Not found" }, 404);
    const response = await c.env.ASSETS.fetch(c.req.raw);
    // Workers Assets returns immutable headers. Keep the body/status/asset
    // headers while allowing the global security middleware to apply policy.
    return new Response(response.body, response);
  });
  return app;
}
