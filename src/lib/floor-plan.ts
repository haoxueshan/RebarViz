import type { FloorEdgeConnection } from "./floor-topology";
import { parseFloorConnections } from "./floor-topology";

export type FloorCoordinateModel = "net-layout-v1" | "clear-space-physical-v2";

export type FloorSlabType = "room" | "corridor" | "hall" | "balcony" | "other";
export type FloorOpeningType = "stair" | "shaft" | "void" | "other";
export type FloorEdgeSide = "west" | "east" | "south" | "north";
export type FloorBoundaryGeometryKind = "building-exterior" | "shared-slab" | "opening-edge";
export type FloorResolvedSupport = "outer-wall" | "inner-wall" | "continuous" | "opening-cut";

export type FloorSlab = {
  id: string;
  name: string;
  type: FloorSlabType;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorOpening = {
  id: string;
  name: string;
  type: FloorOpeningType;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorEdgeRange =
  | { mode: "whole" }
  | { mode: "offset"; startMm: number; endMm: number };

export type FloorSupportRuleTarget =
  | { kind: "slab-edge"; slabId: string; side: FloorEdgeSide; range: FloorEdgeRange }
  | { kind: "opening-edge"; openingId: string; side: FloorEdgeSide; range: FloorEdgeRange };

export type FloorSupportRule = {
  id: string;
  target: FloorSupportRuleTarget;
  support: "inner-wall" | "continuous" | "opening-cut";
};

export type FloorPlanState = {
  /**
   * net-layout-v1：旧模型——只有 Net 坐标精确共边才形成 shared-slab。
   * clear-space-physical-v2（Plan V3）：slab.x/y 是净空矩形在建筑物理平面中的参考位置，
   * 正式拓扑来自 connections；inner-wall 真实占据净空之间的物理空间（Clear Gap = 墙厚）。
   */
  coordinateModel: FloorCoordinateModel;
  slabs: FloorSlab[];
  openings: FloorOpening[];
  supportRules: FloorSupportRule[];
  /**
   * Plan V3 正式建筑拓扑（Canonical，必须保存）。
   * 与 Derived 的 Physical Walls / Solved Slabs 不同。
   */
  connections?: FloorEdgeConnection[];
  innerWallThickness: number;
  outerWallThickness: number;
  snapDistanceMm: number;
  /** 几何对齐容差：小于该值的边缘重叠/间隙自动纠偏为精确共边；0 为严格模式。 */
  overlapToleranceMm: number;
};

export type FloorTopologyCell = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseSlabId: string | null;
  openingIds: string[];
  effectiveSlabId: string | null;
};

export type FloorAtomicBoundarySegment = {
  id: string;
  orientation: "horizontal" | "vertical";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  geometryKind: FloorBoundaryGeometryKind;
  support: FloorResolvedSupport;
  thicknessMm: number;
  slabIds: string[];
  openingId?: string;
  targets: FloorSupportRuleTarget[];
};

/** 显示边界可以合并相邻原子段；钢筋和通墙等正式计算必须使用 Atomic Boundary。 */
export type FloorBoundarySegment = FloorAtomicBoundarySegment & {
  /** V1兼容字段。V2中它等于已解析的support，不再代表纯几何关系。 */
  type: FloorResolvedSupport;
  atomicIds: string[];
};

export type FloorPlanIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorOpeningCoverage = {
  openingId: string;
  openingAreaMm2: number;
  coveredAreaMm2: number;
  coverageRatio: number;
};

export type FloorSlabAdjacency = {
  slabIds: [string, string];
  segmentIds: string[];
  sharedLengthMm: number;
  supports: FloorResolvedSupport[];
};

export type FloorNearMiss = {
  slabIds: [string, string];
  orientation: "vertical" | "horizontal";
  sideA: FloorEdgeSide;
  sideB: FloorEdgeSide;
  distanceMm: number;
  coordinateA: number;
  coordinateB: number;
  overlapStartMm: number;
  overlapEndMm: number;
};

export type FloorOpeningNearMiss = {
  openingId: string;
  slabId: string;
  orientation: "vertical" | "horizontal";
  openingSide: FloorEdgeSide;
  slabSide: FloorEdgeSide;
  distanceMm: number;
  overlapStartMm: number;
  overlapEndMm: number;
};

type FloorRect = { x: number; y: number; width: number; height: number };
type AtomicCandidate = Omit<FloorAtomicBoundarySegment, "id" | "support" | "thicknessMm">;

export const FLOOR_GEOMETRY_EPSILON_MM = 1e-7;
export const FLOOR_TOPOLOGY_NEAR_MISS_TOLERANCE_MM = 5;
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
const SLAB_TYPES: readonly FloorSlabType[] = ["room", "corridor", "hall", "balcony", "other"];
const OPENING_TYPES: readonly FloorOpeningType[] = ["stair", "shaft", "void", "other"];
const SIDES: readonly FloorEdgeSide[] = ["west", "east", "south", "north"];

export const DEFAULT_FLOOR_PLAN_STATE: FloorPlanState = {
  coordinateModel: "net-layout-v1",
  slabs: [
    { id: "floor-slab-a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "floor-slab-b", name: "板区B", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
  ],
  openings: [],
  supportRules: [],
  innerWallThickness: 240,
  outerWallThickness: 370,
  snapDistanceMm: 150,
  overlapToleranceMm: 10,
};

/**
 * Floor坐标是“净跨拓扑坐标”，用于拼接有板区域，而不是含墙厚的建筑物理坐标。
 * 未来任何正式钢筋长度都禁止直接使用 endX-startX；必须组合净跨、经过墙厚、
 * 端部规则与Opening裁断后计算。
 */

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isSlabType(value: unknown): value is FloorSlabType {
  return typeof value === "string" && SLAB_TYPES.includes(value as FloorSlabType);
}

function isOpeningType(value: unknown): value is FloorOpeningType {
  return typeof value === "string" && OPENING_TYPES.includes(value as FloorOpeningType);
}

function normalizeRange(value: unknown): FloorEdgeRange {
  if (!isObject(value) || value.mode !== "offset") return { mode: "whole" };
  return {
    mode: "offset",
    startMm: finiteNumber(value.startMm, 0),
    endMm: finiteNumber(value.endMm, 0),
  };
}

function normalizeTarget(value: unknown): FloorSupportRuleTarget | null {
  if (!isObject(value) || !SIDES.includes(value.side as FloorEdgeSide)) return null;
  if (value.kind === "slab-edge" && typeof value.slabId === "string") {
    return { kind: "slab-edge", slabId: value.slabId, side: value.side as FloorEdgeSide, range: normalizeRange(value.range) };
  }
  if (value.kind === "opening-edge" && typeof value.openingId === "string") {
    return { kind: "opening-edge", openingId: value.openingId, side: value.side as FloorEdgeSide, range: normalizeRange(value.range) };
  }
  return null;
}

export function normalizeFloorPlanState(value: unknown): FloorPlanState {
  if (!isObject(value)) return structuredClone(DEFAULT_FLOOR_PLAN_STATE);
  const hasSlabsField = Object.prototype.hasOwnProperty.call(value, "slabs");
  const slabs = Array.isArray(value.slabs)
    ? value.slabs.filter(isObject).map((slab, index): FloorSlab => ({
        id: typeof slab.id === "string" && slab.id ? slab.id : `floor-slab-${index + 1}`,
        name: typeof slab.name === "string" ? slab.name : `板区${index + 1}`,
        type: isSlabType(slab.type) ? slab.type : "room",
        x: finiteNumber(slab.x, 0),
        y: finiteNumber(slab.y, 0),
        width: finiteNumber(slab.width, 3600),
        height: finiteNumber(slab.height, 3600),
      }))
    : structuredClone(DEFAULT_FLOOR_PLAN_STATE.slabs);
  const openings = Array.isArray(value.openings)
    ? value.openings.filter(isObject).map((opening, index): FloorOpening => ({
        id: typeof opening.id === "string" && opening.id ? opening.id : `floor-opening-${index + 1}`,
        name: typeof opening.name === "string" ? opening.name : `洞口${index + 1}`,
        type: isOpeningType(opening.type) ? opening.type : "other",
        x: finiteNumber(opening.x, 0),
        y: finiteNumber(opening.y, 0),
        width: finiteNumber(opening.width, 2400),
        height: finiteNumber(opening.height, 2400),
      }))
    : [];
  const supportRules = Array.isArray(value.supportRules)
    ? value.supportRules.flatMap((rule, index): FloorSupportRule[] => {
        if (!isObject(rule)) return [];
        const target = normalizeTarget(rule.target);
        if (!target || !["inner-wall", "continuous", "opening-cut"].includes(String(rule.support))) return [];
        return [{
          id: typeof rule.id === "string" && rule.id ? rule.id : `floor-support-rule-${index + 1}`,
          target,
          support: rule.support as FloorSupportRule["support"],
        }];
      })
    : [];
  return {
    coordinateModel: "net-layout-v1",
    slabs: hasSlabsField && Array.isArray(value.slabs) ? slabs : structuredClone(DEFAULT_FLOOR_PLAN_STATE.slabs),
    openings,
    supportRules,
    innerWallThickness: finiteNumber(value.innerWallThickness, 240),
    outerWallThickness: finiteNumber(value.outerWallThickness, 370),
    snapDistanceMm: finiteNumber(value.snapDistanceMm, 150),
    overlapToleranceMm: Math.min(30, Math.max(0, finiteNumber(value.overlapToleranceMm, 10))),
  };
}

/**
 * Plan V3 归一化：coordinateModel 允许 net-layout-v1（旧项目兼容）与 clear-space-physical-v2；
 * connections 经严格解析（非法 side pair / 重复指向同一 Slab / 未知 Slab 被拒绝）。
 */
export function normalizeFloorPlanStateV3(value: unknown): FloorPlanState {
  const base = normalizeFloorPlanState(value);
  const coordinateModel: FloorCoordinateModel = isObject(value) && value.coordinateModel === "clear-space-physical-v2"
    ? "clear-space-physical-v2"
    : "net-layout-v1";
  const slabIds = new Set(base.slabs.map((slab) => slab.id));
  const connections = isObject(value) ? parseFloorConnections(value.connections, slabIds) : [];
  // 仅 clear-space-physical-v2 模型写入正式 connections 字段；net-layout-v1 保持无字段（旧项目兼容）。
  if (coordinateModel === "clear-space-physical-v2") {
    return { ...base, coordinateModel, connections };
  }
  return { ...base, coordinateModel };
}

function rectsOverlap(left: FloorRect, right: FloorRect): boolean {
  return left.x < right.x + right.width - EPSILON && left.x + left.width > right.x + EPSILON && left.y < right.y + right.height - EPSILON && left.y + left.height > right.y + EPSILON;
}

export function floorSlabsOverlap(left: FloorSlab, right: FloorSlab): boolean {
  return rectsOverlap(left, right);
}

export function floorOpeningsOverlap(left: FloorOpening, right: FloorOpening): boolean {
  return rectsOverlap(left, right);
}

export function floorOpeningIntersectsSlab(opening: FloorOpening, slab: FloorSlab): boolean {
  return rectsOverlap(opening, slab);
}

function positiveRangeOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): [number, number] | null {
  const start = Math.max(leftStart, rightStart);
  const end = Math.min(leftEnd, rightEnd);
  return end - start > EPSILON ? [start, end] : null;
}

/**
 * 检测视觉上近似相接、但尚未达到正式几何重合精度的板边。
 * 该函数只报告问题，不修改FloorPlan坐标，也不放大正式Geometry EPSILON。
 */
export function findFloorSlabNearMisses(
  state: Pick<FloorPlanState, "slabs">,
  toleranceMm = FLOOR_TOPOLOGY_NEAR_MISS_TOLERANCE_MM,
): FloorNearMiss[] {
  const tolerance = Number.isFinite(toleranceMm) ? Math.max(toleranceMm, 0) : FLOOR_TOPOLOGY_NEAR_MISS_TOLERANCE_MM;
  const nearMisses: FloorNearMiss[] = [];
  for (let leftIndex = 0; leftIndex < state.slabs.length; leftIndex += 1) {
    const left = state.slabs[leftIndex];
    if (![left.x, left.y, left.width, left.height].every(Number.isFinite) || left.width <= 0 || left.height <= 0) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < state.slabs.length; rightIndex += 1) {
      const right = state.slabs[rightIndex];
      if (![right.x, right.y, right.width, right.height].every(Number.isFinite) || right.width <= 0 || right.height <= 0) continue;
      const yOverlap = positiveRangeOverlap(left.y, left.y + left.height, right.y, right.y + right.height);
      if (yOverlap) {
        const verticalCandidates: Array<[number, number, FloorEdgeSide, FloorEdgeSide]> = [
          [left.x + left.width, right.x, "east", "west"],
          [left.x, right.x + right.width, "west", "east"],
        ];
        verticalCandidates.forEach(([coordinateA, coordinateB, sideA, sideB]) => {
          const distanceMm = sideA === "east" ? coordinateB - coordinateA : coordinateA - coordinateB;
          if (distanceMm <= EPSILON || distanceMm > tolerance) return;
          nearMisses.push({
            slabIds: [left.id, right.id],
            orientation: "vertical",
            sideA,
            sideB,
            distanceMm,
            coordinateA,
            coordinateB,
            overlapStartMm: yOverlap[0],
            overlapEndMm: yOverlap[1],
          });
        });
      }
      const xOverlap = positiveRangeOverlap(left.x, left.x + left.width, right.x, right.x + right.width);
      if (xOverlap) {
        const horizontalCandidates: Array<[number, number, FloorEdgeSide, FloorEdgeSide]> = [
          [left.y + left.height, right.y, "north", "south"],
          [left.y, right.y + right.height, "south", "north"],
        ];
        horizontalCandidates.forEach(([coordinateA, coordinateB, sideA, sideB]) => {
          const distanceMm = sideA === "north" ? coordinateB - coordinateA : coordinateA - coordinateB;
          if (distanceMm <= EPSILON || distanceMm > tolerance) return;
          nearMisses.push({
            slabIds: [left.id, right.id],
            orientation: "horizontal",
            sideA,
            sideB,
            distanceMm,
            coordinateA,
            coordinateB,
            overlapStartMm: xOverlap[0],
            overlapEndMm: xOverlap[1],
          });
        });
      }
    }
  }
  return nearMisses.sort((left, right) =>
    left.slabIds.join("|").localeCompare(right.slabIds.join("|"))
    || left.orientation.localeCompare(right.orientation)
    || left.overlapStartMm - right.overlapStartMm
    || left.coordinateA - right.coordinateA);
}

