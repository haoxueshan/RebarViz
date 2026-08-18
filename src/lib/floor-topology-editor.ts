import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorEdgeSide,
  type FloorOpening,
  type FloorPlanIssue,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import type { FloorEdgeConnection } from "./floor-topology";
import {
  solveFloorTopology,
  type FloorTopologyConstraintIssue,
  type FloorTopologySolution,
  type FloorTopologySolveOptions,
} from "./floor-topology-solver";
import { rewriteFloorSupportRulesForConnectionSupport } from "./floor-topology-support";
import { buildFloorPhysicalLayout, type FloorPhysicalLayout } from "./floor-physical-layout";

/**
 * Floor Topology V1.4A.2.1 Editor Consistency Hardening（纯函数，无 React / DOM / 副作用）。
 *
 * V3 坐标唯一语义：
 *   coordinateModel === "clear-space-physical-v2" 时，slab.x / slab.y 就是该房间净空矩形
 *   在建筑 Physical Plane 中的真实位置。
 *   Canonical Position = Editor Position = Canvas Position = Solved Physical Position。
 *
 * 关键规则：
 * - 任何会改变物理拓扑的操作（Move / Resize / Detach / 墙厚 / 内墙↔连续）都经过：
 *   Mutation → Solve → Validate → Materialize → Opening Follow → Canonical State（一个 History 事务）。
 * - Opening 不持久化 hostSlabId：使用 Derived Host Mapping（完整包含 + 确定性 tie-break）。
 * - Connected Slab 拖动：Connection 是硬约束；拖离墙 → 删除被破坏的 Connection（不修改 Solver 规则）。
 * - 编辑器 Detach 容差只决定“是否 Detach”，不修改正式墙 Gap（保留 Connection 时 Solver 会把 Jitter 拉回正式 Gap）。
 */
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
export const FLOOR_NEW_SLAB_GAP_MM = 500;
/** 编辑器级 Detach 容差（mm）：轻微手抖不拆墙；正式 Geometry EPSILON 保持不动。 */
export const FLOOR_EDITOR_DETACH_TOLERANCE_MM = 30;

function isV3(plan: FloorPlanState): boolean {
  return plan.coordinateModel === "clear-space-physical-v2";
}

function sideFace(rect: { x: number; y: number; width: number; height: number }, side: FloorEdgeSide): number {
  if (side === "west") return rect.x;
  if (side === "east") return rect.x + rect.width;
  if (side === "south") return rect.y;
  return rect.y + rect.height;
}

function tangentialOverlap(
  vertical: boolean,
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  if (vertical) {
    return Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  }
  return Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
}

export function floorConnectionsForSlab(plan: FloorPlanState, slabId: string): FloorEdgeConnection[] {
  return (plan.connections ?? []).filter((connection) =>
    connection.a.slabId === slabId || connection.b.slabId === slabId);
}

/** 矩形完整包含判定。 */
function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return inner.x >= outer.x - EPSILON
    && inner.y >= outer.y - EPSILON
    && inner.x + inner.width <= outer.x + outer.width + EPSILON
    && inner.y + inner.height <= outer.y + outer.height + EPSILON;
}

function openingInsideSlab(opening: FloorOpening, slab: FloorSlab): boolean {
  return rectContains(slab, opening);
}

export type FloorOpeningHostResolution =
  | { status: "confirmed"; slabId: string; localX: number; localY: number }
  | { status: "ambiguous"; slabIds: string[] }
  | { status: "unhosted" };

/**
 * Opening Host（Derived，不持久化）：
 * - 完整位于唯一 Slab Clear Rect 内 → confirmed；
 * - 多个 Slab 完整包含 → ambiguous（不猜，不移动）；
 * - 无完整包含 → unhosted（保持原坐标，交给 opening-uncovered / partial-outside Validation）。
 * 确定性 tie-break：按 slab.id 排序。
 */
export function resolveFloorOpeningHost(plan: FloorPlanState, opening: FloorOpening): FloorOpeningHostResolution {
  const hosts = plan.slabs
    .filter((slab) => openingInsideSlab(opening, slab))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (hosts.length === 0) return { status: "unhosted" };
  if (hosts.length > 1) return { status: "ambiguous", slabIds: hosts.map((slab) => slab.id) };
  const host = hosts[0];
  return { status: "confirmed", slabId: host.id, localX: opening.x - host.x, localY: opening.y - host.y };
}

/**
 * Opening 传播：Before Plan 确定 Host + Local Offset（禁止在 After 重新猜 Host），
 * After 找到 Host 新位置，写 Opening 新位置；width/height 不变。
 * 任何 Slab 平移（Materialize / Move / Resize / 墙厚 / Support 切换）都复用本函数。
 */
