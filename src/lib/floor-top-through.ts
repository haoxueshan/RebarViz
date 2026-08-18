import {
  findCrossingAtomicBoundary,
  resolveFloorEndpointBoundary,
} from "./floor-bottom-calculator";
import {
  buildFloorAtomicBoundarySegments,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import type { FloorBarRole } from "./floor-rebar-role";
import type {
  FloorTopBarSettings,
  FloorTopEndpointAnchor,
  FloorTopIssue,
  FloorTopThroughPath,
} from "./floor-top-calculator";
import type { TopExtraMode } from "./slab-calculator";

const THROUGH_GEOMETRY_EPSILON_MM = 1e-7;
export const THROUGH_LINE_POSITION_EPSILON_MM = 1e-6;

type AxisInterval = { start: number; end: number };

export type ResolvedFloorTopThroughPath = {
  id: string;
  name: string;
  direction: "x" | "y";
  orderedSlabIds: string[];
  bandStartMm: number;
  bandEndMm: number;
  maxBandStartMm: number;
  maxBandEndMm: number;
  runStartMm: number;
  runEndMm: number;
  role: FloorBarRole;
  diameter: number;
  spacing: number;
  extraMode: TopExtraMode;
  linePositionsMm: number[];
};

export type FloorTopThroughGeometry = {
  pathId: string;
  direction: "x" | "y";
  orderedSlabIds: string[];
  runStartMm: number;
  runEndMm: number;
  validBandIntervals: AxisInterval[];
  maxBandStartMm: number | null;
  maxBandEndMm: number | null;
  errors: FloorTopIssue[];
};

export type FloorTopThroughApplication = {
  lines: FloorBarLine[];
  pieces: FloorBarPiece[];
  resolvedPaths: ResolvedFloorTopThroughPath[];
  claimedNormalPieceIds: Set<string>;
  errors: FloorTopIssue[];
};

type ResolveSettings = (
  slabId: string,
  direction: "x" | "y",
  role: FloorBarRole,
) => FloorTopBarSettings;

type ResolveEndpointAnchor = (
  segment: FloorAtomicBoundarySegment,
  endpoint: "start" | "end",
  extraMode: TopExtraMode,
) => FloorTopEndpointAnchor;

type ApplyThroughInput = {
  plan: FloorPlanState;
  paths: readonly FloorTopThroughPath[];
  normalLines: readonly FloorBarLine[];
  normalPieces: readonly FloorBarPiece[];
  topAnchorExtraMm: number;
  resolveSettings: ResolveSettings;
  resolveEndpointAnchor: ResolveEndpointAnchor;
};

function issue(
  code: string,
  message: string,
  objectIds?: string[],
): FloorTopIssue {
  return { code, message, objectIds };
}

function axisStart(slab: FloorSlab, direction: "x" | "y"): number {
  return direction === "x" ? slab.x : slab.y;
}

function axisEnd(slab: FloorSlab, direction: "x" | "y"): number {
  return axisStart(slab, direction) + (direction === "x" ? slab.width : slab.height);
}

function perpendicularStart(slab: FloorSlab, direction: "x" | "y"): number {
  return direction === "x" ? slab.y : slab.x;
}

function perpendicularEnd(slab: FloorSlab, direction: "x" | "y"): number {
  return perpendicularStart(slab, direction) + (direction === "x" ? slab.height : slab.width);
}

function segmentPerpendicularRange(
  segment: FloorAtomicBoundarySegment,
  direction: "x" | "y",
): AxisInterval {
  return direction === "x"
    ? { start: Math.min(segment.startY, segment.endY), end: Math.max(segment.startY, segment.endY) }
    : { start: Math.min(segment.startX, segment.endX), end: Math.max(segment.startX, segment.endX) };
}

function mergeIntervals(intervals: readonly AxisInterval[]): AxisInterval[] {
  const result: AxisInterval[] = [];
  [...intervals]
    .filter((item) => item.end > item.start + THROUGH_GEOMETRY_EPSILON_MM)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach((item) => {
      const previous = result.at(-1);
      if (!previous || item.start > previous.end + THROUGH_GEOMETRY_EPSILON_MM) {
        result.push({ ...item });
      } else {
        previous.end = Math.max(previous.end, item.end);
      }
    });
  return result;
}

function intersectIntervals(
  left: readonly AxisInterval[],
  right: readonly AxisInterval[],
): AxisInterval[] {
  const result: AxisInterval[] = [];
  left.forEach((a) => right.forEach((b) => {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end > start + THROUGH_GEOMETRY_EPSILON_MM) result.push({ start, end });
  }));
  return mergeIntervals(result);
}