/**
 * 检测洞口边与楼板边视觉上接近、但尚未真正对齐的情况。
 * 只报告问题，不修改坐标，也不放大正式 Geometry EPSILON。
 */
export function findOpeningSlabNearMisses(
  state: Pick<FloorPlanState, "openings" | "slabs">,
  toleranceMm = FLOOR_TOPOLOGY_NEAR_MISS_TOLERANCE_MM,
): FloorOpeningNearMiss[] {
  const tolerance = Number.isFinite(toleranceMm) ? Math.max(toleranceMm, 0) : FLOOR_TOPOLOGY_NEAR_MISS_TOLERANCE_MM;
  const nearMisses: FloorOpeningNearMiss[] = [];
  state.openings.forEach((opening) => {
    if (![opening.x, opening.y, opening.width, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0) return;
    state.slabs.forEach((slab) => {
      if (![slab.x, slab.y, slab.width, slab.height].every(Number.isFinite) || slab.width <= 0 || slab.height <= 0) return;
      const yOverlap = positiveRangeOverlap(opening.y, opening.y + opening.height, slab.y, slab.y + slab.height);
      if (yOverlap) {
        const verticalCandidates: Array<[number, number, FloorEdgeSide, FloorEdgeSide]> = [
          [opening.x + opening.width, slab.x, "east", "west"],
          [opening.x, slab.x + slab.width, "west", "east"],
        ];
        verticalCandidates.forEach(([coordinateA, coordinateB, sideA, sideB]) => {
          const distanceMm = sideA === "east" ? coordinateB - coordinateA : coordinateA - coordinateB;
          if (distanceMm <= EPSILON || distanceMm > tolerance) return;
          nearMisses.push({
            openingId: opening.id,
            slabId: slab.id,
            orientation: "vertical",
            openingSide: sideA,
            slabSide: sideB,
            distanceMm,
            overlapStartMm: yOverlap[0],
            overlapEndMm: yOverlap[1],
          });
        });
      }
      const xOverlap = positiveRangeOverlap(opening.x, opening.x + opening.width, slab.x, slab.x + slab.width);
      if (xOverlap) {
        const horizontalCandidates: Array<[number, number, FloorEdgeSide, FloorEdgeSide]> = [
          [opening.y + opening.height, slab.y, "north", "south"],
          [opening.y, slab.y + slab.height, "south", "north"],
        ];
        horizontalCandidates.forEach(([coordinateA, coordinateB, sideA, sideB]) => {
          const distanceMm = sideA === "north" ? coordinateB - coordinateA : coordinateA - coordinateB;
          if (distanceMm <= EPSILON || distanceMm > tolerance) return;
          nearMisses.push({
            openingId: opening.id,
            slabId: slab.id,
            orientation: "horizontal",
            openingSide: sideA,
            slabSide: sideB,
            distanceMm,
            overlapStartMm: xOverlap[0],
            overlapEndMm: xOverlap[1],
          });
        });
      }
    });
  });
  return nearMisses.sort((left, right) =>
    left.openingId.localeCompare(right.openingId)
    || left.slabId.localeCompare(right.slabId)
    || left.orientation.localeCompare(right.orientation)
    || left.overlapStartMm - right.overlapStartMm);
}

function intersectionArea(left: FloorRect, right: FloorRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

export function floorOpeningCoverage(opening: FloorOpening, slabs: readonly FloorSlab[]): FloorOpeningCoverage {
  const openingAreaMm2 = Math.max(opening.width, 0) * Math.max(opening.height, 0);
  const coveredAreaMm2 = slabs.reduce((sum, slab) => sum + intersectionArea(opening, slab), 0);
  return {
    openingId: opening.id,
    openingAreaMm2,
    coveredAreaMm2,
    coverageRatio: openingAreaMm2 > 0 ? Math.min(coveredAreaMm2 / openingAreaMm2, 1) : 0,
  };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function edgeLength(object: FloorRect, side: FloorEdgeSide): number {
  return side === "west" || side === "east" ? object.height : object.width;
}

function targetObject(target: FloorSupportRuleTarget, state: FloorPlanState): FloorRect | undefined {
  return target.kind === "slab-edge"
    ? state.slabs.find((slab) => slab.id === target.slabId)
    : state.openings.find((opening) => opening.id === target.openingId);
}

function ruleBreakpoints(state: FloorPlanState): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  state.supportRules.forEach((rule) => {
    if (rule.target.range.mode !== "offset") return;
    const object = targetObject(rule.target, state);
    if (!object) return;
    const start = Math.max(0, Math.min(edgeLength(object, rule.target.side), rule.target.range.startMm));
    const end = Math.max(0, Math.min(edgeLength(object, rule.target.side), rule.target.range.endMm));
    if (rule.target.side === "west" || rule.target.side === "east") y.push(object.y + start, object.y + end);
    else x.push(object.x + start, object.x + end);
  });
  return { x, y };
}

function containsPoint(rect: FloorRect, x: number, y: number): boolean {
  return x > rect.x - EPSILON && x < rect.x + rect.width + EPSILON && y > rect.y - EPSILON && y < rect.y + rect.height + EPSILON;
}

export function buildFloorTopologyCells(state: FloorPlanState): FloorTopologyCell[] {
  const validSlabs = state.slabs.filter((slab) => slab.width > 0 && slab.height > 0 && [slab.x, slab.y, slab.width, slab.height].every(Number.isFinite));
  const validOpenings = state.openings.filter((opening) => opening.width > 0 && opening.height > 0 && [opening.x, opening.y, opening.width, opening.height].every(Number.isFinite));
  if (validSlabs.length === 0 && validOpenings.length === 0) return [];
  const breaks = ruleBreakpoints(state);
  const xs = uniqueSorted([
    ...validSlabs.flatMap((slab) => [slab.x, slab.x + slab.width]),
    ...validOpenings.flatMap((opening) => [opening.x, opening.x + opening.width]),
    ...breaks.x,
  ]);
  const ys = uniqueSorted([
    ...validSlabs.flatMap((slab) => [slab.y, slab.y + slab.height]),
    ...validOpenings.flatMap((opening) => [opening.y, opening.y + opening.height]),
    ...breaks.y,
  ]);
  const cells: FloorTopologyCell[] = [];
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const x = xs[xIndex];
      const y = ys[yIndex];
      const width = xs[xIndex + 1] - x;
      const height = ys[yIndex + 1] - y;
      if (width <= EPSILON || height <= EPSILON) continue;
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const baseSlab = validSlabs.find((slab) => containsPoint(slab, centerX, centerY));
      const openingIds = validOpenings.filter((opening) => containsPoint(opening, centerX, centerY)).map((opening) => opening.id).sort();
      cells.push({
        id: `cell:${x}-${x + width}:${y}-${y + height}`,
        x,
        y,
        width,
        height,
        baseSlabId: baseSlab?.id ?? null,
        openingIds,
        effectiveSlabId: baseSlab && openingIds.length === 0 ? baseSlab.id : null,
      });
    }
  }
  return cells;
}

