import {
  directionLabel,
  type AnchorSource,
  type BarDirection,
  type BarLayer,
  type BarLengthVariant,
  type BarResult,
  type SlabCalculation,
  type SlabCalculatorState,
} from "./slab-calculator";
import { allocateLargestRemainder } from "./slab-room-topology";

export const DEFAULT_MAX_LINES_PER_RESULT = 5;
export const SLAB_DIAGRAM_WIDTH = 1000;
export const SLAB_DIAGRAM_HEIGHT = 560;

const PLOT_RECT: DiagramRect = { x: 94, y: 50, width: 820, height: 410 };
const FALLBACK_ROOM_SPAN = 1000;
const FALLBACK_WALL_THICKNESS = 200;
const MAX_SAFE_DRAWING_VALUE = 1_000_000_000;
const EPSILON = 1e-7;

export type DiagramPoint = {
  x: number;
  y: number;
};

export type DiagramRect = DiagramPoint & {
  width: number;
  height: number;
};

export type WorldRect = DiagramRect;

export type WorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type WorldRoom = {
  id: string;
  index: number;
  name: string;
  originalSpanX: number;
  originalSpanY: number;
  rect: WorldRect;
};

export type WorldWallSegment = {
  id: string;
  kind: "outer" | "inner";
  orientation: "horizontal" | "vertical" | "corner";
  outward?: "north" | "south" | "east" | "west";
  thicknessMm: number;
  rect: WorldRect;
  adjacentRoomIds: string[];
};

export type WorldLayout = {
  rooms: WorldRoom[];
  walls: WorldWallSegment[];
  innerWall: number;
  outerWall: number;
  originalInnerWall: number;
  originalOuterWall: number;
  usedFallback: boolean;
  unequalPerpendicularSpans: boolean;
};

export type SlabDiagramRoom = {
  id: string;
  index: number;
  name: string;
  shortName: string;
  spanX: number;
  spanY: number;
  worldRect: WorldRect;
  rect: DiagramRect;
  labelRect: DiagramRect;
  label: string;
};

export type SlabDiagramWall = {
  id: string;
  kind: "outer" | "inner";
  orientation: "horizontal" | "vertical" | "corner";
  thicknessMm: number;
  rect: DiagramRect;
  label: string;
  labelPoint: DiagramPoint;
  showLabel: boolean;
  adjacentRoomIds: string[];
};

export type SlabDiagramSegment = {
  id: string;
  kind: "net" | "anchor-start" | "anchor-end" | "extra-start" | "extra-end";
  start: DiagramPoint;
  end: DiagramPoint;
  compressed?: boolean;
  variantId?: string;
  variantLabel?: string;
};

export type SlabDiagramMarker = {
  id: string;
  label: string;
  variantId: string;
  point: DiagramPoint;
  width: number;
  height: number;
};

export type SlabDiagramVariantLegend = {
  id: string;
  label: string;
  count: number;
  representativeCount: number;
  perpendicularStartMm: number;
  perpendicularEndMm: number;
  startAnchorSource: AnchorSource;
  endAnchorSource: AnchorSource;
  startAnchor: number;
  endAnchor: number;
  startExtraApplied: boolean;
  endExtraApplied: boolean;
  singleLengthM: number;
  totalLengthM: number;
  weightKg: number;
};

export type SlabDiagramBarGroup = {
  resultId: string;
  resultOrder: number;
  resultNumber: string;
  roomId?: string;
  scopeName: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  scopeType: "room" | "through";
  lengthMode: "uniform" | "zoned";
  representativeCount: number;
  netSegments: SlabDiagramSegment[];
  startAnchorSegments: SlabDiagramSegment[];
  endAnchorSegments: SlabDiagramSegment[];
  extraSegments: SlabDiagramSegment[];
  markers: SlabDiagramMarker[];
  specificationLabel: string;
  countLabel: string;
  runLabel: string;
  anchorLabel: string;
  extraLabel: string;
  singleLengthLabel: string;
  totalLengthM: number;
  weightKg: number;
  startExtraApplied: boolean;
  endExtraApplied: boolean;
  variants: SlabDiagramVariantLegend[];
};

export type DiagramSelectionContext =
  | { kind: "filtered" | "current-filters" | "custom"; selectedCount: number; totalCount: number }
  | undefined;

export type SlabDiagramScene = {
  width: number;
  height: number;
  plotRect: DiagramRect;
  worldBounds: WorldBounds;
  scale: number;
  rooms: SlabDiagramRoom[];
  walls: SlabDiagramWall[];
  barGroups: SlabDiagramBarGroup[];
  notes: string[];
  selectionContext: DiagramSelectionContext;
  xAxis: { start: DiagramPoint; end: DiagramPoint };
  yAxis: { start: DiagramPoint; end: DiagramPoint };
};

type CoordinateTransform = {
  scale: number;
  point: (point: DiagramPoint) => DiagramPoint;
  rect: (rect: WorldRect) => DiagramRect;
};

type Footprint = {
  rect: WorldRect;
  adjacentRoomIds: string[];
};

type BoundaryEdge = {
  orientation: "horizontal" | "vertical";
  outward: "north" | "south" | "east" | "west";
  coordinate: number;
  start: number;
  end: number;
  adjacentRoomIds: string[];
};

type WorldBarLine = {
  start: DiagramPoint;
  end: DiagramPoint;
  variant: BarLengthVariant;
  variantIndex: number;
};

type WorldDiagramSegment = Omit<SlabDiagramSegment, "start" | "end"> & {
  start: DiagramPoint;
  end: DiagramPoint;
};

type WorldBarGroup = Omit<
  SlabDiagramBarGroup,
  "netSegments" | "startAnchorSegments" | "endAnchorSegments" | "extraSegments" | "markers" | "variants"
