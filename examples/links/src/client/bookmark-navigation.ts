import { bookmarkQuerySchema } from "../shared/bookmarks.js";

export type LibraryFilters = { q: string; tag: string; offset: number };

export function libraryFilters(params: URLSearchParams): LibraryFilters {
  const parsed = bookmarkQuerySchema.safeParse({
    q: params.get("q") ?? "",
    tag: params.get("tag") ?? "",
    offset: params.get("offset") ?? 0,
  });
  return parsed.success
    ? { q: parsed.data.q, tag: parsed.data.tag, offset: parsed.data.offset }
    : { q: "", tag: "", offset: 0 };
}

export function libraryPath(filters: LibraryFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.offset) params.set("offset", String(filters.offset));
  return `/bookmarks${params.size ? `?${params}` : ""}`;
}

export function bookmarkTaskPath(path: string, filters: LibraryFilters) {
  const destination = libraryPath(filters);
  return destination === "/bookmarks"
    ? path
    : `${path}?${new URLSearchParams({ returnTo: destination })}`;
}

/** Only the library and its validated filters can receive an editor return. */
export function bookmarkReturnPath(candidate: string | null) {
  if (
    !candidate ||
    !candidate.startsWith("/bookmarks") ||
    candidate.includes("\\")
  )
    return "/bookmarks";
  const url = new URL(candidate, "https://links.invalid");
  if (
    url.origin !== "https://links.invalid" ||
    url.pathname !== "/bookmarks" ||
    url.hash
  )
    return "/bookmarks";
  return libraryPath(libraryFilters(url.searchParams));
}
