export type DevCutoverOperation = "status" | "prepare" | "resume";

const cutoverConfirmations: Record<DevCutoverOperation, string> = {
  status: "CONSULTAR",
  prepare: "PREPARAR",
  resume: "RETOMAR",
};

export function devCutoverAdminTarget(
  env: NodeJS.ProcessEnv,
  operation: DevCutoverOperation,
): string {
  try {
    const raw = env.LEVI_DEV_ADMIN_DATABASE_URL;
    if (!raw) throw new Error();
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) ||
      url.hostname.split(".")[0]!.includes("-pooler") ||
      (url.port !== "" && url.port !== "5432") ||
      url.hash ||
      url.hostname !== env.LEVI_DEV_DATABASE_HOST ||
      database !== env.LEVI_DEV_DATABASE_NAME ||
      database !== "levi_dev" ||
      decodeURIComponent(url.username) !== "neondb_owner" ||
      !url.password ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      [...url.searchParams.keys()].some(
        (key) => !["sslmode", "channel_binding"].includes(key),
      ) ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      url.searchParams.getAll("channel_binding").length > 1 ||
      (url.searchParams.has("channel_binding") &&
        url.searchParams.get("channel_binding") !== "require") ||
      env.LEVI_DEV_CUTOVER_CONFIRMATION !==
        `${cutoverConfirmations[operation]}:${url.hostname}/${database}`
    )
      throw new Error();
    return raw;
  } catch {
    throw new Error(
      "Barreira DEV recusada. Confira alvo Neon direto, banco levi_dev, owner neondb_owner, TLS e confirmação explícita.",
    );
  }
}

export function devMigrationTarget(
  env: NodeJS.ProcessEnv,
  operation: "apply" | "status" = "apply",
): string {
  try {
    const raw = env.LEVI_DEV_DATABASE_URL;
    if (!raw) throw new Error();
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) ||
      url.hostname.split(".")[0]!.includes("-pooler") ||
      (url.port !== "" && url.port !== "5432") ||
      url.hash ||
      url.hostname !== env.LEVI_DEV_DATABASE_HOST ||
      database !== env.LEVI_DEV_DATABASE_NAME ||
      !/^levi_dev(?:_[a-z0-9_]+)?$/.test(database) ||
      decodeURIComponent(url.username) !== "levi_dev_migrator" ||
      !url.password ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      env.LEVI_DEV_MIGRATION_CONFIRMATION !==
        `${operation === "status" ? "CONSULTAR" : "APLICAR"}:${url.hostname}/${database}`
    )
      throw new Error();
    return raw;
  } catch {
    throw new Error(
      "Migração DEV recusada. Confira alvo Neon direto, banco levi_dev, role migrator, TLS e confirmação explícita.",
    );
  }
}
