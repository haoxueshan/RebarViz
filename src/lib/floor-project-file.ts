import {
  DEFAULT_FLOOR_BOTTOM_STATE,
  normalizeFloorBottomState,
  type FloorBottomState,
} from "./floor-bottom-calculator";
import {
  DEFAULT_FLOOR_PLAN_STATE,
  normalizeFloorPlanState,
  type FloorPlanState,
} from "./floor-plan";
import {
  buildFloorRebarRoleDomains,
  DEFAULT_FLOOR_REBAR_ROLE_STATE,
  normalizeFloorRebarRoleState,
  type FloorRebarRoleState,
} from "./floor-rebar-role";
import {
  DEFAULT_FLOOR_TOP_STATE,
  normalizeFloorTopState,
  type FloorTopState,
} from "./floor-top-calculator";
import {
  createFloorBottomStoredRecord,
  parseFloorBottomStoredRecord,
} from "./floor-bottom-storage";
import {
  createFloorDraftRecord,
  FLOOR_DRAFT_SCHEMA_VERSION,
  parseFloorDraftRecord,
} from "./floor-plan-storage";
import {
  createFloorRebarRoleStoredRecord,
  parseFloorRebarRoleStoredRecord,
} from "./floor-rebar-role-storage";
import {
  createFloorTopStoredRecord,
  parseFloorTopStoredRecord,
} from "./floor-top-storage";

export const FLOOR_PROJECT_FILE_FORMAT = "rebarviz-floor-layout";
export const FLOOR_PROJECT_FILE_SCHEMA_VERSION = 1 as const;

/** 工程元数据本地存储（不写入 FloorPlanState）。 */
export const FLOOR_PROJECT_META_KEY = "rebarviz:floor-rebar:project-meta:v1";
export const FLOOR_PROJECT_META_SCHEMA_VERSION = 1 as const;

export type FloorProjectMetaRecord = {
  schemaVersion: typeof FLOOR_PROJECT_META_SCHEMA_VERSION;
  projectName: string;
};

export const FLOOR_DEFAULT_PROJECT_NAME = "未命名楼板";

export type FloorProjectFile = {
  format: typeof FLOOR_PROJECT_FILE_FORMAT;
  schemaVersion: typeof FLOOR_PROJECT_FILE_SCHEMA_VERSION;
  meta: {
    projectName: string;
    exportedAt: string;
    app: "RebarViz";
  };
  data: {
    plan: ReturnType<typeof createFloorDraftRecord>;
    bottom: ReturnType<typeof createFloorBottomStoredRecord>;
    top: ReturnType<typeof createFloorTopStoredRecord>;
    role: ReturnType<typeof createFloorRebarRoleStoredRecord>;
  };
};

export type ParsedFloorProject = {
  projectName: string;
  planState: FloorPlanState;
  bottomState: FloorBottomState;
  topState: FloorTopState;
  roleState: FloorRebarRoleState;
  bottomRoleReviewRequired: boolean;
  topRoleReviewRequired: boolean;
  /** 旧版楼层草稿文件：仅恢复 Plan，其余使用默认值。 */
  legacy: boolean;
};

export type FloorProjectParseErrorCode =
  | "not-json"
  | "not-floor-file"
  | "unsupported-schema"
  | "missing-plan"
  | "corrupted";

export type FloorProjectParseResult =
  | { ok: true; project: ParsedFloorProject }
  | { ok: false; error: FloorProjectParseErrorCode };

export const FLOOR_PROJECT_PARSE_ERROR_MESSAGES: Record<FloorProjectParseErrorCode, string> = {
  "not-json": "无法读取文件：文件不是有效的 JSON。",
  "not-floor-file": "无法导入：不是有效的 RebarViz 楼板布局文件。",
  "unsupported-schema": "无法导入：楼板文件版本暂不支持。",
  "missing-plan": "无法导入：缺少楼板布局数据。",
  corrupted: "无法导入：文件数据不完整或已损坏。",
};

/** 工程文件大小上限（5MB）。 */
export const FLOOR_PROJECT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * UI V5+ 工程文件能力：真正的空白楼板（保留软件默认工程参数，但不含示例板区/洞口/支承）。
 */
export function createBlankFloorPlanState(): FloorPlanState {
  return {
    coordinateModel: DEFAULT_FLOOR_PLAN_STATE.coordinateModel,
    slabs: [],
    openings: [],
    supportRules: [],
    innerWallThickness: DEFAULT_FLOOR_PLAN_STATE.innerWallThickness,
    outerWallThickness: DEFAULT_FLOOR_PLAN_STATE.outerWallThickness,
    snapDistanceMm: DEFAULT_FLOOR_PLAN_STATE.snapDistanceMm,
    overlapToleranceMm: DEFAULT_FLOOR_PLAN_STATE.overlapToleranceMm,
  };
}

