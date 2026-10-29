import {
  createFoundationAuth,
  type FoundationEmail,
  type FoundationAuth,
  type FoundationSession,
} from "@t00ls-dev/auth";
import type { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "./data/schema.js";
import { RequestError } from "./contracts.js";

export type Database = Awaited<ReturnType<typeof createPostgresDatabase>>;
export interface AppOptions {
  baseURL: string;
  databaseUrl: string;
  secret: string;
  /** Configuração privada; nunca derivada da requisição ou da concessão histórica. */
  adminEmail?: string | undefined;
  email: FoundationEmail;
  /** Destino fixo de apresentação; não vem da requisição do usuário. */
  onboardingReturnPath?: "/onboarding";
  /** Somente a entrada Worker confia no header de IP da Cloudflare. */
  publicAbuseProtection?: boolean;
}

export function createAuth(database: Database, options: AppOptions) {
  return createFoundationAuth({
    baseURL: options.baseURL,
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schema: { user, session, account, verification },
      transaction: true,
    }),
    secret: options.secret,
    generateId: "uuid",
    email: {
      send: (input) =>
        options.email.send({
          ...input,
          subject:
            input.subject === "Sign in"
              ? "Verifique seu e-mail no Levi"
              : "Defina sua senha no Levi",
          text: `Use o link para continuar no Levi. Não compartilhe este link.\n\n${input.text}\n\nSe você não solicitou esta mensagem, ignore-a.`,
        }),
    },
  });
}

export function verifiedSession(
  identity: FoundationSession | null,
): FoundationSession {
  if (!identity)
    throw new RequestError(
      401,
      "SESSAO_NECESSARIA",
      "Entre na sua conta para continuar.",
    );
  if (!identity.user.emailVerified)
    throw new RequestError(
      403,
      "EMAIL_NAO_VERIFICADO",
      "Verifique seu e-mail para continuar.",
    );
  return identity;
}

export function readySession(
  _database: Database,
  resolved: FoundationSession | null,
) {
  return Promise.resolve(verifiedSession(resolved));
}

// Chama somente o handler HTTP público. A instância Better Auth não é acessada.
export async function authRequest(
  auth: Pick<FoundationAuth, "handler" | "resolveSession">,
  options: AppOptions,
  original: Request,
  path: string,
  body?: object,
) {
  const headers = new Headers(original.headers);
  headers.delete("host");
  headers.delete("content-length");
  if (body) headers.set("content-type", "application/json");
  const response = await auth.handler(
    new Request(new URL(`/api/auth${path}`, options.baseURL), {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  if (response.status >= 300 && response.status < 400) return response;
  const responseHeaders = new Headers(response.headers);
  if (response.status === 429 && !responseHeaders.has("Retry-After")) {
    const retry = responseHeaders.get("X-Retry-After");
    if (retry && /^\d+$/.test(retry)) responseHeaders.set("Retry-After", retry);
  }
  // Preserva todos os cookies nativos; não devolve tokens de sessão no JSON.
  return new Response(
    JSON.stringify(
      response.ok
        ? {
            ok: true,
            mensagem: "Solicitação concluída. Consulte a etapa do onboarding.",
          }
        : {
            erro: "AUTENTICACAO_NAO_CONCLUIDA",
            mensagem:
              "Não foi possível concluir a autenticação. Solicite um novo link ou tente entrar novamente.",
          },
    ),
    {
      status:
        path === "/sign-in/email" && [400, 401, 403].includes(response.status)
          ? 401
          : response.status,
      headers: responseHeaders,
    },
  );
}