function offsetRange(object: FloorRect, side: FloorEdgeSide, startX: number, startY: number, endX: number, endY: number): FloorEdgeRange {
  const startMm = side === "west" || side === "east" ? Math.min(startY, endY) - object.y : Math.min(startX, endX) - object.x;
  const endMm = side === "west" || side === "east" ? Math.max(startY, endY) - object.y : Math.max(startX, endX) - object.x;
  if (Math.abs(startMm) <= EPSILON && Math.abs(endMm - edgeLength(object, side)) <= EPSILON) return { mode: "whole" };
  return { mode: "offset", startMm, endMm };
}

function slabTarget(slab: FloorSlab, side: FloorEdgeSide, startX: number, startY: number, endX: number, endY: number): FloorSupportRuleTarget {
  return { kind: "slab-edge", slabId: slab.id, side, range: offsetRange(slab, side, startX, startY, endX, endY) };
}

function openingTarget(opening: FloorOpening, side: FloorEdgeSide, startX: number, startY: number, endX: number, endY: number): FloorSupportRuleTarget {
  return { kind: "opening-edge", openingId: opening.id, side, range: offsetRange(opening, side, startX, startY, endX, endY) };
}

function sameTargetHost(left: FloorSupportRuleTarget, right: FloorSupportRuleTarget): boolean {
  if (left.kind !== right.kind || left.side !== right.side) return false;
  if (left.kind === "slab-edge" && right.kind === "slab-edge") return left.slabId === right.slabId;
  if (left.kind === "opening-edge" && right.kind === "opening-edge") return left.openingId === right.openingId;
  return false;
}