> & {
  netSegments: WorldDiagramSegment[];
  startAnchorSegments: WorldDiagramSegment[];
  endAnchorSegments: WorldDiagramSegment[];
  extraSegments: WorldDiagramSegment[];
  markers: [];
  variants: SlabDiagramVariantLegend[];
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safePositive(value: number, fallback: number): number {
  if (!isFinitePositive(value)) return fallback;
  return Math.min(value, MAX_SAFE_DRAWING_VALUE);
}

function safeNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_SAFE_DRAWING_VALUE);
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  return Number.isFinite(value) ? Math.min(value, Number.MAX_SAFE_INTEGER / 8) : Number.MAX_SAFE_INTEGER / 8;
}

function dimensionText(value: number): string {
  return isFinitePositive(value) ? `${value}` : "待完善";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function pointInsideRect(point: DiagramPoint, rect: WorldRect): boolean {
  return (
    point.x > rect.x - EPSILON &&
    point.x < rect.x + rect.width + EPSILON &&
    point.y > rect.y - EPSILON &&
    point.y < rect.y + rect.height + EPSILON
  );
}

function shortRoomName(name: string, fallback: string): string {
  const normalized = name.trim() || fallback;
  return normalized.length > 10 ? `${normalized.slice(0, 9)}…` : normalized;
}

export function buildWorldRooms(state: SlabCalculatorState): Omit<WorldLayout, "walls"> {
  const arrangement = state.slab.arrangement;
  const innerWall = safePositive(state.slab.innerWallThickness, FALLBACK_WALL_THICKNESS);
  const outerWall = safePositive(state.slab.outerWallThickness, FALLBACK_WALL_THICKNESS);
  let usedFallback =
    !isFinitePositive(state.slab.innerWallThickness) ||
    !isFinitePositive(state.slab.outerWallThickness);
  let cursorX = 0;
  let cursorY = 0;
  const rooms = state.slab.rooms.map<WorldRoom>((room, index) => {
    const width = safePositive(room.spanX, FALLBACK_ROOM_SPAN);
    const height = safePositive(room.spanY, FALLBACK_ROOM_SPAN);
    if (!isFinitePositive(room.spanX) || !isFinitePositive(room.spanY)) usedFallback = true;
    const result: WorldRoom = {
      id: room.id,
      index,
      name: room.name,
      originalSpanX: room.spanX,
      originalSpanY: room.spanY,
      rect: {
        x: arrangement === "x" ? cursorX : 0,
        y: arrangement === "y" ? cursorY : 0,
        width,
        height,
      },
    };
    if (arrangement === "x") cursorX = safeAdd(cursorX, width + innerWall);
    if (arrangement === "y") cursorY = safeAdd(cursorY, height + innerWall);
    return result;
  });
  const perpendicularSpans = rooms.map((room) =>
    arrangement === "x" ? room.rect.height : room.rect.width,
  );
  return {
    rooms,
    innerWall,
    outerWall,
    originalInnerWall: state.slab.innerWallThickness,
    originalOuterWall: state.slab.outerWallThickness,
    usedFallback,
    unequalPerpendicularSpans:
      arrangement !== "single" &&
      perpendicularSpans.length > 1 &&
      perpendicularSpans.some((span) => Math.abs(span - perpendicularSpans[0]) > EPSILON),
  };
}

function buildInnerWalls(
  rooms: readonly WorldRoom[],
  arrangement: SlabCalculatorState["slab"]["arrangement"],
  innerWall: number,
): WorldWallSegment[] {
  if (arrangement === "single") return [];
  return rooms.slice(0, -1).flatMap((room, index) => {
    const next = rooms[index + 1];
    if (!next) return [];
    const overlap = arrangement === "x"
      ? Math.min(room.rect.height, next.rect.height)
      : Math.min(room.rect.width, next.rect.width);
    if (overlap <= 0) return [];
    return [{
      id: `inner-${room.id}-${next.id}`,
      kind: "inner" as const,
      orientation: arrangement === "x" ? "vertical" as const : "horizontal" as const,
      thicknessMm: innerWall,
      rect: arrangement === "x"
        ? { x: room.rect.x + room.rect.width, y: 0, width: innerWall, height: overlap }
        : { x: 0, y: room.rect.y + room.rect.height, width: overlap, height: innerWall },
      adjacentRoomIds: [room.id, next.id],
    }];
  });
}

function occupiedCell(
  xIndex: number,
  yIndex: number,
  xCuts: readonly number[],
  yCuts: readonly number[],
  footprints: readonly Footprint[],
): { occupied: boolean; adjacentRoomIds: string[] } {
  if (xIndex < 0 || yIndex < 0 || xIndex >= xCuts.length - 1 || yIndex >= yCuts.length - 1) {
    return { occupied: false, adjacentRoomIds: [] };
  }
  const point = {
    x: (xCuts[xIndex] + xCuts[xIndex + 1]) / 2,
    y: (yCuts[yIndex] + yCuts[yIndex + 1]) / 2,
  };
  const matching = footprints.filter((footprint) => pointInsideRect(point, footprint.rect));
  return {
    occupied: matching.length > 0,
    adjacentRoomIds: [...new Set(matching.flatMap((footprint) => footprint.adjacentRoomIds))],
  };
}

function mergeBoundaryEdges(edges: BoundaryEdge[]): BoundaryEdge[] {
  const sorted = [...edges].sort((left, right) =>
    left.orientation.localeCompare(right.orientation) ||
    left.outward.localeCompare(right.outward) ||
    left.coordinate - right.coordinate ||
    left.start - right.start,
  );
  return sorted.reduce<BoundaryEdge[]>((merged, edge) => {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.orientation === edge.orientation &&
      previous.outward === edge.outward &&
      Math.abs(previous.coordinate - edge.coordinate) <= EPSILON &&
      edge.start <= previous.end + EPSILON
    ) {
      previous.end = Math.max(previous.end, edge.end);
      previous.adjacentRoomIds = [
        ...new Set([...previous.adjacentRoomIds, ...edge.adjacentRoomIds]),
      ];
      return merged;
    }
    merged.push({ ...edge, adjacentRoomIds: [...edge.adjacentRoomIds] });
    return merged;
  }, []);
}

