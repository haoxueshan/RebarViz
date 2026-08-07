export type FloorSlab = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorBoundarySegment = {
  id: string;
  orientation: "horizontal" | "vertical";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  type: "inner-wall" | "outer-wall";
  thicknessMm: number;
  slabIds: string[];
};

export type FloorPlanState = {
  slabs: FloorSlab[];
  innerWallThickness: number;
  outerWallThickness: number;
  snapDistanceMm: number;
};

type Edge = {
  coordinate: number;
  start: number;
  end: number;
  side: "west" | "east" | "south" | "north";
  slabId: string;
};

type AtomicSegment = {
  orientation: "horizontal" | "vertical";
  coordinate: number;
  start: number;
  end: number;
  type: "inner-wall" | "outer-wall";
  thicknessMm: number;
  slabIds: string[];
};

const EPSILON = 1e-7;

export const DEFAULT_FLOOR_PLAN_STATE: FloorPlanState = {
  slabs: [
    { id: "floor-room-a", name: "房间A", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "floor-room-b", name: "房间B", x: 4200, y: 0, width: 3600, height: 3600 },
  ],
  innerWallThickness: 240,
  outerWallThickness: 370,
  snapDistanceMm: 150,
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeFloorPlanState(value: unknown): FloorPlanState {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_FLOOR_PLAN_STATE);
  const candidate = value as Partial<FloorPlanState>;
  const slabs = Array.isArray(candidate.slabs)
    ? candidate.slabs
        .filter((slab): slab is FloorSlab => Boolean(slab && typeof slab === "object"))
        .map((slab, index) => ({
          id: typeof slab.id === "string" && slab.id ? slab.id : `floor-room-${index + 1}`,
          name: typeof slab.name === "string" ? slab.name : `房间${index + 1}`,
          x: finiteNumber(slab.x, 0),
          y: finiteNumber(slab.y, 0),
          width: finiteNumber(slab.width, 3600),
          height: finiteNumber(slab.height, 3600),
        }))
    : [];
  return {
    slabs: slabs.length > 0 ? slabs : structuredClone(DEFAULT_FLOOR_PLAN_STATE.slabs),
    innerWallThickness: finiteNumber(candidate.innerWallThickness, 240),
    outerWallThickness: finiteNumber(candidate.outerWallThickness, 370),
    snapDistanceMm: finiteNumber(candidate.snapDistanceMm, 150),
  };
}

export function floorSlabsOverlap(left: FloorSlab, right: FloorSlab): boolean {
  return (
    left.x < right.x + right.width - EPSILON &&
    left.x + left.width > right.x + EPSILON &&
    left.y < right.y + right.height - EPSILON &&
    left.y + left.height > right.y + EPSILON
  );
}

export function validateFloorPlan(state: FloorPlanState): string[] {
  const errors: string[] = [];
  if (state.slabs.length === 0) errors.push("至少需要一个房间或板块。");
  const ids = new Set<string>();
  state.slabs.forEach((slab, index) => {
    const label = slab.name.trim() || `第${index + 1}个房间`;
    if (!slab.id || ids.has(slab.id)) errors.push(`${label}的ID重复或为空。`);
    ids.add(slab.id);
    if (!slab.name.trim()) errors.push(`第${index + 1}个房间名称不能为空。`);
    if (![slab.x, slab.y].every(Number.isFinite)) errors.push(`${label}的坐标无效。`);
    if (!Number.isFinite(slab.width) || slab.width <= 0) errors.push(`${label}的东西向尺寸必须大于0。`);
    if (!Number.isFinite(slab.height) || slab.height <= 0) errors.push(`${label}的南北向尺寸必须大于0。`);
  });
  if (!Number.isFinite(state.innerWallThickness) || state.innerWallThickness <= 0) errors.push("内墙厚度必须大于0。");
  if (!Number.isFinite(state.outerWallThickness) || state.outerWallThickness <= 0) errors.push("外墙厚度必须大于0。");
  if (!Number.isFinite(state.snapDistanceMm) || state.snapDistanceMm < 0) errors.push("吸附距离不能为负数。");
  for (let leftIndex = 0; leftIndex < state.slabs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < state.slabs.length; rightIndex += 1) {
      if (floorSlabsOverlap(state.slabs[leftIndex], state.slabs[rightIndex])) {
        errors.push(`${state.slabs[leftIndex].name}与${state.slabs[rightIndex].name}发生重叠，请调整位置。`);
      }
    }
  }
  return [...new Set(errors)];
}

function groupEdges(edges: Edge[]): Map<number, Edge[]> {
  const groups = new Map<number, Edge[]>();
  edges.forEach((edge) => {
    const group = groups.get(edge.coordinate) ?? [];
    group.push(edge);
    groups.set(edge.coordinate, group);
  });
  return groups;
}

