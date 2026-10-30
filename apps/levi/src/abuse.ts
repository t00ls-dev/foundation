import { fixedWindowRateLimit } from "@t00ls-dev/security";
import type { FoundationEmail, FoundationSession } from "@t00ls-dev/auth";
import type { MiddlewareHandler, Next } from "hono";
import type { Database } from "./auth.js";

// Limites conservadores do DEV público; não são quotas comerciais do produto.
export const publicAbuseLimits = {
  emailPerMinute: 5,
  loginPerMinute: 10,
  anonymousPerMinute: 60,
  callbackPerMinute: 60,
  guardPerMinute: 1_200,
  readPerMinute: 300,
  writePerMinute: 60,
  selectionPerMinute: 30,
  provisionPerQuarterHour: 5,
  passwordPerQuarterHour: 5,
  logoutPerMinute: 30,
  recipientPerQuarterHour: 3,
  emailAttemptsPerDay: 90,
} as const;

export function createAbuseProtection(
  client: Pick<Database["client"], "query">,
  secret: string,
  now: () => number = Date.now,
) {
  const hmac = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  async function digest(value: string) {
    const bytes = await crypto.subtle.sign(
      "HMAC",
      await hmac,
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  async function increment(key: string, expiresAt: number, cleanup: boolean) {
    // A guarda limpa antes da categoria; cada incremento continua atômico.
    // O store público e quotas de envio também funcionam isoladamente.
    const result = await client.query<{ count: number }>(
      `${
        cleanup
          ? `WITH expired AS (
           DELETE FROM abuse_counters WHERE key IN
           (SELECT key FROM abuse_counters
            WHERE expires_at <= now() AND key <> $1
            LIMIT 100 FOR UPDATE SKIP LOCKED)
         )`
          : ""
      }
         INSERT INTO abuse_counters(key, count, expires_at) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET count = abuse_counters.count + 1
         RETURNING count`,
      [key, new Date(expiresAt)],
    );
    if (!result.rows[0]) throw new Error("Limite indisponível.");
    return result.rows[0].count;
  }
  const store = {
    increment: (key: string, expiresAt: number) =>
      increment(key, expiresAt, true),
  };
  const categoryStore = {
    increment: (key: string, expiresAt: number) =>
      increment(key, expiresAt, false),
  };
  const ip = (request: Request) =>
    // Somente Worker habilita esta composição. Nunca confia em X-Forwarded-For.
    digest(request.headers.get("cf-connecting-ip") ?? "unknown-client");
  const limiter = (
    prefix: string,
    limit: number,
    key: (request: Request) => Promise<string> = ip,
    windowMs = 60_000,
    counterStore = categoryStore,
  ) =>
    fixedWindowRateLimit({
      prefix,
      store: counterStore,
      limit,
      windowMs,
      key,
      now,
    });
  const guard = limiter(
    "v2:guard",
    publicAbuseLimits.guardPerMinute,
    ip,
    60_000,
    store,
  );
  const anonymous = limiter(
    "v2:anonymous",
    publicAbuseLimits.anonymousPerMinute,
  );
  const callbacks = limiter("v2:callback", publicAbuseLimits.callbackPerMinute);
  const emailRequests = limiter("email", publicAbuseLimits.emailPerMinute);
  const login = limiter("login", publicAbuseLimits.loginPerMinute);
  function credentialLimiter(c: Parameters<MiddlewareHandler>[0]) {
    if (
      c.req.method === "POST" &&
      ["/api/onboarding/email", "/api/onboarding/password-email"].includes(
        c.req.path,
      )
    )
      return emailRequests;
    if (c.req.path === "/api/auth/sign-in/email") return login;
    return null;
  }
  async function apply(
    limited: MiddlewareHandler,
    c: Parameters<MiddlewareHandler>[0],
    next: Next,
  ) {
    const response = await limited(c, async () => {
      // Respostas nativas do handler auth podem substituir os headers preparados do Hono.
      const quotaHeaders = [
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ].map((name) => [name, c.res.headers.get(name)] as const);
      await next();
      for (const [name, value] of quotaHeaders)
        if (value) c.header(name, value);
    });
    if (response?.status === 429)
      return c.json(
        {
          erro: "LIMITE_DE_SOLICITACOES",
          mensagem: "Muitas solicitações. Aguarde antes de tentar novamente.",
        },
        429,
      );
    return response;
  }
  // Antes de consultar sessão: guarda ampla e tetos de credenciais originais.
  const beforeSession: MiddlewareHandler = async (c, next) => {
    const response = await guard(c, async () => {
      const credential = credentialLimiter(c);
      if (credential) c.res = (await apply(credential, c, next)) ?? c.res;
      else await next();
    });
    if (response?.status === 429)
      return c.json(
        {
          erro: "LIMITE_DE_SOLICITACOES",
          mensagem: "Muitas solicitações. Aguarde antes de tentar novamente.",
        },
        429,
      );
    return response;
  };
  // A identidade vem exclusivamente de resolveSession, nunca do request.
  function middleware(identity: FoundationSession | null): MiddlewareHandler {
    return async (c, next) => {
      if (credentialLimiter(c)) return next();
      const path = c.req.path;
      // Hono executa o handler GET para HEAD; ambos compartilham a mesma quota.
      const method = c.req.method === "HEAD" ? "GET" : c.req.method;
      if (
        method === "GET" &&
        (path === "/api/auth/magic-link/verify" ||
          /^\/api\/auth\/reset-password\/[^/]+$/.test(path))
      )
        return apply(callbacks, c, next);
      if (!identity) return apply(anonymous, c, next);
      const userKey = () => digest(`user:${identity.user.id}`);
      let category: string;
      let limit: number;
      let windowMs = 60_000;
      if (method === "POST" && path === "/api/auth/sign-out") {
        category = "logout";
        limit = publicAbuseLimits.logoutPerMinute;
      } else if (method === "POST" && path === "/api/context/church") {
        category = "selection";
        limit = publicAbuseLimits.selectionPerMinute;
      } else if (method === "POST" && path === "/api/churches") {
        category = "provision";
        limit = publicAbuseLimits.provisionPerQuarterHour;
        windowMs = 15 * 60_000;
      } else if (method === "POST" && path === "/api/onboarding/password") {
        category = "password";
        limit = publicAbuseLimits.passwordPerQuarterHour;
        windowMs = 15 * 60_000;
      } else if (
        (method === "POST" && path === "/api/members") ||
        (method === "PATCH" &&
          /^\/api\/(?:members|churches)\/[^/]+$/.test(path)) ||
        (["PATCH", "DELETE"].includes(method) &&
          /^\/api\/churches\/[^/]+\/accesses\/[^/]+$/.test(path))
      ) {
        category = "write";
        limit = publicAbuseLimits.writePerMinute;
      } else if (
        method === "GET" &&
        ([
          "/api/onboarding",
          "/api/churches",
          "/api/context",
          "/api/members",
        ].includes(path) ||
          /^\/api\/(?:churches|members)\/[^/]+$/.test(path) ||
          /^\/api\/members\/requests\/[^/]+$/.test(path) ||
          /^\/api\/churches\/[^/]+\/accesses$/.test(path))
      ) {
        category = "read";
        limit = publicAbuseLimits.readPerMinute;
      } else return apply(anonymous, c, next);
      return apply(
        limiter(`v2:${category}`, limit, userKey, windowMs),
        c,
        next,
      );
    };
  }
  async function consume(prefix: string, windowMs: number, limit: number) {
    const start = Math.floor(now() / windowMs) * windowMs;
    return (
      (await store.increment(`${prefix}:${start}`, start + windowMs)) <= limit
    );
  }
  function protectEmail(provider: FoundationEmail): FoundationEmail {
    return {
      async send(input) {
        const recipient = await digest(input.to.trim().toLowerCase());
        if (
          !(await consume(
            `recipient:${recipient}`,
            15 * 60_000,
            publicAbuseLimits.recipientPerQuarterHour,
          )) ||
          !(await consume(
            "email-day",
            24 * 60 * 60_000,
            publicAbuseLimits.emailAttemptsPerDay,
          ))
        )
          return; // Mesma resposta por destinatário, exista conta ou não.
        // Falha/timeout também consome orçamento; sem retry nem envio transacional.
        await provider.send(input);
      },
    };
  }
  function administrative(
    identity: FoundationSession | null,
  ): MiddlewareHandler {
    return (c, next) =>
      apply(
        limiter(
          "v2:admin",
          60,
          () => digest(`user:${identity?.user.id}`),
          60_000,
          store,
        ),
        c,
        next,
      );
  }
  return { beforeSession, middleware, administrative, protectEmail, store };
}
