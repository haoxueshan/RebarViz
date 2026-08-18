import type { FloorEdgeSide, FloorPlanState } from "./floor-plan";

/**
 * Floor Topology V1.4A：显式板边连接模型。
 *
 * 正式建筑拓扑关系的唯一来源是 FloorEdgeConnection，
 * 不再是“两个 Clear Rect 坐标恰好相等”。
 *
 * - inner-wall：两个净空矩形之间的物理空间真实被墙占据，Clear Gap = wallThickness（默认 240）。
 * - continuous：Clear Gap = 0。
 * - Connection 只建立法向墙厚约束；tangentConstraint 仅 Full-Full 连接可锁切向。
 * - Connection 是 Canonical 数据（保存进 Plan V3）；Solved Walls 是 Derived（禁止保存）。
 */
export const FLOOR_CONNECTION_SIDE_PAIRS: ReadonlyArray<[FloorEdgeSide, FloorEdgeSide]> = [
  ["west", "east"],
  ["east", "west"],
  ["south", "north"],
  ["north", "south"],
];

export type FloorConnectionRange =
  | { mode: "auto-overlap" }
  | { mode: "offset"; startMm: number; endMm: number };

export type FloorConnectionEndpoint = {
  slabId: string;
  side: FloorEdgeSide;
  range: FloorConnectionRange;
};

export type FloorConnectionSource =
  | "manual"
  | "smart-join"
  | "legacy-shared-edge"
  | "legacy-wall-gap"
  | "auto-detected";

export type FloorConnectionConfidence = "confirmed" | "high" | "medium";

export type FloorTangentConstraint =
  | { mode: "none" }
  | { mode: "lock-start"; offsetMm: number };

export type FloorEdgeConnection = {
  id: string;
  a: FloorConnectionEndpoint;
  b: FloorConnectionEndpoint;
  source: FloorConnectionSource;
  confidence: FloorConnectionConfidence;
  tangentConstraint: FloorTangentConstraint;
};

/** 合法的 Side Pair：只允许平行对向边。 */
export function isValidFloorConnectionSidePair(left: FloorEdgeSide, right: FloorEdgeSide): boolean {
  return FLOOR_CONNECTION_SIDE_PAIRS.some(
    ([a, b]) => a === left && b === right,
  );
}

/** 稳定 Connection ID：基于 slab ids + side pair，导入两次得到完全相同 ID。 */
export function stableFloorConnectionId(
  slabIdA: string,
  sideA: FloorEdgeSide,
  slabIdB: string,
  sideB: FloorEdgeSide,
): string {
  const [leftId, rightId] = [slabIdA, slabIdB].sort();
  const leftSide = leftId === slabIdA ? sideA : sideB;
  const rightSide = leftId === slabIdA ? sideB : sideA;
  return `connection:${leftId}:${leftSide}:${rightId}:${rightSide}`;
}

export function floorConnectionReferencesSlab(connection: FloorEdgeConnection, slabId: string): boolean {
  return connection.a.slabId === slabId || connection.b.slabId === slabId;
}

/** 同一对 Slab + Side Pair 的唯一身份（用于合并/去重）。 */
export function floorConnectionPairKey(connection: FloorEdgeConnection): string {
  const [leftId, rightId] = [connection.a.slabId, connection.b.slabId].sort();
  const left = leftId === connection.a.slabId ? connection.a : connection.b;
  const right = leftId === connection.a.slabId ? connection.b : connection.a;
  return `${leftId}:${left.side}:${rightId}:${right.side}`;
}

/** 连接的法向墙厚：inner-wall → 全局内墙厚；continuous → 0。 */
export function floorConnectionClearGapMm(
  connection: FloorEdgeConnection,
  plan: FloorPlanState,
  support: "inner-wall" | "continuous",
): number {
  return support === "inner-wall" ? Math.max(plan.innerWallThickness, 0) : 0;
}

/** 解析连接支承：特殊规则 continuous → continuous；否则默认 inner-wall（与既有 Support Resolver 语义一致）。 */
export function resolveFloorConnectionSupport(
  connection: FloorEdgeConnection,
  plan: FloorPlanState,
): "inner-wall" | "continuous" {
  const hasContinuous = plan.supportRules.some((rule) =>
    rule.support === "continuous"
    && rule.target.kind === "slab-edge"
    && (rule.target.slabId === connection.a.slabId || rule.target.slabId === connection.b.slabId));
  return hasContinuous ? "continuous" : "inner-wall";
}

/** V1.4B API：查找连接。 */
export function findFloorConnection(plan: FloorPlanState, id: string): FloorEdgeConnection | null {
  return plan.connections?.find((connection) => connection.id === id) ?? null;
}

