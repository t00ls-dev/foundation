import { createMiddleware } from "hono/factory";
import {
  createRequestAuth,
  type AppEnvironment,
  type EmailFactory,
} from "./auth.js";

export function requireSession(emailFactory: EmailFactory) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const { auth, database } = createRequestAuth(context.env, emailFactory);
    const result = await auth.resolveSession(context.req.raw.headers);
    for (const [name, value] of result.headers) {
      if (name.toLowerCase() !== "set-cookie") context.header(name, value);
    }
    for (const cookie of result.headers.getSetCookie()) {
      context.header("Set-Cookie", cookie, { append: true });
    }
    if (!result.data)
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Sign in to continue" } },
        401,
      );
    context.set("identity", result.data);
    context.set("database", database);
    await next();
  });
}