export function propagateFloorOpeningsBySlabMotion(
  beforePlan: FloorPlanState,
  afterPlan: FloorPlanState,
): { openings: FloorOpening[]; ambiguous: string[] } {
  const afterById = new Map(afterPlan.slabs.map((slab) => [slab.id, slab]));
  const ambiguous: string[] = [];
  const openings = beforePlan.openings.map((opening) => {
    const host = resolveFloorOpeningHost(beforePlan, opening);
    if (host.status !== "confirmed") {
      if (host.status === "ambiguous") ambiguous.push(opening.id);
      return opening;
    }
    const afterHost = afterById.get(host.slabId);
    if (!afterHost) return opening;
    return { ...opening, x: afterHost.x + host.localX, y: afterHost.y + host.localY };
  });
  return { openings, ambiguous };
}

/**
 * 统一 Mutation Finalize：Solve → Validate → Materialize → Opening Follow。
 * Low Level；禁止与 materializeFloorTopologyPositions 相互递归。
 * options（可选）：透传给 Solver（Editor Move 用 preferredAnchors 固定稳定 Anchor）。
 */
export function finalizeFloorTopologyMutation(
  beforePlan: FloorPlanState,
  mutatedPlan: FloorPlanState,
  options?: FloorTopologySolveOptions,
): { ok: true; plan: FloorPlanState } | { ok: false; code: "mutation-blocked-by-topology"; message: string; issues: FloorTopologyConstraintIssue[] } {
  const solution = solveFloorTopology(mutatedPlan, options);
  const blocking = solution.issues.find((issue) => issue.level === "error");
  if (blocking) {
    return {
      ok: false,
      code: "mutation-blocked-by-topology",
      message: blocking.message,
      issues: solution.issues.filter((issue) => issue.level === "error"),
    };
  }
  const solved = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  const slabPlan: FloorPlanState = {
    ...mutatedPlan,
    slabs: mutatedPlan.slabs.map((slab) => {
      const solvedSlab = solved.get(slab.id);
      if (!solvedSlab) return slab;
      return { ...slab, x: solvedSlab.x, y: solvedSlab.y };
    }),
  };
  const { openings } = propagateFloorOpeningsBySlabMotion(beforePlan, slabPlan);
  return { ok: true, plan: { ...slabPlan, openings } };
}

/**
 * Materialize：V3 Plan → solve →（无 Blocking Issue）→ Solved x/y 写回 slab.x/y；
 * Hosted Openings 随 Host Slab 平移（保持 Local Offset，width/height 不变）。
 * 幂等；不修改 width/height/id/name/connections/supportRules；不保存任何 Derived 数据。
 */
export function materializeFloorTopologyPositions(plan: FloorPlanState): FloorPlanState {
  if (!isV3(plan)) return plan;
  const before = plan;
  const solution = solveFloorTopology(plan);
  if (solution.issues.some((issue) => issue.level === "error")) return plan;
  const solved = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  let slabChanged = false;
  for (const slab of plan.slabs) {
    const solvedSlab = solved.get(slab.id);
    if (!solvedSlab) continue;
    if (Math.abs(solvedSlab.x - slab.x) > EPSILON || Math.abs(solvedSlab.y - slab.y) > EPSILON) {
      slabChanged = true;
      break;
    }
  }
  if (!slabChanged) return plan;
  const slabPlan: FloorPlanState = {
    ...plan,
    slabs: plan.slabs.map((slab) => {
      const solvedSlab = solved.get(slab.id);
      if (!solvedSlab) return slab;
      return { ...slab, x: solvedSlab.x, y: solvedSlab.y };
    }),
  };
  const { openings } = propagateFloorOpeningsBySlabMotion(before, slabPlan);
  return { ...slabPlan, openings };
}

/**
 * Canonical Consistency Validator（只报告，不偷偷修数据）：
 * V3 逐 Slab 比较 plan.x/y vs solve.x/y，差异 > EPSILON → topology-v3-not-materialized。
 */
