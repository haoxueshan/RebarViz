import {
  FLOOR_GEOMETRY_EPSILON_MM,
  findFloorSlabNearMisses,
  floorSlabsOverlap,
  validateFloorPlanV2,
  type FloorEdgeSide,
  type FloorPlanIssue,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorOverlapInfo = {
  leftSlabId: string;
  rightSlabId: string;
  overlapWidthMm: number;
  overlapHeightMm: number;
  overlapAreaMm2: number;
  shortAxisOverlapMm: number;
};

export type FloorGeometryCorrection = {
  slabId: string;
  axis: "x" | "y";
  previousValue: number;
  correctedValue: number;
  correctionMm: number;
  reason: "tolerable-overlap" | "tolerable-gap";
};

export type FloorGeometryToleranceResult = {
  plan: FloorPlanState;
  corrections: FloorGeometryCorrection[];
  unresolvedIssues: FloorPlanIssue[];
};

export function describeSlabOverlap(left: FloorSlab, right: FloorSlab): FloorOverlapInfo | null {
  const overlapWidthMm = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const overlapHeightMm = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (overlapWidthMm <= EPSILON || overlapHeightMm <= EPSILON) return null;
  return {
    leftSlabId: left.id,
    rightSlabId: right.id,
    overlapWidthMm,
    overlapHeightMm,
    overlapAreaMm2: overlapWidthMm * overlapHeightMm,
    shortAxisOverlapMm: Math.min(overlapWidthMm, overlapHeightMm),
  };
}

type ShiftCandidate = {
  slabId: string;
  axis: "x" | "y";
  delta: number;
  correctionMm: number;
  reason: FloorGeometryCorrection["reason"];
};

function overlapShift(left: FloorSlab, right: FloorSlab): ShiftCandidate | null {
  const info = describeSlabOverlap(left, right);
  if (!info) return null;
  const axis: "x" | "y" = info.overlapWidthMm <= info.overlapHeightMm ? "x" : "y";
  const overlapMm = axis === "x" ? info.overlapWidthMm : info.overlapHeightMm;
  const rightCenter = axis === "x" ? right.x + right.width / 2 : right.y + right.height / 2;
  const leftCenter = axis === "x" ? left.x + left.width / 2 : left.y + left.height / 2;
  const delta = rightCenter >= leftCenter ? overlapMm : -overlapMm;
  return { slabId: right.id, axis, delta, correctionMm: overlapMm, reason: "tolerable-overlap" };
}

function nearMissShift(nearMiss: { sideA: FloorEdgeSide; distanceMm: number }): ShiftCandidate["delta"] {
  if (nearMiss.sideA === "east") return -nearMiss.distanceMm;
  if (nearMiss.sideA === "west") return nearMiss.distanceMm;
  if (nearMiss.sideA === "north") return -nearMiss.distanceMm;
  return nearMiss.distanceMm;
}

function shiftedSlabConflicts(
  slabs: readonly FloorSlab[],
  slabId: string,
  axis: "x" | "y",
  delta: number,
): boolean {
  const slab = slabs.find((item) => item.id === slabId);
  if (!slab) return true;
  const moved: FloorSlab = { ...slab, [axis]: slab[axis] + delta };
  return slabs.some((other) => other.id !== slabId && floorSlabsOverlap(moved, other));
}

function shiftSlab(slabs: readonly FloorSlab[], slabId: string, axis: "x" | "y", delta: number): FloorSlab[] {
  return slabs.map((slab) => (slab.id === slabId ? { ...slab, [axis]: slab[axis] + delta } : slab));
}

/**
 * 几何容差解析：把小于容差的板区边缘重叠/间隙自动纠偏为精确共边。
 * 修正永远落在 pair 中索引靠后的板区（right），并保证不产生新的面积重叠。
 */
export function resolveFloorGeometryTolerance(plan: FloorPlanState): FloorGeometryToleranceResult {
  const raw = Number.isFinite(plan.overlapToleranceMm) ? plan.overlapToleranceMm : 10;
  const tolerance = Math.max(0, raw);
  if (tolerance === 0) {
    const unresolvedIssues = validateFloorPlanV2(plan).filter((issue) => issue.level === "error");
    return { plan, corrections: [], unresolvedIssues };
  }
  let slabs = plan.slabs.map((slab) => ({ ...slab }));
  const corrections: FloorGeometryCorrection[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const passCorrections: FloorGeometryCorrection[] = [];
    for (let leftIndex = 0; leftIndex < slabs.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < slabs.length; rightIndex += 1) {
        const left = slabs[leftIndex];
        const right = slabs[rightIndex];
        const candidate = overlapShift(left, right);
        if (!candidate || candidate.correctionMm > tolerance) continue;
        if (shiftedSlabConflicts(slabs, candidate.slabId, candidate.axis, candidate.delta)) continue;
        const target = slabs.find((item) => item.id === candidate.slabId);
        if (!target) continue;
        slabs = shiftSlab(slabs, candidate.slabId, candidate.axis, candidate.delta);
        passCorrections.push({
          slabId: candidate.slabId,
          axis: candidate.axis,
          previousValue: target[candidate.axis],
          correctedValue: target[candidate.axis] + candidate.delta,
          correctionMm: candidate.correctionMm,
          reason: candidate.reason,
        });
      }
    }
    const nearMisses = findFloorSlabNearMisses({ slabs }, tolerance);
    for (const nearMiss of nearMisses) {
      const right = slabs.find((item) => item.id === nearMiss.slabIds[1]);
      if (!right) continue;
      const axis: "x" | "y" = nearMiss.orientation === "vertical" ? "x" : "y";
      const delta = nearMissShift(nearMiss);
      if (shiftedSlabConflicts(slabs, right.id, axis, delta)) continue;
      const previousValue = right[axis];
      slabs = shiftSlab(slabs, right.id, axis, delta);
      passCorrections.push({
        slabId: right.id,
        axis,
        previousValue,
        correctedValue: previousValue + delta,
        correctionMm: nearMiss.distanceMm,
        reason: "tolerable-gap",
      });
    }
    if (passCorrections.length === 0) break;
    corrections.push(...passCorrections);
  }
  const canonical: FloorPlanState = { ...plan, slabs };
  const unresolvedIssues = validateFloorPlanV2(canonical).filter((issue) => issue.level === "error");
  return { plan: canonical, corrections, unresolvedIssues };
}
