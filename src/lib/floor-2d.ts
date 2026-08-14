import type { FloorOpening, FloorPlanState } from "./floor-plan";

export type FloorCanvasFitMode = "floor" | "all" | "selection" | "domain";

export type Floor2dBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type FloorGridStep = {
  minorMm: number;
  majorMm: number;
};

export type FloorPrintMarkCluster = {
  mark: string;
  pieceIds: string[];
  centerX: number;
  centerY: number;
};

export type FloorSpatialMarkPiece = {
  id: string;
  mark: string;
  direction: "x" | "y";
  positionMm: number;
  runStartMm: number;
  runEndMm: number;
  spacing: number;
};

const GRID_STEPS_MM = [100, 200, 500, 1000, 2000, 5000, 10000] as const;
const EMPTY_BOUNDS: Floor2dBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
const MARK_CLUSTER_EPSILON_MM = 1e-6;

/** 选择真实世界毫米网格；仅用于视觉辅助，不参与吸附或正式计算。 */
export function chooseFloorGridStep(scale: number): FloorGridStep {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 0.04;
  const targetPx = 40;
  const minorMm = GRID_STEPS_MM.reduce((best, candidate) => {
    const bestDistance = Math.abs(best * safeScale - targetPx);
    const candidateDistance = Math.abs(candidate * safeScale - targetPx);
    if (candidateDistance !== bestDistance) return candidateDistance < bestDistance ? candidate : best;
    return candidate < best ? candidate : best;
  });
  return { minorMm, majorMm: minorMm * 4 };
}

function rectsHavePositiveAreaIntersection(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return Math.min(left.x + left.width, right.x + right.width) > Math.max(left.x, right.x)
    && Math.min(left.y + left.height, right.y + right.height) > Math.max(left.y, right.y);
}

export function floorOpeningTouchesFloor(
  opening: Pick<FloorOpening, "x" | "y" | "width" | "height">,
  state: { slabs: readonly { x: number; y: number; width: number; height: number }[] },
): boolean {
  return state.slabs.some((slab) => rectsHavePositiveAreaIntersection(opening, slab));
}

function boundsForObjects(
  objects: readonly { x: number; y: number; width: number; height: number }[],
): Floor2dBounds {
  if (objects.length === 0) return { ...EMPTY_BOUNDS };
  return objects.reduce<Floor2dBounds>((bounds, object) => ({
    minX: Math.min(bounds.minX, object.x),
    minY: Math.min(bounds.minY, object.y),
    maxX: Math.max(bounds.maxX, object.x + Math.max(object.width, 1)),
    maxY: Math.max(bounds.maxY, object.y + Math.max(object.height, 1)),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

/**
 * 默认（floor 模式）只根据楼板主体取景，避免异常洞口把画布拉到远处；
 * all 模式才纳入全部洞口。
 */
export function calculateFloorCanvasBounds(
  state: Pick<FloorPlanState, "slabs" | "openings">,
  mode: FloorCanvasFitMode,
): Floor2dBounds {
  if (mode === "all") return boundsForObjects([...state.slabs, ...state.openings]);
  return boundsForObjects(state.slabs);
}

function rangesDistance(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  if (leftStart <= rightEnd && rightStart <= leftEnd) return 0;
  return Math.max(leftStart, rightStart) - Math.min(leftEnd, rightEnd);
}

function piecesAreSpatiallyAdjacent(left: FloorSpatialMarkPiece, right: FloorSpatialMarkPiece): boolean {
  if (left.mark !== right.mark || left.direction !== right.direction) return false;
  const proximity = Math.max(left.spacing, right.spacing, 1) * 1.5;
  const perpendicularDistance = Math.abs(left.positionMm - right.positionMm);
  const runDistance = rangesDistance(left.runStartMm, left.runEndMm, right.runStartMm, right.runEndMm);
  return (
    perpendicularDistance <= proximity + MARK_CLUSTER_EPSILON_MM
    && runDistance <= MARK_CLUSTER_EPSILON_MM
  ) || (
    perpendicularDistance <= MARK_CLUSTER_EPSILON_MM
    && runDistance <= proximity + MARK_CLUSTER_EPSILON_MM
  );
}

function pieceCenter(piece: FloorSpatialMarkPiece): { x: number; y: number } {
  const runCenter = (piece.runStartMm + piece.runEndMm) / 2;
  return piece.direction === "x"
    ? { x: runCenter, y: piece.positionMm }
    : { x: piece.positionMm, y: runCenter };
}

/** 同一Mark按实际空间相邻关系聚类；输入顺序不会决定聚类中心。 */
export function buildFloorPrintMarkClusters(
  pieces: readonly FloorSpatialMarkPiece[],
): FloorPrintMarkCluster[] {
  const ordered = [...pieces].sort((left, right) =>
    left.mark.localeCompare(right.mark)
    || left.direction.localeCompare(right.direction)
    || left.positionMm - right.positionMm
    || left.runStartMm - right.runStartMm
    || left.runEndMm - right.runEndMm
    || left.id.localeCompare(right.id));
  const visited = new Set<string>();
  const clusters: FloorPrintMarkCluster[] = [];

  ordered.forEach((seed) => {
    if (visited.has(seed.id)) return;
    const queue = [seed];
    const members: FloorSpatialMarkPiece[] = [];
    visited.add(seed.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      ordered.forEach((candidate) => {
        if (visited.has(candidate.id) || !piecesAreSpatiallyAdjacent(current, candidate)) return;
        visited.add(candidate.id);
        queue.push(candidate);
      });
    }
    const centers = members.map(pieceCenter);
    clusters.push({
      mark: seed.mark,
      pieceIds: members.map((piece) => piece.id).sort(),
      centerX: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
      centerY: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
    });
  });

  return clusters.sort((left, right) =>
    left.mark.localeCompare(right.mark)
    || left.centerY - right.centerY
    || left.centerX - right.centerX
    || left.pieceIds.join("|").localeCompare(right.pieceIds.join("|")));
}
