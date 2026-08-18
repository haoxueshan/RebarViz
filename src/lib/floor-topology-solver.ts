import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorSlab,
  type FloorSupportRuleTarget,
} from "./floor-plan";
import {
  floorConnectionClearGapMm,
  resolveFloorConnectionSupport,
  type FloorEdgeConnection,
} from "./floor-topology";

/**
 * Floor Topology V1.4A Constraint Solver：X Axis / Y Axis 分离求解。
 *
 * - Connection 产生法向墙厚约束（inner-wall → gap=墙厚；continuous → gap=0）。
 * - tangentConstraint（lock-start）只对 Full-Full 连接产生切向等式。
 * - Anchor 保持建筑原始参考位置（sourceX/sourceY 最小 + 稳定 tie-break）。
 * - Constraint Cycle 闭合误差不平均分摊：报告 topology-constraint-conflict。
 * - Wall Rect 允许在 T/L/X 节点重叠；Slab Clear Rect 禁止面积重叠。
 */
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

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
    | "connection-overlap-conflict";
  message: string;
  slabIds?: string[];
  connectionIds?: string[];
  errorMm?: number;
};

export type FloorTopologySolution = {
  slabs: FloorSolvedSlab[];
  walls: FloorSolvedWall[];
  components: FloorTopologyComponent[];
  issues: FloorTopologyConstraintIssue[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
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
  positions: Map<string, number>,
  issues: FloorTopologyConstraintIssue[],
): void {
  const graph = new Map<string, AxisEdge[]>(plan.slabs.map((slab) => [slab.id, []]));
  const addEdge = (fromId: string, edge: AxisEdge) => {
    graph.get(fromId)?.push(edge);
  };
  for (const connection of connections) {
    const a = slabs.get(connection.a.slabId);
    const b = slabs.get(connection.b.slabId);
    if (!a || !b) continue;
    const support = resolveFloorConnectionSupport(connection, plan);
    const gapMm = floorConnectionClearGapMm(connection, plan, support);
    const vertical = isVerticalConnection(connection);
    const normalAxis = vertical ? "x" : "y";
    if (normalAxis === axis) {
      const delta = normalDelta(connection, a, b, gapMm);
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
  // 每个连通分量独立 Anchor：原始 source 坐标最小的 Slab（稳定 tie-break）。
  const visited = new Set<string>();
  for (const startSlab of [...plan.slabs].sort((left, right) =>
    (axis === "x" ? left.x - right.x || left.y - right.y : left.y - right.y || left.x - right.x)
    || left.id.localeCompare(right.id))) {
    if (visited.has(startSlab.id)) continue;
    visited.add(startSlab.id);
    positions.set(startSlab.id, axis === "x" ? startSlab.x : startSlab.y);
    const queue = [startSlab.id];
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
        visited.add(edge.other);
        queue.push(edge.other);
      }
    }
  }
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

export function solveFloorTopology(plan: FloorPlanState): FloorTopologySolution {
  const issues: FloorTopologyConstraintIssue[] = [];
  const slabs = slabById(plan);
  const connections = plan.connections ?? [];
  // 无效 side pair 先报告并从求解中排除。
  const validConnections: FloorEdgeConnection[] = [];
  for (const connection of connections) {
    const a = slabs.get(connection.a.slabId);
    const b = slabs.get(connection.b.slabId);
    if (!a || !b) {
      issues.push({ level: "error", code: "connection-invalid-side-pair", message: "连接引用了不存在的板区。", connectionIds: [connection.id] });
      continue;
    }
    const valid = (connection.a.side === "west" && connection.b.side === "east")
      || (connection.a.side === "east" && connection.b.side === "west")
      || (connection.a.side === "south" && connection.b.side === "north")
      || (connection.a.side === "north" && connection.b.side === "south");
    if (!valid) {
      issues.push({ level: "error", code: "connection-invalid-side-pair", message: "连接边组合非法：只允许平行对向边。", slabIds: [a.id, b.id], connectionIds: [connection.id] });
      continue;
    }
    validConnections.push(connection);
  }
  const xPositions = new Map<string, number>();
  const yPositions = new Map<string, number>();
  solveAxisGraph(plan, validConnections, slabs, "x", xPositions, issues);
  solveAxisGraph(plan, validConnections, slabs, "y", yPositions, issues);

  const solvedSlabs: FloorSolvedSlab[] = plan.slabs.map((slab) => ({
    slabId: slab.id,
    sourceX: slab.x,
    sourceY: slab.y,
    x: xPositions.get(slab.id) ?? slab.x,
    y: yPositions.get(slab.id) ?? slab.y,
    width: slab.width,
    height: slab.height,
    offsetX: (xPositions.get(slab.id) ?? slab.x) - slab.x,
    offsetY: (yPositions.get(slab.id) ?? slab.y) - slab.y,
  }));
  const solvedById = new Map(solvedSlabs.map((item) => [item.slabId, item]));

  // Walls：inner-wall 连接的墙带；continuous 不生成墙。
  const walls: FloorSolvedWall[] = [];
  for (const connection of validConnections) {
    const support = resolveFloorConnectionSupport(connection, plan);
    if (support !== "inner-wall") continue;
    const a = solvedById.get(connection.a.slabId);
    const b = solvedById.get(connection.b.slabId);
    if (!a || !b) continue;
    const vertical = isVerticalConnection(connection);
    const faceA = sideFace(a, connection.a.side);
    const faceB = sideFace(b, connection.b.side);
    const wallStart = Math.min(faceA, faceB);
    const wallEnd = Math.max(faceA, faceB);
    const thicknessMm = wallEnd - wallStart;
    if (thicknessMm <= EPSILON) {
      issues.push({ level: "error", code: "connection-no-overlap", message: "连接墙厚为0：clear gap 未解析。", connectionIds: [connection.id] });
      continue;
    }
    let range = tangentialRange(vertical, a, b);
    if (connection.a.range.mode === "offset") {
      const offset = connection.a.range;
      const base = vertical ? a.y : a.x;
      range = {
        start: Math.max(range.start, base + offset.startMm),
        end: Math.min(range.end, base + offset.endMm),
      };
    }
    if (range.end - range.start <= EPSILON) {
      issues.push({ level: "error", code: "connection-no-overlap", message: "连接共享长度为0：角点接触不能形成正式墙。", slabIds: [a.slabId, b.slabId], connectionIds: [connection.id] });
      continue;
    }
    walls.push({
      id: `solved-wall:${connection.id}`,
      connectionId: connection.id,
      kind: "inner-wall",
      orientation: vertical ? "vertical" : "horizontal",
      x: vertical ? wallStart : range.start,
      y: vertical ? range.start : wallStart,
      width: vertical ? thicknessMm : range.end - range.start,
      height: vertical ? range.end - range.start : thicknessMm,
      lengthMm: range.end - range.start,
      thicknessMm,
      slabIds: [a.slabId, b.slabId] as [string, string],
    });
  }

  // 同一 Slab 同一侧多个连接：Solved 切向范围正长度重叠且指向不同 Slab → 冲突。
  // 登记每条连接的两侧端点（同一边可连接多个 Slab，PRD 14）。
  const overlapsBySide = new Map<string, Array<{ start: number; end: number; connectionId: string; otherId: string }>>();
  walls.forEach((wall) => {
    const connection = connections.find((item) => item.id === wall.connectionId);
    if (!connection) return;
    const range = verticalRangeOfWall(wall);
    for (const endpoint of [connection.a, connection.b]) {
      const key = `${endpoint.slabId}:${endpoint.side}`;
      const list = overlapsBySide.get(key) ?? [];
      list.push({ ...range, connectionId: connection.id, otherId: endpoint.slabId === connection.a.slabId ? connection.b.slabId : connection.a.slabId });
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

  // Components：Connection 连通性（不含几何接触判断）。
  const adjacency = new Map<string, Set<string>>(plan.slabs.map((slab) => [slab.id, new Set<string>()]));
  validConnections.forEach((connection) => {
    adjacency.get(connection.a.slabId)?.add(connection.b.slabId);
    adjacency.get(connection.b.slabId)?.add(connection.a.slabId);
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
  if (!Number.isFinite(bounds.minX)) return {
    slabs: solvedSlabs,
    walls,
    components,
    issues,
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  };

  return { slabs: solvedSlabs, walls, components, issues, bounds };
}

function verticalRangeOfWall(wall: FloorSolvedWall): { start: number; end: number } {
  return wall.orientation === "vertical"
    ? { start: wall.y, end: wall.y + wall.height }
    : { start: wall.x, end: wall.x + wall.width };
}

function targetForConnection(
  slabId: string,
  side: "west" | "east" | "south" | "north",
  range: FloorEdgeConnection["a"]["range"],
): FloorSupportRuleTarget {
  return {
    kind: "slab-edge",
    slabId,
    side,
    range: range.mode === "auto-overlap" ? { mode: "whole" } : { mode: "offset", startMm: range.startMm, endMm: range.endMm },
  };
}

/**
 * Plan V3 Atomic Boundary Segments：来自 Connection + Solved Overlap。
 * shared-slab 在 V3 中表示“逻辑连接边界”，不再要求两个 Clear Rect 坐标相等；
 * 段坐标取墙体中心线（display coordinate），正式跨墙长度禁止用 endX-startX 推断。
 */
export function buildFloorTopologyBoundarySegmentsV3(plan: FloorPlanState): FloorAtomicBoundarySegment[] {
  const solution = solveFloorTopology(plan);
  const segments: FloorAtomicBoundarySegment[] = [];
  for (const connection of plan.connections ?? []) {
    const support = resolveFloorConnectionSupport(connection, plan);
    const wall = solution.walls.find((item) => item.connectionId === connection.id);
    const a = solution.slabs.find((item) => item.slabId === connection.a.slabId);
    const b = solution.slabs.find((item) => item.slabId === connection.b.slabId);
    if (!a || !b) continue;
    const vertical = connection.a.side === "west" || connection.a.side === "east";
    if (support === "inner-wall" && wall) {
      segments.push({
        id: `atomic:v3:${connection.id}`,
        orientation: wall.orientation,
        startX: vertical ? wall.x + wall.width / 2 : wall.x,
        startY: vertical ? wall.y : wall.y + wall.height / 2,
        endX: vertical ? wall.x + wall.width / 2 : wall.x + wall.width,
        endY: vertical ? wall.y + wall.height : wall.y + wall.height / 2,
        geometryKind: "shared-slab",
        support: "inner-wall",
        thicknessMm: wall.thicknessMm,
        slabIds: [...wall.slabIds].sort(),
        targets: [
          targetForConnection(connection.a.slabId, connection.a.side, connection.a.range),
          targetForConnection(connection.b.slabId, connection.b.side, connection.b.range),
        ],
      });
      continue;
    }
    // continuous：Clear Gap=0，段取两侧 Clear Face 的接触线。
    const faceA = sideFace(a, connection.a.side);
    const faceB = sideFace(b, connection.b.side);
    const contact = (faceA + faceB) / 2;
    const tangential = tangentialRange(vertical, a, b);
    if (tangential.end - tangential.start <= EPSILON) continue;
    segments.push({
      id: `atomic:v3:${connection.id}`,
      orientation: vertical ? "vertical" : "horizontal",
      startX: vertical ? contact : tangential.start,
      startY: vertical ? tangential.start : contact,
      endX: vertical ? contact : tangential.end,
      endY: vertical ? tangential.end : contact,
      geometryKind: "shared-slab",
      support: "continuous",
      thicknessMm: 0,
      slabIds: [a.slabId, b.slabId].sort(),
      targets: [
        targetForConnection(connection.a.slabId, connection.a.side, connection.a.range),
        targetForConnection(connection.b.slabId, connection.b.side, connection.b.range),
      ],
    });
  }
  // 外墙：没有 Connection 覆盖的板边 → building-exterior 整边段（厚度放净空外侧，V1.4A 简化）。
  const covered = new Map<string, boolean>();
  for (const connection of plan.connections ?? []) {
    covered.set(`${connection.a.slabId}:${connection.a.side}`, true);
    covered.set(`${connection.b.slabId}:${connection.b.side}`, true);
  }
  for (const slab of solution.slabs) {
    const sides: Array<"west" | "east" | "south" | "north"> = ["west", "east", "south", "north"];
    for (const side of sides) {
      if (covered.get(`${slab.slabId}:${side}`)) continue;
      const vertical = side === "west" || side === "east";
      const coordinate = vertical ? (side === "west" ? slab.x : slab.x + slab.width) : (side === "south" ? slab.y : slab.y + slab.height);
      const start = vertical ? slab.y : slab.x;
      const end = vertical ? slab.y + slab.height : slab.x + slab.width;
      segments.push({
        id: `atomic:v3:exterior:${slab.slabId}:${side}`,
        orientation: vertical ? "vertical" : "horizontal",
        startX: vertical ? coordinate : start,
        startY: vertical ? start : coordinate,
        endX: vertical ? coordinate : end,
        endY: vertical ? end : coordinate,
        geometryKind: "building-exterior",
        support: "outer-wall",
        thicknessMm: Math.max(plan.outerWallThickness, 0),
        slabIds: [slab.slabId],
        targets: [{ kind: "slab-edge", slabId: slab.slabId, side, range: { mode: "whole" } }],
      });
    }
  }
  return segments;
}

/** Plan V3 Slab Adjacency：来自 connections 与 solved overlap。 */
export function buildFloorTopologySlabAdjacency(plan: FloorPlanState): Array<{
  slabIds: [string, string];
  segmentIds: string[];
  sharedLengthMm: number;
  supports: Array<"inner-wall" | "continuous">;
}> {
  const solution = solveFloorTopology(plan);
  const groups = new Map<string, { slabIds: [string, string]; segmentIds: string[]; sharedLengthMm: number; supports: Array<"inner-wall" | "continuous"> }>();
  for (const connection of plan.connections ?? []) {
    const wall = solution.walls.find((item) => item.connectionId === connection.id);
    const support = resolveFloorConnectionSupport(connection, plan);
    const a = solution.slabs.find((item) => item.slabId === connection.a.slabId);
    const b = solution.slabs.find((item) => item.slabId === connection.b.slabId);
    if (!a || !b) continue;
    const lengthMm = wall ? wall.lengthMm : (tangentialRange(connection.a.side === "west" || connection.a.side === "east", a, b).end - (tangentialRange(connection.a.side === "west" || connection.a.side === "east", a, b).start));
    if (lengthMm <= EPSILON) continue;
    const slabIds = [a.slabId, b.slabId].sort() as [string, string];
    const key = slabIds.join("|");
    const current = groups.get(key) ?? { slabIds, segmentIds: [], sharedLengthMm: 0, supports: [] as Array<"inner-wall" | "continuous"> };
    current.segmentIds.push(`atomic:v3:${connection.id}`);
    current.sharedLengthMm += lengthMm;
    if (!current.supports.includes(support)) current.supports.push(support);
    groups.set(key, current);
  }
  return [...groups.values()];
}
