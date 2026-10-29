import type { SessionContext } from "./session-types.js";
import { administrativePath } from "./admin-paths.js";
import {
  administrativeNotFound,
  requireGlobalAdministrator,
} from "./admin-access.js";
import { administrativeDirectory } from "./admin-directory.js";
import { administrativeEmail } from "./admin-config.js";
import { listFeatureFlags, updateFeatureFlag } from "./feature-flags.js";
import {
  featureKeys,
  invalidAdministrativeInput,
  readExpectedVersion,
} from "./feature-contracts.js";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  createMember,
  editMember,
  listMembers,
  findMember,
  findMemberRequest,
} from "./members.js";
import {
  readMember,
  readMemberEdit,
  readMemberFilters,
  readMemberRequestKey,
} from "./member-contracts.js";
import { createAbuseProtection } from "./abuse.js";
import { bodyLimit } from "hono/body-limit";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import {
  csrfProtection,
  foundationSecurityHeaders,
  privateResponseHeaders,
} from "@t00ls-dev/security";
import { and, eq } from "drizzle-orm";
import type { FoundationAuth, FoundationSession } from "@t00ls-dev/auth";
import {
  createAuth,
  authRequest,
  verifiedSession,
  readySession,
  hasPassword,
  type Database,
  type AppOptions,
} from "./auth.js";
import {
  readObject,
  readString,
  requireUuid,
  RequestError,
} from "./contracts.js";
import { tenants, verification } from "./data/schema.js";
import {
  findChurch,
  listChurches,
  listOrganizations,
  organizationContext,
  organizationStage,
  provisionOrganization,
  selectOrganization,
} from "./organizations.js";

type Environment = {
  Variables: {
    database: Database;
    auth: FoundationAuth;
    identity: FoundationSession | null;
    abuse: ReturnType<typeof createAbuseProtection> | null;
    memberIdentity: FoundationSession;
    memberContext: Awaited<ReturnType<typeof organizationContext>>;
  };
};

