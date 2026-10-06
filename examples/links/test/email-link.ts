// Test-only: read the actual plain-text message, never assume its whole body
// is a URL or silently choose one of multiple links.
export function extractEmailUrl(text: string, origin: string): string {
  const links = text.split(/\r?\n/).filter((line) => {
    if (!/^https?:\/\/\S+$/.test(line)) return false;
    return URL.canParse(line);
  });
  if (links.length !== 1)
    throw new Error("Expected exactly one authentication link");
  const link = links[0]!;
  const url = new URL(link);
  if (
    url.origin !== origin ||
    !/^\/api\/auth\/(?:verify-email|magic-link\/verify|reset-password\/[^/]+)$/.test(
      url.pathname,
    )
  )
    throw new Error("Unexpected authentication link destination");
  return link;
}