/** 导出前清理：删除已不存在板区/Domain 的历史引用（复用各模块 Normalizer）。 */
export function sanitizeFloorBottomState(state: FloorBottomState, slabIds: ReadonlySet<string>): FloorBottomState {
  return normalizeFloorBottomState(state, slabIds);
}

export function sanitizeFloorTopState(state: FloorTopState, slabIds: ReadonlySet<string>): FloorTopState {
  return normalizeFloorTopState(state, slabIds);
}

export function sanitizeFloorRoleState(state: FloorRebarRoleState, validKeys: ReadonlySet<string>): FloorRebarRoleState {
  return normalizeFloorRebarRoleState(state, validKeys);
}

export function createFloorProjectFile(input: {
  projectName: string;
  plan: FloorPlanState;
  bottom: FloorBottomState;
  top: FloorTopState;
  role: FloorRebarRoleState;
  bottomRoleReviewRequired: boolean;
  topRoleReviewRequired: boolean;
}): FloorProjectFile {
  const slabIds = new Set(input.plan.slabs.map((slab) => slab.id));
  const validRoleKeys = new Set(buildFloorRebarRoleDomains(input.plan).map((domain) => domain.id));
  const plan = createFloorDraftRecord(input.plan);
  const bottom = createFloorBottomStoredRecord(
    sanitizeFloorBottomState(input.bottom, slabIds),
    plan.savedAt,
    input.bottomRoleReviewRequired,
  );
  const top = createFloorTopStoredRecord(
    sanitizeFloorTopState(input.top, slabIds),
    plan.savedAt,
    input.topRoleReviewRequired,
  );
  const role = createFloorRebarRoleStoredRecord(sanitizeFloorRoleState(input.role, validRoleKeys), plan.savedAt);
  return {
    format: FLOOR_PROJECT_FILE_FORMAT,
    schemaVersion: FLOOR_PROJECT_FILE_SCHEMA_VERSION,
    meta: {
      projectName: input.projectName.trim() || FLOOR_DEFAULT_PROJECT_NAME,
      exportedAt: new Date().toISOString(),
      app: "RebarViz",
    },
    data: { plan, bottom, top, role },
  };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 标准工程文件 Plan 最低结构校验：必须是 FloorDraft V2 Record，
 * 且 state 具备 FloorPlanState 的三个数组字段与坐标模型（若存在）。
 * 标准工程文件禁止把损坏数据静默 Normalize 成默认布局。
 */
function isStrictFloorDraftPlanRecord(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  const candidate = value as { schemaVersion?: unknown; state?: unknown };
  // Plan V2 / V3 均受支持：V2 导入时由 parseFloorDraftRecord 走 Legacy Migration。
  if (candidate.schemaVersion !== 2 && candidate.schemaVersion !== FLOOR_DRAFT_SCHEMA_VERSION) return false;
  if (!isObjectLike(candidate.state)) return false;
  const state = candidate.state as { slabs?: unknown; openings?: unknown; supportRules?: unknown; coordinateModel?: unknown };
  if (!Array.isArray(state.slabs)) return false;
  if (!Array.isArray(state.openings)) return false;
  if (!Array.isArray(state.supportRules)) return false;
  if (state.coordinateModel !== undefined && state.coordinateModel !== "net-layout-v1" && state.coordinateModel !== "clear-space-physical-v2") return false;
  return true;
}

/**
 * 旧版“仅楼层草稿文件”识别（V1.4A.2.2 收紧）：
 * - FloorDraftRecord（schemaVersion 2/3 + 具备 Plan 形状的 state）：
 *   一律交给 parseFloorDraftRecord ——
 *   V3 → normalizeFloorPlanStateV3 + Materialize（保留 connections 与 V3 坐标模型），
 *   V2 → Legacy 归一化 + V2→V3 Migration；绝不再降级为 net-layout-v1。
 * - 裸 FloorPlanState：仅 coordinateModel==="net-layout-v1" + slabs + openings 三特征。
 * 普通 JSON（如 { slabs: [] } / { schemaVersion: 3, state: {} }）不误判为 Legacy。
 */
function parseLegacyPlan(value: unknown): ReturnType<typeof parseFloorDraftRecord> {
  if (!isObjectLike(value)) return null;
  const candidate = value as {
    schemaVersion?: unknown; savedAt?: unknown; state?: unknown;
    slabs?: unknown; openings?: unknown; coordinateModel?: unknown;
  };
  if (
    (candidate.schemaVersion === FLOOR_DRAFT_SCHEMA_VERSION || candidate.schemaVersion === 2) &&
    isObjectLike(candidate.state)
  ) {
    const state = candidate.state as Record<string, unknown>;
    const hasPlanShape = Array.isArray(state.slabs)
      || state.coordinateModel === "net-layout-v1"
      || state.coordinateModel === "clear-space-physical-v2";
    if (hasPlanShape) return parseFloorDraftRecord(value);
  }
  if (
    candidate.coordinateModel === "net-layout-v1" &&
    Array.isArray(candidate.slabs) &&
    Array.isArray(candidate.openings)
  ) {
    return {
      schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION,
      savedAt: new Date(0).toISOString(),
      state: normalizeFloorPlanState(value),
    };
  }
  return null;
}

export function parseFloorProjectFile(text: string): FloorProjectParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "not-json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "corrupted" };
  const candidate = parsed as { format?: unknown; schemaVersion?: unknown; meta?: unknown; data?: unknown; plan?: unknown; state?: unknown };

  // 标准工程文件路径。
  if (candidate.format !== undefined) {
    if (candidate.format !== FLOOR_PROJECT_FILE_FORMAT) return { ok: false, error: "not-floor-file" };
    // schemaVersion 严格：当前仅支持 V1，0/-1/0.5/"1"/2/99 一律拒绝。
    if (candidate.schemaVersion !== FLOOR_PROJECT_FILE_SCHEMA_VERSION) {
      return { ok: false, error: "unsupported-schema" };
    }
    if (!isObjectLike(candidate.data)) return { ok: false, error: "corrupted" };
    const data = candidate.data as { plan?: unknown; bottom?: unknown; top?: unknown; role?: unknown };
    if (data.plan === undefined || data.plan === null) return { ok: false, error: "missing-plan" };
    if (!isStrictFloorDraftPlanRecord(data.plan)) return { ok: false, error: "corrupted" };
    const planRecord = parseFloorDraftRecord(data.plan);
    if (!planRecord) return { ok: false, error: "missing-plan" };
    const slabIds = new Set(planRecord.state.slabs.map((slab) => slab.id));
    const validRoleKeys = new Set(buildFloorRebarRoleDomains(planRecord.state).map((domain) => domain.id));
    const bottomRecord = data.bottom !== undefined ? parseFloorBottomStoredRecord(data.bottom, slabIds) : null;
    const topRecord = data.top !== undefined ? parseFloorTopStoredRecord(data.top, slabIds) : null;
    const roleRecord = data.role !== undefined ? parseFloorRebarRoleStoredRecord(data.role, validRoleKeys) : null;
    if (!bottomRecord || !topRecord || !roleRecord) return { ok: false, error: "corrupted" };
    const meta = candidate.meta as { projectName?: unknown } | undefined;
    return {
      ok: true,
      project: {
        projectName: typeof meta?.projectName === "string" && meta.projectName.trim() ? meta.projectName.trim() : FLOOR_DEFAULT_PROJECT_NAME,
        planState: planRecord.state,
        bottomState: bottomRecord.state,
        topState: topRecord.state,
        roleState: roleRecord.state,
        bottomRoleReviewRequired: bottomRecord.roleReviewRequired,
        topRoleReviewRequired: topRecord.roleReviewRequired,
        legacy: false,
      },
    };
  }

  // 旧版“仅楼层草稿文件”fallback：只恢复 Plan，其余使用默认值。
  const legacyPlan = parseLegacyPlan(parsed);
  if (!legacyPlan) return { ok: false, error: "not-floor-file" };
  const slabIds = new Set(legacyPlan.state.slabs.map((slab) => slab.id));
  const validRoleKeys = new Set(buildFloorRebarRoleDomains(legacyPlan.state).map((domain) => domain.id));
  return {
    ok: true,
    project: {
      projectName: FLOOR_DEFAULT_PROJECT_NAME,
      planState: legacyPlan.state,
      bottomState: normalizeFloorBottomState(DEFAULT_FLOOR_BOTTOM_STATE, slabIds),
      topState: normalizeFloorTopState(DEFAULT_FLOOR_TOP_STATE, slabIds),
      roleState: normalizeFloorRebarRoleState(DEFAULT_FLOOR_REBAR_ROLE_STATE, validRoleKeys),
      bottomRoleReviewRequired: true,
      topRoleReviewRequired: true,
      legacy: true,
    },
  };
}

/** 导出文件名：RebarViz_{projectName}_{YYYY-MM-DD}.json（清理非法字符）。 */
export function floorProjectFileName(projectName: string, date = new Date()): string {
  const safeName = (projectName.trim() || FLOOR_DEFAULT_PROJECT_NAME).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `RebarViz_${safeName}_${yyyy}-${mm}-${dd}.json`;
}

export function serializeFloorProjectFile(project: FloorProjectFile): string {
  return JSON.stringify(project, null, 2);
}

export function createFloorProjectMetaRecord(projectName: string): FloorProjectMetaRecord {
  return { schemaVersion: FLOOR_PROJECT_META_SCHEMA_VERSION, projectName };
}

export function parseFloorProjectMetaRecord(value: unknown): FloorProjectMetaRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { schemaVersion?: unknown; projectName?: unknown };
  if (candidate.schemaVersion !== FLOOR_PROJECT_META_SCHEMA_VERSION || typeof candidate.projectName !== "string") return null;
  return { schemaVersion: FLOOR_PROJECT_META_SCHEMA_VERSION, projectName: candidate.projectName.trim() || FLOOR_DEFAULT_PROJECT_NAME };
}