export function validateFloorTopologyMaterialized(
  plan: FloorPlanState,
  precomputedSolution?: FloorTopologySolution,
): FloorPlanIssue[] {
  if (!isV3(plan)) return [];
  const solution = precomputedSolution ?? solveFloorTopology(plan);
  const solved = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  const issues: FloorPlanIssue[] = [];
  plan.slabs.forEach((slab) => {
    const solvedSlab = solved.get(slab.id);
    if (!solvedSlab) return;
    if (Math.abs(solvedSlab.x - slab.x) > EPSILON || Math.abs(solvedSlab.y - slab.y) > EPSILON) {
      issues.push({
        level: "error",
        code: "topology-v3-not-materialized",
        message: `板区 ${slab.name} 的编辑坐标与求解坐标不一致（编辑 (${slab.x}, ${slab.y})，求解 (${solvedSlab.x}, ${solvedSlab.y})）。请通过正式编辑事务修改拓扑。`,
        objectIds: [slab.id],
      });
    }
  });
  return issues;
}

export type FloorEditorGeometry = {
  solution: FloorTopologySolution;
  physical: FloorPhysicalLayout;
  connectionsBySlab: Map<string, FloorEdgeConnection[]>;
};

/** 编辑器统一几何（一次 solve + 一次 physical layout）。 */
export function buildFloorEditorGeometry(plan: FloorPlanState): FloorEditorGeometry {
  const solution = solveFloorTopology(plan);
  const connectionsBySlab = new Map<string, FloorEdgeConnection[]>();
  plan.slabs.forEach((slab) => {
    connectionsBySlab.set(slab.id, floorConnectionsForSlab(plan, slab.id));
  });
  return { solution, physical: buildFloorPhysicalLayout(plan), connectionsBySlab };
}

export type FloorConnectionEvaluation =
  | { connectionId: string; status: "ok" }
  | { connectionId: string; status: "broken"; reasons: string[] };

/**
 * 单条 Connection 在移动后的破坏判定（不 solve，避免 Ghost 被约束拉回）：
 * - inner-wall：实际 Clear Gap 必须等于 resolved wall thickness；continuous：0。
 * - 切向共享长度必须 > 0。
 * - lock-start 锁定关系被违反 → broken。
 */
export function evaluateFloorConnectionAfterMove(
  plan: FloorPlanState,
  connection: FloorEdgeConnection,
  movedSlabId: string,
  movedSlab: FloorSlab,
  expectedGapByConnection: ReadonlyMap<string, number>,
): FloorConnectionEvaluation {
  const otherId = connection.a.slabId === movedSlabId ? connection.b.slabId : connection.a.slabId;
  const other = plan.slabs.find((slab) => slab.id === otherId);
  if (!other) return { connectionId: connection.id, status: "broken", reasons: ["另一端板区不存在"] };
  const movedEndpoint = connection.a.slabId === movedSlabId ? connection.a : connection.b;
  const otherEndpoint = connection.a.slabId === movedSlabId ? connection.b : connection.a;
  const vertical = movedEndpoint.side === "west" || movedEndpoint.side === "east";
  const reasons: string[] = [];

  // 法向 Gap：用当前 Solution 解析出的预期墙厚（inner-wall → 墙厚；continuous → 0）。
  const expectedGapMm = expectedGapByConnection.get(connection.id) ?? Math.max(plan.innerWallThickness, 0);
  const faceMoved = sideFace(movedSlab, movedEndpoint.side);
  const faceOther = sideFace(other, otherEndpoint.side);
  const gapActual = Math.abs(faceMoved - faceOther);
  if (Math.abs(gapActual - expectedGapMm) > FLOOR_EDITOR_DETACH_TOLERANCE_MM) {
    reasons.push(`法向间距 ${gapActual.toFixed(1)}mm 不再等于预期 ${expectedGapMm.toFixed(1)}mm`);
  }

  // 切向共享长度。
  if (tangentialOverlap(vertical, movedSlab, other) <= EPSILON) {
    reasons.push("切向共享长度消失");
  }

  // lock-start：b = a.position + offsetMm。
  if (connection.tangentConstraint.mode === "lock-start") {
    const offset = connection.tangentConstraint.offsetMm;
    const base = vertical ? "y" : "x";
    const movedValue = movedSlab[base];
    const otherValue = other[base];
    const deviation = movedSlabId === connection.a.slabId
      ? Math.abs(otherValue - movedValue - offset)
      : Math.abs(movedValue - otherValue - offset);
    if (deviation > FLOOR_EDITOR_DETACH_TOLERANCE_MM) {
      reasons.push("切向锁定约束被破坏");
    }
  }

  return reasons.length === 0
    ? { connectionId: connection.id, status: "ok" }
    : { connectionId: connection.id, status: "broken", reasons };
}

