import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorAtomicBoundarySegment,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorSlab,
  type FloorSupportRuleTarget,
} from "./floor-plan";
import {
  floorConnectionClearGapMm,
  subtractFloorRanges,
  type FloorEdgeConnection,
  type FloorRange,
} from "./floor-topology";
import { resolveFloorConnectionSupportDetails } from "./floor-topology-support";

/**
 * Floor Topology V1.4A.1 Constraint Solver：X Axis / Y Axis 分离求解。
 *
 * - Connection 产生法向墙厚约束（inner-wall → gap=墙厚；continuous → gap=0）。
 * - tangentConstraint（lock-start）只对 Full-Full 连接产生切向等式。
 * - Anchor 保持建筑原始参考位置（sourceX/sourceY 最小 + 稳定 tie-break）。
 * - Constraint Cycle 闭合误差不平均分摊：报告 topology-constraint-conflict。
 * - Support / Gap 求解使用有限阶段迭代（≤3 轮，禁止无限递归）：
 *   Phase A：以当前 Gap 解全轴（切向+法向）→ 临时位置；
 *   Phase B：由 Solved 位置计算每条连接的实际 Overlap Range（双端点 Range 求交）；
 *   Phase C：以实际 Side + Range 解析 Support（精确匹配）；
 *   Phase D：以新 Support Gap 重解法向轴；
 *   Phase E：重算最终 Overlap，Support 集合不再变化即收敛。
 * - 最终有效墙段 = Natural Solved Overlap ∩ A Endpoint Range ∩ B Endpoint Range。
 * - Wall Rect 允许在 T/L/X 节点重叠；Solved Clear Slab 禁止面积重叠（solved-slab-overlap）。
 * - 外墙按 Side 区间减法生成：未被有效 Connection 覆盖的区间才生成 building-exterior。
 */
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
const MAX_SUPPORT_PASSES = 3;
const SIDES: readonly FloorEdgeSide[] = ["west", "east", "south", "north"];