/** V1.4B API：创建连接（确定性 ID；调用方负责去重与持久化）。 */
export function createFloorConnection(input: {
  slabIdA: string;
  sideA: FloorEdgeSide;
  slabIdB: string;
  sideB: FloorEdgeSide;
  source?: FloorConnectionSource;
  confidence?: FloorConnectionConfidence;
  tangentConstraint?: FloorTangentConstraint;
}): FloorEdgeConnection | null {
  if (input.slabIdA === input.slabIdB) return null;
  if (!isValidFloorConnectionSidePair(input.sideA, input.sideB)) return null;
  return {
    id: stableFloorConnectionId(input.slabIdA, input.sideA, input.slabIdB, input.sideB),
    a: { slabId: input.slabIdA, side: input.sideA, range: { mode: "auto-overlap" } },
    b: { slabId: input.slabIdB, side: input.sideB, range: { mode: "auto-overlap" } },
    source: input.source ?? "manual",
    confidence: input.confidence ?? "confirmed",
    tangentConstraint: input.tangentConstraint ?? { mode: "none" },
  };
}

/** V1.4B API：移除连接。 */
export function removeFloorConnection(plan: FloorPlanState, id: string): FloorPlanState {
  return {
    ...plan,
    connections: (plan.connections ?? []).filter((connection) => connection.id !== id),
  };
}

/** 归一化连接端点 Range：offset 必须 start < end。 */
export function normalizeFloorConnectionRange(value: unknown): FloorConnectionRange {
  if (value && typeof value === "object") {
    const candidate = value as { mode?: unknown; startMm?: unknown; endMm?: unknown };
    if (candidate.mode === "auto-overlap") return { mode: "auto-overlap" };
    if (
      candidate.mode === "offset"
      && typeof candidate.startMm === "number" && Number.isFinite(candidate.startMm)
      && typeof candidate.endMm === "number" && Number.isFinite(candidate.endMm)
      && candidate.startMm < candidate.endMm
    ) {
      return { mode: "offset", startMm: candidate.startMm, endMm: candidate.endMm };
    }
  }
  return { mode: "auto-overlap" };
}

/** 解析/归一化连接列表：非法 side pair / 重复指向同一 Slab 被拒绝。 */
export function parseFloorConnections(value: unknown, slabIds: ReadonlySet<string>): FloorEdgeConnection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const connections: FloorEdgeConnection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      id?: unknown; source?: unknown; confidence?: unknown; tangentConstraint?: unknown;
      a?: unknown; b?: unknown;
    };
    const a = candidate.a as { slabId?: unknown; side?: unknown; range?: unknown } | undefined;
    const b = candidate.b as { slabId?: unknown; side?: unknown; range?: unknown } | undefined;
    if (!a || !b || typeof a.slabId !== "string" || typeof b.slabId !== "string") continue;
    if (a.slabId === b.slabId) continue;
    if (!slabIds.has(a.slabId) || !slabIds.has(b.slabId)) continue;
    const sideA = String(a.side) as FloorEdgeSide;
    const sideB = String(b.side) as FloorEdgeSide;
    if (!isValidFloorConnectionSidePair(sideA, sideB)) continue;
    const source: FloorConnectionSource = ["manual", "smart-join", "legacy-shared-edge", "legacy-wall-gap", "auto-detected"]
      .includes(String(candidate.source)) ? String(candidate.source) as FloorConnectionSource : "manual";
    const confidence: FloorConnectionConfidence = ["confirmed", "high", "medium"].includes(String(candidate.confidence))
      ? String(candidate.confidence) as FloorConnectionConfidence
      : "confirmed";
    const tangentRaw = candidate.tangentConstraint as { mode?: unknown; offsetMm?: unknown } | undefined;
    const tangentConstraint: FloorTangentConstraint = tangentRaw?.mode === "lock-start" && typeof tangentRaw.offsetMm === "number"
      ? { mode: "lock-start", offsetMm: tangentRaw.offsetMm }
      : { mode: "none" };
    const id = typeof candidate.id === "string" && candidate.id
      ? candidate.id
      : stableFloorConnectionId(a.slabId, sideA, b.slabId, sideB);
    if (seen.has(id)) continue;
    seen.add(id);
    connections.push({
      id,
      a: { slabId: a.slabId, side: sideA, range: normalizeFloorConnectionRange(a.range) },
      b: { slabId: b.slabId, side: sideB, range: normalizeFloorConnectionRange(b.range) },
      source,
      confidence,
      tangentConstraint,
    });
  }
  return connections;
}