/** 基于当前 Solution 解析各连接预期 Gap（一次 solve，供批量评估复用）。 */
function expectedGapsForConnections(plan: FloorPlanState, connectionIds: readonly string[]): Map<string, number> {
  const solution = solveFloorTopology(plan);
  const result = new Map<string, number>();
  connectionIds.forEach((id) => {
    const solved = solution.solvedConnections.find((item) => item.connectionId === id);
    result.set(id, !solved || !solved.valid || solved.support !== "continuous"
      ? Math.max(plan.innerWallThickness, 0)
      : 0);
  });
  return result;
}

export type FloorSlabMovePreview = {
  plan: FloorPlanState;
  removedConnectionIds: string[];
  evaluations: FloorConnectionEvaluation[];
  /** V1.4A.2.2：目标位置是否可提交（与其它 Clear Slab 发生正面积重叠即为 false）。 */
  valid: boolean;
  issues: FloorPlanIssue[];
};

/**
 * V1.4A.2.2 重叠预检：移动后 Clear Rect 与其它 Slab 正面积重叠（EPSILON 边界，轴对齐矩形即精确）。
 * PointerMove 阶段只做本纯 Rect 检查（不 solve）；PointerUp 的正式 Full Solve 仍兜底。
 */
export function evaluateFloorMoveOverlapIssues(plan: FloorPlanState, movedSlab: FloorSlab): FloorPlanIssue[] {
  const issues: FloorPlanIssue[] = [];
  for (const other of plan.slabs) {
    if (other.id === movedSlab.id) continue;
    const overlapX = movedSlab.x < other.x + other.width - EPSILON && movedSlab.x + movedSlab.width > other.x + EPSILON;
    const overlapY = movedSlab.y < other.y + other.height - EPSILON && movedSlab.y + movedSlab.height > other.y + EPSILON;
    if (!overlapX || !overlapY) continue;
    issues.push({
      level: "error",
      code: "move-slab-overlap",
      message: `该位置与${other.name}重叠，不能放置。`,
      objectIds: [other.id],
    });
  }
  return issues;
}

/**
 * 拖动预览：临时移除 broken connections（不修改正式 State），
 * 保证 buildFloorPhysicalLayout(preview) 不会把 Ghost 拉回墙约束位置。
 */
export function previewFloorSlabPhysicalMoveV3(
  plan: FloorPlanState,
  slabId: string,
  x: number,
  y: number,
): FloorSlabMovePreview {
  const existing = plan.slabs.find((slab) => slab.id === slabId);
  if (!existing || !isV3(plan)) {
    return { plan, removedConnectionIds: [], evaluations: [], valid: true, issues: [] };
  }
  const movedSlab: FloorSlab = { ...existing, x, y };
  const connections = floorConnectionsForSlab(plan, slabId);
  const expectedGaps = expectedGapsForConnections(plan, connections.map((connection) => connection.id));
  const evaluations = connections
    .map((connection) => evaluateFloorConnectionAfterMove(plan, connection, slabId, movedSlab, expectedGaps));
  const broken = new Set(evaluations
    .filter((evaluation): evaluation is Extract<FloorConnectionEvaluation, { status: "broken" }> => evaluation.status === "broken")
    .map((evaluation) => evaluation.connectionId));
  const issues = evaluateFloorMoveOverlapIssues(plan, movedSlab);
  return {
    plan: {
      ...plan,
      slabs: plan.slabs.map((slab) => (slab.id === slabId ? movedSlab : slab)),
      connections: (plan.connections ?? []).filter((connection) => !broken.has(connection.id)),
    },
    removedConnectionIds: [...broken],
    evaluations,
    valid: issues.length === 0,
    issues,
  };
}

export type FloorSlabPhysicalMoveFailureCode =
  | "move-slab-overlap"
  | "move-topology-conflict"
  | "move-invalid";

export type FloorSlabPhysicalMoveResult =
  | { ok: true; plan: FloorPlanState; removedConnectionIds: string[] }
  | {
      ok: false;
      /** 失败必须返回原始 Before Plan（Atomic Rollback，禁止部分修改后的 Plan）。 */
      plan: FloorPlanState;
      removedConnectionIds: [];
      code: FloorSlabPhysicalMoveFailureCode;
      message: string;
    };

/** 把 finalize 的 Blocking Issue 映射为 Move 失败语义。 */
function moveFailureCodeFromIssues(issues: readonly FloorTopologyConstraintIssue[]): FloorSlabPhysicalMoveFailureCode {
  if (issues.some((issue) => issue.code === "solved-slab-overlap")) return "move-slab-overlap";
  if (issues.some((issue) =>
    issue.code === "topology-constraint-conflict"
    || issue.code === "connection-overlap-conflict"
    || issue.code === "support-rule-conflict")) {
    return "move-topology-conflict";
  }
  return "move-invalid";
}