function rangeBounds(range: FloorEdgeRange, length: number): [number, number] {
  return range.mode === "whole" ? [0, length] : [Math.min(range.startMm, range.endMm), Math.max(range.startMm, range.endMm)];
}

function rangesOverlap(left: FloorEdgeRange, right: FloorEdgeRange, length: number): boolean {
  const [leftStart, leftEnd] = rangeBounds(left, length);
  const [rightStart, rightEnd] = rangeBounds(right, length);
  return leftStart < rightEnd - EPSILON && leftEnd > rightStart + EPSILON;
}

export function floorSupportRuleMatchesTarget(
  rule: FloorSupportRule,
  target: FloorSupportRuleTarget,
  state: FloorPlanState,
): boolean {
  const object = targetObject(target, state);
  return Boolean(
    object &&
      sameTargetHost(rule.target, target) &&
      rangesOverlap(rule.target.range, target.range, edgeLength(object, target.side)),
  );
}

export function replaceFloorSupportRuleForAtomicSegment(
  state: FloorPlanState,
  segment: FloorAtomicBoundarySegment,
  nextRule: FloorSupportRule,
): FloorSupportRule[] {
  return [
    ...state.supportRules.filter((rule) =>
      !segment.targets.some((target) => floorSupportRuleMatchesTarget(rule, target, state)),
    ),
    structuredClone(nextRule),
  ];
}

export function resolveSupportRuleTarget(target: FloorSupportRuleTarget, state: FloorPlanState): FloorSupportRule[] {
  return state.supportRules.filter((rule) => floorSupportRuleMatchesTarget(rule, target, state));
}

export type FloorBoundarySupportResolution = {
  support: FloorResolvedSupport;
  matchingRuleIds: string[];
  conflictingSupports: FloorResolvedSupport[];
};

function defaultBoundarySupport(geometryKind: FloorBoundaryGeometryKind): FloorResolvedSupport {
  if (geometryKind === "building-exterior") return "outer-wall";
  return geometryKind === "shared-slab" ? "inner-wall" : "opening-cut";
}

