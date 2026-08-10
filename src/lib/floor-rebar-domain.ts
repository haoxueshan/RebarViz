import {
  buildFloorAtomicBoundarySegments,
  buildFloorTopologyCells,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorTopologyCell,
} from "./floor-plan";

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
 * 根据有效楼板 cell 与 continuous 支承建立物理连通域。
 * Opening 是否参与由传入 plan 决定，因此 Role 与 Physical 可以复用同一拓扑实现。
 */
export function buildFloorRebarDomains(
  plan: FloorPlanState,
  idPrefix = "rebar-domain",
): FloorRebarDomain[] {
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
