import {
  buildFloorAtomicBoundarySegments,
  buildFloorTopologyCells,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorTopologyCell,
} from "./floor-plan";
import {
  solveFloorTopology,
  type FloorTopologySolution,
} from "./floor-topology-solver";

export type FloorRebarDomain = {
  id: string;
  slabIds: string[];
  cellIds: string[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const GEOMETRY_EPSILON_MM = 1e-7;

function cellSharedEdge(
  left: FloorTopologyCell,
  right: FloorTopologyCell,
): { orientation: "horizontal" | "vertical"; coordinate: number; start: number; end: number } | null {
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (overlapY > GEOMETRY_EPSILON_MM && (Math.abs(left.x + left.width - right.x) <= GEOMETRY_EPSILON_MM || Math.abs(right.x + right.width - left.x) <= GEOMETRY_EPSILON_MM)) {
    return {
      orientation: "vertical",
      coordinate: Math.abs(left.x + left.width - right.x) <= GEOMETRY_EPSILON_MM ? right.x : left.x,
      start: Math.max(left.y, right.y),
      end: Math.min(left.y + left.height, right.y + right.height),
    };
  }
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  if (overlapX > GEOMETRY_EPSILON_MM && (Math.abs(left.y + left.height - right.y) <= GEOMETRY_EPSILON_MM || Math.abs(right.y + right.height - left.y) <= GEOMETRY_EPSILON_MM)) {
    return {
      orientation: "horizontal",
      coordinate: Math.abs(left.y + left.height - right.y) <= GEOMETRY_EPSILON_MM ? right.y : left.y,
      start: Math.max(left.x, right.x),
      end: Math.min(left.x + left.width, right.x + right.width),
    };
  }
  return null;
}

function atomicCoversEdge(
  segment: FloorAtomicBoundarySegment,
  edge: NonNullable<ReturnType<typeof cellSharedEdge>>,
): boolean {
  if (segment.orientation !== edge.orientation) return false;
  if (edge.orientation === "vertical") {
    return Math.abs(segment.startX - edge.coordinate) <= GEOMETRY_EPSILON_MM &&
      segment.startY < edge.end - GEOMETRY_EPSILON_MM && segment.endY > edge.start + GEOMETRY_EPSILON_MM;
  }
  return Math.abs(segment.startY - edge.coordinate) <= GEOMETRY_EPSILON_MM &&
    segment.startX < edge.end - GEOMETRY_EPSILON_MM && segment.endX > edge.start + GEOMETRY_EPSILON_MM;
}

/**
 * Plan V3 物理连通域：来自 Solved Connections（continuous 连通，inner-wall 分隔）。
 * 不再用 Legacy Cells / Rect Touch；域几何取 Solved Clear Rect 并集。
 * 正式钢筋长度算法（V1.4C）完成前，Bottom/Top 计算对 V3 有 Safety Guard。
 */
function buildFloorRebarDomainsV3(
  plan: FloorPlanState,
  idPrefix: string,
  precomputedSolution?: FloorTopologySolution,
): FloorRebarDomain[] {
  const solution = precomputedSolution ?? solveFloorTopology(plan);
  const solvedById = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  const graph = new Map<string, Set<string>>(plan.slabs.map((slab) => [slab.id, new Set<string>()]));
  solution.solvedConnections.forEach((solved) => {
    if (!solved.valid || solved.support !== "continuous") return;
    graph.get(solved.slabIds[0])?.add(solved.slabIds[1]);
    graph.get(solved.slabIds[1])?.add(solved.slabIds[0]);
  });
  const visited = new Set<string>();
  const domains: FloorRebarDomain[] = [];
  [...plan.slabs].sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id)).forEach((slab) => {
    if (visited.has(slab.id)) return;
    const members: string[] = [];
    const queue = [slab.id];
    visited.add(slab.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      members.push(currentId);
      graph.get(currentId)?.forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    members.sort();
    const bounds = members.reduce((acc, id) => {
      const item = solvedById.get(id);
      if (!item) return acc;
      return {
        minX: Math.min(acc.minX, item.x),
        minY: Math.min(acc.minY, item.y),
        maxX: Math.max(acc.maxX, item.x + item.width),
        maxY: Math.max(acc.maxY, item.y + item.height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    domains.push({
      id: `${idPrefix}:v3:${members.join("|")}`,
      slabIds: members,
      cellIds: [],
      minX: Number.isFinite(bounds.minX) ? bounds.minX : slab.x,
      minY: Number.isFinite(bounds.minY) ? bounds.minY : slab.y,
      maxX: Number.isFinite(bounds.maxX) ? bounds.maxX : slab.x + slab.width,
      maxY: Number.isFinite(bounds.maxY) ? bounds.maxY : slab.y + slab.height,
    });
  });
  return domains.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 根据有效楼板 cell 与 continuous 支承建立物理连通域。
 * Opening 是否参与由传入 plan 决定，因此 Role 与 Physical 可以复用同一拓扑实现。
 */
export function buildFloorRebarDomains(
  plan: FloorPlanState,
  idPrefix = "rebar-domain",
  precomputedSolution?: FloorTopologySolution,
): FloorRebarDomain[] {
  if (plan.coordinateModel === "clear-space-physical-v2") {
    return buildFloorRebarDomainsV3(plan, idPrefix, precomputedSolution);
  }
  const cells = buildFloorTopologyCells(plan).filter(
    (cell): cell is FloorTopologyCell & { effectiveSlabId: string } => Boolean(cell.effectiveSlabId),
  );
  const atomic = buildFloorAtomicBoundarySegments(plan);
  const graph = new Map(cells.map((cell) => [cell.id, new Set<string>()]));

  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      const left = cells[leftIndex];
      const right = cells[rightIndex];
      const edge = cellSharedEdge(left, right);
      if (!edge) continue;
      const connected = left.effectiveSlabId === right.effectiveSlabId || atomic.some(
        (segment) => segment.geometryKind === "shared-slab" &&
          segment.support === "continuous" &&
          segment.slabIds.includes(left.effectiveSlabId) &&
          segment.slabIds.includes(right.effectiveSlabId) &&
          atomicCoversEdge(segment, edge),
      );
      if (!connected) continue;
      graph.get(left.id)?.add(right.id);
      graph.get(right.id)?.add(left.id);
    }
  }

  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const visited = new Set<string>();
  const domains: FloorRebarDomain[] = [];
  cells.forEach((cell) => {
    if (visited.has(cell.id)) return;
    const queue = [cell.id];
    const component: FloorTopologyCell[] = [];
    visited.add(cell.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = cellsById.get(currentId);
      if (current) component.push(current);
      graph.get(currentId)?.forEach((nextId) => {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      });
    }
    const cellIds = component.map((item) => item.id).sort();
    const slabIds = [...new Set(component.flatMap((item) => item.effectiveSlabId ? [item.effectiveSlabId] : []))].sort();
    domains.push({
      id: `${idPrefix}:${cellIds.join("|")}`,
      slabIds,
      cellIds,
      minX: Math.min(...component.map((item) => item.x)),
      minY: Math.min(...component.map((item) => item.y)),
      maxX: Math.max(...component.map((item) => item.x + item.width)),
      maxY: Math.max(...component.map((item) => item.y + item.height)),
    });
  });
  return domains.sort((left, right) => left.minY - right.minY || left.minX - right.minX || left.id.localeCompare(right.id));
}
