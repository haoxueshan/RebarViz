import { normalizeFloorPlanState, normalizeFloorPlanStateV3, type FloorPlanState } from "./floor-plan";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";

export const FLOOR_DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
export const FLOOR_DRAFT_SCHEMA_VERSION = 3 as const;

export type FloorDraftRecord = {
  schemaVersion: typeof FLOOR_DRAFT_SCHEMA_VERSION;
  savedAt: string;
  state: FloorPlanState;
};

export function createFloorDraftRecord(state: FloorPlanState, savedAt = new Date().toISOString()): FloorDraftRecord {
  return { schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION, savedAt, state: structuredClone(state) };
}

/**
 * 解析 Floor Draft：
 * - V3：直接归一化（支持 net-layout-v1 与 clear-space-physical-v2）。
 * - V2：Legacy Migration（Plan V2 → V3，Exact Shared Edge + Wall Gap 推断），与 Project Import 共享同一函数。
 * - 更旧的裸 FloorPlanState：继续兼容（net-layout-v1）。
 */
export function parseFloorDraftRecord(value: unknown): FloorDraftRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; savedAt?: unknown; state?: unknown };
  const savedAt = typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString();
  if (candidate.schemaVersion === FLOOR_DRAFT_SCHEMA_VERSION && candidate.state && typeof candidate.state === "object") {
    return {
      schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
      savedAt,
      state: normalizeFloorPlanStateV3(candidate.state),
    };
  }
  if (candidate.schemaVersion === 2 && candidate.state && typeof candidate.state === "object") {
    const legacy = normalizeFloorPlanState(candidate.state);
    return {
      schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
      savedAt,
      state: migrateFloorPlanV2ToV3(legacy).plan,
    };
  }
  // 更旧的直接保存 FloorPlanState；原 key 继续复用并在下次保存时升级为 V3 wrapper。
  return {
    schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
    savedAt,
    state: normalizeFloorPlanState(value),
  };
}
