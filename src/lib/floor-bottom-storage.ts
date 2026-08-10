import {
  normalizeFloorBottomState,
  type FloorBottomState,
} from "./floor-bottom-calculator";

export const FLOOR_BOTTOM_STORAGE_KEY = "rebarviz:floor-rebar:bottom:v1";
export const FLOOR_BOTTOM_STORAGE_SCHEMA_VERSION = 2 as const;

export type FloorBottomStoredRecord = {
  schemaVersion: typeof FLOOR_BOTTOM_STORAGE_SCHEMA_VERSION;
  savedAt: string;
  state: FloorBottomState;
};

export function createFloorBottomStoredRecord(
  state: FloorBottomState,
  savedAt = new Date().toISOString(),
): FloorBottomStoredRecord {
  return {
    schemaVersion: FLOOR_BOTTOM_STORAGE_SCHEMA_VERSION,
    savedAt,
    state: structuredClone(state),
  };
}

export function parseFloorBottomStoredRecord(
  value: unknown,
  slabIds?: ReadonlySet<string>,
): FloorBottomStoredRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    schemaVersion?: unknown;
    savedAt?: unknown;
    state?: unknown;
  };
  if (![1, FLOOR_BOTTOM_STORAGE_SCHEMA_VERSION].includes(candidate.schemaVersion as number) || !candidate.state) return null;
  return {
    schemaVersion: FLOOR_BOTTOM_STORAGE_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString(),
    state: normalizeFloorBottomState(candidate.state, slabIds),
  };
}
