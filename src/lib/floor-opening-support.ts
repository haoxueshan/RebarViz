import {
  FLOOR_GEOMETRY_EPSILON_MM,
  resolveFloorBoundarySupportDetails,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSupportRuleTarget,
} from "./floor-plan";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorOpeningEdgeResolution = {
  openingId: string;
  side: FloorEdgeSide;
  support: "opening-cut" | "inner-wall";
  thicknessMm: number;
  matchingRuleIds: string[];
  conflictingSupports: FloorResolvedSupport[];
  rangeStartMm: number;
  rangeEndMm: number;
  boundaryId: string;
};

export type FloorOpeningSupportConflict = {
  openingId: string;
  side: FloorEdgeSide;
  rangeStartMm: number;
  rangeEndMm: number;
  matchingRuleIds: string[];
  conflictingSupports: FloorResolvedSupport[];
};

function stableDimension(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function edgeLength(
  opening: FloorPlanState["openings"][number],
  side: FloorEdgeSide,
): number {
  return side === "west" || side === "east" ? opening.height : opening.width;
}

function edgeOrigin(
  opening: FloorPlanState["openings"][number],
  side: FloorEdgeSide,
): number {
  return side === "west" || side === "east" ? opening.y : opening.x;
}

function uniqueBreakpoints(values: readonly number[]): number[] {
  const result: number[] = [];
  [...values].sort((left, right) => left - right).forEach((value) => {
    const previous = result.at(-1);
    if (previous === undefined || Math.abs(value - previous) > EPSILON) result.push(value);
  });
  return result;
}

function formalSegments(
  plan: FloorPlanState,
  openingId: string,
  side: FloorEdgeSide,
): Array<{ startMm: number; endMm: number }> {
  const opening = plan.openings.find((item) => item.id === openingId);
  if (!opening) return [];
  const lengthMm = edgeLength(opening, side);
  if (!Number.isFinite(lengthMm) || lengthMm <= EPSILON) return [];
  const breakpoints = [0, lengthMm];
  plan.supportRules.forEach((rule) => {
    if (rule.target.kind !== "opening-edge"
      || rule.target.openingId !== openingId
      || rule.target.side !== side
      || rule.target.range.mode !== "offset") return;
    if (Number.isFinite(rule.target.range.startMm)) {
      breakpoints.push(Math.min(lengthMm, Math.max(0, rule.target.range.startMm)));
    }
    if (Number.isFinite(rule.target.range.endMm)) {
      breakpoints.push(Math.min(lengthMm, Math.max(0, rule.target.range.endMm)));
    }
  });
  const normalized = uniqueBreakpoints(breakpoints);
  return normalized.slice(0, -1).flatMap((startMm, index) => {
    const endMm = normalized[index + 1];
    return endMm - startMm > EPSILON ? [{ startMm, endMm }] : [];
  });
}

function segmentTarget(
  openingId: string,
  side: FloorEdgeSide,
  startMm: number,
  endMm: number,
  edgeLengthMm: number,
): FloorSupportRuleTarget {
  const whole = Math.abs(startMm) <= EPSILON
    && Math.abs(endMm - edgeLengthMm) <= EPSILON;
  return {
    kind: "opening-edge",
    openingId,
    side,
    range: whole
      ? { mode: "whole" }
      : { mode: "offset", startMm, endMm },
  };
}

/** Resolve one physical point against deterministic, positive-length opening-edge segments. */
export function resolveFloorOpeningEdgeAtPosition(
  plan: FloorPlanState,
  request: {
    openingId: string;
    side: FloorEdgeSide;
    worldTangentMm: number;
  },
): FloorOpeningEdgeResolution | null {
  const opening = plan.openings.find((item) => item.id === request.openingId);
  if (!opening || !Number.isFinite(request.worldTangentMm)) return null;
  const lengthMm = edgeLength(opening, request.side);
  const localOffsetMm = request.worldTangentMm - edgeOrigin(opening, request.side);
  const segments = formalSegments(plan, request.openingId, request.side);
  const breakpoint = segments
    .flatMap((segment) => [segment.startMm, segment.endMm])
    .find((value) => Math.abs(localOffsetMm - value) <= EPSILON);
  const normalizedOffsetMm = breakpoint ?? localOffsetMm;
  const segment = segments.find(({ startMm, endMm }) =>
    normalizedOffsetMm >= startMm && normalizedOffsetMm < endMm);
  if (!segment) return null;
  const details = resolveFloorBoundarySupportDetails(
    "opening-edge",
    [segmentTarget(request.openingId, request.side, segment.startMm, segment.endMm, lengthMm)],
    plan,
  );
  const support = details.support === "inner-wall" ? "inner-wall" : "opening-cut";
  return {
    openingId: request.openingId,
    side: request.side,
    support,
    thicknessMm: support === "inner-wall" ? plan.innerWallThickness : 0,
    matchingRuleIds: details.matchingRuleIds,
    conflictingSupports: details.conflictingSupports,
    rangeStartMm: segment.startMm,
    rangeEndMm: segment.endMm,
    boundaryId: [
      "v3-opening",
      request.openingId,
      request.side,
      stableDimension(segment.startMm),
      stableDimension(segment.endMm),
      support,
    ].join(":"),
  };
}

export function findFloorOpeningSupportConflicts(
  plan: FloorPlanState,
): FloorOpeningSupportConflict[] {
  const sides: readonly FloorEdgeSide[] = ["west", "east", "south", "north"];
  const conflicts: FloorOpeningSupportConflict[] = [];
  [...plan.openings].sort((left, right) => left.id.localeCompare(right.id)).forEach((opening) => {
    sides.forEach((side) => {
      const originMm = edgeOrigin(opening, side);
      formalSegments(plan, opening.id, side).forEach((segment) => {
        const resolution = resolveFloorOpeningEdgeAtPosition(plan, {
          openingId: opening.id,
          side,
          worldTangentMm: originMm + (segment.startMm + segment.endMm) / 2,
        });
        if (!resolution || resolution.conflictingSupports.length < 2) return;
        conflicts.push({
          openingId: opening.id,
          side,
          rangeStartMm: segment.startMm,
          rangeEndMm: segment.endMm,
          matchingRuleIds: resolution.matchingRuleIds,
          conflictingSupports: resolution.conflictingSupports,
        });
      });
    });
  });
  return conflicts;
}
