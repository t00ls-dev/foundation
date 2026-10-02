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
  resendEmail,
  type AppEnvironment,
  type EmailFactory,
} from "./auth.js";
import { bookmarkRoutes } from "./bookmarks.js";
import { requireSession } from "./require-session.js";
import { accountSecurityRoutes } from "./account-security.js";

export function createApp(emailFactory: EmailFactory = resendEmail) {
  const app = new Hono<AppEnvironment>();
  app.use("*", foundationSecurityHeaders());
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
    c.json({ googleEnabled: Boolean(resolveGoogleConfig(c.env)) }),
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
  app.on(["GET", "POST"], "/api/auth/**", (c) =>
    createRequestAuth(c.env, emailFactory).auth.handler(c.req.raw),
  );

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

  app.notFound((c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/"))
      return c.json({ error: "Not found" }, 404);
    return c.env.ASSETS.fetch(c.req.raw);
  });
  return app;
}