function boundaryEdges(footprints: readonly Footprint[]): BoundaryEdge[] {
  if (footprints.length === 0) return [];
  const xCuts = uniqueSorted(footprints.flatMap((item) => [item.rect.x, item.rect.x + item.rect.width]));
  const yCuts = uniqueSorted(footprints.flatMap((item) => [item.rect.y, item.rect.y + item.rect.height]));
  const edges: BoundaryEdge[] = [];
  for (let xIndex = 0; xIndex < xCuts.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < yCuts.length - 1; yIndex += 1) {
      const cell = occupiedCell(xIndex, yIndex, xCuts, yCuts, footprints);
      if (!cell.occupied) continue;
      const x0 = xCuts[xIndex];
      const x1 = xCuts[xIndex + 1];
      const y0 = yCuts[yIndex];
      const y1 = yCuts[yIndex + 1];
      if (!occupiedCell(xIndex, yIndex - 1, xCuts, yCuts, footprints).occupied) {
        edges.push({ orientation: "horizontal", outward: "south", coordinate: y0, start: x0, end: x1, adjacentRoomIds: cell.adjacentRoomIds });
      }
      if (!occupiedCell(xIndex, yIndex + 1, xCuts, yCuts, footprints).occupied) {
        edges.push({ orientation: "horizontal", outward: "north", coordinate: y1, start: x0, end: x1, adjacentRoomIds: cell.adjacentRoomIds });
      }
      if (!occupiedCell(xIndex - 1, yIndex, xCuts, yCuts, footprints).occupied) {
        edges.push({ orientation: "vertical", outward: "west", coordinate: x0, start: y0, end: y1, adjacentRoomIds: cell.adjacentRoomIds });
      }
      if (!occupiedCell(xIndex + 1, yIndex, xCuts, yCuts, footprints).occupied) {
        edges.push({ orientation: "vertical", outward: "east", coordinate: x1, start: y0, end: y1, adjacentRoomIds: cell.adjacentRoomIds });
      }
    }
  }
  return mergeBoundaryEdges(edges);
}

function edgeRect(edge: BoundaryEdge, thickness: number): WorldRect {
  if (edge.orientation === "horizontal") {
    return {
      x: edge.start,
      y: edge.outward === "south" ? edge.coordinate - thickness : edge.coordinate,
      width: Math.max(edge.end - edge.start, EPSILON),
      height: thickness,
    };
  }
  return {
    x: edge.outward === "west" ? edge.coordinate - thickness : edge.coordinate,
    y: edge.start,
    width: thickness,
    height: Math.max(edge.end - edge.start, EPSILON),
  };
}

function edgeEndpoints(edge: BoundaryEdge): [DiagramPoint, DiagramPoint] {
  return edge.orientation === "horizontal"
    ? [
        { x: edge.start, y: edge.coordinate },
        { x: edge.end, y: edge.coordinate },
      ]
    : [
        { x: edge.coordinate, y: edge.start },
        { x: edge.coordinate, y: edge.end },
      ];
}

function samePoint(left: DiagramPoint, right: DiagramPoint): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}

function positiveRectIntersection(left: WorldRect, right: WorldRect): boolean {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return width > EPSILON && height > EPSILON;
}

function cornerPatchRect(
  point: DiagramPoint,
  horizontal: BoundaryEdge,
  vertical: BoundaryEdge,
  thickness: number,
): WorldRect {
  return {
    x: vertical.outward === "west" ? point.x - thickness : point.x,
    y: horizontal.outward === "south" ? point.y - thickness : point.y,
    width: thickness,
    height: thickness,
  };
}

/**
 * Outward wall rectangles already overlap at concave corners. A patch is only
 * needed when perpendicular incident rectangles merely touch, which identifies
 * a convex corner without filling an exterior notch at a concave corner.
 */
function buildConvexCornerWalls(
  edges: readonly BoundaryEdge[],
  walls: readonly WorldWallSegment[],
  thickness: number,
): WorldWallSegment[] {
  const patches = new Map<string, WorldWallSegment>();
  edges.forEach((left, leftIndex) => {
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      const right = edges[rightIndex];
      if (left.orientation === right.orientation) continue;
      const sharedPoint = edgeEndpoints(left).find((point) =>
        edgeEndpoints(right).some((candidate) => samePoint(point, candidate)),
      );
      if (!sharedPoint) continue;
      const leftWall = walls[leftIndex];
      const rightWall = walls[rightIndex];
      if (!leftWall || !rightWall || positiveRectIntersection(leftWall.rect, rightWall.rect)) {
        continue;
      }
      const horizontal = left.orientation === "horizontal" ? left : right;
      const vertical = left.orientation === "vertical" ? left : right;
      const key = `${sharedPoint.x}:${sharedPoint.y}`;
      patches.set(key, {
        id: `outer-corner-${sharedPoint.x}-${sharedPoint.y}`,
        kind: "outer",
        orientation: "corner",
        thicknessMm: thickness,
        rect: cornerPatchRect(sharedPoint, horizontal, vertical, thickness),
        adjacentRoomIds: [
          ...new Set([...left.adjacentRoomIds, ...right.adjacentRoomIds]),
        ],
      });
    }
  });
  return [...patches.values()];
}

