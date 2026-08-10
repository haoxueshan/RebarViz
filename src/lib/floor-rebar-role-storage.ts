import {
  normalizeFloorRebarRoleState,
  type FloorRebarRoleState,
} from "./floor-rebar-role";

export const FLOOR_REBAR_ROLE_STORAGE_KEY = "rebarviz:floor-rebar:role:v1";
export const FLOOR_REBAR_ROLE_STORAGE_SCHEMA_VERSION = 1 as const;

export type FloorRebarRoleStoredRecord = {
  schemaVersion: typeof FLOOR_REBAR_ROLE_STORAGE_SCHEMA_VERSION;
  savedAt: string;
  state: FloorRebarRoleState;
};

export function createFloorRebarRoleStoredRecord(
  state: FloorRebarRoleState,
  savedAt = new Date().toISOString(),
): FloorRebarRoleStoredRecord {
  return {
    schemaVersion: FLOOR_REBAR_ROLE_STORAGE_SCHEMA_VERSION,
    savedAt,
    state: structuredClone(state),
  };
}

export function parseFloorRebarRoleStoredRecord(
  value: unknown,
  validKeys?: ReadonlySet<string>,
): FloorRebarRoleStoredRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; savedAt?: unknown; state?: unknown };
  if (candidate.schemaVersion !== FLOOR_REBAR_ROLE_STORAGE_SCHEMA_VERSION || !candidate.state) return null;
  return {
    schemaVersion: FLOOR_REBAR_ROLE_STORAGE_SCHEMA_VERSION,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString(),
    state: normalizeFloorRebarRoleState(candidate.state, validKeys),
  };
}
