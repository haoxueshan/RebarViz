import {
  normalizeFloorTopState,
  type FloorTopState,
} from "./floor-top-calculator";

export const FLOOR_TOP_STORAGE_KEY = "rebarviz:floor-rebar:top:v1";
export const FLOOR_TOP_STORAGE_SCHEMA_VERSION = 1 as const;

export type FloorTopStoredRecord = {
  schemaVersion: typeof FLOOR_TOP_STORAGE_SCHEMA_VERSION;
  savedAt: string;
  state: FloorTopState;
};

export function createFloorTopStoredRecord(
  state: FloorTopState,
  savedAt = new Date().toISOString(),
): FloorTopStoredRecord {
  return {
    schemaVersion: FLOOR_TOP_STORAGE_SCHEMA_VERSION,
    savedAt,
    state: structuredClone(state),
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
  };
  if (candidate.schemaVersion !== FLOOR_TOP_STORAGE_SCHEMA_VERSION || !candidate.state) {
    return null;
  }
  return {
    schemaVersion: FLOOR_TOP_STORAGE_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string"
      ? candidate.savedAt
      : new Date(0).toISOString(),
    state: normalizeFloorTopState(candidate.state, slabIds),
  };
}