function largestInterval(intervals: readonly AxisInterval[]): AxisInterval | null {
  return [...intervals].sort((left, right) =>
    (right.end - right.start) - (left.end - left.start) || left.start - right.start)[0] ?? null;
}

function sharedSegments(
  atomic: readonly FloorAtomicBoundarySegment[],
  direction: "x" | "y",
  leftId: string,
  rightId: string,
): FloorAtomicBoundarySegment[] {
  const orientation = direction === "x" ? "vertical" : "horizontal";
  return atomic.filter((segment) =>
    segment.geometryKind === "shared-slab" &&
    segment.orientation === orientation &&
    segment.slabIds.includes(leftId) &&
    segment.slabIds.includes(rightId));
}

/**
 * 只解析稳定的板区链与几何Band，不读取或生成钢筋结果。
 * 正式根数与相位必须在普通Top结果生成后另行校验。
 */
export function resolveFloorTopThroughPathGeometry(
  plan: FloorPlanState,
  path: FloorTopThroughPath,
  atomic = buildFloorAtomicBoundarySegments(plan),
): FloorTopThroughGeometry {
  // V1.4A.1 Safety Guard：V3 通墙路径尚未 Connection-aware（V1.4C），不按 Legacy Rect Touch 解析。
  if (plan.coordinateModel === "clear-space-physical-v2") {
    return {
      pathId: path.id,
      direction: path.direction,
      orderedSlabIds: [...new Set(path.slabIds)],
      runStartMm: 0,
      runEndMm: 0,
      validBandIntervals: [],
      maxBandStartMm: null,
      maxBandEndMm: null,
      errors: [issue(
        "topology-v3-calculation-not-ready",
        "当前楼层已使用新版墙带拓扑。通墙路径尚未完成V1.4连接路径迁移，无法解析正式通墙几何。",
        [path.id],
      )],
    };
  }
  const errors: FloorTopIssue[] = [];
  const uniqueIds = [...new Set(path.slabIds)];
  if (uniqueIds.length !== path.slabIds.length || uniqueIds.length < 2) {
    errors.push(issue(
      "through-path-chain-invalid",
      `“${path.name}”必须选择至少两个不重复且首尾相邻的板区。`,
      [path.id, ...path.slabIds],
    ));
  }
  const slabById = new Map(plan.slabs.map((slab) => [slab.id, slab]));
  const slabs = uniqueIds.flatMap((id) => {
    const slab = slabById.get(id);
    return slab ? [slab] : [];
  });
  if (slabs.length !== uniqueIds.length) {
    errors.push(issue(
      "through-path-chain-invalid",
      `“${path.name}”引用了不存在的板区。`,
      [path.id, ...path.slabIds],
    ));
  }
  const ordered = [...slabs].sort((left, right) =>
    axisStart(left, path.direction) - axisStart(right, path.direction) ||
    perpendicularStart(left, path.direction) - perpendicularStart(right, path.direction) ||
    left.id.localeCompare(right.id));
  let validBandIntervals: AxisInterval[] = ordered.length > 0
    ? [{
        start: Math.max(...ordered.map((slab) => perpendicularStart(slab, path.direction))),
        end: Math.min(...ordered.map((slab) => perpendicularEnd(slab, path.direction))),
      }]
    : [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const touches = Math.abs(axisEnd(current, path.direction) - axisStart(next, path.direction)) <=
      THROUGH_GEOMETRY_EPSILON_MM;
    const pairSegments = sharedSegments(atomic, path.direction, current.id, next.id);
    if (!touches || pairSegments.length === 0) {
      errors.push(issue(
        "through-path-chain-invalid",
        `“${path.name}”中的“${current.name}”与“${next.name}”没有形成${path.direction === "x" ? "东西" : "南北"}向有效共享边。`,
        [path.id, current.id, next.id],
      ));
      continue;
    }
    validBandIntervals = intersectIntervals(
      validBandIntervals,
      mergeIntervals(pairSegments.map((segment) => segmentPerpendicularRange(segment, path.direction))),
    );
  }
  validBandIntervals = mergeIntervals(validBandIntervals);
  if (ordered.length >= 2 && validBandIntervals.length === 0) {
    errors.push(issue(
      "through-path-chain-invalid",
      `“${path.name}”没有所有板区及共享边共同覆盖的有效通墙带宽。`,
      [path.id, ...ordered.map((slab) => slab.id)],
    ));
  }
  const maximum = largestInterval(validBandIntervals);
  return {
    pathId: path.id,
    direction: path.direction,
    orderedSlabIds: ordered.map((slab) => slab.id),
    runStartMm: ordered.length > 0 ? axisStart(ordered[0], path.direction) : 0,
    runEndMm: ordered.length > 0 ? axisEnd(ordered.at(-1)!, path.direction) : 0,
    validBandIntervals,
    maxBandStartMm: maximum?.start ?? null,
    maxBandEndMm: maximum?.end ?? null,
    errors,
  };
}

