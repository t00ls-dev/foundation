const defaultDestination = "/bookmarks";
const localOrigin = "https://links.invalid";

// Only application-owned private routes may be authentication return targets.
export function authDestination(value: string | null): string {
  if (!value?.startsWith("/")) return defaultDestination;
  try {
    const url = new URL(value, localOrigin);
    if (
      url.origin !== localOrigin ||
      !/^\/(?:bookmarks(?:\/new|\/[^/]+\/edit)?|account(?:\/security)?)$/.test(
        url.pathname,
      )
    )
      return defaultDestination;
    const path =
      url.pathname === "/account/security" ? "/account" : url.pathname;
    return `${path}${url.search}${url.hash}`;
  } catch {
    return defaultDestination;
  }
}

export function authPath(path: string, destination: string): string {
  const next = authDestination(destination);
  return next === defaultDestination
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ next })}`;
}
