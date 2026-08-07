import { normalizeFloorPlanState, type FloorPlanState } from "./floor-plan";

export const FLOOR_DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
export const FLOOR_DRAFT_SCHEMA_VERSION = 2 as const;

export type FloorDraftRecord = {
  schemaVersion: typeof FLOOR_DRAFT_SCHEMA_VERSION;
  savedAt: string;
  state: FloorPlanState;
};

export function createFloorDraftRecord(state: FloorPlanState, savedAt = new Date().toISOString()): FloorDraftRecord {
  return { schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION, savedAt, state: structuredClone(state) };
}

export function parseFloorDraftRecord(value: unknown): FloorDraftRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; savedAt?: unknown; state?: unknown };
  if (candidate.schemaVersion === FLOOR_DRAFT_SCHEMA_VERSION && candidate.state && typeof candidate.state === "object") {
    return {
      schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
      savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString(),
      state: normalizeFloorPlanState(candidate.state),
    };
  }
  // V1直接保存FloorPlanState；原key继续复用并在下次保存时升级为V2 wrapper。
  return {
    schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
    savedAt: new Date(0).toISOString(),
    state: normalizeFloorPlanState(value),
  };
}