function inHalfOpenBand(position: number, start: number, end: number): boolean {
  return position >= start - THROUGH_LINE_POSITION_EPSILON_MM &&
    position < end - THROUGH_LINE_POSITION_EPSILON_MM;
}

function positionsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) =>
    Math.abs(value - right[index]) <= THROUGH_LINE_POSITION_EPSILON_MM);
}

function uniquePositions(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.filter((value, index) =>
    index === 0 || Math.abs(value - sorted[index - 1]) > THROUGH_LINE_POSITION_EPSILON_MM);
}

function settingsEqual(left: FloorTopBarSettings, right: FloorTopBarSettings): boolean {
  return left.diameter === right.diameter &&
    left.spacing === right.spacing &&
    left.extraMode === right.extraMode;
}

function intervalsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd - THROUGH_GEOMETRY_EPSILON_MM &&
    leftEnd > rightStart + THROUGH_GEOMETRY_EPSILON_MM;
}

function openingBlocksStrip(
  plan: FloorPlanState,
  direction: "x" | "y",
  runStart: number,
  runEnd: number,
  bandStart: number,
  bandEnd: number,
): boolean {
  return plan.openings.some((opening) => {
    const stripXStart = direction === "x" ? runStart : bandStart;
    const stripXEnd = direction === "x" ? runEnd : bandEnd;
    const stripYStart = direction === "x" ? bandStart : runStart;
    const stripYEnd = direction === "x" ? bandEnd : runEnd;
    return intervalsOverlap(stripXStart, stripXEnd, opening.x, opening.x + opening.width) &&
      intervalsOverlap(stripYStart, stripYEnd, opening.y, opening.y + opening.height);
  });
}

function hasExternalContinuousEndpoint(
  atomic: readonly FloorAtomicBoundarySegment[],
  geometry: FloorTopThroughGeometry,
  bandStart: number,
  bandEnd: number,
  endpoint: "start" | "end",
): boolean {
  const slabId = endpoint === "start"
    ? geometry.orderedSlabIds[0]
    : geometry.orderedSlabIds.at(-1);
  const run = endpoint === "start" ? geometry.runStartMm : geometry.runEndMm;
  if (!slabId) return false;
  return atomic.some((segment) => {
    const onRun = geometry.direction === "x"
      ? segment.orientation === "vertical" && Math.abs(segment.startX - run) <= THROUGH_GEOMETRY_EPSILON_MM
      : segment.orientation === "horizontal" && Math.abs(segment.startY - run) <= THROUGH_GEOMETRY_EPSILON_MM;
    if (!onRun || segment.geometryKind !== "shared-slab" || segment.support !== "continuous") return false;
    if (!segment.slabIds.includes(slabId) || segment.slabIds.every((id) => geometry.orderedSlabIds.includes(id))) return false;
    const range = segmentPerpendicularRange(segment, geometry.direction);
    return intervalsOverlap(range.start, range.end, bandStart, bandEnd);
  });
}