export type FloorSolvedSlab = {
  slabId: string;
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export type FloorSolvedWall = {
  id: string;
  connectionId: string;
  kind: "inner-wall";
  orientation: "vertical" | "horizontal";
  x: number;
  y: number;
  width: number;
  height: number;
  lengthMm: number;
  thicknessMm: number;
  slabIds: [string, string];
};

/** V1.4A.1：Solved Connection Geometry（唯一负责实际 Range 的派生类型，不写入 Project）。 */
export type FloorSolvedConnection = {
  connectionId: string;
  slabIds: [string, string];
  orientation: "vertical" | "horizontal";
  sideA: FloorEdgeSide;
  sideB: FloorEdgeSide;
  /** 最终有效世界切向区间。 */
  rangeStartMm: number;
  rangeEndMm: number;
  lengthMm: number;
  /** 相对各端 Slab 切向起点的 offset。 */
  aOffsetStartMm: number;
  aOffsetEndMm: number;
  bOffsetStartMm: number;
  bOffsetEndMm: number;
  support: "inner-wall" | "continuous";
  gapMm: number;
  valid: boolean;
};

export type FloorTopologyComponent = {
  id: string;
  slabIds: string[];
  slabCount: number;
};

export type FloorTopologyConstraintIssue = {
  level: "warning" | "error";
  code:
    | "topology-constraint-conflict"
    | "connection-no-overlap"
    | "connection-invalid-side-pair"
    | "connection-range-invalid"
    | "connection-overlap-conflict"
    | "solved-slab-overlap"
    | "support-rule-conflict";
  message: string;
  slabIds?: string[];
  connectionIds?: string[];
  /** 冲突规则 ID 列表（support-rule-conflict）。 */
  objectIds?: string[];
  errorMm?: number;
  /** solved-slab-overlap 明细。 */
  overlapWidthMm?: number;
  overlapHeightMm?: number;
  overlapAreaMm2?: number;
};

export type FloorTopologySolution = {
  slabs: FloorSolvedSlab[];
  solvedConnections: FloorSolvedConnection[];
  walls: FloorSolvedWall[];
  components: FloorTopologyComponent[];
  issues: FloorTopologyConstraintIssue[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type FloorTopologyExteriorRange = {
  slabId: string;
  side: FloorEdgeSide;
  startMm: number;
  endMm: number;
  orientation: "vertical" | "horizontal";
};

/**
 * V1.4A.2.2 Solve Options（仅 Editor Mutation 使用）：
 * - preferredAnchors：每轴优先作为连通分量 Anchor 的 Slab ID 列表。
 *   只决定分量的绝对平移参考（Anchor 保持其 source 坐标），
 *   不修改 normalDelta / wall gap / tangent constraint / cycle conflict / range 等任何正式拓扑方程。
 * - 未提供时行为与旧版逐位一致（默认 Anchor = source 坐标最小 + 稳定 tie-break）。
 */
export type FloorTopologySolveOptions = {
  preferredAnchors?: {
    x?: readonly string[];
    y?: readonly string[];
  };
};

type AxisEdge = {
  other: string;
  delta: number;
  connectionId: string;
};

function slabById(plan: FloorPlanState): Map<string, FloorSlab> {
  return new Map(plan.slabs.map((slab) => [slab.id, slab]));
}

function isVerticalConnection(connection: FloorEdgeConnection): boolean {
  return connection.a.side === "west" || connection.a.side === "east";
}

function sideLength(slab: FloorSlab, side: FloorEdgeSide): number {
  return side === "west" || side === "east" ? slab.height : slab.width;
}

/** 法向方程：b = a.position + delta（delta 只含尺寸与墙厚，与源坐标无关）。 */
function normalDelta(
  connection: FloorEdgeConnection,
  a: FloorSlab,
  b: FloorSlab,
  gapMm: number,
): number {
  const aSide = connection.a.side;
  const bSide = connection.b.side;
  if (aSide === "west" && bSide === "east") return -b.width - gapMm;
  if (aSide === "east" && bSide === "west") return a.width + gapMm;
  if (aSide === "south" && bSide === "north") return -b.height - gapMm;
  return a.height + gapMm;
}

/** 切向 lock-start 方程（仅显式锁定时使用）：b = a.position + offsetMm。 */
function tangentDelta(connection: FloorEdgeConnection): number | null {
  if (connection.tangentConstraint.mode !== "lock-start") return null;
  return connection.tangentConstraint.offsetMm;
}

function solveAxisGraph(
  plan: FloorPlanState,
  connections: readonly FloorEdgeConnection[],
  slabs: Map<string, FloorSlab>,
  axis: "x" | "y",
  gapOf: (connection: FloorEdgeConnection) => number,
  preferredAnchorIds?: ReadonlySet<string>,
): { positions: Map<string, number>; issues: FloorTopologyConstraintIssue[] } {
  const issues: FloorTopologyConstraintIssue[] = [];
  const graph = new Map<string, AxisEdge[]>(plan.slabs.map((slab) => [slab.id, []]));
  const addEdge = (fromId: string, edge: AxisEdge) => {
    graph.get(fromId)?.push(edge);
  };
  for (const connection of connections) {
    const a = slabs.get(connection.a.slabId);
    const b = slabs.get(connection.b.slabId);
    if (!a || !b) continue;
    const vertical = isVerticalConnection(connection);
    const normalAxis = vertical ? "x" : "y";
    if (normalAxis === axis) {
      const delta = normalDelta(connection, a, b, gapOf(connection));
      addEdge(a.id, { other: b.id, delta, connectionId: connection.id });
      addEdge(b.id, { other: a.id, delta: -delta, connectionId: connection.id });
    }
    const tangent = tangentDelta(connection);
    if (tangent !== null) {
      const tangentAxis = vertical ? "y" : "x";
      if (tangentAxis === axis) {
        addEdge(a.id, { other: b.id, delta: tangent, connectionId: connection.id });
        addEdge(b.id, { other: a.id, delta: -tangent, connectionId: connection.id });
      }
    }
  }
  // 每个连通分量独立 Anchor：默认取该轴 source 坐标最小的 Slab（稳定 tie-break）。
  // preferredAnchorIds（可选）：Editor Move 传入，排除移动中的 Slab，防止整组 Component 漂移。
  // 只决定绝对平移参考；约束方程、闭合检测、冲突报告与默认路径完全一致。
  const positions = new Map<string, number>();
  const visited = new Set<string>();
  const ranked = [...plan.slabs].sort((left, right) =>
    (axis === "x" ? left.x - right.x || left.y - right.y : left.y - right.y || left.x - right.x)
    || left.id.localeCompare(right.id));
  const rankOf = new Map(ranked.map((slab, index) => [slab.id, index]));
  for (const startSlab of ranked) {
    if (visited.has(startSlab.id)) continue;
    // 第一阶段：收集本分量成员（不赋位置），便于从成员中选择 Preferred Anchor。
    const members = new Set<string>([startSlab.id]);
    const memberQueue = [startSlab.id];
    while (memberQueue.length > 0) {
      const currentId = memberQueue.shift()!;
      for (const edge of graph.get(currentId) ?? []) {
        if (members.has(edge.other)) continue;
        members.add(edge.other);
        memberQueue.push(edge.other);
      }
    }
    const anchorId = preferredAnchorIds
      ? [...members]
          .filter((id) => preferredAnchorIds.has(id))
          .sort((left, right) => rankOf.get(left)! - rankOf.get(right)!)[0]
      : undefined;
    const anchorSlab = anchorId ? slabs.get(anchorId) : undefined;
    // 无 Preferred 成员时回退默认语义（source 坐标最小 Slab）。
    const finalAnchorId = anchorSlab?.id ?? startSlab.id;
    const finalAnchorSlab = anchorSlab ?? startSlab;
    for (const member of members) visited.add(member);
    positions.set(finalAnchorId, axis === "x" ? finalAnchorSlab.x : finalAnchorSlab.y);
    const queue = [finalAnchorId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentPosition = positions.get(currentId)!;
      for (const edge of graph.get(currentId) ?? []) {
        const candidate = currentPosition + edge.delta;
        if (positions.has(edge.other)) {
          const known = positions.get(edge.other)!;
          if (Math.abs(candidate - known) > EPSILON + 1e-3) {
            issues.push({
              level: "error",
              code: "topology-constraint-conflict",
              message: `拓扑约束冲突：约束链闭合误差 ${(Math.abs(candidate - known)).toFixed(1)}mm。建筑尺寸不能静默变形。`,
              slabIds: [currentId, edge.other],
              connectionIds: [edge.connectionId],
              errorMm: Math.abs(candidate - known),
            });
          }
          continue;
        }
        positions.set(edge.other, candidate);
        queue.push(edge.other);
      }
    }
  }
  return { positions, issues };
}

function sideFace(slab: FloorSolvedSlab, side: "west" | "east" | "south" | "north"): number {
  if (side === "west") return slab.x;
  if (side === "east") return slab.x + slab.width;
  if (side === "south") return slab.y;
  return slab.y + slab.height;
}

function tangentialRange(
  vertical: boolean,
  a: FloorSolvedSlab,
  b: FloorSolvedSlab,
): { start: number; end: number } {
  if (vertical) {
    return { start: Math.max(a.y, b.y), end: Math.min(a.y + a.height, b.y + b.height) };
  }
  return { start: Math.max(a.x, b.x), end: Math.min(a.x + a.width, b.x + b.width) };
}

/**
 * 由 Solved 位置计算每条连接的实际 Overlap：
 * Natural Solved Overlap ∩ A Endpoint Range ∩ B Endpoint Range（世界切向坐标求交）。
 */
function computeSolvedConnections(
  plan: FloorPlanState,
  connections: readonly FloorEdgeConnection[],
  positions: { x: Map<string, number>; y: Map<string, number> },
): { solved: FloorSolvedConnection[]; noOverlap: FloorTopologyConstraintIssue[] } {
  const solvedSlabs = new Map<string, FloorSolvedSlab>(plan.slabs.map((slab) => [slab.id, {
    slabId: slab.id,
    sourceX: slab.x,
    sourceY: slab.y,
    x: positions.x.get(slab.id) ?? slab.x,
    y: positions.y.get(slab.id) ?? slab.y,
    width: slab.width,
    height: slab.height,
    offsetX: (positions.x.get(slab.id) ?? slab.x) - slab.x,
    offsetY: (positions.y.get(slab.id) ?? slab.y) - slab.y,
  }]));
  const solved: FloorSolvedConnection[] = [];
  const noOverlap: FloorTopologyConstraintIssue[] = [];
  for (const connection of connections) {
    const a = solvedSlabs.get(connection.a.slabId);
    const b = solvedSlabs.get(connection.b.slabId);
    if (!a || !b) continue;
    const vertical = isVerticalConnection(connection);
    const natural = tangentialRange(vertical, a, b);
    let start = natural.start;
    let end = natural.end;
    const intersect = (slab: FloorSolvedSlab, range: FloorEdgeConnection["a"]["range"]) => {
      if (range.mode !== "offset") return;
      const base = vertical ? slab.y : slab.x;
      start = Math.max(start, base + range.startMm);
      end = Math.min(end, base + range.endMm);
    };
    intersect(a, connection.a.range);
    intersect(b, connection.b.range);
    const lengthMm = end - start;
    const valid = lengthMm > EPSILON;
    if (!valid) {
      noOverlap.push({
        level: "error",
        code: "connection-no-overlap",
        message: "连接共享长度为0：端点区间无交集或角点接触不能形成正式墙。",
        slabIds: [a.slabId, b.slabId],
        connectionIds: [connection.id],
      });
    }
    const baseA = vertical ? a.y : a.x;
    const baseB = vertical ? b.y : b.x;
    solved.push({
      connectionId: connection.id,
      slabIds: [a.slabId, b.slabId] as [string, string],
      orientation: vertical ? "vertical" : "horizontal",
      sideA: connection.a.side,
      sideB: connection.b.side,
      rangeStartMm: start,
      rangeEndMm: end,
      lengthMm: Math.max(lengthMm, 0),
      aOffsetStartMm: start - baseA,
      aOffsetEndMm: end - baseA,
      bOffsetStartMm: start - baseB,
      bOffsetEndMm: end - baseB,
      support: "inner-wall",
      gapMm: 0,
      valid,
    });
  }
  return { solved, noOverlap };
}

export function solveFloorTopology(
  plan: FloorPlanState,
  options?: FloorTopologySolveOptions,
): FloorTopologySolution {
  const issues: FloorTopologyConstraintIssue[] = [];
  const slabs = slabById(plan);
  const connections = plan.connections ?? [];
  // 无效 side pair / 未知引用 / 非法 offset range 先报告并从求解中排除。
  const validConnections: FloorEdgeConnection[] = [];
  for (const connection of connections) {
    const a = slabs.get(connection.a.slabId);
    const b = slabs.get(connection.b.slabId);
    if (!a || !b) {
      issues.push({ level: "error", code: "connection-invalid-side-pair", message: "连接引用了不存在的板区。", connectionIds: [connection.id] });
      continue;
    }
    const validPair = (connection.a.side === "west" && connection.b.side === "east")
      || (connection.a.side === "east" && connection.b.side === "west")
      || (connection.a.side === "south" && connection.b.side === "north")
      || (connection.a.side === "north" && connection.b.side === "south");
    if (!validPair) {
      issues.push({ level: "error", code: "connection-invalid-side-pair", message: "连接边组合非法：只允许平行对向边。", slabIds: [a.id, b.id], connectionIds: [connection.id] });
      continue;
    }
    // Offset Range 必须在 Side 长度内（0 <= start < end <= sideLength），不静默 Clamp。
    let rangeValid = true;
    for (const endpoint of [connection.a, connection.b]) {
      const slab = endpoint.slabId === connection.a.slabId ? a : b;
      if (endpoint.range.mode !== "offset") continue;
      const length = sideLength(slab, endpoint.side);
      if (!Number.isFinite(endpoint.range.startMm) || !Number.isFinite(endpoint.range.endMm)
        || endpoint.range.startMm < -EPSILON || endpoint.range.startMm >= endpoint.range.endMm
        || endpoint.range.endMm > length + EPSILON) {
        issues.push({
          level: "error",
          code: "connection-range-invalid",
          message: `连接“${connection.id}”的端点范围无效：必须位于目标边长度内且起点小于终点。`,
          slabIds: [endpoint.slabId],
          connectionIds: [connection.id],
        });
        rangeValid = false;
      }
    }
    if (!rangeValid) continue;
    validConnections.push(connection);
  }

  // 有限阶段迭代：Gap 由 Support 决定，Support 由实际 Range 决定（≤3 轮，禁止无限递归）。
  const connectionById = new Map(validConnections.map((connection) => [connection.id, connection]));
  const supportByConnection = new Map<string, "inner-wall" | "continuous">();
  const matchingRuleIdsByConnection = new Map<string, string[]>();
  const conflictingSupportsByConnection = new Map<string, string[]>();
  let axisConflicts: FloorTopologyConstraintIssue[] = [];
  let noOverlapIssues: FloorTopologyConstraintIssue[] = [];
  let solvedConnections: FloorSolvedConnection[] = [];
  let positions = { x: new Map<string, number>(), y: new Map<string, number>() };
  const preferredAnchorIdsX = options?.preferredAnchors?.x ? new Set(options.preferredAnchors.x) : undefined;
  const preferredAnchorIdsY = options?.preferredAnchors?.y ? new Set(options.preferredAnchors.y) : undefined;

  for (let pass = 0; pass < MAX_SUPPORT_PASSES; pass += 1) {
    const gapOf = (connection: FloorEdgeConnection) =>
      floorConnectionClearGapMm(connection, plan, supportByConnection.get(connection.id) ?? "inner-wall");
    const xResult = solveAxisGraph(plan, validConnections, slabs, "x", gapOf, preferredAnchorIdsX);
    const yResult = solveAxisGraph(plan, validConnections, slabs, "y", gapOf, preferredAnchorIdsY);
    positions = { x: xResult.positions, y: yResult.positions };
    axisConflicts = [...xResult.issues, ...yResult.issues];
    const computed = computeSolvedConnections(plan, validConnections, positions);
    solvedConnections = computed.solved;
    noOverlapIssues = computed.noOverlap;

    const nextSupport = new Map<string, "inner-wall" | "continuous">();
    const nextMatching = new Map<string, string[]>();
    const nextConflicting = new Map<string, string[]>();
    let changed = false;
    for (const solved of solvedConnections) {
      if (!solved.valid) continue;
      const connection = connectionById.get(solved.connectionId);
      if (!connection) continue;
      const details = resolveFloorConnectionSupportDetails(
        connection,
        plan,
        { start: solved.rangeStartMm, end: solved.rangeEndMm },
        { start: solved.rangeStartMm, end: solved.rangeEndMm },
      );
      nextSupport.set(solved.connectionId, details.support);
      nextMatching.set(solved.connectionId, details.matchingRuleIds);
      nextConflicting.set(solved.connectionId, details.conflictingSupports);
      if (supportByConnection.get(solved.connectionId) !== details.support) changed = true;
    }
    supportByConnection.clear();
    nextSupport.forEach((support, id) => supportByConnection.set(id, support));
    matchingRuleIdsByConnection.clear();
    nextMatching.forEach((ruleIds, id) => matchingRuleIdsByConnection.set(id, ruleIds));
    conflictingSupportsByConnection.clear();
    nextConflicting.forEach((supports, id) => conflictingSupportsByConnection.set(id, supports));
    if (!changed) break;
  }

  // 最终 Support / Gap 写回 Solved Connection。
  const finalSolvedConnections: FloorSolvedConnection[] = solvedConnections.map((solved) => {
    if (!solved.valid) return solved;
    const connection = connectionById.get(solved.connectionId);
    const support = connection
      ? (supportByConnection.get(solved.connectionId) ?? "inner-wall")
      : "inner-wall";
    return {
      ...solved,
      support,
      gapMm: connection ? floorConnectionClearGapMm(connection, plan, support) : 0,
    };
  });

  const solvedSlabs: FloorSolvedSlab[] = plan.slabs.map((slab) => ({
    slabId: slab.id,
    sourceX: slab.x,
    sourceY: slab.y,
    x: positions.x.get(slab.id) ?? slab.x,
    y: positions.y.get(slab.id) ?? slab.y,
    width: slab.width,
    height: slab.height,
    offsetX: (positions.x.get(slab.id) ?? slab.x) - slab.x,
    offsetY: (positions.y.get(slab.id) ?? slab.y) - slab.y,
  }));
  const solvedById = new Map(solvedSlabs.map((item) => [item.slabId, item]));

  // Solved Clear Slab 面积重叠验证（Wall Rect 重叠不算错误，T/L/X 合法）。
  for (let left = 0; left < solvedSlabs.length; left += 1) {
    for (let right = left + 1; right < solvedSlabs.length; right += 1) {
      const a = solvedSlabs[left];
      const b = solvedSlabs[right];
      const overlapWidthMm = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeightMm = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapWidthMm <= EPSILON || overlapHeightMm <= EPSILON) continue;
      issues.push({
        level: "error",
        code: "solved-slab-overlap",
        message: `板区 ${a.slabId} 与 ${b.slabId} 求解后的净空矩形发生 ${overlapWidthMm.toFixed(1)}×${overlapHeightMm.toFixed(1)}mm 面积重叠，约束链无法形成合法物理布局。`,
        slabIds: [a.slabId, b.slabId],
        overlapWidthMm,
        overlapHeightMm,
        overlapAreaMm2: overlapWidthMm * overlapHeightMm,
      });
    }
  }

  // 冲突规则（同一实际 Range 同时命中 inner-wall 与 continuous）→ 确定性安全默认 + Validation Error。
  finalSolvedConnections.forEach((solved) => {
    if (!solved.valid) return;
    const conflicting = conflictingSupportsByConnection.get(solved.connectionId) ?? [];
    if (conflicting.length <= 1) return;
    issues.push({
      level: "error",
      code: "support-rule-conflict",
      message: "同一连接实际区间同时命中相互冲突的支承规则（inner-wall / continuous），已按安全默认内墙处理，请重新设置。",
      slabIds: [...solved.slabIds],
      connectionIds: [solved.connectionId],
      objectIds: matchingRuleIdsByConnection.get(solved.connectionId) ?? [],
    });
  });

  // Walls：inner-wall 连接的实际区间墙带；continuous 不生成墙。
  const walls: FloorSolvedWall[] = [];
  for (const solved of finalSolvedConnections) {
    if (!solved.valid) continue;
    if (solved.support !== "inner-wall") continue;
    const a = solvedById.get(solved.slabIds[0]);
    const b = solvedById.get(solved.slabIds[1]);
    if (!a || !b) continue;
    const faceA = sideFace(a, solved.sideA);
    const faceB = sideFace(b, solved.sideB);
    const wallStart = Math.min(faceA, faceB);
    const wallEnd = Math.max(faceA, faceB);
    const thicknessMm = wallEnd - wallStart;
    if (thicknessMm <= EPSILON) {
      issues.push({ level: "error", code: "connection-no-overlap", message: "连接墙厚为0：clear gap 未解析。", connectionIds: [solved.connectionId] });
      continue;
    }
    walls.push({
      id: `solved-wall:${solved.connectionId}`,
      connectionId: solved.connectionId,
      kind: "inner-wall",
      orientation: solved.orientation,
      x: solved.orientation === "vertical" ? wallStart : solved.rangeStartMm,
      y: solved.orientation === "vertical" ? solved.rangeStartMm : wallStart,
      width: solved.orientation === "vertical" ? thicknessMm : solved.lengthMm,
      height: solved.orientation === "vertical" ? solved.lengthMm : thicknessMm,
      lengthMm: solved.lengthMm,
      thicknessMm,
      slabIds: solved.slabIds,
    });
  }

  // 同一 Slab 同一侧多个连接：Solved 切向范围正长度重叠且指向不同 Slab → 冲突。
  const overlapsBySide = new Map<string, Array<{ start: number; end: number; connectionId: string; otherId: string }>>();
  finalSolvedConnections.forEach((solved) => {
    if (!solved.valid) return;
    for (const [slabId, side, otherId] of [
      [solved.slabIds[0], solved.sideA, solved.slabIds[1]],
      [solved.slabIds[1], solved.sideB, solved.slabIds[0]],
    ] as Array<[string, FloorEdgeSide, string]>) {
      const key = `${slabId}:${side}`;
      const list = overlapsBySide.get(key) ?? [];
      list.push({ start: solved.rangeStartMm, end: solved.rangeEndMm, connectionId: solved.connectionId, otherId });
      overlapsBySide.set(key, list);
    }
  });
  overlapsBySide.forEach((list) => {
    for (let left = 0; left < list.length; left += 1) {
      for (let right = left + 1; right < list.length; right += 1) {
        const overlap = Math.min(list[left].end, list[right].end) - Math.max(list[left].start, list[right].start);
        if (overlap > EPSILON && list[left].otherId !== list[right].otherId) {
          issues.push({
            level: "error",
            code: "connection-overlap-conflict",
            message: "同一边两个连接求解后范围重叠且指向不同板区。",
            connectionIds: [list[left].connectionId, list[right].connectionId],
            errorMm: overlap,
          });
        }
      }
    }
  });

  // Components：有效 Solved Connection 连通性（不含几何接触判断）。
  const adjacency = new Map<string, Set<string>>(plan.slabs.map((slab) => [slab.id, new Set<string>()]));
  finalSolvedConnections.forEach((solved) => {
    if (!solved.valid) return;
    adjacency.get(solved.slabIds[0])?.add(solved.slabIds[1]);
    adjacency.get(solved.slabIds[1])?.add(solved.slabIds[0]);
  });
  const seenComponents = new Set<string>();
  const components: FloorTopologyComponent[] = [];
  [...plan.slabs].sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id)).forEach((slab) => {
    if (seenComponents.has(slab.id)) return;
    const members: string[] = [];
    const queue = [slab.id];
    seenComponents.add(slab.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      members.push(currentId);
      adjacency.get(currentId)?.forEach((nextId) => {
        if (seenComponents.has(nextId)) return;
        seenComponents.add(nextId);
        queue.push(nextId);
      });
    }
    components.push({ id: `topology-component:${members.join("|")}`, slabIds: members, slabCount: members.length });
  });

  issues.push(...axisConflicts, ...noOverlapIssues);

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  solvedSlabs.forEach((slab) => {
    bounds.minX = Math.min(bounds.minX, slab.x);
    bounds.minY = Math.min(bounds.minY, slab.y);
    bounds.maxX = Math.max(bounds.maxX, slab.x + slab.width);
    bounds.maxY = Math.max(bounds.maxY, slab.y + slab.height);
  });
  walls.forEach((wall) => {
    bounds.minX = Math.min(bounds.minX, wall.x);
    bounds.minY = Math.min(bounds.minY, wall.y);
    bounds.maxX = Math.max(bounds.maxX, wall.x + wall.width);
    bounds.maxY = Math.max(bounds.maxY, wall.y + wall.height);
  });
  if (!Number.isFinite(bounds.minX)) {
    return {
      slabs: solvedSlabs,
      solvedConnections: finalSolvedConnections,
      walls,
      components,
      issues,
      bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    };
  }

  return { slabs: solvedSlabs, solvedConnections: finalSolvedConnections, walls, components, issues, bounds };
}

