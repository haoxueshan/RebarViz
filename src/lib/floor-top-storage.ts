import {
  normalizeFloorTopState,
  type FloorTopState,
} from "./floor-top-calculator";

export const FLOOR_TOP_STORAGE_KEY = "rebarviz:floor-rebar:top:v1";
export const FLOOR_TOP_STORAGE_SCHEMA_VERSION = 4 as const;

export type FloorTopStoredRecord = {
  schemaVersion: typeof FLOOR_TOP_STORAGE_SCHEMA_VERSION;
  savedAt: string;
  state: FloorTopState;
  roleReviewRequired: boolean;
};

export function createFloorTopStoredRecord(
  state: FloorTopState,
  savedAt = new Date().toISOString(),
  roleReviewRequired = false,
): FloorTopStoredRecord {
  return {
    schemaVersion: FLOOR_TOP_STORAGE_SCHEMA_VERSION,
    savedAt,
    state: structuredClone(state),
    roleReviewRequired,
  };
}

export function parseFloorTopStoredRecord(
  value: unknown,
  slabIds?: ReadonlySet<string>,
): FloorTopStoredRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    schemaVersion?: unknown;
    savedAt?: unknown;
    state?: unknown;
    roleReviewRequired?: unknown;
  };
  if (![1, 2, 3, FLOOR_TOP_STORAGE_SCHEMA_VERSION].includes(candidate.schemaVersion as number) || !candidate.state) {
    return null;
  }
  const preservesReviewState = candidate.schemaVersion === 3 ||
    candidate.schemaVersion === FLOOR_TOP_STORAGE_SCHEMA_VERSION;
  return {
    schemaVersion: FLOOR_TOP_STORAGE_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string"
      ? candidate.savedAt
      : new Date(0).toISOString(),
    state: normalizeFloorTopState(candidate.state, slabIds),
    roleReviewRequired: preservesReviewState
      ? candidate.roleReviewRequired === true
      : true,
  };
}
