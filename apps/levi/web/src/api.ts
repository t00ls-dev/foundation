import type { SessionContext } from "../../src/session-types.js";
export type { SessionContext } from "../../src/session-types.js";
import {
  isCivilDate,
  memberTextLimits,
  type Member,
  type MemberInput,
  type MemberFilters,
  type MemberPage,
  type MemberEditInput,
} from "../../src/member-types.js";
export type Stage =
  "email" | "verificar-email" | "igreja" | "concluido" | "sem-acesso";
export interface NamedItem {
  id: string;
  nome: string;
}
export type ChurchRole = "admin" | "collaborator";
export interface ChurchLink extends NamedItem {
  role: ChurchRole;
  version: number;
}
export interface ChurchItem extends NamedItem {
  version: number;
  address: string | null;
  phone: string | null;
  email: string | null;
}
export interface ProvisionInput {
  churchName: string;
  churchAddress?: string | null;
  churchPhone?: string | null;
  churchEmail?: string | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAt: number | null = null,
  ) {
    super(message);
  }
}
// Somente espera de UX em memória; o servidor continua impondo todas as quotas.
const cooldowns = new Map<string, number>();
let identityGeneration = 0;
let contextGeneration = 0;
let activeChurchId: string | null = null;
let activeRole: ChurchRole | null = null;
export function resetClientIdentity() {
  identityGeneration++;
  contextGeneration++;
  activeRole = null;
  activeChurchId = null;
  cooldowns.clear();
}
function category(path: string, method: string): string {
  if (path === "/api/session-context") return "session";
  if (
    path === "/api/onboarding/email" ||
    path === "/api/onboarding/password-email"
  )
    return "email";
  if (path === "/api/auth/sign-in/email") return "login";
  if (path === "/api/auth/sign-out") return "logout";
  if (path === "/api/context/church") return "selection";
  if (method === "POST" && path === "/api/churches") return "provision";
  if (path === "/api/onboarding/password") return "password";
  return method === "GET" ? "read" : "write";
}
function retrySeconds(headers: Headers): number {
  for (const name of ["Retry-After", "X-Retry-After"]) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      if (Number.isSafeInteger(seconds))
        return Math.max(1, Math.min(seconds, 86_400));
    } else if (
      /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
    ) {
      const date = Date.parse(value);
      if (Number.isFinite(date))
        return Math.max(
          1,
          Math.min(Math.ceil((date - Date.now()) / 1_000), 86_400),
        );
    }
  }
  return 60;
}
function rateLimitError(retryAt: number): ApiError {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
  return new ApiError(
    429,
    "LIMITE_DE_SOLICITACOES",
    `Muitas solicitações. Tente novamente em ${seconds} ${seconds === 1 ? "segundo" : "segundos"}.`,
    retryAt,
  );
}
function contractError(): never {
  throw new ApiError(
    502,
    "RESPOSTA_INVALIDA",
    "Não foi possível confirmar os dados. Tente atualizar novamente.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return contractError();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    return contractError();
  return value;
}
async function request(
  path: string,
  body?: object,
  key?: string,
  method?: "PATCH" | "DELETE",
): Promise<unknown> {
  const requestMethod = method ?? (body ? "POST" : "GET");
  const generation = identityGeneration;
  const contextVersion = contextGeneration;
  const expectedChurch = activeChurchId;
  const scope = category(path, requestMethod);
  const waiting = cooldowns.get(scope);
  if (waiting && waiting > Date.now()) throw rateLimitError(waiting);
  cooldowns.delete(scope);
  let response: Response;
  try {
    response = await fetch(path, {
      method: requestMethod,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
        ...(path.startsWith("/api/members") && expectedChurch
          ? { "X-Levi-Church": expectedChurch }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      "REDE",
      "Não foi possível confirmar a operação. Verifique sua conexão e consulte o estado antes de tentar novamente.",
    );
  }
  if (response.status === 429) {
    const retryAt = Date.now() + retrySeconds(response.headers) * 1_000;
    // Resposta atrasada de uma identidade anterior não limita a nova sessão.
    if (generation !== identityGeneration) throw rateLimitError(retryAt);
    cooldowns.set(scope, Math.max(cooldowns.get(scope) ?? 0, retryAt));
    throw rateLimitError(cooldowns.get(scope)!);
  }
  const value: unknown = await response.json().catch(() => null);
  if (
    path.startsWith("/api/members") &&
    (generation !== identityGeneration || expectedChurch !== activeChurchId)
  )
    throw new ApiError(
      409,
      "CONTEXTO_ALTERADO",
      "Atualize a igreja selecionada.",
    );
  if (
    generation !== identityGeneration ||
    ((path === "/api/context" ||
      path.startsWith("/api/churches/") ||
      path.startsWith("/api/members")) &&
      contextVersion !== contextGeneration)
  )
    throw new ApiError(
      409,
      "CONTEXTO_ALTERADO",
      "O contexto foi alterado. Atualize a consulta.",
    );

  if (
    response.ok &&
    [
      "/api/auth/sign-out",
      "/api/auth/sign-in/email",
      "/api/onboarding/password",
    ].includes(path)
  ) {
    resetClientIdentity();
  }
  if (!response.ok) {
    const data =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    throw new ApiError(
      response.status,
      typeof data.erro === "string" ? data.erro : "INDISPONIVEL",
      typeof data.mensagem === "string" && data.mensagem.length < 500
        ? data.mensagem
        : "Não foi possível concluir a solicitação. Tente novamente.",
    );
  }
  return record(value);
}
function namedItems(list: unknown): NamedItem[] {
  if (!Array.isArray(list)) return contractError();
  return list.map((value: unknown) => {
    const item = record(value);
    if (
      typeof item.nome !== "string" ||
      !item.nome.trim() ||
      item.nome.length > 160
    )
      return contractError();
    return { id: id(item.id), nome: item.nome };
  });
}
export const api = {
  invitationAuth: (email: string, token: string) =>
    request("/api/invitations/auth", { email, token }),
  acceptInvitation: (token: string) =>
    request("/api/invitations/accept", { token }),
  sendInvitation: (churchId: string, email: string, role: ChurchRole) =>
    request(`/api/churches/${id(churchId)}/invitations`, { email, role }),
  cancelInvitation: (churchId: string, invitationId: string) =>
    request(
      `/api/churches/${id(churchId)}/invitations/${id(invitationId)}`,
      {},
      undefined,
      "DELETE",
    ),
  resendInvitation: (churchId: string, invitationId: string) =>
    request(
      `/api/churches/${id(churchId)}/invitations/${id(invitationId)}/resend`,
      {},
    ),
  async invitations(churchId: string, after: string | null = null) {
    const data = record(
      await request(
        `/api/churches/${id(churchId)}/invitations${after ? `?after=${id(after)}` : ""}`,
      ),
    );
    if (!Array.isArray(data.invitations) || data.invitations.length > 100)
      return contractError();
    return {
      next: data.next === null ? null : id(data.next),
      invitations: data.invitations.map((value: unknown) => {
        const item = record(value);
        if (
          typeof item.email !== "string" ||
          (item.role !== "admin" && item.role !== "collaborator") ||
          typeof item.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(item.expiresAt)) ||
          (item.acceptedAt !== null && typeof item.acceptedAt !== "string") ||
          (item.cancelledAt !== null && typeof item.cancelledAt !== "string")
        )
          return contractError();
        return {
          id: id(item.id),
          email: item.email,
          role: item.role,
          expiresAt: item.expiresAt,
          acceptedAt: item.acceptedAt,
          cancelledAt: item.cancelledAt,
        };
      }),
    };
  },
  async sessionContext(): Promise<SessionContext | null> {
    try {
      const value = record(await request("/api/session-context"));
      return { userId: id(value.userId), sessionId: id(value.sessionId) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  async stage(): Promise<Stage> {
    const { etapa } = record(await request("/api/onboarding"));
    if (
      etapa !== "email" &&
      etapa !== "verificar-email" &&
      etapa !== "igreja" &&
      etapa !== "sem-acesso" &&
      etapa !== "concluido"
    )
      return contractError();
    return etapa;
  },
  email: (email: string) => request("/api/onboarding/email", { email }),
  passwordEmail: () => request("/api/onboarding/password-email", {}),
  password: (token: string | null, newPassword: string) =>
    request("/api/onboarding/password", {
      ...(token ? { token } : {}),
      newPassword,
    }),
  login: (email: string, password: string) =>
    request("/api/auth/sign-in/email", { email, password }),
  logout: () => request("/api/auth/sign-out", {}),
  async organizations() {
    const items: ChurchLink[] = [];
    let after: string | null = null;
    do {
      const data = record(
        await request(`/api/churches${after ? `?after=${after}` : ""}`),
      );
      if (!Array.isArray(data.churches)) return contractError();
      items.push(
        ...data.churches.map((value: unknown) => {
          const item = record(value);
          return {
            ...namedItems([item])[0]!,
            role: parseRole(item.role),
            version: parseVersion(item.version),
          };
        }),
      );
      const previous: string | null = after;
      after = data.next === null ? null : id(data.next);
      if (after && (after === previous || after !== items.at(-1)?.id))
        return contractError();
    } while (after);
    return items;
  },
  async provision(input: ProvisionInput, key: string) {
    const result = record(
      await request(
        "/api/churches",
        {
          name: input.churchName,
          address: input.churchAddress,
          phone: input.churchPhone,
          email: input.churchEmail,
        },
        key,
      ),
    );
    return {
      churchId: id(result.churchId),
    };
  },
  select: (churchId: string) => {
    contextGeneration++;
    activeChurchId = null;
    return request("/api/context/church", { churchId });
  },
  async context() {
    const data = record(await request("/api/context"));
    if (data.role !== "admin" && data.role !== "collaborator")
      return contractError();
    if (typeof data.membersEnabled !== "boolean") return contractError();
    if (
      typeof data.churchName !== "string" ||
      !data.churchName.trim() ||
      data.churchName.length > 160
    )
      return contractError();
    const churchId = id(data.churchId);
    const role = parseRole(data.role);
    if (activeChurchId !== churchId || activeRole !== role) contextGeneration++;
    activeChurchId = churchId;
    activeRole = role;
    return {
      churchId: activeChurchId,
      churchName: data.churchName,
      role: parseRole(data.role),
      membersEnabled: data.membersEnabled,
    };
  },
  async editChurch(
    churchId: string,
    input: {
      name: string;
      address: string;
      phone: string;
      email: string;
      version: number;
    },
  ) {
    const data = record(
      await request(`/api/churches/${id(churchId)}`, input, undefined, "PATCH"),
    );
    if (
      id(data.churchId) !== churchId ||
      parseVersion(data.version) !== input.version + 1
    )
      return contractError();
  },
  async accessList(churchId: string, after: string | null = null) {
    const data = record(
      await request(
        `/api/churches/${id(churchId)}/accesses${after ? `?after=${id(after)}` : ""}`,
      ),
    );
    if (!Array.isArray(data.accesses) || data.accesses.length > 100)
      return contractError();
    const accesses = data.accesses.map((value: unknown) => {
      const item = record(value);
      if (
        id(item.churchId) !== churchId ||
        typeof item.name !== "string" ||
        typeof item.email !== "string" ||
        typeof item.createdAt !== "string" ||
        !Number.isFinite(Date.parse(item.createdAt))
      )
        return contractError();
      return {
        id: id(item.id),
        userId: id(item.userId),
        name: item.name,
        email: item.email,
        role: parseRole(item.role),
        version: parseVersion(item.version),
        createdAt: item.createdAt,
      };
    });
    const next = data.next === null ? null : id(data.next);
    if (next && (next === after || next !== accesses.at(-1)?.id))
      return contractError();
    return { accesses, next };
  },
  async changeAccess(
    churchId: string,
    accessId: string,
    version: number,
    role: ChurchRole | null,
  ) {
    const data = record(
      await request(
        `/api/churches/${id(churchId)}/accesses/${id(accessId)}`,
        role === null ? { version } : { version, role },
        undefined,
        role === null ? "DELETE" : "PATCH",
      ),
    );
    if (id(data.churchId) !== churchId) return contractError();
  },
  async churches() {
    const selected = activeChurchId ?? contractError();
    const data = record(await request(`/api/churches/${selected}`));
    if (
      id(data.id) !== selected ||
      typeof data.nome !== "string" ||
      !data.nome.trim() ||
      data.nome.length > 160
    )
      return contractError();
    parseVersion(data.version);
    for (const [field, max] of [
      ["address", 500],
      ["phone", 40],
      ["email", 254],
    ] as const) {
      const value = data[field];
      if (
        activeRole === "admin" &&
        value !== null &&
        (typeof value !== "string" || value.length > max)
      )
        return contractError();
      if (activeRole === "collaborator" && value !== undefined)
        return contractError();
    }
    return {
      churchId: selected,
      churches: [
        {
          id: selected,
          nome: data.nome,
          version: parseVersion(data.version),
          address: typeof data.address === "string" ? data.address : null,
          phone: typeof data.phone === "string" ? data.phone : null,
          email: typeof data.email === "string" ? data.email : null,
        },
      ],
    };
  },
};

function memberSummary(value: unknown): MemberPage["members"][number] {
  const data = record(value);
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 160 ||
    typeof data.churchName !== "string" ||
    !data.churchName.trim() ||
    (data.status !== "Ativo" && data.status !== "Inativo")
  )
    return contractError();
  return {
    id: id(data.id),
    name: data.name,
    churchId: id(data.churchId),
    churchName: data.churchName,
    status: data.status,
  };
}
function memberReceipt(value: unknown) {
  const data = record(value);
  return {
    churchId: id(data.churchId),
    memberId: id(data.memberId),
  };
}
export const memberApi = {
  async list(filters: MemberFilters = {}): Promise<MemberPage> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined && value !== "") params.set(key, String(value));
    const data = record(await request(`/api/members?${params}`));
    if (
      !Array.isArray(data.members) ||
      !Number.isInteger(data.page) ||
      Number(data.page) < 1 ||
      !Number.isInteger(data.pageSize) ||
      Number(data.pageSize) < 1 ||
      Number(data.pageSize) > 100 ||
      typeof data.hasNext !== "boolean" ||
      data.members.length > Number(data.pageSize)
    )
      return contractError();
    return {
      churchId: id(data.churchId),
      members: data.members.map(memberSummary),
      page: Number(data.page),
      pageSize: Number(data.pageSize),
      hasNext: data.hasNext,
    };
  },
  async find(memberId: string): Promise<{ churchId: string; member: Member }> {
    const data = record(await request(`/api/members/${id(memberId)}`));
    const value = record(data.member);
    const summary = memberSummary(value);
    for (const field of ["birthDate", "joinedOn", "baptismDate"])
      if (
        value[field] !== null &&
        (typeof value[field] !== "string" || !isCivilDate(value[field]))
      )
        return contractError();
    for (const field of ["phone", "email", "address", "churchRole"])
      if (
        value[field] !== null &&
        (typeof value[field] !== "string" ||
          value[field].length >
            memberTextLimits[
              field as "phone" | "email" | "address" | "churchRole"
            ])
      )
        return contractError();
    if (
      !Number.isSafeInteger(value.version) ||
      Number(value.version) < 1 ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))
    )
      return contractError();
    return {
      churchId: id(data.churchId),
      member: {
        ...summary,
        birthDate: value.birthDate as string | null,
        joinedOn: value.joinedOn as string | null,
        baptismDate: value.baptismDate as string | null,
        phone: value.phone as string | null,
        email: value.email as string | null,
        address: value.address as string | null,
        churchRole: value.churchRole as string | null,
        createdAt: value.createdAt,
        version: Number(value.version),
      },
    };
  },
  async edit(memberId: string, input: MemberEditInput) {
    return memberReceipt(
      await request(`/api/members/${id(memberId)}`, input, undefined, "PATCH"),
    );
  },
  async create(input: MemberInput, key: string) {
    return memberReceipt(await request("/api/members", input, key));
  },
  async recover(key: string) {
    return memberReceipt(
      await request(`/api/members/requests/${encodeURIComponent(key)}`),
    );
  },
};

function parseRole(value: unknown): ChurchRole {
  if (value !== "admin" && value !== "collaborator") return contractError();
  return value;
}
function parseVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    return contractError();
  return value;
}