/**
 * 外墙区间（唯一真值）：每条 Solved Slab Side 的 [0, sideLength] 减去该 Side
 * 全部有效 Solved Connection 的覆盖区间，剩余区间生成 building-exterior。
 * Atomic Boundary 与 Physical Layout 必须共用本结果。
 */
export function buildFloorTopologyExteriorRanges(
  plan: FloorPlanState,
  solution: FloorTopologySolution = solveFloorTopology(plan),
): FloorTopologyExteriorRange[] {
  const solvedById = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  const coveredBySide = new Map<string, FloorRange[]>();
  solution.solvedConnections.forEach((solved) => {
    if (!solved.valid) return;
    for (const [slabId, side] of [
      [solved.slabIds[0], solved.sideA],
      [solved.slabIds[1], solved.sideB],
    ] as Array<[string, FloorEdgeSide]>) {
      const slab = solvedById.get(slabId);
      if (!slab) continue;
      const base = solved.orientation === "vertical" ? slab.y : slab.x;
      const key = `${slabId}:${side}`;
      const list = coveredBySide.get(key) ?? [];
      list.push({ start: solved.rangeStartMm - base, end: solved.rangeEndMm - base });
      coveredBySide.set(key, list);
    }
  });
  const ranges: FloorTopologyExteriorRange[] = [];
  for (const slab of solution.slabs) {
    for (const side of SIDES) {
      const vertical = side === "west" || side === "east";
      const length = vertical ? slab.height : slab.width;
      const covered = coveredBySide.get(`${slab.slabId}:${side}`) ?? [];
      const remaining = subtractFloorRanges({ start: 0, end: length }, covered);
      for (const range of remaining) {
        if (range.end - range.start <= EPSILON) continue;
        ranges.push({
          slabId: slab.slabId,
          side,
          startMm: range.start,
          endMm: range.end,
          orientation: vertical ? "vertical" : "horizontal",
        });
      }
    }
  }
  return ranges;
}