export function resolveFloorBoundarySupportDetails(
  geometryKind: FloorBoundaryGeometryKind,
  targets: readonly FloorSupportRuleTarget[],
  state: FloorPlanState,
): FloorBoundarySupportResolution {
  const fallback = defaultBoundarySupport(geometryKind);
  if (geometryKind === "building-exterior") {
    return { support: fallback, matchingRuleIds: [], conflictingSupports: [] };
  }
  const allowed = geometryKind === "shared-slab"
    ? new Set<FloorSupportRule["support"]>(["inner-wall", "continuous"])
    : new Set<FloorSupportRule["support"]>(["opening-cut", "inner-wall"]);
  const matching = state.supportRules.filter(
    (rule) => allowed.has(rule.support) && targets.some((target) => floorSupportRuleMatchesTarget(rule, target, state)),
  );
  const supports = [...new Set(matching.map((rule) => rule.support))].sort() as FloorResolvedSupport[];
  return {
    // 冲突时使用保守且与数组顺序无关的安全值；validation会阻止正式计算。
    support: supports.length === 1 ? supports[0] : fallback,
    matchingRuleIds: [...new Set(matching.map((rule) => rule.id))].sort(),
    conflictingSupports: supports.length > 1 ? supports : [],
  };
}

export function resolveFloorBoundarySupport(
  geometryKind: FloorBoundaryGeometryKind,
  targets: readonly FloorSupportRuleTarget[],
  state: FloorPlanState,
): FloorResolvedSupport {
  return resolveFloorBoundarySupportDetails(geometryKind, targets, state).support;
}

function candidateId(candidate: AtomicCandidate): string {
  const axis = candidate.orientation === "vertical" ? "v" : "h";
  return `atomic:${axis}:${candidate.geometryKind}:${candidate.startX},${candidate.startY}-${candidate.endX},${candidate.endY}:${candidate.slabIds.join("+")}:${candidate.openingId ?? "none"}`;
}

function supportThickness(support: FloorResolvedSupport, state: FloorPlanState): number {
  if (support === "outer-wall") return state.outerWallThickness;
  if (support === "inner-wall") return state.innerWallThickness;
  return 0;
}

function openingAtCell(openingIds: string[], state: FloorPlanState, side: FloorEdgeSide, coordinate: number): FloorOpening | undefined {
  return state.openings.find((opening) => openingIds.includes(opening.id) && (
    side === "west" ? Math.abs(opening.x + opening.width - coordinate) <= EPSILON
      : side === "east" ? Math.abs(opening.x - coordinate) <= EPSILON
        : side === "south" ? Math.abs(opening.y + opening.height - coordinate) <= EPSILON
          : Math.abs(opening.y - coordinate) <= EPSILON
  ));
}

export function buildFloorAtomicBoundarySegments(state: FloorPlanState): FloorAtomicBoundarySegment[] {
  const cells = buildFloorTopologyCells(state);
  const effective = cells.filter((cell) => cell.effectiveSlabId);
  const cellAt = (x: number, y: number) => cells.find((cell) => x > cell.x - EPSILON && x < cell.x + cell.width + EPSILON && y > cell.y - EPSILON && y < cell.y + cell.height + EPSILON);
  const candidates: AtomicCandidate[] = [];
  effective.forEach((cell) => {
    const slab = state.slabs.find((item) => item.id === cell.effectiveSlabId);
    if (!slab) return;
    const sides: Array<{ side: FloorEdgeSide; neighborX: number; neighborY: number; startX: number; startY: number; endX: number; endY: number; coordinate: number }> = [
      { side: "west", neighborX: cell.x - EPSILON * 10, neighborY: cell.y + cell.height / 2, startX: cell.x, startY: cell.y, endX: cell.x, endY: cell.y + cell.height, coordinate: cell.x },
      { side: "east", neighborX: cell.x + cell.width + EPSILON * 10, neighborY: cell.y + cell.height / 2, startX: cell.x + cell.width, startY: cell.y, endX: cell.x + cell.width, endY: cell.y + cell.height, coordinate: cell.x + cell.width },
      { side: "south", neighborX: cell.x + cell.width / 2, neighborY: cell.y - EPSILON * 10, startX: cell.x, startY: cell.y, endX: cell.x + cell.width, endY: cell.y, coordinate: cell.y },
      { side: "north", neighborX: cell.x + cell.width / 2, neighborY: cell.y + cell.height + EPSILON * 10, startX: cell.x, startY: cell.y + cell.height, endX: cell.x + cell.width, endY: cell.y + cell.height, coordinate: cell.y + cell.height },
    ];
    sides.forEach((edge) => {
      const neighbor = cellAt(edge.neighborX, edge.neighborY);
      if (neighbor?.effectiveSlabId === slab.id) return;
      if (neighbor?.effectiveSlabId && slab.id > neighbor.effectiveSlabId) return;
      const orientation = edge.side === "west" || edge.side === "east" ? "vertical" : "horizontal";
      if (neighbor?.effectiveSlabId) {
        const other = state.slabs.find((item) => item.id === neighbor.effectiveSlabId);
        if (!other) return;
        const otherSide: FloorEdgeSide = edge.side === "west" ? "east" : edge.side === "east" ? "west" : edge.side === "south" ? "north" : "south";
        candidates.push({
          orientation,
          startX: edge.startX,
          startY: edge.startY,
          endX: edge.endX,
          endY: edge.endY,
          geometryKind: "shared-slab",
          slabIds: [slab.id, other.id].sort(),
          targets: [slabTarget(slab, edge.side, edge.startX, edge.startY, edge.endX, edge.endY), slabTarget(other, otherSide, edge.startX, edge.startY, edge.endX, edge.endY)],
        });
        return;
      }
      const opening = neighbor ? openingAtCell(neighbor.openingIds, state, edge.side, edge.coordinate) : undefined;
      if (opening) {
        const openingSide: FloorEdgeSide = edge.side === "west" ? "east" : edge.side === "east" ? "west" : edge.side === "south" ? "north" : "south";
        candidates.push({
          orientation,
          startX: edge.startX,
          startY: edge.startY,
          endX: edge.endX,
          endY: edge.endY,
          geometryKind: "opening-edge",
          slabIds: [slab.id],
          openingId: opening.id,
          targets: [openingTarget(opening, openingSide, edge.startX, edge.startY, edge.endX, edge.endY)],
        });
        return;
      }
      candidates.push({
        orientation,
        startX: edge.startX,
        startY: edge.startY,
        endX: edge.endX,
        endY: edge.endY,
        geometryKind: "building-exterior",
        slabIds: [slab.id],
        targets: [slabTarget(slab, edge.side, edge.startX, edge.startY, edge.endX, edge.endY)],
      });
    });
  });
  return candidates.map((candidate) => {
    const support = resolveFloorBoundarySupport(candidate.geometryKind, candidate.targets, state);
    return { ...candidate, id: candidateId(candidate), support, thicknessMm: supportThickness(support, state) };
  }).sort((left, right) => {
    const orientation = left.orientation.localeCompare(right.orientation);
    if (orientation !== 0) return orientation;
    return left.orientation === "horizontal"
      ? left.startY - right.startY || left.startX - right.startX || left.endX - right.endX
      : left.startX - right.startX || left.startY - right.startY || left.endY - right.endY;
  });
}