export function buildWorldWallTopology(
  rooms: readonly WorldRoom[],
  arrangement: SlabCalculatorState["slab"]["arrangement"],
  innerWall: number,
  outerWall: number,
): WorldWallSegment[] {
  const innerWalls = buildInnerWalls(rooms, arrangement, innerWall);
  const footprints: Footprint[] = [
    ...rooms.map((room) => ({ rect: room.rect, adjacentRoomIds: [room.id] })),
    ...innerWalls.map((wall) => ({ rect: wall.rect, adjacentRoomIds: wall.adjacentRoomIds })),
  ];
  const edges = boundaryEdges(footprints);
  const outerWalls = edges.map<WorldWallSegment>((edge) => ({
    id: `outer-${edge.outward}-${edge.coordinate}-${edge.start}-${edge.end}`,
    kind: "outer",
    orientation: edge.orientation,
    outward: edge.outward,
    thicknessMm: outerWall,
    rect: edgeRect(edge, outerWall),
    adjacentRoomIds: edge.adjacentRoomIds,
  }));
  const cornerWalls = buildConvexCornerWalls(edges, outerWalls, outerWall);
  return [...outerWalls, ...cornerWalls, ...innerWalls];
}

export function buildWorldLayout(state: SlabCalculatorState): WorldLayout {
  const base = buildWorldRooms(state);
  return {
    ...base,
    walls: buildWorldWallTopology(
      base.rooms,
      state.slab.arrangement,
      base.innerWall,
      base.outerWall,
    ),
  };
}

export function getRepresentativeCount(
  result: Pick<BarResult, "count"> | null | undefined,
  maxLinesPerResult = DEFAULT_MAX_LINES_PER_RESULT,
): number {
  if (
    !result ||
    !Number.isFinite(result.count) ||
    result.count <= 0 ||
    !Number.isFinite(maxLinesPerResult) ||
    maxLinesPerResult <= 0
  ) return 0;
  return Math.min(Math.trunc(result.count), Math.max(1, Math.trunc(maxLinesPerResult)));
}

export function allocateVariantRepresentativeCounts(
  result: Pick<BarResult, "count" | "lengthVariants"> | null | undefined,
  maxLinesPerResult = DEFAULT_MAX_LINES_PER_RESULT,
): Array<{ variantId: string; count: number }> {
  if (!result || result.lengthVariants.length === 0) return [];
  const total = getRepresentativeCount(result, maxLinesPerResult);
  const allocated = allocateLargestRemainder(
    total,
    result.lengthVariants.map((variant) => variant.count),
  );
  return result.lengthVariants.map((variant, index) => ({
    variantId: variant.id,
    count: allocated[index] ?? 0,
  }));
}

function representativeFractions(count: number, layer: BarLayer): number[] {
  if (count <= 0) return [];
  const localOffset = layer === "top" ? 0.014 : -0.014;
  return Array.from({ length: count }, (_, index) =>
    clamp((index + 1) / (count + 1) + localOffset, 0.06, 0.94),
  );
}

