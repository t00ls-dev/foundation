import type { FoundationSession } from "@t00ls-dev/auth";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { withGlobalAdministrator } from "./admin-access.js";
import { appendAdministrativeAudit } from "./admin-audit.js";
import { RequestError, requireUuid } from "./contracts.js";
import { featureFlags, featureFlagChurches, churches } from "./data/schema.js";
import {
  knownFeature,
  invalidAdministrativeInput,
  readExpectedVersion,
  readFeaturePolicy,
} from "./feature-contracts.js";

type AdministratorInput = {
  database: Database;
  identity: FoundationSession | null;
  adminEmail?: string | undefined;
};

export async function listFeatureFlags(input: AdministratorInput) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const flags = await tx
        .select()
        .from(featureFlags)
        .orderBy(asc(featureFlags.key))
        .for("share");
      const churches = await tx.select().from(featureFlagChurches);
      return flags.map((flag) => ({
        ...flag,
        churchIds: churches
          .filter((row) => row.featureFlagId === flag.id)
          .map((row) => row.churchId)
          .sort(),
      }));
    },
  );
}

export async function updateFeatureFlag(
  input: AdministratorInput & {
    key: string;
    policy: unknown;
    expectedVersion: number;
    operationId: string;
  },
) {
  return withGlobalAdministrator(
    { ...input, mutation: true, recent: false },
    async (tx, actor) => {
      if (!knownFeature(input.key)) invalidAdministrativeInput();
      const key = input.key;
      const policy = readFeaturePolicy(input.policy);
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      const operationId = requireUuid(input.operationId).toLowerCase();
      const [previous] = await tx
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .for("update");
      if ((previous?.version ?? 0) !== expectedVersion)
        throw new RequestError(
          409,
          "VERSAO_DIVERGENTE",
          "A funcionalidade foi alterada. Consulte o estado atual.",
        );
      const selected: string[] =
        policy.kind === "selected" ? policy.churchIds : [];
      if (selected.length) {
        const found = await tx
          .select({ id: churches.id })
          .from(churches)
          .where(inArray(churches.id, selected));
        if (found.length !== selected.length) invalidAdministrativeInput();
      }
      const oldIds = previous
        ? (
            await tx
              .select({ id: featureFlagChurches.churchId })
              .from(featureFlagChurches)
              .where(eq(featureFlagChurches.featureFlagId, previous.id))
          )
            .map((row) => row.id)
            .sort()
        : [];
      if (
        previous?.policy === policy.kind &&
        JSON.stringify(oldIds) === JSON.stringify(selected)
      )
        return { ...previous, churchIds: oldIds };
      const values = {
        policy: policy.kind,
        version: expectedVersion + 1,
        updatedAt: new Date(),
        updatedBy: actor,
      };
      const [changed] = previous
        ? await tx
            .update(featureFlags)
            .set(values)
            .where(eq(featureFlags.id, previous.id))
            .returning()
        : await tx
            .insert(featureFlags)
            .values({ key, ...values })
            .returning();
      if (!changed) throw new Error("Política não confirmada.");
      await tx
        .delete(featureFlagChurches)
        .where(eq(featureFlagChurches.featureFlagId, changed.id));
      if (selected.length)
        await tx.insert(featureFlagChurches).values(
          selected.map((churchId) => ({
            featureFlagId: changed.id,
            churchId,
          })),
        );
      await appendAdministrativeAudit(tx, {
        actor,
        target: changed.id,
        operationId,
        churchId: null,
        action: `feature_flag.${policy.kind}`,
      });
      for (const id of oldIds.filter((id) => !selected.includes(id)))
        await appendAdministrativeAudit(tx, {
          actor,
          target: changed.id,
          operationId,
          churchId: id,
          action: "feature_flag.church_removed",
        });
      for (const id of selected.filter((id) => !oldIds.includes(id)))
        await appendAdministrativeAudit(tx, {
          actor,
          target: changed.id,
          operationId,
          churchId: id,
          action: "feature_flag.church_added",
        });
      return { ...changed, churchIds: selected };
    },
  );
}

/** Somente disponibilidade. O chamador ainda deve validar sessão, membership e recurso do tenant. */
export async function featureAvailable(input: {
  database: Database;
  key: string;
  churchId: string;
}): Promise<boolean> {
  if (!knownFeature(input.key)) return false;
  const churchId = requireUuid(input.churchId).toLowerCase();
  // Um único snapshot: política e seleção nunca vêm de versões diferentes.
  const [row] = await input.database.db
    .select({
      policy: featureFlags.policy,
      selected: sql<boolean>`EXISTS (
    SELECT 1 FROM feature_flag_churches
    WHERE feature_flag_id = ${featureFlags.id} AND church_id = ${churchId}::uuid
  )`,
    })
    .from(featureFlags)
    .innerJoin(churches, eq(churches.id, churchId))
    .where(eq(featureFlags.key, input.key));
  if (!row) return false;
  switch (row.policy) {
    case "all":
      return true;
    case "selected":
      return row.selected;
    case "disabled":
      return false;
    default: {
      const exhaustive: never = row.policy;
      throw new Error(`Política persistida inválida: ${typeof exhaustive}.`);
    }
  }
}
