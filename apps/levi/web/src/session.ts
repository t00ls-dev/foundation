import type { SessionContext } from "../../src/session-types.js";

// Token de recuperação: memória desta página apenas. Nunca é serializado.
export function takeLinkReturn(
  location: Pick<Location, "href" | "pathname">,
  history: Pick<History, "replaceState">,
) {
  const params = new URL(location.href).searchParams;
  const token = params.get("token");
  const invalid = params.has("error");
  const churchId = params.get("igreja");
  const churchQuery =
    location.pathname === "/membros" &&
    churchId &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      churchId,
    )
      ? `?igreja=${churchId}`
      : "";
  history.replaceState(null, "", location.pathname + churchQuery);
  return { token: token && token.length <= 512 ? token : null, invalid };
}

const storageKey = "levi.onboarding.request";
type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function provisionKey(
  storage: RequestStorage | undefined,
  generate: () => string = () => crypto.randomUUID(),
): string {
  try {
    const previous = storage?.getItem(storageKey);
    if (previous && /^[a-zA-Z0-9_-]{16,128}$/.test(previous)) return previous;
  } catch {
    /* Storage indisponível não concede autoridade. */
  }
  const key = generate();
  try {
    storage?.setItem(storageKey, key);
  } catch {
    /* Repetição na página conserva a chave em memória. */
  }
  return key;
}
export function clearProvisionKey(storage: RequestStorage | undefined) {
  try {
    storage?.removeItem(storageKey);
  } catch {
    /* Sem dados de autenticação nesse storage. */
  }
}
export function requestStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function sameSession(
  left: SessionContext | null | undefined,
  right: SessionContext | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.userId === right.userId && left.sessionId === right.sessionId;
}

export function clearSessionRequests(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | undefined,
) {
  try {
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key === storageKey || key?.startsWith("levi.member.request."))
        storage.removeItem(key);
    }
  } catch {
    /* Storage indisponível não autoriza retenção dos payloads em memória. */
  }
}