function segmentLength(segment: Pick<FloorAtomicBoundarySegment, "startX" | "startY" | "endX" | "endY">): number {
  return Math.abs(segment.endX - segment.startX) + Math.abs(segment.endY - segment.startY);
}

function canMergeDisplay(left: FloorBoundarySegment, right: FloorAtomicBoundarySegment): boolean {
  return left.orientation === right.orientation && left.geometryKind === right.geometryKind && left.support === right.support && left.thicknessMm === right.thicknessMm && left.openingId === right.openingId && (
    left.orientation === "horizontal"
      ? Math.abs(left.startY - right.startY) <= EPSILON && Math.abs(left.endX - right.startX) <= EPSILON
      : Math.abs(left.startX - right.startX) <= EPSILON && Math.abs(left.endY - right.startY) <= EPSILON
  );
}

export function buildFloorDisplayBoundarySegments(state: FloorPlanState): FloorBoundarySegment[] {
  const atomic = buildFloorAtomicBoundarySegments(state);
  const displays: FloorBoundarySegment[] = [];
  atomic.forEach((segment) => {
    const previous = displays.at(-1);
    if (previous && canMergeDisplay(previous, segment)) {
      previous.endX = segment.endX;
      previous.endY = segment.endY;
      previous.slabIds = [...new Set([...previous.slabIds, ...segment.slabIds])].sort();
      previous.targets = [...previous.targets, ...segment.targets];
      previous.atomicIds.push(segment.id);
      previous.id = `display:${previous.atomicIds.join("|")}`;
    } else {
      displays.push({ ...segment, id: `display:${segment.id}`, type: segment.support, atomicIds: [segment.id], targets: [...segment.targets], slabIds: [...segment.slabIds] });
    }
  });
  return displays;
}

/** V1兼容显示函数。正式几何消费者应使用buildFloorAtomicBoundarySegments。 */
export function buildFloorBoundarySegments(state: FloorPlanState): FloorBoundarySegment[] {
  return buildFloorDisplayBoundarySegments(state);
}