export function createApp(options: AppOptions) {
  const origin = new URL(options.baseURL).origin;
  const returnPath = options.onboardingReturnPath ?? "/api/onboarding";
  if (options.baseURL !== origin || options.secret.length < 32)
    throw new Error(
      "Configure a origem e um segredo de ao menos 32 caracteres.",
    );
  const app = new Hono<Environment>();
  app.use("*", async (c, next) => {
    await next();
    privateResponseHeaders(c.res.headers);
    c.header("Referrer-Policy", "no-referrer");
  });
  // Executa antes na volta do middleware; a política mais restrita fica por último.
  app.use("*", foundationSecurityHeaders());
  // Guarda antes de CSRF, bodyLimit, quotas e matching dos endpoints/HTML.
  app.use("*", async (c, next) => {
    if (!administrativePath(c.req.path)) return next();
    if (!administrativeEmail(options.adminEmail) || !c.req.header("cookie"))
      administrativeNotFound();
    let database: Database | undefined;
    try {
      try {
        database = await createPostgresDatabase(options.databaseUrl);
        const auth = createAuth(database, options);
        const resolved = await auth.resolveSession(c.req.raw.headers);
        await requireGlobalAdministrator(
          database,
          resolved.data,
          options.adminEmail,
        );
        c.set("database", database);
        c.set("auth", auth);
        c.set("identity", resolved.data);
        c.set("abuse", createAbuseProtection(database.client, options.secret));
        for (const cookie of resolved.headers.getSetCookie())
          c.header("Set-Cookie", cookie, { append: true });
      } catch {
        administrativeNotFound();
      }
      // Variantes codificadas, caixa diferente e prefixos não são aliases.
      if (!(
        c.req.path === "/admin" ||
        c.req.path === "/api/admin" ||
        c.req.path.startsWith("/api/admin/")
      ))
        return c.notFound();
      await next();
    } finally {
      await database?.client.end().catch(() => {});
    }
  });
  const csrf = csrfProtection({ trustedOrigins: [origin] });
  app.use(
    "*",
    createMiddleware<Environment>(async (c, next) => {
      const denied = await csrf(c, next);
      if (denied)
        return c.json(
          {
            erro: "ORIGEM_INVALIDA",
            mensagem: "A origem da solicitação não é permitida.",
          },
          403,
        );
    }),
  );
  app.use(
    "*",
    createMiddleware<Environment>((c, next) =>
      bodyLimit({
        // A seleção já admite 1000 UUIDs; os demais contratos mantêm 16 KiB.
        maxSize:
          c.req.method === "PUT" && c.req.path === "/api/admin/features/members"
            ? 65_536
            : 16_384,
        onError: (c) =>
          c.json(
            {
              erro: "ENTRADA_INVALIDA",
              mensagem: "A solicitação excede o tamanho permitido.",
            },
            413,
          ),
      })(c, next),
    ),
  );
  app.use("/api/*", async (c, next) => {
    if (administrativePath(c.req.path)) return next();
    const database = await createPostgresDatabase(options.databaseUrl);
    try {
      c.set("database", database);
      const abuse = options.publicAbuseProtection
        ? createAbuseProtection(database.client, options.secret)
        : null;
      c.set("abuse", abuse);
      c.set(
        "auth",
        createAuth(database, {
          ...options,
          email: abuse ? abuse.protectEmail(options.email) : options.email,
        }),
      );
      await next();
    } finally {
      await database.client.end();
    }
  });
  app.use(
    "/api/*",
    createMiddleware<Environment>(async (c, next) => {
      if (administrativePath(c.req.path)) return next();
      const abuse = c.get("abuse");
      if (abuse) return abuse.beforeSession(c, next);
      await next();
    }),
  );
  // Resolve uma vez por request, inclusive para a quota autenticada de logout.
  app.use("/api/*", async (c, next) => {
    if (administrativePath(c.req.path)) return next();
    c.set("identity", null);
    if (
      (!c.req.path.startsWith("/api/auth/") ||
        c.req.path === "/api/auth/sign-out") &&
      c.req.header("cookie")
    ) {
      const resolved = await c.get("auth").resolveSession(c.req.raw.headers);
      c.set("identity", resolved.data);
      // No logout, só o handler nativo pode decidir limpar ou manter os cookies.
      // Cookies preliminares no Hono substituiriam os cookies da resposta nativa.
      if (!(c.req.method === "POST" && c.req.path === "/api/auth/sign-out")) {
        for (const cookie of resolved.headers.getSetCookie())
          c.header("Set-Cookie", cookie, { append: true });
      }
    }
    await next();
  });
  app.use(
    "/api/*",
    createMiddleware<Environment>(async (c, next) => {
      const abuse = c.get("abuse");
      if (abuse)
        return administrativePath(c.req.path)
          ? abuse.administrative(c.get("identity"))(c, next)
          : abuse.middleware(c.get("identity"))(c, next);
      await next();
    }),
  );

  app.get("/api/admin/session", (c) => {
    const identity = c.get("identity");
    if (!identity) administrativeNotFound();
    return c.json({ userId: identity.user.id, sessionId: identity.session.id });
  });
  app.get("/api/admin/organizations", async (c) => {
    const after = c.req.query("after");
    const items = await administrativeDirectory({
      database: c.get("database"),
      identity: c.get("identity"),
      adminEmail: options.adminEmail,
      ...(after ? { after } : {}),
    });
    return c.json({
      items,
      next: items.length === 100 ? (items.at(-1)?.id ?? null) : null,
    });
  });
  app.get("/api/admin/features", async (c) => {
    const stored = await listFeatureFlags({
      database: c.get("database"),
      identity: c.get("identity"),
      adminEmail: options.adminEmail,
    });
    return c.json({
      features: featureKeys.map((key) => {
        const row = stored.find((flag) => flag.key === key);
        return {
          key,
          policy: row?.policy ?? "disabled",
          version: row?.version ?? 0,
          organizationIds: row?.organizationIds ?? [],
        };
      }),
    });
  });
  app.put("/api/admin/features/:key", async (c) => {
    const input = await readObject(c.req.raw, [
      "policy",
      "expectedVersion",
      "confirmAll",
    ]);
    if (typeof input.expectedVersion !== "number") invalidAdministrativeInput();
    if (
      input.policy &&
      typeof input.policy === "object" &&
      "kind" in input.policy &&
      input.policy.kind === "all" &&
      input.confirmAll !== true
    )
      invalidAdministrativeInput();
    const result = await updateFeatureFlag({
      database: c.get("database"),
      identity: c.get("identity"),
      adminEmail: options.adminEmail,
      key: c.req.param("key"),
      policy: input.policy,
      expectedVersion: readExpectedVersion(input.expectedVersion),
      operationId: crypto.randomUUID(),
    });
    return c.json({ feature: result });
  });

  app.post("/api/onboarding/email", async (c) => {
    const input = await readObject(c.req.raw, ["email"]);
    const email = readString(input, "email", 3, 254);
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      "/sign-in/magic-link",
      { email, callbackURL: returnPath },
    );
  });
  app.get("/api/auth/magic-link/verify", (c) => {
    const token = c.req.query("token") ?? "";
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      `/magic-link/verify?${new URLSearchParams({ token, callbackURL: returnPath })}`,
    );
  });
  app.post("/api/onboarding/password-email", async (c) => {
    await readObject(c.req.raw, []);
    const identity = verifiedSession(c.get("identity"));
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      "/request-password-reset",
      { email: identity.user.email, redirectTo: returnPath },
    );
  });
  app.get("/api/auth/reset-password/:token", (c) => {
    const token = encodeURIComponent(c.req.param("token"));
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      `/reset-password/${token}?${new URLSearchParams({ callbackURL: returnPath })}`,
    );
  });
  app.post("/api/onboarding/password", async (c) => {
    const input = await readObject(c.req.raw, ["token", "newPassword"]);
    const newPassword = readString(input, "newPassword", 8, 128, false);
    const identity = verifiedSession(c.get("identity"));
    if (input.token === undefined) {
      return c.get("auth").setInitialPassword(c.req.raw.headers, newPassword);
    }
    const token = readString(input, "token", 1, 512, false);
    // Associação à sessão é regra do Levi. Validade e consumo continuam nativos.
    const matches = await c
      .get("database")
      .db.select({ id: verification.id })
      .from(verification)
      .where(
        and(
          eq(verification.identifier, `reset-password:${token}`),
          eq(verification.value, identity.user.id),
        ),
      )
      .limit(1);
    if (!matches.length)
      throw new RequestError(
        400,
        "LINK_INVALIDO",
        "O link é inválido ou já foi utilizado. Solicite outro.",
      );
    return authRequest(c.get("auth"), options, c.req.raw, "/reset-password", {
      token,
      newPassword,
    });
  });
  app.post("/api/auth/sign-in/email", async (c) => {
    const input = await readObject(c.req.raw, ["email", "password"]);
    return authRequest(c.get("auth"), options, c.req.raw, "/sign-in/email", {
      email: readString(input, "email", 3, 254),
      password: readString(input, "password", 1, 128, false),
    });
  });
  app.post("/api/auth/sign-out", async (c) => {
    await readObject(c.req.raw, []);
    return authRequest(c.get("auth"), options, c.req.raw, "/sign-out", {});
  });
  app.get("/api/session-context", (c) => {
    const identity = c.get("identity");
    if (!identity)
      throw new RequestError(
        401,
        "SESSAO_NECESSARIA",
        "Entre na sua conta para continuar.",
      );
    return c.json({
      userId: identity.user.id,
      sessionId: identity.session.id,
    } satisfies SessionContext);
  });
  app.get("/api/onboarding", async (c) => {
    if (c.req.query("error"))
      throw new RequestError(
        400,
        "LINK_INVALIDO",
        "O link é inválido, expirou ou já foi utilizado. Solicite outro.",
      );
    const identity = c.get("identity");
    if (!identity) return c.json({ etapa: "email" });
    if (!identity.user.emailVerified)
      return c.json({ etapa: "verificar-email" });
    if (!(await hasPassword(c.get("database").db, identity.user.id)))
      return c.json({ etapa: "senha" });
    return c.json({
      etapa: await organizationStage(c.get("database"), identity),
    });
  });
  app.post("/api/organizations", async (c) => {
    const database = c.get("database");
    const identity = await readySession(database, c.get("identity"));
    const body = await readObject(c.req.raw, [
      "organizationName",
      "churchName",
      "churchAddress",
      "churchPhone",
      "churchEmail",
    ]);
    const optional = (key: string, max: number) =>
      body[key] == null ? null : readString(body, key, 0, max) || null;
    const churchEmail = optional("churchEmail", 254);
    if (churchEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(churchEmail))
      throw new RequestError(
        400,
        "ENTRADA_INVALIDA",
        "Informe um e-mail válido para a igreja.",
      );
    const requestKey = c.req.header("Idempotency-Key") ?? "";
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestKey))
      throw new RequestError(
        400,
        "CHAVE_NECESSARIA",
        "Envie uma chave de idempotência de 16 a 128 caracteres.",
      );
    return c.json(
      await provisionOrganization(database, identity, {
        organizationName: readString(body, "organizationName", 1, 160),
        churchName: readString(body, "churchName", 1, 160),
        churchAddress: optional("churchAddress", 500),
        churchPhone: optional("churchPhone", 40),
        churchEmail,
        requestKey,
      }),
      201,
    );
  });
  app.get("/api/organizations", async (c) =>
    c.json({
      organizations: await listOrganizations(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
      ),
    }),
  );
  app.post("/api/tenant", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    const body = await readObject(c.req.raw, ["organizationId"]);
    return c.json(
      await selectOrganization(
        c.get("database"),
        identity,
        requireUuid(readString(body, "organizationId", 36, 36)),
      ),
    );
  });
  app.get("/api/context", async (c) => {
    const context = await organizationContext(
      c.get("database"),
      await readySession(c.get("database"), c.get("identity")),
    );
    const [organization] = await c
      .get("database")
      .db.select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, context.tenantId))
      .limit(1);
    if (!organization)
      throw new RequestError(
        404,
        "NAO_ENCONTRADO",
        "Organização não encontrada.",
      );
    return c.json({
      organizationId: context.tenantId,
      organizationName: organization.name,
      role: context.role,
      membersEnabled: true,
    });
  });
  app.get("/api/churches", async (c) =>
    c.json(
      await listChurches(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
      ),
    ),
  );
  app.get("/api/churches/:id", async (c) =>
    c.json(
      await findChurch(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
        requireUuid(c.req.param("id")),
      ),
    ),
  );
  app.use("/api/members*", async (c, next) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    c.set("memberIdentity", identity);
    c.set(
      "memberContext",
      await organizationContext(c.get("database"), identity),
    );
    await next();
  });
  app.post("/api/members", async (c) =>
    c.json(
      await createMember(
        c.get("database"),
        c.get("memberIdentity"),
        await readMember(c.req.raw),
        readMemberRequestKey(c.req.raw),
        c.get("memberContext"),
      ),
      201,
    ),
  );
  app.get("/api/members", async (c) =>
    c.json(
      await listMembers(
        c.get("database"),
        c.get("memberIdentity"),
        readMemberFilters(new URL(c.req.url)),
        c.get("memberContext"),
      ),
    ),
  );
  app.get("/api/members/requests/:key", async (c) => {
    const key = c.req.param("key");
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key))
      throw new RequestError(
        400,
        "ENTRADA_INVALIDA",
        "A tentativa informada é inválida.",
      );
    return c.json(
      await findMemberRequest(
        c.get("database"),
        c.get("memberIdentity"),
        key,
        c.get("memberContext"),
      ),
    );
  });
  app.patch("/api/members/:id", async (c) =>
    c.json(
      await editMember(
        c.get("database"),
        c.get("memberIdentity"),
        requireUuid(c.req.param("id")),
        await readMemberEdit(c.req.raw),
        c.get("memberContext"),
      ),
    ),
  );
  app.get("/api/members/:id", async (c) =>
    c.json(
      await findMember(
        c.get("database"),
        c.get("memberIdentity"),
        requireUuid(c.req.param("id")),
        c.get("memberContext"),
      ),
    ),
  );
  // Allowlist exata: signup, mudança de e-mail/senha e novos plugins não vazam.
  app.all("/api/auth/*", (c) =>
    c.json(
      {
        erro: "ROTA_INDISPONIVEL",
        mensagem: "Esta operação de autenticação não está disponível.",
      },
      404,
    ),
  );
  app.notFound((c) =>
    c.json(
      { erro: "NAO_ENCONTRADO", mensagem: "Recurso não encontrado." },
      404,
    ),
  );
  app.onError((error, c) =>
    error instanceof RequestError
      ? c.json({ erro: error.code, mensagem: error.message }, error.status)
      : c.json(
          {
            erro: "INDISPONIVEL",
            mensagem:
              "Não foi possível confirmar a operação. Consulte o estado antes de tentar novamente.",
          },
          503,
        ),
  );
  return app;
}