function offsetTarget(
  slabId: string,
  side: FloorEdgeSide,
  startMm: number,
  endMm: number,
  sideLengthMm: number,
): FloorSupportRuleTarget {
  const whole = startMm <= EPSILON && endMm >= sideLengthMm - EPSILON;
  return {
    kind: "slab-edge",
    slabId,
    side,
    range: whole ? { mode: "whole" } : { mode: "offset", startMm, endMm },
  };
}

/**
 * Plan V3 Atomic Boundary Segments：来自 Solved Connection + 区间减法外墙。
 * shared-slab 在 V3 中表示“逻辑连接边界”，不再要求两个 Clear Rect 坐标相等；
 * 段坐标取墙体中心线（display coordinate），正式跨墙长度禁止用 endX-startX 推断。
 */
export function buildFloorTopologyBoundarySegmentsV3(
  plan: FloorPlanState,
  solution: FloorTopologySolution = solveFloorTopology(plan),
): FloorAtomicBoundarySegment[] {
  const segments: FloorAtomicBoundarySegment[] = [];
  const solvedById = new Map(solution.slabs.map((item) => [item.slabId, item]));
  for (const solved of solution.solvedConnections) {
    if (!solved.valid) continue;
    const a = solvedById.get(solved.slabIds[0]);
    const b = solvedById.get(solved.slabIds[1]);
    if (!a || !b) continue;
    const lengthA = solved.orientation === "vertical" ? a.height : a.width;
    const lengthB = solved.orientation === "vertical" ? b.height : b.width;
    const targets = [
      offsetTarget(solved.slabIds[0], solved.sideA, solved.aOffsetStartMm, solved.aOffsetEndMm, lengthA),
      offsetTarget(solved.slabIds[1], solved.sideB, solved.bOffsetStartMm, solved.bOffsetEndMm, lengthB),
    ];
    if (solved.support === "inner-wall") {
      const wall = solution.walls.find((item) => item.connectionId === solved.connectionId);
      if (!wall) continue;
      const vertical = wall.orientation === "vertical";
      segments.push({
        id: `atomic:v3:${solved.connectionId}`,
        orientation: wall.orientation,
        startX: vertical ? wall.x + wall.width / 2 : wall.x,
        startY: vertical ? wall.y : wall.y + wall.height / 2,
        endX: vertical ? wall.x + wall.width / 2 : wall.x + wall.width,
        endY: vertical ? wall.y + wall.height : wall.y + wall.height / 2,
        geometryKind: "shared-slab",
        support: "inner-wall",
        thicknessMm: wall.thicknessMm,
        slabIds: [...solved.slabIds].sort(),
        targets,
      });
      continue;
    }
    // continuous：Clear Gap=0，段取两侧 Clear Face 的接触线。
    const faceA = sideFace(a, solved.sideA);
    const faceB = sideFace(b, solved.sideB);
    const contact = (faceA + faceB) / 2;
    const vertical = solved.orientation === "vertical";
    segments.push({
      id: `atomic:v3:${solved.connectionId}`,
      orientation: solved.orientation,
      startX: vertical ? contact : solved.rangeStartMm,
      startY: vertical ? solved.rangeStartMm : contact,
      endX: vertical ? contact : solved.rangeEndMm,
      endY: vertical ? solved.rangeEndMm : contact,
      geometryKind: "shared-slab",
      support: "continuous",
      thicknessMm: 0,
      slabIds: [...solved.slabIds].sort(),
      targets,
    });
  }
  // 外墙：区间减法结果（Partial Side 可生成多段 building-exterior）。
  const exteriorIndex = new Map<string, number>();
  for (const range of buildFloorTopologyExteriorRanges(plan, solution)) {
    const slab = solvedById.get(range.slabId);
    if (!slab) continue;
    const vertical = range.orientation === "vertical";
    const key = `${range.slabId}:${range.side}`;
    const index = exteriorIndex.get(key) ?? 0;
    exteriorIndex.set(key, index + 1);
    const coordinate = vertical
      ? (range.side === "west" ? slab.x : slab.x + slab.width)
      : (range.side === "south" ? slab.y : slab.y + slab.height);
    const start = vertical ? slab.y + range.startMm : slab.x + range.startMm;
    const end = vertical ? slab.y + range.endMm : slab.x + range.endMm;
    const sideLengthMm = vertical ? slab.height : slab.width;
    segments.push({
      id: `atomic:v3:exterior:${range.slabId}:${range.side}:${index}`,
      orientation: range.orientation,
      startX: vertical ? coordinate : start,
      startY: vertical ? start : coordinate,
      endX: vertical ? coordinate : end,
      endY: vertical ? end : coordinate,
      geometryKind: "building-exterior",
      support: "outer-wall",
      thicknessMm: Math.max(plan.outerWallThickness, 0),
      slabIds: [range.slabId],
      targets: [offsetTarget(range.slabId, range.side, range.startMm, range.endMm, sideLengthMm)],
    });
  }
  return segments;
}