function linePositionById(lines: readonly FloorBarLine[]): Map<string, number> {
  return new Map(lines.map((line) => [line.id, line.positionMm]));
}

function candidatePositionsForSlab(
  slabId: string,
  direction: "x" | "y",
  bandStart: number,
  bandEnd: number,
  normalPieces: readonly FloorBarPiece[],
  positionsByLine: ReadonlyMap<string, number>,
): number[] {
  return uniquePositions(normalPieces.flatMap((piece) => {
    if (piece.source !== "normal" || piece.direction !== direction || !piece.slabIds.includes(slabId)) return [];
    const position = positionsByLine.get(piece.lineId);
    return position !== undefined && inHalfOpenBand(position, bandStart, bandEnd) ? [position] : [];
  }));
}

function pieceForSlabAtPosition(
  slab: FloorSlab,
  direction: "x" | "y",
  position: number,
  normalPieces: readonly FloorBarPiece[],
  positionsByLine: ReadonlyMap<string, number>,
): FloorBarPiece[] {
  const runStart = axisStart(slab, direction);
  const runEnd = axisEnd(slab, direction);
  return normalPieces.filter((piece) => {
    if (piece.source !== "normal" || piece.direction !== direction || !piece.slabIds.includes(slab.id)) return false;
    const linePosition = positionsByLine.get(piece.lineId);
    return linePosition !== undefined &&
      Math.abs(linePosition - position) <= THROUGH_LINE_POSITION_EPSILON_MM &&
      intervalsOverlap(piece.runStartMm, piece.runEndMm, runStart, runEnd);
  });
}

function bandContainedIn(intervals: readonly AxisInterval[], start: number, end: number): AxisInterval | null {
  return intervals.find((interval) =>
    start >= interval.start - THROUGH_GEOMETRY_EPSILON_MM &&
    end <= interval.end + THROUGH_GEOMETRY_EPSILON_MM) ?? null;
}

/**
 * Final Top = Normal Top - Claimed Normal Pieces + Through Pieces。
 * 此函数绝不调用countBars；每一根Through都继承已冻结的普通Top相位、规格和角色。
 */
