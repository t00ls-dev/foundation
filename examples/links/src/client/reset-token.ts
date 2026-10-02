export type ResetTokenResult = "ready" | "invalid" | "error";

export function resetTokenResult(
  response: Pick<Response, "ok" | "status" | "redirected" | "url">,
  token: string,
  origin: string,
): ResetTokenResult {
  if (!response.ok || response.status !== 200 || !response.redirected)
    return "error";
  try {
    const url = new URL(response.url);
    if (
      url.origin !== origin ||
      url.pathname !== "/reset-password" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.size !== 1
    )
      return "error";
    if (url.searchParams.get("error") === "INVALID_TOKEN") return "invalid";
    return url.searchParams.get("token") === token ? "ready" : "error";
  } catch {
    return "error";
  }
}

export async function checkResetToken(
  token: string,
  signal: AbortSignal,
): Promise<ResetTokenResult> {
  const origin = globalThis.location.origin;
  const url = new URL(
    `/api/auth/reset-password/${encodeURIComponent(token)}`,
    origin,
  );
  url.searchParams.set("callbackURL", "/reset-password");
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    mode: "same-origin",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    signal,
  });
  try {
    return resetTokenResult(response, token, origin);
  } finally {
    await response.body?.cancel();
  }
}