/** Plan V3 Slab Adjacency：来自有效 Solved Connections（双端点 Range 求交后的正式区间）。 */
export function buildFloorTopologySlabAdjacency(
  plan: FloorPlanState,
  solution: FloorTopologySolution = solveFloorTopology(plan),
): Array<{
  slabIds: [string, string];
  segmentIds: string[];
  sharedLengthMm: number;
  supports: Array<"inner-wall" | "continuous">;
}> {
  const groups = new Map<string, { slabIds: [string, string]; segmentIds: string[]; sharedLengthMm: number; supports: Array<"inner-wall" | "continuous"> }>();
  for (const solved of solution.solvedConnections) {
    if (!solved.valid || solved.lengthMm <= EPSILON) continue;
    const slabIds = [...solved.slabIds].sort() as [string, string];
    const key = slabIds.join("|");
    const current = groups.get(key) ?? { slabIds, segmentIds: [], sharedLengthMm: 0, supports: [] as Array<"inner-wall" | "continuous"> };
    current.segmentIds.push(`atomic:v3:${solved.connectionId}`);
    current.sharedLengthMm += solved.lengthMm;
    if (!current.supports.includes(solved.support)) current.supports.push(solved.support);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => left.slabIds.join("|").localeCompare(right.slabIds.join("|")));
}
