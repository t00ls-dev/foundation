import { RequestError, requireUuid } from "./contracts.js";

export const featureKeys = ["members"] as const;
export type FeatureKey = (typeof featureKeys)[number];
export type FeaturePolicy =
  | { kind: "all" | "disabled" }
  | { kind: "selected"; churchIds: [string, ...string[]] };

export function knownFeature(value: string): value is FeatureKey {
  return featureKeys.some((key) => key === value);
}

export function invalidAdministrativeInput(): never {
  throw new RequestError(
    400,
    "ENTRADA_INVALIDA",
    "A configuração administrativa é inválida.",
  );
}

export function readExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) invalidAdministrativeInput();
  return value;
}

export function readFeaturePolicy(value: unknown): FeaturePolicy {
  if (!value || typeof value !== "object" || !("kind" in value))
    invalidAdministrativeInput();
  switch (value.kind) {
    case "all":
    case "disabled":
      if (Object.keys(value).some((key) => key !== "kind"))
        invalidAdministrativeInput();
      return { kind: value.kind };
    case "selected": {
      if (
        Object.keys(value).some(
          (key) => !["kind", "churchIds"].includes(key),
        ) ||
        !("churchIds" in value) ||
        !Array.isArray(value.churchIds) ||
        value.churchIds.length > 1000
      )
        invalidAdministrativeInput();
      const ids = value.churchIds
        .map((id: unknown) => {
          if (typeof id !== "string") invalidAdministrativeInput();
          return requireUuid(id).toLowerCase();
        })
        .sort();
      const [first, ...rest] = ids;
      if (!first || new Set(ids).size !== ids.length)
        invalidAdministrativeInput();
      return { kind: "selected", churchIds: [first, ...rest] };
    }
    default:
      return invalidAdministrativeInput();
  }
}
