import { basename } from "node:path";

export function projectName(target: string): string {
  const name = basename(target)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  let start = 0;
  let end = name.length;
  while (start < end && "._-".includes(name.charAt(start))) start++;
  while (end > start && "._-".includes(name.charAt(end - 1))) end--;
  const trimmed = name.slice(start, end);

  if (!trimmed) {
    throw new Error("Target directory must produce a valid package name.");
  }

  return trimmed;
}