/**
 * 正式提交：移动 + Detach 是一个事务（Undo 一步）。
 * V1.4A.2.2：Finalize 失败必须 Atomic Rollback（返回 Before Plan），禁止 best-effort 提交非法 Plan。
 * - 目标位置与其它 Clear Slab 重叠 → ok:false（move-slab-overlap），Connection 不 Detach、规则不清理。
 * - Connection 保留时用 Stable Anchor（非移动 Slab 优先），避免整个 Component 跟着 Jitter 平移。
 */
export function applyFloorSlabPhysicalMoveV3(
  plan: FloorPlanState,
  slabId: string,
  x: number,
  y: number,
): FloorSlabPhysicalMoveResult {
  const existing = plan.slabs.find((slab) => slab.id === slabId);
  if (!existing || !isV3(plan)) return { ok: true, plan, removedConnectionIds: [] };
  const preview = previewFloorSlabPhysicalMoveV3(plan, slabId, x, y);
  if (Math.abs(existing.x - x) <= EPSILON && Math.abs(existing.y - y) <= EPSILON && preview.removedConnectionIds.length === 0) {
    return { ok: true, plan, removedConnectionIds: [] };
  }
  if (!preview.valid) {
    return {
      ok: false,
      plan,
      removedConnectionIds: [],
      code: "move-slab-overlap",
      message: preview.issues[0]?.message ?? "该位置与其它板区重叠，不能放置。",
    };
  }
  const cleaned = cleanupFloorSupportRulesAfterConnectionRemoval(plan, preview.plan, preview.removedConnectionIds);
  // Stable Anchor：移动中的 Slab 不得成为其分量 Anchor（除非分量只剩它自己）。
  const preferredAnchorIds = plan.slabs.filter((slab) => slab.id !== slabId).map((slab) => slab.id);
  const finalized = finalizeFloorTopologyMutation(plan, cleaned, {
    preferredAnchors: { x: preferredAnchorIds, y: preferredAnchorIds },
  });
  if (finalized.ok) return { ok: true, plan: finalized.plan, removedConnectionIds: preview.removedConnectionIds };
  return {
    ok: false,
    plan,
    removedConnectionIds: [],
    code: moveFailureCodeFromIssues(finalized.issues),
    message: finalized.message,
  };
}

/** 明确断开：删除指定 Connection（主动拆墙，一次 Undo）。 */
export function removeFloorConnections(plan: FloorPlanState, ids: readonly string[]): FloorPlanState {
  const remove = new Set(ids);
  if (remove.size === 0) return plan;
  return {
    ...plan,
    connections: (plan.connections ?? []).filter((connection) => !remove.has(connection.id)),
  };
}

/**
 * Connection 移除后局部清理（V1.4A.2.1）：
 * 只考虑 removed Connections 的 Endpoint Side/Range；
 * 仅删除同时满足的 shared-slab 语义规则：
 *   1. 命中刚删除 Connection 的 Endpoint Range；
 *   2. 该规则 Range 不再被任何 Remaining Connection 覆盖。
 * Whole 规则在仍有其它 Connection 覆盖时保留；与本次 Detach 无关的孤立规则绝不碰。
 */
