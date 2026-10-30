import type { FoundationSession } from "@t00ls-dev/auth";
import { asc, gt } from "drizzle-orm";
import type { Database } from "./auth.js";
import { withGlobalAdministrator } from "./admin-access.js";
import { churches } from "./data/schema.js";
import { requireUuid } from "./contracts.js";

export function administrativeDirectory(input: {
  database: Database;
  identity: FoundationSession | null;
  adminEmail?: string | undefined;
  after?: string;
}) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const after = input.after ? requireUuid(input.after).toLowerCase() : null;
      return tx
        .select({ id: churches.id, name: churches.name })
        .from(churches)
        .where(after ? gt(churches.id, after) : undefined)
        .orderBy(asc(churches.id))
        .limit(100);
    },
  );
}