export function buildFloorSlabAdjacency(state: FloorPlanState): FloorSlabAdjacency[] {
  const groups = new Map<string, FloorSlabAdjacency>();
  buildFloorAtomicBoundarySegments(state).filter((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.length === 2).forEach((segment) => {
    const slabIds = [...segment.slabIds].sort() as [string, string];
    const key = slabIds.join("|");
    const current = groups.get(key) ?? { slabIds, segmentIds: [], sharedLengthMm: 0, supports: [] };
    current.segmentIds.push(segment.id);
    current.sharedLengthMm += segmentLength(segment);
    if (!current.supports.includes(segment.support)) current.supports.push(segment.support);
    groups.set(key, current);
  });
  return [...groups.values()];
}

export function findFloorComponents(state: FloorPlanState): string[][] {
  const adjacency = buildFloorSlabAdjacency(state);
  const graph = new Map(state.slabs.map((slab) => [slab.id, new Set<string>()]));
  adjacency.forEach(({ slabIds: [left, right] }) => { graph.get(left)?.add(right); graph.get(right)?.add(left); });
  const visited = new Set<string>();
  const components: string[][] = [];
  state.slabs.forEach((slab) => {
    if (visited.has(slab.id)) return;
    const queue = [slab.id];
    const component: string[] = [];
    visited.add(slab.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      graph.get(current)?.forEach((next) => { if (!visited.has(next)) { visited.add(next); queue.push(next); } });
    }
    components.push(component);
  });
  return components;
}

function supportRuleIssue(rule: FloorSupportRule, state: FloorPlanState): FloorPlanIssue[] {
  const object = targetObject(rule.target, state);
  if (!object) return [{ level: "error", code: "support-target-missing", message: `支承规则“${rule.id}”引用了不存在的对象。`, objectIds: [rule.id] }];
  const geometryAllowed = rule.target.kind === "slab-edge" ? ["inner-wall", "continuous"] : ["opening-cut", "inner-wall"];
  const issues: FloorPlanIssue[] = [];
  if (!geometryAllowed.includes(rule.support)) issues.push({ level: "error", code: "support-type-invalid", message: `支承规则“${rule.id}”的处理类型不适用于该边。`, objectIds: [rule.id] });
  if (rule.target.range.mode === "offset") {
    const length = edgeLength(object, rule.target.side);
    if (!Number.isFinite(rule.target.range.startMm) || !Number.isFinite(rule.target.range.endMm) || rule.target.range.startMm < 0 || rule.target.range.endMm > length || rule.target.range.startMm >= rule.target.range.endMm) {
      issues.push({ level: "error", code: "support-range-invalid", message: `支承规则“${rule.id}”的范围无效，必须位于目标边内且起点小于终点。`, objectIds: [rule.id] });
    }
  }
  return issues;
}

/**
 * 基础校验（与坐标模型无关）：对象字段 / 尺寸 / 墙厚 / 吸附 / Opening 覆盖警告 /
 * Opening 近边警告 / 支承规则基础合法性。V2 与 V3 验证器共用。
 */
export function validateFloorPlanBase(state: FloorPlanState): FloorPlanIssue[] {
  const issues: FloorPlanIssue[] = [];
  if (state.coordinateModel !== "net-layout-v1" && state.coordinateModel !== "clear-space-physical-v2") issues.push({ level: "error", code: "coordinate-model-invalid", message: "楼层坐标模型无效。" });
  if (state.slabs.length === 0) issues.push({ level: "error", code: "slab-required", message: "至少需要一个板区。" });
  const ids = new Set<string>();
  const validateObject = (object: FloorRect & { id: string; name: string }, label: string, validType: boolean) => {
    if (!object.id || ids.has(object.id)) issues.push({ level: "error", code: "object-id-duplicate", message: `${label}的ID重复或为空。`, objectIds: [object.id] });
    ids.add(object.id);
    if (!object.name.trim()) issues.push({ level: "warning", code: "object-name-empty", message: `${label}名称为空。`, objectIds: [object.id] });
    if (![object.x, object.y].every(Number.isFinite)) issues.push({ level: "error", code: "object-coordinate-invalid", message: `${label}坐标无效。`, objectIds: [object.id] });
    if (!Number.isFinite(object.width) || object.width <= 0) issues.push({ level: "error", code: "object-width-invalid", message: `${label}的东西向尺寸必须大于0。`, objectIds: [object.id] });
    if (!Number.isFinite(object.height) || object.height <= 0) issues.push({ level: "error", code: "object-height-invalid", message: `${label}的南北向尺寸必须大于0。`, objectIds: [object.id] });
    if (!validType) issues.push({ level: "error", code: "object-type-invalid", message: `${label}类型无效。`, objectIds: [object.id] });
  };
  state.slabs.forEach((slab, index) => validateObject(slab, slab.name.trim() || `第${index + 1}个板区`, isSlabType(slab.type)));
  state.openings.forEach((opening, index) => validateObject(opening, opening.name.trim() || `第${index + 1}个洞口`, isOpeningType(opening.type)));
  state.openings.forEach((opening) => {
    const coverage = floorOpeningCoverage(opening, state.slabs);
    if (coverage.coveredAreaMm2 <= EPSILON) issues.push({ level: "warning", code: "opening-uncovered", message: `“${opening.name}”当前未覆盖任何楼板区域，请确认位置。`, objectIds: [opening.id] });
    else if (coverage.coverageRatio < 1 - EPSILON) issues.push({ level: "warning", code: "opening-partial-outside", message: `“${opening.name}”部分区域位于楼板范围之外，请确认是否符合实际楼层。`, objectIds: [opening.id] });
  });
  const sideText: Record<FloorEdgeSide, string> = { west: "西边", east: "东边", south: "南边", north: "北边" };
  findOpeningSlabNearMisses(state).forEach((nearMiss) => {
    const opening = state.openings.find((item) => item.id === nearMiss.openingId);
    const slab = state.slabs.find((item) => item.id === nearMiss.slabId);
    issues.push({
      level: "warning",
      code: "opening-edge-near-slab-edge",
      message: `“${opening?.name ?? nearMiss.openingId}”${sideText[nearMiss.openingSide]}与“${slab?.name ?? nearMiss.slabId}”${sideText[nearMiss.slabSide]}相差${Number(nearMiss.distanceMm.toFixed(3))}mm，尚未完全对齐，请确认洞口位置。`,
      objectIds: [nearMiss.openingId, nearMiss.slabId],
    });
  });
  if (!Number.isFinite(state.innerWallThickness) || state.innerWallThickness <= 0) issues.push({ level: "error", code: "inner-wall-invalid", message: "内墙厚度必须大于0。" });
  if (!Number.isFinite(state.outerWallThickness) || state.outerWallThickness <= 0) issues.push({ level: "error", code: "outer-wall-invalid", message: "外墙厚度必须大于0。" });
  if (!Number.isFinite(state.snapDistanceMm) || state.snapDistanceMm < 0) issues.push({ level: "error", code: "snap-distance-invalid", message: "吸附距离不能为负数。" });
  state.supportRules.forEach((rule) => issues.push(...supportRuleIssue(rule, state)));
  return issues;
}

/**
 * Legacy Net Layout Validator（仅 net-layout-v1 语义）。
 * clear-space-physical-v2 必须走 validateFloorPlanV3（Canonical Adapter dispatch），
 * 本函数对 V3 只运行基础字段校验，禁止把 Rect Touch 结果套在 V3 上。
 */
export function validateFloorPlanV2(state: FloorPlanState): FloorPlanIssue[] {
  const issues: FloorPlanIssue[] = validateFloorPlanBase(state);
  const legacy = state.coordinateModel === "net-layout-v1";
  if (!legacy) return issues;
  for (let left = 0; left < state.slabs.length; left += 1) for (let right = left + 1; right < state.slabs.length; right += 1) if (floorSlabsOverlap(state.slabs[left], state.slabs[right])) issues.push({ level: "error", code: "slab-overlap", message: `${state.slabs[left].name}与${state.slabs[right].name}发生面积重叠。`, objectIds: [state.slabs[left].id, state.slabs[right].id] });
  const sideText: Record<FloorEdgeSide, string> = { west: "西边", east: "东边", south: "南边", north: "北边" };
  findFloorSlabNearMisses(state).forEach((nearMiss) => {
    const left = state.slabs.find((slab) => slab.id === nearMiss.slabIds[0]);
    const right = state.slabs.find((slab) => slab.id === nearMiss.slabIds[1]);
    issues.push({
      level: "error",
      code: "slab-edge-near-miss",
      message: `${left?.name ?? nearMiss.slabIds[0]}${sideText[nearMiss.sideA]}与${right?.name ?? nearMiss.slabIds[1]}${sideText[nearMiss.sideB]}相差${Number(nearMiss.distanceMm.toFixed(3))}mm，二维图上看似相接，但尚未形成真实共享板边。请将坐标调整为完全重合。`,
      objectIds: [...nearMiss.slabIds],
    });
  });
  for (let left = 0; left < state.openings.length; left += 1) for (let right = left + 1; right < state.openings.length; right += 1) if (floorOpeningsOverlap(state.openings[left], state.openings[right])) issues.push({ level: "error", code: "opening-overlap", message: `${state.openings[left].name}与${state.openings[right].name}发生面积重叠。`, objectIds: [state.openings[left].id, state.openings[right].id] });
  const atomic = buildFloorAtomicBoundarySegments(state);
  atomic.forEach((segment) => {
    const resolution = resolveFloorBoundarySupportDetails(segment.geometryKind, segment.targets, state);
    if (resolution.conflictingSupports.length > 1) {
      issues.push({
        level: "error",
        code: "support-rule-conflict",
        message: `同一${segment.geometryKind === "shared-slab" ? "共享板边" : "洞口边"}存在相互冲突的支承规则（${resolution.conflictingSupports.join(" / ")}），请重新设置。`,
        objectIds: resolution.matchingRuleIds,
      });
    }
  });
  state.supportRules.forEach((rule) => {
    const affectsBoundary = atomic.some((segment) => {
      const compatible = segment.geometryKind === "shared-slab"
        ? rule.target.kind === "slab-edge" && (rule.support === "inner-wall" || rule.support === "continuous")
        : segment.geometryKind === "opening-edge"
          ? rule.target.kind === "opening-edge" && (rule.support === "opening-cut" || rule.support === "inner-wall")
          : false;
      return compatible && segment.targets.some((target) => floorSupportRuleMatchesTarget(rule, target, state));
    });
    if (targetObject(rule.target, state) && !affectsBoundary) {
      issues.push({
        level: "warning",
        code: "support-rule-no-effect",
        message: `支承规则“${rule.id}”当前已不作用于任何有效边界，请检查或重新设置。`,
        objectIds: [rule.id],
      });
    }
  });
  const effectiveSlabIds = new Set(buildFloorTopologyCells(state).flatMap((cell) => cell.effectiveSlabId ? [cell.effectiveSlabId] : []));
  state.slabs.forEach((slab) => {
    if (slab.width > 0 && slab.height > 0 && !effectiveSlabIds.has(slab.id)) {
      issues.push({
        level: "error",
        code: "slab-fully-covered",
        message: `“${slab.name}”已被洞口完全覆盖，不会产生楼板板筋。`,
        objectIds: [slab.id],
      });
    }
  });
  const components = findFloorComponents(state);
  if (components.length > 1) issues.push({ level: "warning", code: "floor-components", message: `当前楼层存在${components.length}个互不连接的楼板组合，请确认。`, objectIds: components.flat() });
  return issues;
}

/** V1兼容：仅返回阻断性错误文字。新UI应使用validateFloorPlanV2。 */
export function validateFloorPlan(state: FloorPlanState): string[] {
  return validateFloorPlanV2(state).filter((issue) => issue.level === "error").map((issue) => issue.message);
}

type SnapCandidate = { coordinate: number; objectId: string };

function closestSnap(value: number, candidates: SnapCandidate[], threshold: number): number {
  const eligible = candidates
    .filter((candidate) => Number.isFinite(candidate.coordinate) && Math.abs(candidate.coordinate - value) <= threshold + EPSILON)
    .sort((left, right) =>
      Math.abs(left.coordinate - value) - Math.abs(right.coordinate - value)
      || left.coordinate - right.coordinate
      || left.objectId.localeCompare(right.objectId));
  return eligible[0]?.coordinate ?? value;
}

function intervalGap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  if (leftStart <= rightEnd + EPSILON && rightStart <= leftEnd + EPSILON) return 0;
  return Math.max(leftStart, rightStart) - Math.min(leftEnd, rightEnd);
}