export function cleanupFloorSupportRulesAfterConnectionRemoval(
  beforePlan: FloorPlanState,
  afterPlan: FloorPlanState,
  removedConnectionIds: readonly string[],
): FloorPlanState {
  if (!isV3(afterPlan) || removedConnectionIds.length === 0) return afterPlan;
  const removed = new Set(removedConnectionIds);
  const beforeSolve = solveFloorTopology(beforePlan);
  const afterSolve = solveFloorTopology(afterPlan);
  const offsetRanges = (solution: FloorTopologySolution, filter: (id: string) => boolean) => {
    const bySide = new Map<string, Array<{ start: number; end: number }>>();
    solution.solvedConnections.forEach((solved) => {
      if (!filter(solved.connectionId)) return;
      for (const [slabId, side] of [
        [solved.slabIds[0], solved.sideA],
        [solved.slabIds[1], solved.sideB],
      ] as Array<[string, FloorEdgeSide]>) {
        const slab = solution.slabs.find((item) => item.slabId === slabId);
        if (!slab) continue;
        const base = solved.orientation === "vertical" ? slab.y : slab.x;
        const key = `${slabId}:${side}`;
        const list = bySide.get(key) ?? [];
        list.push({ start: solved.rangeStartMm - base, end: solved.rangeEndMm - base });
        bySide.set(key, list);
      }
    });
    return bySide;
  };
  const removedRanges = offsetRanges(beforeSolve, (id) => removed.has(id));
  const remainingRanges = offsetRanges(afterSolve, () => true);
  const rangesOverlap = (left: { start: number; end: number }, right: { start: number; end: number }) =>
    left.start < right.end - EPSILON && left.end > right.start + EPSILON;
  const rules = afterPlan.supportRules.filter((rule) => {
    const target = rule.target;
    if (target.kind !== "slab-edge") return true;
    if (rule.support !== "inner-wall" && rule.support !== "continuous") return true;
    const slab = afterPlan.slabs.find((item) => item.id === target.slabId);
    if (!slab) return false;
    const length = target.side === "west" || target.side === "east" ? slab.height : slab.width;
    const ruleRange = target.range.mode === "whole"
      ? { start: 0, end: length }
      : { start: target.range.startMm, end: target.range.endMm };
    const removedOnSide = removedRanges.get(`${target.slabId}:${target.side}`) ?? [];
    const touchedRemoved = removedOnSide.some((range) => rangesOverlap(ruleRange, range));
    if (!touchedRemoved) return true; // 与本次 Detach 无关：绝不删除。
    const remaining = remainingRanges.get(`${target.slabId}:${target.side}`) ?? [];
    return remaining.some((range) => rangesOverlap(ruleRange, range)); // 仍被其它 Connection 使用 → 保留。
  });
  if (rules.length === afterPlan.supportRules.length) return afterPlan;
  return { ...afterPlan, supportRules: rules };
}

/** V3 物理净空包围盒（Clear Slab，不含墙）。 */
export function floorPhysicalClearBounds(plan: FloorPlanState): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!isV3(plan) || plan.slabs.length === 0) return null;
  const solution = solveFloorTopology(plan);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  solution.slabs.forEach((slab) => {
    minX = Math.min(minX, slab.x);
    minY = Math.min(minY, slab.y);
    maxX = Math.max(maxX, slab.x + slab.width);
    maxY = Math.max(maxY, slab.y + slab.height);
  });
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** 新增板区默认位置：物理净空右侧 + FLOOR_NEW_SLAB_GAP_MM（Golden：maxX=10094 → x=10594）。 */
export function nextFloorSlabPhysicalPositionV3(plan: FloorPlanState): { x: number; y: number } {
  const bounds = floorPhysicalClearBounds(plan);
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.maxX + FLOOR_NEW_SLAB_GAP_MM, y: bounds.minY };
}

/** Duplicate 位置：源板物理 Canonical 坐标 + 净宽 + GAP（Golden C：6074+4020+500=10594）。 */
export function duplicateFloorSlabPositionV3(plan: FloorPlanState, slabId: string): { x: number; y: number } | null {
  if (!isV3(plan)) return null;
  const source = plan.slabs.find((slab) => slab.id === slabId);
  if (!source) return null;
  const solution = solveFloorTopology(plan);
  const solved = solution.slabs.find((item) => item.slabId === slabId);
  const x = solved?.x ?? source.x;
  const y = solved?.y ?? source.y;
  return { x: x + source.width + FLOOR_NEW_SLAB_GAP_MM, y };
}

/** 新增/移动洞口：基于 Physical Canonical Host（如 B.x=-1436，而不是 Legacy -1676）。 */
export function defaultFloorOpeningPositionV3(
  plan: FloorPlanState,
  hostSlabId: string,
  openingWidth: number,
  openingHeight: number,
): { x: number; y: number } | null {
  if (!isV3(plan)) return null;
  const host = plan.slabs.find((slab) => slab.id === hostSlabId);
  if (!host) return null;
  const solution = solveFloorTopology(plan);
  const solved = solution.slabs.find((item) => item.slabId === hostSlabId);
  const x = solved?.x ?? host.x;
  const y = solved?.y ?? host.y;
  return {
    x: x + (host.width - openingWidth) / 2,
    y: y + (host.height - openingHeight) / 2,
  };
}

export type FloorSlabResizeAnchorX = "auto" | "west" | "east" | "center";
export type FloorSlabResizeAnchorY = "auto" | "south" | "north" | "center";

export type FloorSlabResizeRequest = {
  slabId: string;
  width?: number;
  height?: number;
  anchorX?: FloorSlabResizeAnchorX;
  anchorY?: FloorSlabResizeAnchorY;
};

export type FloorSlabResizeResult =
  | { ok: true; plan: FloorPlanState }
  | {
      ok: false;
      code: "resize-anchor-required" | "resize-size-invalid" | "resize-blocked-by-topology" | "resize-opening-outside";
      message: string;
    };

