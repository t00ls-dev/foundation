import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { account } from "../schema.js";
import type { AppEnvironment, EmailFactory } from "./auth.js";
import { requireSession } from "./require-session.js";

export function accountSecurityRoutes(emailFactory: EmailFactory) {
  const routes = new Hono<AppEnvironment>();
  routes.use("*", requireSession(emailFactory));
  routes.get("/security", async (c) => {
    if (new URL(c.req.url).search) {
      return c.json(
        {
          error: {
            code: "INVALID",
            message: "This endpoint does not accept query parameters.",
          },
        },
        400,
      );
    }
    const userId = c.get("identity").user.id;
    // Project only existence. Never load the password hash or account metadata.
    const rows = await c
      .get("database")
      .select({ present: sql<number>`1` })
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          eq(account.providerId, "credential"),
          eq(account.accountId, userId),
          isNotNull(account.password),
          ne(account.password, ""),
        ),
      )
      .limit(1);
    return c.json({ hasPassword: rows.length !== 0 });
  });
  return routes;
}
