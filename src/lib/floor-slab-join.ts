import {
  buildFloorSlabAdjacency,
  FLOOR_GEOMETRY_EPSILON_MM,
  floorSlabsOverlap,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";

/**
 * Floor Smart Join V1.3.2：板边磁吸连接（Interaction Join Capture）。
 *
 * 三层精度概念（严禁混淆）：
 * - Formal Geometry EPSILON ≈ 1e-7mm：正式拓扑判断（shared-slab 必须精确共边），禁止扩大。
 * - Geometry Repair Tolerance ≈ overlapToleranceMm（默认10mm）：输入/浮点误差修复层。
 * - Interaction Join Capture ≈ plan.snapDistanceMm（默认150mm）：识别“用户正在尝试连接”，
 *   松手后把 Net Geometry 修正成精确 Gap=0，再交给正式 EPSILON 拓扑。
 *
 * 本模块为纯函数层：无 React / DOM / localStorage / 副作用。
 */

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

/** Smart Join UX 最小共享边长度：只接触1mm不能成为操作候选（正式拓扑不受此限制）。 */
export const MIN_JOIN_SHARED_LENGTH_MM = 50;
/** 交互捕捉距离非法时的 fallback。 */
export const JOIN_CAPTURE_DISTANCE_FALLBACK_MM = 150;
/** 候选锁定后的释放距离系数（Hysteresis）：进入150mm后可保持到180mm。 */
export const JOIN_RELEASE_DISTANCE_FACTOR = 1.2;

export type FloorSlabJoinSide = "west" | "east" | "south" | "north";
export type FloorSlabJoinAlignment = "preserve" | "start" | "center" | "end";

export type FloorSlabJoinCandidate = {
  sourceSlabId: string;
  targetSlabId: string;
  sourceSide: FloorSlabJoinSide;
  targetSide: FloorSlabJoinSide;
  orientation: "vertical" | "horizontal";
  /** 当前边距（捕捉前）。 */
  distanceMm: number;
  projectedSharedStartMm: number;
  projectedSharedEndMm: number;
  projectedSharedLengthMm: number;
  /** 精确 Net 目标坐标（target.x + target.width 直接计算，无浮点误差）。 */
  targetX: number;
  targetY: number;
  moveXmm: number;
  moveYmm: number;
  moveDistanceMm: number;
  alignment: FloorSlabJoinAlignment;
  confidence: "high" | "medium" | "low";
  predictedSupport: "inner-wall" | "continuous";
  predictedWallThicknessMm: number;
  score: number;
};

export type FloorSlabJoinValidation = {
  valid: boolean;
  sharedLengthMm: number;
  support: "inner-wall" | "continuous" | null;
  reason:
    | null
    | "no-shared-edge"
    | "third-party-overlap"
    | "source-target-overlap"
    | "too-short"
    | "topology-conflict";
};

const oppositeSide: Record<FloorSlabJoinSide, FloorSlabJoinSide> = {
  west: "east",
  east: "west",
  south: "north",
  north: "south",
};

function slabEdgeCoordinate(slab: FloorSlab, side: FloorSlabJoinSide): number {
  if (side === "west") return slab.x;
  if (side === "east") return slab.x + slab.width;
  if (side === "south") return slab.y;
  return slab.y + slab.height;
}

function isVerticalJoin(sourceSide: FloorSlabJoinSide): boolean {
  return sourceSide === "west" || sourceSide === "east";
}

function capturedDistance(plan: FloorPlanState): number {
  const value = plan.snapDistanceMm;
  return Number.isFinite(value) && value > 0 ? value : JOIN_CAPTURE_DISTANCE_FALLBACK_MM;
}

/** 构造精确 Net 目标坐标：直接由 target 坐标加减尺寸计算，禁止任何近似值。 */
function exactJoinPosition(
  source: FloorSlab,
  target: FloorSlab,
  sourceSide: FloorSlabJoinSide,
  alignment: FloorSlabJoinAlignment,
): { x: number; y: number } {
  // sourceSide 是 Source 与 Target 相接的那条边：
  // west（源西边贴目标东边，源在目标东侧）→ x = target.x + target.width
  // east（源东边贴目标西边，源在目标西侧）→ x = target.x - source.width
  if (sourceSide === "west") {
    const x = target.x + target.width;
    return { x, y: alignedCrossAxis(source.y, source.height, target.y, target.height, alignment) };
  }
  if (sourceSide === "east") {
    const x = target.x - source.width;
    return { x, y: alignedCrossAxis(source.y, source.height, target.y, target.height, alignment) };
  }
  // south（源南边贴目标北边，源在目标北侧）→ y = target.y + target.height
  if (sourceSide === "south") {
    const y = target.y + target.height;
    return { x: alignedCrossAxis(source.x, source.width, target.x, target.width, alignment), y };
  }
  const y = target.y - source.height;
  return { x: alignedCrossAxis(source.x, source.width, target.x, target.width, alignment), y };
}

function alignedCrossAxis(
  sourceStart: number,
  sourceSize: number,
  targetStart: number,
  targetSize: number,
  alignment: FloorSlabJoinAlignment,
): number {
  if (alignment === "start") return targetStart;
  if (alignment === "center") return targetStart + (targetSize - sourceSize) / 2;
  if (alignment === "end") return targetStart + targetSize - sourceSize;
  return sourceStart;
}

/** 候选构造：几何无效（零/负共享投影）返回 null。 */
function buildJoinCandidate(
  plan: FloorPlanState,
  source: FloorSlab,
  target: FloorSlab,
  sourceSide: FloorSlabJoinSide,
  alignment: FloorSlabJoinAlignment,
  captureMm: number,
): FloorSlabJoinCandidate | null {
  const targetSide = oppositeSide[sourceSide];
  const vertical = isVerticalJoin(sourceSide);
  const sourceEdge = slabEdgeCoordinate(source, sourceSide);
  const targetEdge = slabEdgeCoordinate(target, targetSide);
  const distanceMm = Math.abs(sourceEdge - targetEdge);
  if (distanceMm > captureMm) return null;
  const { x, y } = exactJoinPosition(source, target, sourceSide, alignment);
  // 非 preserve 对齐的跨轴移动量限制在捕捉距离内：避免 corner touch / 远距离自动吸。
  if (alignment !== "preserve") {
    const crossAxisMove = Math.abs(vertical ? y - source.y : x - source.x);
    if (crossAxisMove > captureMm) return null;
  }
  // 共享投影（另一轴）。
  const sourceStart = vertical ? y : x;
  const sourceEnd = sourceStart + (vertical ? source.height : source.width);
  const targetStart = vertical ? target.y : target.x;
  const targetEnd = targetStart + (vertical ? target.height : target.width);
  const sharedStart = Math.max(sourceStart, targetStart);
  const sharedEnd = Math.min(sourceEnd, targetEnd);
  const sharedLength = sharedEnd - sharedStart;
  if (sharedLength <= EPSILON) return null;
  if (sharedLength < MIN_JOIN_SHARED_LENGTH_MM) return null;
  // 第三方粗冲突与 source-target 面积重叠。
  const preview: FloorSlab = { ...source, x, y };
  for (const other of plan.slabs) {
    if (other.id === source.id || other.id === target.id) continue;
    if (floorSlabsOverlap(preview, other)) return null;
  }
  if (floorSlabsOverlap(preview, target)) return null;
  // 预测支承：共享边上已有明确规则时尊重规则，否则默认 inner-wall。
  const pairHasContinuous = plan.supportRules.some((rule) =>
    rule.support === "continuous" && (
      (rule.target.kind === "slab-edge" && rule.target.slabId === source.id)
      || (rule.target.kind === "slab-edge" && rule.target.slabId === target.id)
    ));
  const predictedSupport = pairHasContinuous ? "continuous" : "inner-wall";
  const predictedWallThicknessMm = predictedSupport === "inner-wall" ? Math.max(plan.innerWallThickness, 0) : 0;
  const moveXmm = x - source.x;
  const moveYmm = y - source.y;
  const moveDistanceMm = Math.max(Math.abs(moveXmm), Math.abs(moveYmm));
  const captureShare = distanceMm / captureMm;
  const lengthShare = Math.min(sharedLength / Math.min(
    vertical ? Math.min(source.height, target.height) : Math.min(source.width, target.width),
  ), 1);
  const confidence: FloorSlabJoinCandidate["confidence"] =
    captureShare <= 0.5 && lengthShare >= 0.5 ? "high"
      : captureShare > 0.9 || lengthShare < 0.2 ? "low"
        : "medium";
  return {
    sourceSlabId: source.id,
    targetSlabId: target.id,
    sourceSide,
    targetSide,
    orientation: vertical ? "vertical" : "horizontal",
    distanceMm,
    projectedSharedStartMm: sharedStart,
    projectedSharedEndMm: sharedEnd,
    projectedSharedLengthMm: sharedLength,
    targetX: x,
    targetY: y,
    moveXmm,
    moveYmm,
    moveDistanceMm,
    alignment,
    confidence,
    predictedSupport,
    predictedWallThicknessMm,
    score: 0,
  };
}

/** Deterministic 排序：移动距离小 → 共享长度大 → alignment 优先级（preserve>center>start/end）。 */
const alignmentPriority: Record<FloorSlabJoinAlignment, number> = {
  preserve: 0,
  center: 1,
  start: 2,
  end: 2,
};

export function compareFloorSlabJoinCandidates(
  left: FloorSlabJoinCandidate,
  right: FloorSlabJoinCandidate,
): number {
  if (left.moveDistanceMm !== right.moveDistanceMm) return left.moveDistanceMm - right.moveDistanceMm;
  if (left.projectedSharedLengthMm !== right.projectedSharedLengthMm) {
    return right.projectedSharedLengthMm - left.projectedSharedLengthMm;
  }
  const alignmentDelta = alignmentPriority[left.alignment] - alignmentPriority[right.alignment];
  if (alignmentDelta !== 0) return alignmentDelta;
  return `${left.sourceSide}:${left.targetSlabId}`.localeCompare(`${right.sourceSide}:${right.targetSlabId}`);
}

/**
 * 正式验证：构造 Preview Plan 后要求 Source/Target 真正产生 shared-slab 且 sharedLength > 0，
 * 无第三方冲突、无 source-target 面积重叠、支承可解析。这是所有连接路径的 Single Source of Truth。
 */
export function validateFloorJoinCandidate(
  plan: FloorPlanState,
  candidate: FloorSlabJoinCandidate,
): FloorSlabJoinValidation {
  const source = plan.slabs.find((slab) => slab.id === candidate.sourceSlabId);
  const target = plan.slabs.find((slab) => slab.id === candidate.targetSlabId);
  if (!source || !target) return { valid: false, sharedLengthMm: 0, support: null, reason: "no-shared-edge" };
  const preview: FloorSlab = { ...source, x: candidate.targetX, y: candidate.targetY };
  for (const other of plan.slabs) {
    if (other.id === source.id || other.id === target.id) continue;
    if (floorSlabsOverlap(preview, other)) {
      return { valid: false, sharedLengthMm: 0, support: null, reason: "third-party-overlap" };
    }
  }
  if (floorSlabsOverlap(preview, target)) {
    return { valid: false, sharedLengthMm: 0, support: null, reason: "source-target-overlap" };
  }
  const previewPlan: FloorPlanState = {
    ...plan,
    slabs: plan.slabs.map((slab) => slab.id === source.id ? preview : slab),
  };
  const adjacency = buildFloorSlabAdjacency(previewPlan).find(
    (item) => item.slabIds.includes(candidate.sourceSlabId) && item.slabIds.includes(candidate.targetSlabId),
  );
  if (!adjacency || adjacency.sharedLengthMm <= EPSILON) {
    return { valid: false, sharedLengthMm: 0, support: null, reason: "no-shared-edge" };
  }
  const support = adjacency.supports.includes("inner-wall")
    ? "inner-wall"
    : adjacency.supports.includes("continuous")
      ? "continuous"
      : null;
  if (!support) return { valid: false, sharedLengthMm: adjacency.sharedLengthMm, support: null, reason: "topology-conflict" };
  if (adjacency.sharedLengthMm < MIN_JOIN_SHARED_LENGTH_MM) {
    return { valid: false, sharedLengthMm: adjacency.sharedLengthMm, support, reason: "too-short" };
  }
  return { valid: true, sharedLengthMm: adjacency.sharedLengthMm, support, reason: null };
}

/**
 * 搜索 Source Slab 的 Smart Join 候选（两阶段：快速几何筛选 → Top N 正式拓扑验证）。
 * captureDistanceMm 默认取 plan.snapDistanceMm（交互捕捉距离）。
 */
export function findFloorSlabJoinCandidates(
  plan: FloorPlanState,
  sourceSlabId: string,
  options?: {
    captureDistanceMm?: number;
  },
): FloorSlabJoinCandidate[] {
  const source = plan.slabs.find((slab) => slab.id === sourceSlabId);
  if (!source) return [];
  const captureMm = options?.captureDistanceMm && Number.isFinite(options.captureDistanceMm) && options.captureDistanceMm > 0
    ? options.captureDistanceMm
    : capturedDistance(plan);
  const sides: FloorSlabJoinSide[] = ["west", "east", "south", "north"];
  const alignments: FloorSlabJoinAlignment[] = ["preserve", "start", "center", "end"];
  const raw: FloorSlabJoinCandidate[] = [];
  for (const target of plan.slabs) {
    if (target.id === source.id) continue;
    for (const sourceSide of sides) {
      for (const alignment of alignments) {
        const candidate = buildJoinCandidate(plan, source, target, sourceSide, alignment, captureMm);
        if (candidate) raw.push(candidate);
      }
    }
  }
  raw.sort(compareFloorSlabJoinCandidates);
  // Phase B：只对前几名做正式拓扑验证（避免 PointerMove 全量重建）。
  const validated: FloorSlabJoinCandidate[] = [];
  for (const candidate of raw.slice(0, 5)) {
    const result = validateFloorJoinCandidate(plan, candidate);
    if (!result.valid) continue;
    validated.push({ ...candidate, score: result.sharedLengthMm - candidate.moveDistanceMm });
  }
  validated.sort(compareFloorSlabJoinCandidates);
  return validated;
}

/** 候选身份（用于锁定比较）。 */
function joinIdentity(candidate: FloorSlabJoinCandidate): string {
  return `${candidate.sourceSlabId}|${candidate.targetSlabId}|${candidate.sourceSide}|${candidate.alignment}`;
}

/** Join Guide 的净坐标线位置：共享墙所在的 Target 侧边（精确 Net 坐标）。 */
export function floorSlabJoinGuideCoordinate(
  plan: FloorPlanState,
  candidate: FloorSlabJoinCandidate,
): { axis: "x" | "y"; coordinate: number } {
  const target = plan.slabs.find((slab) => slab.id === candidate.targetSlabId);
  const side = target ? candidate.targetSide : oppositeSide[candidate.sourceSide];
  if (side === "west") return { axis: "x", coordinate: target?.x ?? 0 };
  if (side === "east") return { axis: "x", coordinate: (target?.x ?? 0) + (target?.width ?? 0) };
  if (side === "south") return { axis: "y", coordinate: target?.y ?? 0 };
  return { axis: "y", coordinate: (target?.y ?? 0) + (target?.height ?? 0) };
}

/** 明显更优：距离小很多且共享长度明显更长。 */
function isSignificantlyBetterJoinCandidate(
  best: FloorSlabJoinCandidate,
  preferred: FloorSlabJoinCandidate,
): boolean {
  return best.distanceMm + 20 <= preferred.distanceMm
    && best.projectedSharedLengthMm >= preferred.projectedSharedLengthMm + 200;
}

/**
 * Hysteresis 候选选择：锁定候选可保持到 releaseDistanceMm（默认 capture × 1.2），
 * 避免 A东墙 ↔ C北墙 来回闪；只有明显更优的新候选才切换。
 */
export function selectFloorSlabJoinCandidate(
  candidates: readonly FloorSlabJoinCandidate[],
  preferred: FloorSlabJoinCandidate | null,
  releaseDistanceMm: number,
): FloorSlabJoinCandidate | null {
  const sorted = [...candidates].sort(compareFloorSlabJoinCandidates);
  if (sorted.length === 0) return null;
  if (preferred) {
    const kept = sorted.find((candidate) => joinIdentity(candidate) === joinIdentity(preferred));
    if (kept && kept.distanceMm <= releaseDistanceMm) {
      const best = sorted[0];
      if (best && joinIdentity(best) !== joinIdentity(preferred) && isSignificantlyBetterJoinCandidate(best, kept)) {
        return best;
      }
      return kept;
    }
  }
  return sorted[0];
}

/**
 * 精确应用 Join：验证通过后把 Source 移到精确 Net 坐标。
 * 只产生一个 Geometry Mutation（调用方负责 History 一步）。
 */
export function applyFloorSlabJoin(
  plan: FloorPlanState,
  candidate: FloorSlabJoinCandidate,
): FloorPlanState {
  const result = validateFloorJoinCandidate(plan, candidate);
  if (!result.valid) return plan;
  return {
    ...plan,
    slabs: plan.slabs.map((slab) => slab.id === candidate.sourceSlabId
      ? { ...slab, x: candidate.targetX, y: candidate.targetY }
      : slab),
  };
}

/**
 * 扫描整个项目：尚未正式 shared-slab、但距离 <= capture 且存在有效共享投影的板对。
 * 仅诊断/提示，绝不自动修改坐标（必须用户明确操作才提交）。
 */
export function findFloorUnresolvedJoinCandidates(plan: FloorPlanState): FloorSlabJoinCandidate[] {
  const captureMm = capturedDistance(plan);
  const results: FloorSlabJoinCandidate[] = [];
  const seen = new Set<string>();
  for (const source of plan.slabs) {
    for (const candidate of findFloorSlabJoinCandidates(plan, source.id, { captureDistanceMm: captureMm })) {
      const key = joinIdentity(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(candidate);
    }
  }
  return results.sort(compareFloorSlabJoinCandidates);
}

/** Preview 文案：平板上显示“释放以连接 · 板6 ↔ 板7 · 内墙240mm”。 */
export function floorSlabJoinPreviewLabel(
  plan: FloorPlanState,
  candidate: FloorSlabJoinCandidate,
): string {
  const source = plan.slabs.find((slab) => slab.id === candidate.sourceSlabId);
  const target = plan.slabs.find((slab) => slab.id === candidate.targetSlabId);
  const supportText = candidate.predictedSupport === "inner-wall"
    ? `内墙${candidate.predictedWallThicknessMm}mm`
    : "连续楼板0mm";
  return `释放以连接 · ${source?.name ?? candidate.sourceSlabId} ↔ ${target?.name ?? candidate.targetSlabId} · ${supportText} · 共享${(candidate.projectedSharedLengthMm / 1000).toFixed(2)}m`;
}