function sourceLabel(source: AnchorSource): string {
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

function endpointLabel(result: BarResult, endpoint: "start" | "end"): string {
  const label = result.direction === "x"
    ? endpoint === "start" ? "西端" : "东端"
    : endpoint === "start" ? "南端" : "北端";
  return result.throughWall ? `最${label}` : label;
}

function actualExtraApplied(result: BarResult, endpoint: "start" | "end"): boolean {
  const selected = endpoint === "start" ? result.startExtraApplied : result.endExtraApplied;
  const source = endpoint === "start"
    ? result.startAnchorSource
    : result.endAnchorSource;
  return result.layer === "top"
    && source === "inner-wall"
    && selected
    && Number.isFinite(result.topExtraValue)
    && result.topExtraValue > 0;
}

export function formatDiagramExtraLabel(result: BarResult): string {
  if (result.layer === "bottom") return "地筋不适用面筋增加值";
  const startApplied = actualExtraApplied(result, "start");
  const endApplied = actualExtraApplied(result, "end");
  const extra = safeNonNegative(result.topExtraValue);
  if (startApplied && endApplied) return `两端实际增加${extra}mm`;
  if (startApplied) return `${endpointLabel(result, "start")}实际增加${extra}mm`;
  if (endApplied) return `${endpointLabel(result, "end")}实际增加${extra}mm`;
  if (result.startAnchorSource === "manual" || result.endAnchorSource === "manual") {
    return "手动锚固为最终值，未叠加增加值";
  }
  return "未实际叠加面筋增加值";
}

function formatVariantAnchor(
  result: BarResult,
  variant: BarLengthVariant,
  endpoint: "start" | "end",
): string {
  const source = endpoint === "start" ? variant.startAnchorSource : variant.endAnchorSource;
  const value = endpoint === "start" ? variant.startAnchor : variant.endAnchor;
  const applied = source === "inner-wall"
    && (endpoint === "start"
      ? variant.startExtraApplied
      : variant.endExtraApplied);
  const suffix = source === "manual"
    ? "（最终值）"
    : result.layer === "top"
      ? applied ? `（已增加${safeNonNegative(result.topExtraValue)}mm）` : "（未增加）"
      : "";
  return `${endpointLabel(result, endpoint)}${sourceLabel(source)}${value}mm${suffix}`;
}

function resultNumber(index: number, total: number): string {
  const width = Math.max(2, String(Math.max(total, 1)).length);
  return `R${String(index + 1).padStart(width, "0")}`;
}

function visualAnchorLength(value: number, runSpan: number, wall: number): { length: number; compressed: boolean } {
  const actual = safeNonNegative(value);
  const maximum = Math.max(wall * 3, Math.min(runSpan * 0.2, 1200), 300);
  return { length: Math.min(actual, maximum), compressed: actual > maximum + EPSILON };
}

function moveAlong(point: DiagramPoint, direction: BarDirection, distance: number): DiagramPoint {
  return direction === "x"
    ? { x: point.x + distance, y: point.y }
    : { x: point.x, y: point.y + distance };
}

function normalWorldLines(
  result: BarResult,
  room: WorldRoom,
  allocation: ReadonlyMap<string, number>,
): WorldBarLine[] {
  return result.lengthVariants.flatMap((variant, variantIndex) => {
    const representativeCount = allocation.get(variant.id) ?? 0;
    const originalPerpendicularSpan = result.direction === "x"
      ? room.originalSpanY
      : room.originalSpanX;
    const worldPerpendicularSpan = result.direction === "x"
      ? room.rect.height
      : room.rect.width;
    const coordinateScale = isFinitePositive(originalPerpendicularSpan)
      ? worldPerpendicularSpan / originalPerpendicularSpan
      : 1;
    const mappedStart = clamp(
      variant.perpendicularStartMm * coordinateScale,
      0,
      worldPerpendicularSpan,
    );
    const mappedEnd = clamp(
      variant.perpendicularEndMm * coordinateScale,
      mappedStart,
      worldPerpendicularSpan,
    );
    const span = Math.max(mappedEnd - mappedStart, 0);
    return representativeFractions(representativeCount, result.layer).map((fraction) => {
      if (result.direction === "x") {
        const y = room.rect.y + mappedStart + span * fraction;
        return {
          start: { x: room.rect.x, y },
          end: { x: room.rect.x + room.rect.width, y },
          variant,
          variantIndex,
        };
      }
      const x = room.rect.x + mappedStart + span * fraction;
      return {
        start: { x, y: room.rect.y },
        end: { x, y: room.rect.y + room.rect.height },
        variant,
        variantIndex,
      };
    });
  });
}

function throughWorldLines(
  result: BarResult,
  rooms: readonly WorldRoom[],
  count: number,
): WorldBarLine[] {
  const first = rooms[0];
  const last = rooms.at(-1);
  const variant = result.lengthVariants[0];
  if (!first || !last || !variant) return [];
  return representativeFractions(count, result.layer).map((fraction) =>
    result.direction === "x"
      ? {
          start: { x: first.rect.x, y: first.rect.y + first.rect.height * fraction },
          end: { x: last.rect.x + last.rect.width, y: first.rect.y + first.rect.height * fraction },
          variant,
          variantIndex: 0,
        }
      : {
          start: { x: first.rect.x + first.rect.width * fraction, y: first.rect.y },
          end: { x: first.rect.x + first.rect.width * fraction, y: last.rect.y + last.rect.height },
          variant,
          variantIndex: 0,
        },
  );
}

function boundaryThickness(source: AnchorSource, layout: WorldLayout): number {
  return source === "inner-wall" ? layout.innerWall : layout.outerWall;
}

function buildWorldBarGroup(
  result: BarResult,
  number: string,
  order: number,
  worldLines: readonly WorldBarLine[],
  variantAllocations: ReadonlyMap<string, number>,
  layout: WorldLayout,
): WorldBarGroup {
  const netSegments: WorldDiagramSegment[] = [];
  const startAnchorSegments: WorldDiagramSegment[] = [];
  const endAnchorSegments: WorldDiagramSegment[] = [];
  const extraSegments: WorldDiagramSegment[] = [];
  worldLines.forEach((line, index) => {
    const startVisual = visualAnchorLength(
      line.variant.startAnchor,
      result.netRunSpanMm,
      boundaryThickness(line.variant.startAnchorSource, layout),
    );
    const endVisual = visualAnchorLength(
      line.variant.endAnchor,
      result.netRunSpanMm,
      boundaryThickness(line.variant.endAnchorSource, layout),
    );
    const startOuter = moveAlong(line.start, result.direction, -startVisual.length);
    const endOuter = moveAlong(line.end, result.direction, endVisual.length);
    const suffix = `${line.variantIndex}-${index}`;
    const variantLabel = result.lengthMode === "zoned"
      ? `${number}-${String.fromCharCode(65 + line.variantIndex)}`
      : number;
    netSegments.push({
      id: `${result.id}-net-${suffix}`,
      kind: "net",
      start: line.start,
      end: line.end,
      variantId: line.variant.id,
      variantLabel,
    });
    if (startVisual.length > 0) {
      startAnchorSegments.push({ id: `${result.id}-anchor-start-${suffix}`, kind: "anchor-start", start: startOuter, end: line.start, compressed: startVisual.compressed });
    }
    if (endVisual.length > 0) {
      endAnchorSegments.push({ id: `${result.id}-anchor-end-${suffix}`, kind: "anchor-end", start: line.end, end: endOuter, compressed: endVisual.compressed });
    }
    const extra = safeNonNegative(result.topExtraValue);
    if (
      line.variant.startAnchorSource === "inner-wall"
      && line.variant.startExtraApplied
      && startVisual.length > 0
    ) {
      const visibleExtra = line.variant.startAnchor > 0
        ? startVisual.length * Math.min(extra / line.variant.startAnchor, 1)
        : 0;
      extraSegments.push({ id: `${result.id}-extra-start-${suffix}`, kind: "extra-start", start: startOuter, end: moveAlong(startOuter, result.direction, visibleExtra) });
    }
    if (
      line.variant.endAnchorSource === "inner-wall"
      && line.variant.endExtraApplied
      && endVisual.length > 0
    ) {
      const visibleExtra = line.variant.endAnchor > 0
        ? endVisual.length * Math.min(extra / line.variant.endAnchor, 1)
        : 0;
      extraSegments.push({ id: `${result.id}-extra-end-${suffix}`, kind: "extra-end", start: moveAlong(endOuter, result.direction, -visibleExtra), end: endOuter });
    }
  });

  const layerLabel = result.layer === "bottom" ? "地筋" : "面筋";
  const typeLabel = result.throughWall
    ? `${directionLabel(result.direction)}通墙筋`
    : `${directionLabel(result.direction)}${layerLabel}`;
  const variants = result.lengthVariants.map<SlabDiagramVariantLegend>((variant, index) => ({
    id: variant.id,
    label: result.lengthMode === "zoned" ? `${number}-${String.fromCharCode(65 + index)}` : number,
    count: variant.count,
    representativeCount: variantAllocations.get(variant.id) ?? 0,
    perpendicularStartMm: variant.perpendicularStartMm,
    perpendicularEndMm: variant.perpendicularEndMm,
    startAnchorSource: variant.startAnchorSource,
    endAnchorSource: variant.endAnchorSource,
    startAnchor: variant.startAnchor,
    endAnchor: variant.endAnchor,
    startExtraApplied: variant.startExtraApplied,
    endExtraApplied: variant.endExtraApplied,
    singleLengthM: variant.singleLengthM,
    totalLengthM: variant.totalLengthM,
    weightKg: variant.weightKg,
  }));
  return {
    resultId: result.id,
    resultOrder: order,
    resultNumber: number,
    roomId: result.roomId,
    scopeName: result.scopeName,
    layer: result.layer,
    direction: result.direction,
    throughWall: result.throughWall,
    scopeType: result.scopeType,
    lengthMode: result.lengthMode,
    representativeCount: worldLines.length,
    netSegments,
    startAnchorSegments,
    endAnchorSegments,
    extraSegments,
    markers: [],
    specificationLabel: `${typeLabel} · Φ${result.diameter}@${result.spacing}`,
    countLabel: `实际${result.count}根（图示${worldLines.length}条代表线）`,
    runLabel: [
      `净跨${result.netRunSpanMm}mm`,
      result.intermediateWallMm > 0 ? `中间墙${result.intermediateWallMm}mm` : null,
    ].filter(Boolean).join(" + "),
    anchorLabel: result.lengthMode === "zoned"
      ? "分区锚固见下方明细"
      : `${formatVariantAnchor(result, result.lengthVariants[0], "start")} → ${formatVariantAnchor(result, result.lengthVariants[0], "end")}`,
    extraLabel: result.lengthMode === "zoned" ? "各分区实际增加端见明细" : formatDiagramExtraLabel(result),
    singleLengthLabel: result.lengthMode === "zoned" ? "多长度（父级值为加权平均）" : `${result.singleLengthM.toFixed(3)}m`,
    totalLengthM: result.totalLengthM,
    weightKg: result.weightKg,
    startExtraApplied: result.startExtraApplied,
    endExtraApplied: result.endExtraApplied,
    variants,
  };
}

export function buildWorldBarGroups(
  state: SlabCalculatorState,
  calculation: SlabCalculation | null | undefined,
  layout: WorldLayout,
  options: { visibleResultIds?: ReadonlySet<string>; maxLinesPerResult?: number } = {},
): WorldBarGroup[] {
  if (!calculation?.isValid) return [];
  const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
  const throughWall = calculation.throughWall;
  const maxLines = options.maxLinesPerResult ?? DEFAULT_MAX_LINES_PER_RESULT;
  return calculation.results.flatMap((result, resultIndex) => {
    if (options.visibleResultIds && !options.visibleResultIds.has(result.id)) return [];
    const totalRepresentatives = getRepresentativeCount(result, maxLines);
    if (totalRepresentatives === 0) return [];
    const variantAllocationList = allocateVariantRepresentativeCounts(result, maxLines);
    const variantAllocations = new Map(variantAllocationList.map((item) => [item.variantId, item.count]));
    let lines: WorldBarLine[] = [];
    if (result.scopeType === "room" && result.roomId) {
      const room = roomById.get(result.roomId);
      if (room) lines = normalWorldLines(result, room, variantAllocations);
    } else if (throughWall && result.id === throughWall.throughBar.id) {
      lines = throughWorldLines(result, layout.rooms, totalRepresentatives);
    }
    return lines.length > 0
      ? [buildWorldBarGroup(
          result,
          resultNumber(resultIndex, calculation.results.length),
          resultIndex,
          lines,
          variantAllocations,
          layout,
        )]
      : [];
  });
}

function includePoint(bounds: WorldBounds, point: DiagramPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function includeRect(bounds: WorldBounds, rect: WorldRect): void {
  includePoint(bounds, { x: rect.x, y: rect.y });
  includePoint(bounds, { x: rect.x + Math.max(rect.width, 0), y: rect.y + Math.max(rect.height, 0) });
}

export function collectWorldBounds(
  rooms: readonly WorldRoom[],
  walls: readonly WorldWallSegment[],
  barGroups: readonly WorldBarGroup[],
): WorldBounds {
  const bounds: WorldBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  rooms.forEach((room) => includeRect(bounds, room.rect));
  walls.forEach((wall) => includeRect(bounds, wall.rect));
  barGroups.forEach((group) => {
    [group.netSegments, group.startAnchorSegments, group.endAnchorSegments, group.extraSegments]
      .flat()
      .forEach((segment) => {
        includePoint(bounds, segment.start);
        includePoint(bounds, segment.end);
      });
  });
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    return { minX: 0, minY: 0, maxX: FALLBACK_ROOM_SPAN, maxY: FALLBACK_ROOM_SPAN };
  }
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(Math.min(Math.max(width, height) * 0.035, 1000), 80);
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

export function createTransform(bounds: WorldBounds, plotRect: DiagramRect): CoordinateTransform {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.max(Math.min(plotRect.width / width, plotRect.height / height), Number.EPSILON);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = plotRect.x + (plotRect.width - renderedWidth) / 2;
  const offsetY = plotRect.y + (plotRect.height - renderedHeight) / 2;
  const point = ({ x, y }: DiagramPoint): DiagramPoint => ({
    x: offsetX + (x - bounds.minX) * scale,
    y: offsetY + (bounds.maxY - y) * scale,
  });
  return {
    scale,
    point,
    rect: (rect) => {
      const northWest = point({ x: rect.x, y: rect.y + rect.height });
      return {
        x: northWest.x,
        y: northWest.y,
        width: Math.max(rect.width, 0) * scale,
        height: Math.max(rect.height, 0) * scale,
      };
    },
  };
}

function transformWorldSegment(segment: WorldDiagramSegment, transform: CoordinateTransform): SlabDiagramSegment {
  return { ...segment, start: transform.point(segment.start), end: transform.point(segment.end) };
}

const MARKER_HEIGHT = 19;
const MARKER_GAP = 4;

export function getDiagramMarkerRect(
  marker: Pick<SlabDiagramMarker, "point" | "width" | "height">,
): DiagramRect {
  return {
    x: marker.point.x - marker.width / 2,
    y: marker.point.y - marker.height / 2,
    width: marker.width,
    height: marker.height,
  };
}

function markerWidth(label: string): number {
  return Math.max(34, label.length * 8 + 12);
}

function expandRect(rect: DiagramRect, amount: number): DiagramRect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function rectsOverlap(left: DiagramRect, right: DiagramRect): boolean {
  return (
    left.x < right.x + right.width - EPSILON &&
    left.x + left.width > right.x + EPSILON &&
    left.y < right.y + right.height - EPSILON &&
    left.y + left.height > right.y + EPSILON
  );
}

function rectWithin(rect: DiagramRect, container: DiagramRect): boolean {
  return (
    rect.x >= container.x - EPSILON &&
    rect.y >= container.y - EPSILON &&
    rect.x + rect.width <= container.x + container.width + EPSILON &&
    rect.y + rect.height <= container.y + container.height + EPSILON
  );
}

function rotateValues<T>(values: readonly T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function markerCandidatePoints(
  group: SlabDiagramBarGroup,
  variantId: string,
  variantIndex: number,
): DiagramPoint[] {
  const matching = group.netSegments.filter((segment) => segment.variantId === variantId);
  const segments = rotateValues(matching, group.resultOrder + variantIndex);
  const fractions = rotateValues(
    [0.14, 0.86, 0.29, 0.71, 0.43, 0.57],
    group.resultOrder + variantIndex,
  );
  const offsets = rotateValues(
    [-14, 14, -28, 28, 0],
    group.resultOrder + variantIndex,
  );
  const points: DiagramPoint[] = [];
  segments.forEach((segment) => {
    fractions.forEach((fraction) => {
      const base = {
        x: segment.start.x + (segment.end.x - segment.start.x) * fraction,
        y: segment.start.y + (segment.end.y - segment.start.y) * fraction,
      };
      offsets.forEach((offset) => {
        points.push(group.direction === "x"
          ? { x: base.x, y: base.y + offset }
          : { x: base.x + offset, y: base.y });
      });
    });
  });
  return points;
}

function markerFits(
  marker: SlabDiagramMarker,
  allowedRect: DiagramRect,
  fixedObstacles: readonly DiagramRect[],
  placedRects: readonly DiagramRect[],
): boolean {
  if (![marker.point.x, marker.point.y, marker.width, marker.height].every(Number.isFinite)) {
    return false;
  }
  const rect = getDiagramMarkerRect(marker);
  return (
    rectWithin(rect, allowedRect) &&
    fixedObstacles.every((obstacle) => !rectsOverlap(rect, obstacle)) &&
    placedRects.every((placed) => !rectsOverlap(expandRect(rect, MARKER_GAP), placed))
  );
}

function gridFallbackPoints(width: number, height: number): DiagramPoint[] {
  const points: DiagramPoint[] = [];
  const left = PLOT_RECT.x + width / 2 + 3;
  const right = PLOT_RECT.x + PLOT_RECT.width - width / 2 - 3;
  const top = PLOT_RECT.y + height / 2 + 3;
  const bottom = PLOT_RECT.y + PLOT_RECT.height - height / 2 - 3;
  for (let y = top; y <= bottom + EPSILON; y += height + MARKER_GAP + 2) {
    for (let x = left; x <= right + EPSILON; x += width + MARKER_GAP + 2) {
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * Places every visible result badge in one deterministic pass. Candidate
 * points stay tied to formal net segments first; a plot grid is used only
 * when dense/narrow geometry leaves no collision-free on-line position.
 */
function layoutGroupMarkers(
  groups: readonly SlabDiagramBarGroup[],
  rooms: readonly SlabDiagramRoom[],
  walls: readonly SlabDiagramWall[],
): SlabDiagramBarGroup[] {
  const allowedRect = {
    x: PLOT_RECT.x + 2,
    y: PLOT_RECT.y + 2,
    width: PLOT_RECT.width - 4,
    height: PLOT_RECT.height - 4,
  };
  const fixedObstacles = [
    ...rooms.map((room) => expandRect(room.labelRect, 3)),
    ...walls.map((wall) => expandRect(wall.rect, 1)),
  ];
  const placedRects: DiagramRect[] = [];

  return groups.map((group) => {
    const markers = group.variants.flatMap((variant, variantIndex) => {
      if (variant.representativeCount <= 0) return [];
      const segment = group.netSegments.find((item) => item.variantId === variant.id);
      if (!segment) return [];
      const label = segment.variantLabel ?? variant.label;
      const markerBase = {
        id: `${group.resultId}-marker-${variant.id}`,
        label,
        variantId: variant.id,
        width: markerWidth(label),
        height: MARKER_HEIGHT,
      };
      const candidates = [
        ...markerCandidatePoints(group, variant.id, variantIndex),
        ...gridFallbackPoints(markerBase.width, markerBase.height),
      ];
      const point = candidates.find((candidate) => markerFits(
        { ...markerBase, point: candidate },
        allowedRect,
        fixedObstacles,
        placedRects,
      ));
      if (!point) return [];
      const marker: SlabDiagramMarker = { ...markerBase, point };
      placedRects.push(getDiagramMarkerRect(marker));
      return [marker];
    });
    return { ...group, markers };
  });
}

function wallLabelPoint(rect: DiagramRect): DiagramPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 + 4 };
}

function roomLabelRect(rect: DiagramRect): DiagramRect {
  const horizontalInset = Math.min(3, rect.width / 4);
  const verticalInset = Math.min(3, rect.height / 4);
  const availableWidth = Math.max(rect.width - horizontalInset * 2, 0);
  const availableHeight = Math.max(rect.height - verticalInset * 2, 0);
  const width = Math.min(150, availableWidth);
  const height = Math.min(39, availableHeight);
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function wallLabelIds(walls: readonly { wall: WorldWallSegment; rect: DiagramRect }[]): Set<string> {
  const selected = new Set<string>();
  (["outer", "inner"] as const).forEach((kind) => {
    const candidate = walls
      .filter((item) => item.wall.kind === kind && item.wall.orientation !== "corner")
      .sort((left, right) =>
        (right.wall.orientation === "horizontal" ? right.rect.width : right.rect.height) -
        (left.wall.orientation === "horizontal" ? left.rect.width : left.rect.height),
      )[0];
    const tangentLength = candidate
      ? candidate.wall.orientation === "horizontal" ? candidate.rect.width : candidate.rect.height
      : 0;
    if (candidate && tangentLength >= 72) selected.add(candidate.wall.id);
  });
  return selected;
}

export function transformScene(
  layout: WorldLayout,
  worldBarGroups: readonly WorldBarGroup[],
  bounds: WorldBounds,
  selectionContext: DiagramSelectionContext,
  preview = false,
): SlabDiagramScene {
  const transform = createTransform(bounds, PLOT_RECT);
  const rooms = layout.rooms.map<SlabDiagramRoom>((room) => {
    const rect = transform.rect(room.rect);
    return {
      id: room.id,
      index: room.index,
      name: room.name,
      shortName: shortRoomName(room.name, `房间${room.index + 1}`),
      spanX: room.originalSpanX,
      spanY: room.originalSpanY,
      worldRect: room.rect,
      rect,
      labelRect: roomLabelRect(rect),
      label: `${room.name || `房间${room.index + 1}`} · ${dimensionText(room.originalSpanX)}×${dimensionText(room.originalSpanY)}mm`,
    };
  });
  const transformedWalls = layout.walls.map((wall) => ({ wall, rect: transform.rect(wall.rect) }));
  const labelIds = wallLabelIds(transformedWalls);
  const walls = transformedWalls.map<SlabDiagramWall>(({ wall, rect }) => ({
    id: wall.id,
    kind: wall.kind,
    orientation: wall.orientation,
    thicknessMm: wall.thicknessMm,
    rect,
    label: `${wall.kind === "outer" ? "外墙" : "内墙"}${dimensionText(
      wall.kind === "outer" ? layout.originalOuterWall : layout.originalInnerWall,
    )}${wall.kind === "outer"
      ? isFinitePositive(layout.originalOuterWall) ? "mm" : ""
      : isFinitePositive(layout.originalInnerWall) ? "mm" : ""}`,
    labelPoint: wallLabelPoint(rect),
    showLabel: labelIds.has(wall.id),
    adjacentRoomIds: wall.adjacentRoomIds,
  }));
  const transformedBarGroups = worldBarGroups.map<SlabDiagramBarGroup>((group) => {
    const transformed: SlabDiagramBarGroup = {
      ...group,
      netSegments: group.netSegments.map((segment) => transformWorldSegment(segment, transform)),
      startAnchorSegments: group.startAnchorSegments.map((segment) => transformWorldSegment(segment, transform)),
      endAnchorSegments: group.endAnchorSegments.map((segment) => transformWorldSegment(segment, transform)),
      extraSegments: group.extraSegments.map((segment) => transformWorldSegment(segment, transform)),
      markers: [],
    };
    return transformed;
  });
  const barGroups = layoutGroupMarkers(transformedBarGroups, rooms, walls);
  const notes = [
    preview
      ? "房间净尺寸与墙厚按统一世界坐标及实际比例显示。"
      : "房间、墙体、钢筋和锚固使用统一世界坐标；钢筋线为代表线。",
  ];
  if (layout.unequalPerpendicularSpans) notes.push("普通多房间按起点侧对齐示意。");
  if (layout.usedFallback) notes.push("输入尺寸待完善，布局使用安全绘图回退值；标签仍显示原始输入。");
  if (selectionContext) {
    const prefix = selectionContext.kind === "custom"
      ? "自定义选择"
      : selectionContext.kind === "current-filters"
        ? "当前筛选"
        : "结果筛选";
    notes.push(`${prefix} ${selectionContext.selectedCount}/${selectionContext.totalCount} 项。`);
  }
  return {
    width: SLAB_DIAGRAM_WIDTH,
    height: SLAB_DIAGRAM_HEIGHT,
    plotRect: { ...PLOT_RECT },
    worldBounds: bounds,
    scale: transform.scale,
    rooms,
    walls,
    barGroups,
    notes,
    selectionContext,
    xAxis: {
      start: { x: PLOT_RECT.x + 12, y: 502 },
      end: { x: PLOT_RECT.x + PLOT_RECT.width - 12, y: 502 },
    },
    yAxis: {
      start: { x: 52, y: PLOT_RECT.y + PLOT_RECT.height - 6 },
      end: { x: 52, y: PLOT_RECT.y + 6 },
    },
  };
}

export function buildSlabDiagramScene(
  state: SlabCalculatorState,
  calculation?: SlabCalculation | null,
  options: {
    visibleResultIds?: ReadonlySet<string>;
    maxLinesPerResult?: number;
    selectionContext?: DiagramSelectionContext;
  } = {},
): SlabDiagramScene {
  const layout = buildWorldLayout(state);
  const worldBarGroups = buildWorldBarGroups(state, calculation, layout, options);
  const bounds = collectWorldBounds(layout.rooms, layout.walls, worldBarGroups);
  return transformScene(
    layout,
    worldBarGroups,
    bounds,
    options.selectionContext,
    calculation === undefined || calculation === null,
  );
}
