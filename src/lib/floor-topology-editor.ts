import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import type { FloorEdgeConnection } from "./floor-topology";
import { solveFloorTopology, type FloorTopologySolution } from "./floor-topology-solver";
import { buildFloorPhysicalLayout, type FloorPhysicalLayout } from "./floor-physical-layout";

/**
 * Floor Topology V1.4A.2 Physical Editor Foundation（纯函数，无 React / DOM / 副作用）。
 *
 * V3 坐标唯一语义：
 *   coordinateModel === "clear-space-physical-v2" 时，slab.x / slab.y 就是该房间净空矩形
 *   在建筑 Physical Plane 中的真实位置。
 *   Canonical Position = Editor Position = Canvas Position = Solved Physical Position。
 *
 * 关键规则：
 * - Materialize：solve 后把 Solved x/y 写回 slab.x/y（禁止写 width/height/connections/supportRules）。
 * - Connected Slab 拖动：Connection 是硬约束；拖离墙 → 删除被破坏的 Connection（不修改 Solver 规则）。
 * - Slide Along Wall：法向 Gap 正确 + 切向仍有共享长度 + tangentConstraint=none → Connection 保留。
 * - Resize 是正式事务：保持 Connections，Solver 传播邻接房间位置；冲突则阻止，不静默 Detach。
 */
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
export const FLOOR_NEW_SLAB_GAP_MM = 500;
/** 拖动判定 Connection 破坏的容差（mm）。 */
export const FLOOR_MOVE_BREAK_TOLERANCE_MM = 0.5;

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

/**
 * Materialize：V3 Plan → solve →（无 Blocking Issue）→ Solved x/y 写回 slab.x/y。
 * 幂等；不修改 width/height/id/name/connections/supportRules；不保存任何 Derived 数据。
 */
export function materializeFloorTopologyPositions(plan: FloorPlanState): FloorPlanState {
  if (!isV3(plan)) return plan;
  const solution = solveFloorTopology(plan);
  if (solution.issues.some((issue) => issue.level === "error")) return plan;
  const solved = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  let changed = false;
  for (const slab of plan.slabs) {
    const solvedSlab = solved.get(slab.id);
    if (!solvedSlab) continue;
    if (Math.abs(solvedSlab.x - slab.x) > EPSILON || Math.abs(solvedSlab.y - slab.y) > EPSILON) {
      changed = true;
      break;
    }
  }
  if (!changed) return plan;
  return {
    ...plan,
    slabs: plan.slabs.map((slab) => {
      const solvedSlab = solved.get(slab.id);
      if (!solvedSlab) return slab;
      return { ...slab, x: solvedSlab.x, y: solvedSlab.y };
    }),
  };
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
  if (Math.abs(gapActual - expectedGapMm) > FLOOR_MOVE_BREAK_TOLERANCE_MM) {
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
    if (deviation > FLOOR_MOVE_BREAK_TOLERANCE_MM) {
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
};

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
    return { plan, removedConnectionIds: [], evaluations: [] };
  }
  const movedSlab: FloorSlab = { ...existing, x, y };
  const connections = floorConnectionsForSlab(plan, slabId);
  const expectedGaps = expectedGapsForConnections(plan, connections.map((connection) => connection.id));
  const evaluations = connections
    .map((connection) => evaluateFloorConnectionAfterMove(plan, connection, slabId, movedSlab, expectedGaps));
  const broken = new Set(evaluations
    .filter((evaluation): evaluation is Extract<FloorConnectionEvaluation, { status: "broken" }> => evaluation.status === "broken")
    .map((evaluation) => evaluation.connectionId));
  return {
    plan: {
      ...plan,
      slabs: plan.slabs.map((slab) => (slab.id === slabId ? movedSlab : slab)),
      connections: (plan.connections ?? []).filter((connection) => !broken.has(connection.id)),
    },
    removedConnectionIds: [...broken],
    evaluations,
  };
}

export type FloorSlabPhysicalMoveResult = {
  plan: FloorPlanState;
  removedConnectionIds: string[];
};

/**
 * 正式提交：移动 + Detach 是一个事务（Undo 一步）。
 * 写回后重新 solve + materialize：其余连接不变，B 停留在新位置。
 */