function connectedSides(plan: FloorPlanState, slabId: string): Set<FloorEdgeSide> {
  const sides = new Set<FloorEdgeSide>();
  floorConnectionsForSlab(plan, slabId).forEach((connection) => {
    if (connection.a.slabId === slabId) sides.add(connection.a.side);
    if (connection.b.slabId === slabId) sides.add(connection.b.side);
  });
  return sides;
}

/**
 * Resize 正式事务：
 * - 明确哪条边固定（auto：单侧 Connected 保持 Connected 侧固定；双侧 Connected → resize-anchor-required）。
 * - 保持 Connections，Solver 传播邻接房间位置（不静默 Detach）。
 * - 引入新的 constraint conflict / clear overlap / no-overlap → 阻止本次 Resize。
 */
export function applyFloorSlabResizeV3(plan: FloorPlanState, request: FloorSlabResizeRequest): FloorSlabResizeResult {
  if (!isV3(plan)) {
    return { ok: false, code: "resize-size-invalid", message: "Resize 事务只适用于 clear-space-physical-v2。" };
  }
  const slab = plan.slabs.find((item) => item.id === request.slabId);
  if (!slab) return { ok: false, code: "resize-size-invalid", message: "目标板区不存在。" };
  const width = request.width ?? slab.width;
  const height = request.height ?? slab.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return { ok: false, code: "resize-size-invalid", message: "房间净尺寸必须大于0。" };
  }
  const widthChanged = Math.abs(width - slab.width) > EPSILON;
  const heightChanged = Math.abs(height - slab.height) > EPSILON;
  const sides = connectedSides(plan, slab.id);
  const xConnected = sides.has("west") || sides.has("east");
  const yConnected = sides.has("south") || sides.has("north");

  const resolveAnchorX = (): FloorSlabResizeAnchorX | null => {
    if (request.anchorX && request.anchorX !== "auto") return request.anchorX;
    if (!widthChanged || !xConnected) return "west";
    if (sides.has("west") && sides.has("east")) return null; // 双侧连接：必须由用户选择。
    return sides.has("west") ? "west" : "east";
  };
  const resolveAnchorY = (): FloorSlabResizeAnchorY | null => {
    if (request.anchorY && request.anchorY !== "auto") return request.anchorY;
    if (!heightChanged || !yConnected) return "south";
    if (sides.has("south") && sides.has("north")) return null;
    return sides.has("south") ? "south" : "north";
  };
  const anchorX = resolveAnchorX();
  const anchorY = resolveAnchorY();
  if (anchorX === null || anchorY === null) {
    return {
      ok: false,
      code: "resize-anchor-required",
      message: "该房间两个方向均存在连接，请先选择固定边（固定西边或固定东边、固定南边或固定北边）。",
    };
  }

  let x = slab.x;
  if (widthChanged) {
    if (anchorX === "west") x = slab.x;
    else if (anchorX === "east") x = slab.x + slab.width - width;
    else x = slab.x + (slab.width - width) / 2;
  }
  let y = slab.y;
  if (heightChanged) {
    if (anchorY === "south") y = slab.y;
    else if (anchorY === "north") y = slab.y + slab.height - height;
    else y = slab.y + (slab.height - height) / 2;
  }

  const trial: FloorPlanState = {
    ...plan,
    slabs: plan.slabs.map((item) => item.id === slab.id ? { ...item, x, y, width, height } : item),
  };
  const finalized = finalizeFloorTopologyMutation(plan, trial);
  if (!finalized.ok) {
    return {
      ok: false,
      code: "resize-blocked-by-topology",
      message: `修改净尺寸被阻止：${finalized.message}`,
    };
  }
  // Opening 越界检查：Before 完整属于 Host 的 Opening，After 必须仍完整位于其 Host 内（不自动缩小洞口）。
  for (const opening of plan.openings) {
    const hostBefore = resolveFloorOpeningHost(plan, opening);
    if (hostBefore.status !== "confirmed") continue;
    const afterOpening = finalized.plan.openings.find((item) => item.id === opening.id) ?? opening;
    const afterHost = finalized.plan.slabs.find((item) => item.id === hostBefore.slabId);
    if (afterHost && !openingInsideSlab(afterOpening, afterHost)) {
      return {
        ok: false,
        code: "resize-opening-outside",
        message: `修改净尺寸被阻止：“${opening.name}”将超出其所在板区，请先调整洞口或选择其它固定边。`,
      };
    }
  }
  return { ok: true, plan: finalized.plan };
}