function buildAtomicSegments(
  orientation: "horizontal" | "vertical",
  edges: Edge[],
  innerWallThickness: number,
  outerWallThickness: number,
): AtomicSegment[] {
  const result: AtomicSegment[] = [];
  groupEdges(edges).forEach((group, coordinate) => {
    const points = [...new Set(group.flatMap((edge) => [edge.start, edge.end]))].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (end - start <= EPSILON) continue;
      const midpoint = (start + end) / 2;
      const covering = group.filter((edge) => edge.start < midpoint + EPSILON && edge.end > midpoint - EPSILON);
      if (covering.length === 0) continue;
      const hasNegativeSide = covering.some((edge) => edge.side === "west" || edge.side === "south");
      const hasPositiveSide = covering.some((edge) => edge.side === "east" || edge.side === "north");
      const type = hasNegativeSide && hasPositiveSide ? "inner-wall" : "outer-wall";
      result.push({
        orientation,
        coordinate,
        start,
        end,
        type,
        thicknessMm: type === "inner-wall" ? innerWallThickness : outerWallThickness,
        slabIds: [...new Set(covering.map((edge) => edge.slabId))].sort(),
      });
    }
  });
  return result;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function mergeAtomicSegments(segments: AtomicSegment[]): AtomicSegment[] {
  const sorted = [...segments].sort(
    (left, right) =>
      left.orientation.localeCompare(right.orientation) ||
      left.coordinate - right.coordinate ||
      left.start - right.start ||
      left.end - right.end,
  );
  const merged: AtomicSegment[] = [];
  sorted.forEach((segment) => {
    const previous = merged.at(-1);
    const canMerge =
      previous &&
      previous.orientation === segment.orientation &&
      Math.abs(previous.coordinate - segment.coordinate) <= EPSILON &&
      Math.abs(previous.end - segment.start) <= EPSILON &&
      previous.type === segment.type &&
      previous.thicknessMm === segment.thicknessMm &&
      (segment.type === "outer-wall" || sameIds(previous.slabIds, segment.slabIds));
    if (canMerge && previous) {
      previous.end = segment.end;
      previous.slabIds = [...new Set([...previous.slabIds, ...segment.slabIds])].sort();
    } else {
      merged.push({ ...segment, slabIds: [...segment.slabIds] });
    }
  });
  return merged;
}

function segmentId(segment: AtomicSegment): string {
  const axis = segment.orientation === "vertical" ? "v" : "h";
  return `wall:${axis}:${segment.type}:${segment.coordinate}:${segment.start}-${segment.end}:${segment.slabIds.join("+")}`;
}

export function buildFloorBoundarySegments(state: FloorPlanState): FloorBoundarySegment[] {
  const verticalEdges: Edge[] = [];
  const horizontalEdges: Edge[] = [];
  state.slabs.forEach((slab) => {
    verticalEdges.push(
      { coordinate: slab.x, start: slab.y, end: slab.y + slab.height, side: "west", slabId: slab.id },
      { coordinate: slab.x + slab.width, start: slab.y, end: slab.y + slab.height, side: "east", slabId: slab.id },
    );
    horizontalEdges.push(
      { coordinate: slab.y, start: slab.x, end: slab.x + slab.width, side: "south", slabId: slab.id },
      { coordinate: slab.y + slab.height, start: slab.x, end: slab.x + slab.width, side: "north", slabId: slab.id },
    );
  });
  const atomic = [
    ...buildAtomicSegments("vertical", verticalEdges, state.innerWallThickness, state.outerWallThickness),
    ...buildAtomicSegments("horizontal", horizontalEdges, state.innerWallThickness, state.outerWallThickness),
  ];
  return mergeAtomicSegments(atomic).map((segment) => ({
    id: segmentId(segment),
    orientation: segment.orientation,
    startX: segment.orientation === "vertical" ? segment.coordinate : segment.start,
    startY: segment.orientation === "vertical" ? segment.start : segment.coordinate,
    endX: segment.orientation === "vertical" ? segment.coordinate : segment.end,
    endY: segment.orientation === "vertical" ? segment.end : segment.coordinate,
    type: segment.type,
    thicknessMm: segment.thicknessMm,
    slabIds: segment.slabIds,
  }));
}

function closestSnap(value: number, candidates: number[], threshold: number): number {
  let best = value;
  let distance = threshold + EPSILON;
  candidates.forEach((candidate) => {
    const nextDistance = Math.abs(candidate - value);
    if (nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  });
  return best;
}

export function snapFloorSlab(
  slab: FloorSlab,
  otherSlabs: readonly FloorSlab[],
  thresholdMm: number,
): FloorSlab {
  const xCandidates = [0];
  const yCandidates = [0];
  otherSlabs.forEach((other) => {
    xCandidates.push(other.x, other.x + other.width, other.x - slab.width, other.x + other.width - slab.width);
    yCandidates.push(other.y, other.y + other.height, other.y - slab.height, other.y + other.height - slab.height);
  });
  return {
    ...slab,
    x: closestSnap(slab.x, xCandidates, Math.max(thresholdMm, 0)),
    y: closestSnap(slab.y, yCandidates, Math.max(thresholdMm, 0)),
  };
}

export function floorPlanBounds(slabs: readonly FloorSlab[]) {
  if (slabs.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return slabs.reduce(
    (bounds, slab) => ({
      minX: Math.min(bounds.minX, slab.x),
      minY: Math.min(bounds.minY, slab.y),
      maxX: Math.max(bounds.maxX, slab.x + Math.max(slab.width, 1)),
      maxY: Math.max(bounds.maxY, slab.y + Math.max(slab.height, 1)),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