export function applyFloorSlabPhysicalMoveV3(
  plan: FloorPlanState,
  slabId: string,
  x: number,
  y: number,
): FloorSlabPhysicalMoveResult {
  const existing = plan.slabs.find((slab) => slab.id === slabId);
  if (!existing || !isV3(plan)) return { plan, removedConnectionIds: [] };
  const preview = previewFloorSlabPhysicalMoveV3(plan, slabId, x, y);
  if (Math.abs(existing.x - x) <= EPSILON && Math.abs(existing.y - y) <= EPSILON && preview.removedConnectionIds.length === 0) {
    return { plan, removedConnectionIds: [] };
  }
  const cleaned = cleanupFloorSupportRulesAfterConnectionRemoval(preview.plan, preview.removedConnectionIds);
  return { plan: materializeFloorTopologyPositions(cleaned), removedConnectionIds: preview.removedConnectionIds };
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
 * Connection 移除后清理：删除不再作用于任何有效连接区间的 slab-edge 支承规则。
 * （V3 中 shared-slab 只来自 Connection；规则失去作用对象即失效。）
 */
export function cleanupFloorSupportRulesAfterConnectionRemoval(
  plan: FloorPlanState,
  removedConnectionIds: readonly string[],
): FloorPlanState {
  if (!isV3(plan) || removedConnectionIds.length === 0) return plan;
  const solution = solveFloorTopology(plan);
  const coveredBySide = new Map<string, Array<{ start: number; end: number }>>();
  solution.solvedConnections.forEach((solved) => {
    if (!solved.valid) return;
    for (const [slabId, side] of [
      [solved.slabIds[0], solved.sideA],
      [solved.slabIds[1], solved.sideB],
    ] as Array<[string, FloorEdgeSide]>) {
      const slab = solution.slabs.find((item) => item.slabId === slabId);
      if (!slab) continue;
      const base = solved.orientation === "vertical" ? slab.y : slab.x;
      const key = `${slabId}:${side}`;
      const list = coveredBySide.get(key) ?? [];
      list.push({ start: solved.rangeStartMm - base, end: solved.rangeEndMm - base });
      coveredBySide.set(key, list);
    }
  });
  const rules = plan.supportRules.filter((rule) => {
    const target = rule.target;
    if (target.kind !== "slab-edge") return true;
    const slab = plan.slabs.find((item) => item.id === target.slabId);
    if (!slab) return false;
    const length = target.side === "west" || target.side === "east" ? slab.height : slab.width;
    const ruleRange = target.range.mode === "whole"
      ? { start: 0, end: length }
      : { start: target.range.startMm, end: target.range.endMm };
    const covered = coveredBySide.get(`${target.slabId}:${target.side}`) ?? [];
    return covered.some((range) =>
      range.start < ruleRange.end - EPSILON && range.end > ruleRange.start + EPSILON);
  });
  if (rules.length === plan.supportRules.length) return plan;
  return { ...plan, supportRules: rules };
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
      code: "resize-anchor-required" | "resize-size-invalid" | "resize-blocked-by-topology";
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

function issueKeys(issues: FloorTopologySolution["issues"]): Set<string> {
  return new Set(issues
    .filter((issue) => issue.level === "error")
    .map((issue) => `${issue.code}|${(issue.slabIds ?? []).join(",")}|${(issue.connectionIds ?? []).join(",")}`));
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
  const baselineKeys = issueKeys(solveFloorTopology(plan).issues);
  const solution = solveFloorTopology(trial);
  const newIssues = solution.issues.filter((issue) => {
    if (issue.level !== "error") return false;
    const key = `${issue.code}|${(issue.slabIds ?? []).join(",")}|${(issue.connectionIds ?? []).join(",")}`;
    return !baselineKeys.has(key);
  });
  if (newIssues.length > 0) {
    return {
      ok: false,
      code: "resize-blocked-by-topology",
      message: `修改净尺寸被阻止：${newIssues[0].message}`,
    };
  }
  return { ok: true, plan: materializeFloorTopologyPositions(trial) };
}