/** 墙厚修改事务：solve → validate → materialize → Opening Follow（一个 History 步骤）。 */
export type FloorWallThicknessResult =
  | { ok: true; plan: FloorPlanState }
  | { ok: false; code: "wall-thickness-invalid" | "mutation-blocked-by-topology"; message: string };

export function applyFloorInnerWallThicknessV3(plan: FloorPlanState, thicknessMm: number): FloorWallThicknessResult {
  if (!isV3(plan)) {
    return { ok: false, code: "wall-thickness-invalid", message: "墙厚事务只适用于 clear-space-physical-v2。" };
  }
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0) {
    return { ok: false, code: "wall-thickness-invalid", message: "内墙厚度必须大于0。" };
  }
  const finalized = finalizeFloorTopologyMutation(plan, { ...plan, innerWallThickness: thicknessMm });
  if (!finalized.ok) {
    return { ok: false, code: "mutation-blocked-by-topology", message: finalized.message };
  }
  return { ok: true, plan: finalized.plan };
}

/** 连接支承切换事务（inner-wall ↔ continuous）：写入精确 Side+Range 规则，solve → materialize → Opening Follow。 */
export type FloorConnectionSupportRequest = {
  connectionId: string;
  support: "inner-wall" | "continuous";
};

export type FloorConnectionSupportResult =
  | { ok: true; plan: FloorPlanState; removedRuleIds: string[]; addedRuleId: string | null }
  | {
      ok: false;
      /** V1.4A.2.2：失败必须返回原始 Before Plan（Atomic Rollback，禁止 Rule 已改但未 Materialize）。 */
      plan: FloorPlanState;
      code: "connection-not-found" | "mutation-blocked-by-topology";
      message: string;
    };

export function applyFloorConnectionSupportV3(plan: FloorPlanState, request: FloorConnectionSupportRequest): FloorConnectionSupportResult {
  if (!isV3(plan)) {
    return { ok: false, plan, code: "connection-not-found", message: "连接支承事务只适用于 clear-space-physical-v2。" };
  }
  const connection = (plan.connections ?? []).find((item) => item.id === request.connectionId);
  if (!connection || (request.support !== "inner-wall" && request.support !== "continuous")) {
    return { ok: false, plan, code: "connection-not-found", message: "连接不存在或支承类型无效。" };
  }
  const solution = solveFloorTopology(plan);
  const solved = solution.solvedConnections.find((item) => item.connectionId === request.connectionId);
  if (!solved) return { ok: false, plan, code: "connection-not-found", message: "连接未解析到有效几何。" };
  const current = solved.valid ? solved.support : "inner-wall";
  if (current === request.support) return { ok: true, plan, removedRuleIds: [], addedRuleId: null };

  // V1.4A.2.2：Range Split 重写（只改两端点上与选中区间重叠的部分，残段保持旧 Support）。
  const aSlab = plan.slabs.find((item) => item.id === solved.slabIds[0]);
  if (!aSlab) return { ok: false, plan, code: "connection-not-found", message: "连接端点板区不存在。" };
  const sideLengthA = solved.orientation === "vertical" ? aSlab.height : aSlab.width;
  const wholeA = solved.aOffsetStartMm <= EPSILON && solved.aOffsetEndMm >= sideLengthA - EPSILON;
  const targetA = {
    kind: "slab-edge" as const,
    slabId: solved.slabIds[0],
    side: solved.sideA,
    range: wholeA
      ? { mode: "whole" as const }
      : { mode: "offset" as const, startMm: solved.aOffsetStartMm, endMm: solved.aOffsetEndMm },
  };
  const ruleId = `connection-support:${request.connectionId}:${request.support}`;
  const rewrite = rewriteFloorSupportRulesForConnectionSupport(
    plan,
    [
      { slabId: solved.slabIds[0], side: solved.sideA, startMm: solved.aOffsetStartMm, endMm: solved.aOffsetEndMm },
      { slabId: solved.slabIds[1], side: solved.sideB, startMm: solved.bOffsetStartMm, endMm: solved.bOffsetEndMm },
    ],
    targetA,
    ruleId,
    request.support,
  );
  const mutated: FloorPlanState = {
    ...plan,
    supportRules: rewrite.supportRules,
  };
  const finalized = finalizeFloorTopologyMutation(plan, mutated);
  if (!finalized.ok) {
    return { ok: false, plan, code: "mutation-blocked-by-topology", message: finalized.message };
  }
  return { ok: true, plan: finalized.plan, removedRuleIds: rewrite.removedRuleIds, addedRuleId: rewrite.addedRuleId };
}