function snapRect<T extends FloorRect & { id: string }>(
  object: T,
  others: readonly (FloorRect & { id: string })[],
  thresholdMm: number,
): T {
  const threshold = Math.max(thresholdMm, 0);
  const xCandidates: SnapCandidate[] = [{ coordinate: 0, objectId: "origin" }];
  const yCandidates: SnapCandidate[] = [{ coordinate: 0, objectId: "origin" }];
  others.forEach((other) => {
    const yRelevant = intervalGap(object.y, object.y + object.height, other.y, other.y + other.height) <= threshold + EPSILON;
    const xRelevant = intervalGap(object.x, object.x + object.width, other.x, other.x + other.width) <= threshold + EPSILON;
    if (yRelevant) {
      xCandidates.push(
        { coordinate: other.x, objectId: other.id },
        { coordinate: other.x + other.width, objectId: other.id },
        { coordinate: other.x - object.width, objectId: other.id },
        { coordinate: other.x + other.width - object.width, objectId: other.id },
      );
    }
    if (xRelevant) {
      yCandidates.push(
        { coordinate: other.y, objectId: other.id },
        { coordinate: other.y + other.height, objectId: other.id },
        { coordinate: other.y - object.height, objectId: other.id },
        { coordinate: other.y + other.height - object.height, objectId: other.id },
      );
    }
  });
  return {
    ...object,
    x: closestSnap(object.x, xCandidates, threshold),
    y: closestSnap(object.y, yCandidates, threshold),
  };
}

export function snapFloorSlab(slab: FloorSlab, otherSlabs: readonly FloorSlab[], thresholdMm: number): FloorSlab {
  return snapRect(slab, otherSlabs, thresholdMm);
}

export function snapFloorOpening(opening: FloorOpening, slabs: readonly FloorSlab[], otherOpenings: readonly FloorOpening[], thresholdMm: number): FloorOpening {
  return snapRect(opening, [...slabs, ...otherOpenings], thresholdMm);
}

export function floorPlanBounds(slabs: readonly FloorSlab[]) {
  if (slabs.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return slabs.reduce((bounds, slab) => ({
    minX: Math.min(bounds.minX, slab.x), minY: Math.min(bounds.minY, slab.y),
    maxX: Math.max(bounds.maxX, slab.x + Math.max(slab.width, 1)), maxY: Math.max(bounds.maxY, slab.y + Math.max(slab.height, 1)),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export function floorPlanObjectBounds(state: Pick<FloorPlanState, "slabs" | "openings">) {
  const objects: FloorRect[] = [...state.slabs, ...state.openings];
  if (objects.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return objects.reduce((bounds, object) => ({
    minX: Math.min(bounds.minX, object.x), minY: Math.min(bounds.minY, object.y),
    maxX: Math.max(bounds.maxX, object.x + Math.max(object.width, 1)), maxY: Math.max(bounds.maxY, object.y + Math.max(object.height, 1)),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export function nextAvailableFloorName(existingNames: readonly string[], prefix: "板区" | "洞口"): string {
  const used = new Set(existingNames);
  for (let index = 0; index < 26; index += 1) {
    const candidate = `${prefix}${String.fromCharCode(65 + index)}`;
    if (!used.has(candidate)) return candidate;
  }
  let number = 27;
  while (used.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
}