export function applyFloorTopThroughPaths(input: ApplyThroughInput): FloorTopThroughApplication {
  const enabledPaths = input.paths.filter((path) => path.enabled);
  if (enabledPaths.length === 0) {
    return {
      lines: [...input.normalLines],
      pieces: [...input.normalPieces],
      resolvedPaths: [],
      claimedNormalPieceIds: new Set(),
      errors: [],
    };
  }
  const errors: FloorTopIssue[] = [];
  const atomic = buildFloorAtomicBoundarySegments(input.plan);
  const slabById = new Map(input.plan.slabs.map((slab) => [slab.id, slab]));
  const positionsByLine = linePositionById(input.normalLines);
  const geometries = enabledPaths.map((path) => ({
    path,
    geometry: resolveFloorTopThroughPathGeometry(input.plan, path, atomic),
  }));
  const pathIds = new Set<string>();
  geometries.forEach(({ path, geometry }) => {
    if (pathIds.has(path.id)) {
      errors.push(issue("through-path-chain-invalid", `通墙路径ID“${path.id}”重复。`, [path.id]));
    }
    pathIds.add(path.id);
    errors.push(...geometry.errors);
  });

  type ValidatedPath = {
    path: FloorTopThroughPath;
    geometry: FloorTopThroughGeometry;
    role: FloorBarRole;
    settings: FloorTopBarSettings;
    positions: number[];
  };
  const validated: ValidatedPath[] = [];
  geometries.forEach(({ path, geometry }) => {
    if (geometry.errors.length > 0) return;
    if (!Number.isFinite(path.bandStartMm) || !Number.isFinite(path.bandEndMm) ||
      path.bandStartMm >= path.bandEndMm) {
      errors.push(issue(
        "through-path-band-invalid",
        `“${path.name}”的通墙范围必须是有限数，且起点小于终点。`,
        [path.id],
      ));
      return;
    }
    if (openingBlocksStrip(
      input.plan,
      path.direction,
      geometry.runStartMm,
      geometry.runEndMm,
      path.bandStartMm,
      path.bandEndMm,
    )) {
      errors.push(issue(
        "through-path-opening-blocked",
        `“${path.name}”的通墙带与洞口发生正面积相交；请缩小通墙范围避开洞口。`,
        [path.id],
      ));
      return;
    }
    const containingInterval = bandContainedIn(
      geometry.validBandIntervals,
      path.bandStartMm,
      path.bandEndMm,
    );
    if (!containingInterval) {
      errors.push(issue(
        "through-path-band-outside",
        `“${path.name}”的通墙范围超出板区链及实际共享边的共同有效范围。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    if (hasExternalContinuousEndpoint(atomic, geometry, path.bandStartMm, path.bandEndMm, "start") ||
      hasExternalContinuousEndpoint(atomic, geometry, path.bandStartMm, path.bandEndMm, "end")) {
      errors.push(issue(
        "through-path-continuous-endpoint",
        `“${path.name}”的起点或终点仍连接连续楼板，请将连续板区完整纳入路径。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    const positionsBySlab = geometry.orderedSlabIds.map((slabId) =>
      candidatePositionsForSlab(
        slabId,
        path.direction,
        path.bandStartMm,
        path.bandEndMm,
        input.normalPieces,
        positionsByLine,
      ));
    const referencePositions = positionsBySlab[0] ?? [];
    const roles = geometry.orderedSlabIds.map((slabId) => {
      const piece = input.normalPieces.find((candidate) => {
        return candidate.source === "normal" &&
          candidate.slabIds.includes(slabId) &&
          candidate.direction === path.direction;
      });
      return piece?.role;
    });
    if (roles.some((role) => !role) || roles.some((role) => role !== roles[0])) {
      errors.push(issue(
        "through-path-role-conflict",
        `“${path.name}”各板区的${path.direction === "x" ? "东西向" : "南北向"}普通面筋主副角色不一致。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    const role = roles[0]!;
    const settings = geometry.orderedSlabIds.map((slabId) =>
      input.resolveSettings(slabId, path.direction, role));
    if (settings.some((item) => !settingsEqual(item, settings[0]))) {
      errors.push(issue(
        "through-path-settings-conflict",
        `“${path.name}”各板区的通墙方向直径、间距或增加位置不一致。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    if (referencePositions.length === 0 || positionsBySlab.some((positions) =>
      !positionsEqual(referencePositions, positions))) {
      errors.push(issue(
        "through-path-line-phase-conflict",
        `“${path.name}”各板区在通墙范围内的普通面筋位置或根数不一致，不能只取交集生成通墙筋。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    validated.push({
      path,
      geometry,
      role,
      settings: settings[0],
      positions: referencePositions,
    });
  });

  for (let leftIndex = 0; leftIndex < validated.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < validated.length; rightIndex += 1) {
      const left = validated[leftIndex];
      const right = validated[rightIndex];
      if (left.path.direction !== right.path.direction) continue;
      if (intervalsOverlap(
        left.geometry.runStartMm,
        left.geometry.runEndMm,
        right.geometry.runStartMm,
        right.geometry.runEndMm,
      ) && intervalsOverlap(
        left.path.bandStartMm,
        left.path.bandEndMm,
        right.path.bandStartMm,
        right.path.bandEndMm,
      )) {
        errors.push(issue(
          "through-path-overlap",
          `“${left.path.name}”与“${right.path.name}”在同方向上范围重叠，会重复认领普通面筋。`,
          [left.path.id, right.path.id],
        ));
      }
    }
  }
  if (errors.length > 0) {
    return {
      lines: [...input.normalLines],
      pieces: [...input.normalPieces],
      resolvedPaths: [],
      claimedNormalPieceIds: new Set(),
      errors,
    };
  }

  const claimed = new Set<string>();
  const throughLines: FloorBarLine[] = [];
  const throughPieces: FloorBarPiece[] = [];
  const resolvedPaths: ResolvedFloorTopThroughPath[] = [];
  validated.forEach(({ path, geometry, role, settings, positions }) => {
    const orderedSlabs = geometry.orderedSlabIds.map((id) => slabById.get(id)!).filter(Boolean);
    const pathErrorsBefore = errors.length;
    positions.forEach((positionMm, lineIndex) => {
      const normalPiecesForLine = new Map<string, FloorBarPiece>();
      orderedSlabs.forEach((slab) => {
        const matches = pieceForSlabAtPosition(
          slab,
          path.direction,
          positionMm,
          input.normalPieces,
          positionsByLine,
        );
        if (matches.length !== 1) {
          errors.push(issue(
            "through-path-normal-piece-missing",
            `“${path.name}”在位置${positionMm}mm无法唯一找到“${slab.name}”的普通面筋Piece。`,
            [path.id, slab.id, ...matches.map((piece) => piece.id)],
          ));
          return;
        }
        normalPiecesForLine.set(matches[0].id, matches[0]);
      });
      const candidates = [...normalPiecesForLine.values()];
      if (candidates.some((piece) =>
        piece.runStartMm < geometry.runStartMm - THROUGH_GEOMETRY_EPSILON_MM ||
        piece.runEndMm > geometry.runEndMm + THROUGH_GEOMETRY_EPSILON_MM)) {
        errors.push(issue(
          "through-path-normal-piece-crosses-scope",
          `“${path.name}”在位置${positionMm}mm的普通面筋已越过路径端点，不能部分切掉该Piece。`,
          [path.id, ...candidates.map((piece) => piece.id)],
        ));
        return;
      }
      if (candidates.some((piece) => claimed.has(piece.id))) {
        errors.push(issue(
          "through-path-overlap",
          `“${path.name}”与其他路径认领了同一普通面筋Piece。`,
          [path.id, ...candidates.filter((piece) => claimed.has(piece.id)).map((piece) => piece.id)],
        ));
        return;
      }
      const startSlab = orderedSlabs[0];
      const endSlab = orderedSlabs.at(-1)!;
      const startBoundary = resolveFloorEndpointBoundary(
        atomic,
        path.direction,
        geometry.runStartMm,
        positionMm,
        new Set([startSlab.id]),
      );
      const endBoundary = resolveFloorEndpointBoundary(
        atomic,
        path.direction,
        geometry.runEndMm,
        positionMm,
        new Set([endSlab.id]),
      );
      if (!startBoundary.segment || !endBoundary.segment) {
        errors.push(issue(
          startBoundary.errorCode === "bottom-endpoint-boundary-ambiguous" ||
            endBoundary.errorCode === "bottom-endpoint-boundary-ambiguous"
            ? "top-endpoint-boundary-ambiguous"
            : "top-endpoint-boundary-missing",
          `“${path.name}”在位置${positionMm}mm无法解析真正起终点支承。`,
          [path.id, ...startBoundary.candidateIds, ...endBoundary.candidateIds],
        ));
        return;
      }
      const startAnchor = input.resolveEndpointAnchor(startBoundary.segment, "start", settings.extraMode);
      const endAnchor = input.resolveEndpointAnchor(endBoundary.segment, "end", settings.extraMode);
      if (startAnchor.anchorMm === null || endAnchor.anchorMm === null) {
        errors.push(issue(
          "through-path-continuous-endpoint",
          `“${path.name}”在位置${positionMm}mm仍以连续板边作为真正端点。`,
          [path.id, startBoundary.segment.id, endBoundary.segment.id],
        ));
        return;
      }
      let intermediateWallMm = 0;
      const intermediateBoundaryIds: string[] = [];
      for (let pairIndex = 0; pairIndex < orderedSlabs.length - 1; pairIndex += 1) {
        const left = orderedSlabs[pairIndex];
        const right = orderedSlabs[pairIndex + 1];
        const crossing = findCrossingAtomicBoundary(
          atomic,
          path.direction,
          axisEnd(left, path.direction),
          positionMm,
          new Set([left.id]),
          new Set([right.id]),
        );
        if (!crossing.segment || !["inner-wall", "continuous"].includes(crossing.segment.support)) {
          errors.push(issue(
            "through-path-chain-invalid",
            `“${path.name}”在位置${positionMm}mm无法确定中间共享边支承。`,
            [path.id, left.id, right.id],
          ));
          return;
        }
        intermediateBoundaryIds.push(crossing.segment.id);
        if (crossing.segment.support === "inner-wall") {
          intermediateWallMm += crossing.segment.thicknessMm;
        }
      }
      if (errors.length > pathErrorsBefore) return;
      candidates.forEach((piece) => claimed.add(piece.id));
      const lineId = `top-through:${path.id}:line:${lineIndex + 1}`;
      const domainId = `through:${path.id}`;
      throughLines.push({
        id: lineId,
        domainId,
        slabIds: [...geometry.orderedSlabIds],
        layer: "top",
        direction: path.direction,
        role,
        source: "through",
        throughPathId: path.id,
        positionMm,
      });
      const netLengthMm = geometry.runEndMm - geometry.runStartMm;
      throughPieces.push({
        id: `${lineId}:piece`,
        lineId,
        domainId,
        slabIds: [...geometry.orderedSlabIds],
        layer: "top",
        direction: path.direction,
        role,
        diameter: settings.diameter,
        spacing: settings.spacing,
        runStartMm: geometry.runStartMm,
        runEndMm: geometry.runEndMm,
        netLengthMm,
        startBoundaryId: startBoundary.segment.id,
        endBoundaryId: endBoundary.segment.id,
        startSupport: startBoundary.segment.support,
        endSupport: endBoundary.segment.support,
        startAnchorMm: startAnchor.anchorMm,
        endAnchorMm: endAnchor.anchorMm,
        startExtraApplied: startAnchor.extraApplied,
        endExtraApplied: endAnchor.extraApplied,
        topExtraValueMm: input.topAnchorExtraMm,
        intermediateWallMm,
        intermediateBoundaryIds,
        singleLengthMm: netLengthMm + intermediateWallMm + startAnchor.anchorMm + endAnchor.anchorMm,
        source: "through",
        throughPathId: path.id,
      });
    });
    if (errors.length === pathErrorsBefore) {
      resolvedPaths.push({
        id: path.id,
        name: path.name,
        direction: path.direction,
        orderedSlabIds: [...geometry.orderedSlabIds],
        bandStartMm: path.bandStartMm,
        bandEndMm: path.bandEndMm,
        maxBandStartMm: geometry.maxBandStartMm!,
        maxBandEndMm: geometry.maxBandEndMm!,
        runStartMm: geometry.runStartMm,
        runEndMm: geometry.runEndMm,
        role,
        diameter: settings.diameter,
        spacing: settings.spacing,
        extraMode: settings.extraMode,
        linePositionsMm: [...positions],
      });
    }
  });
  if (errors.length > 0) {
    return {
      lines: [...input.normalLines],
      pieces: [...input.normalPieces],
      resolvedPaths: [],
      claimedNormalPieceIds: new Set(),
      errors,
    };
  }
  const remainingNormalPieces = input.normalPieces.filter((piece) => !claimed.has(piece.id));
  const remainingLineIds = new Set(remainingNormalPieces.map((piece) => piece.lineId));
  return {
    lines: [
      ...input.normalLines.filter((line) => remainingLineIds.has(line.id)),
      ...throughLines,
    ],
    pieces: [...remainingNormalPieces, ...throughPieces],
    resolvedPaths,
    claimedNormalPieceIds: claimed,
    errors: [],
  };
}
