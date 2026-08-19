import type { FloorRebarCalculationContextV3 } from "./floor-rebar-calculation-context-v3";
import type { FloorRebarDomain } from "./floor-rebar-domain";
import {
  buildFloorRebarScanlineFromContextV3,
  containsHalfOpen,
  type FloorRebarScanlineChain,
} from "./floor-rebar-path";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import type { FloorBarRole } from "./floor-rebar-role";
import type {
  FloorTopBarSettings,
  FloorTopIssue,
  FloorTopThroughPath,
} from "./floor-top-calculator";
import { resolveFloorTopEndpointExtensionV3 } from "./floor-top-policy";
import type { FloorSolvedConnection, FloorSolvedSlab } from "./floor-topology-solver";
import type { TopExtraMode } from "./slab-calculator";

const EPSILON_MM = 1e-7;
export const THROUGH_V3_LINE_POSITION_EPSILON_MM = 1e-6;

export type FloorTopThroughBandIntervalV3 = {
  start: number;
  end: number;
};

export type FloorTopThroughPairGeometryV3 = {
  beforeSlabId: string;
  afterSlabId: string;
  connectionIds: string[];
  validBandIntervals: FloorTopThroughBandIntervalV3[];
};

export type FloorTopThroughGeometryV3 = {
  pathId: string;
  direction: "x" | "y";
  orderedSlabIds: string[];
  orderedPairs: FloorTopThroughPairGeometryV3[];
  runStartMm: number;
  runEndMm: number;
  validBandIntervals: FloorTopThroughBandIntervalV3[];
  maxBandStartMm: number | null;
  maxBandEndMm: number | null;
  errors: FloorTopIssue[];
};

export type ResolvedFloorTopThroughPathV3 = {
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

export type FloorTopThroughResolvedSettingsV3 = FloorTopBarSettings & {
  role: FloorBarRole;
};

export type ApplyFloorTopThroughPathsV3Input = {
  context: FloorRebarCalculationContextV3;
  paths: readonly FloorTopThroughPath[];
  geometries: readonly FloorTopThroughGeometryV3[];
  domains: readonly FloorRebarDomain[];
  normalLines: readonly FloorBarLine[];
  normalPieces: readonly FloorBarPiece[];
  topAnchorExtraMm: number;
  resolveSettings: (
    slabId: string,
    direction: "x" | "y",
  ) => FloorTopThroughResolvedSettingsV3 | null;
};

export type FloorTopThroughApplicationV3 = {
  lines: FloorBarLine[];
  pieces: FloorBarPiece[];
  resolvedPaths: ResolvedFloorTopThroughPathV3[];
  claimedNormalPieceIds: Set<string>;
  errors: FloorTopIssue[];
};

type DirectedConnection = {
  connection: FloorSolvedConnection;
  beforeSlabId: string;
  afterSlabId: string;
};

function issue(code: string, message: string, objectIds?: string[]): FloorTopIssue {
  const firstObjectId = objectIds?.[0];
  const remainingObjectIds = objectIds
    ? [...new Set(objectIds.slice(1).filter((id) => id !== firstObjectId))].sort()
    : [];
  return {
    code,
    message,
    objectIds: firstObjectId ? [firstObjectId, ...remainingObjectIds] : undefined,
  };
}

function sortIssues(issues: readonly FloorTopIssue[]): FloorTopIssue[] {
  return [...issues].sort((left, right) =>
    (left.objectIds?.[0] ?? "").localeCompare(right.objectIds?.[0] ?? "")
    || left.code.localeCompare(right.code)
    || (left.objectIds?.join("|") ?? "").localeCompare(right.objectIds?.join("|") ?? "")
    || left.message.localeCompare(right.message));
}

function mergeIntervals(
  intervals: readonly FloorTopThroughBandIntervalV3[],
): FloorTopThroughBandIntervalV3[] {
  const merged: FloorTopThroughBandIntervalV3[] = [];
  [...intervals]
    .filter((interval) => interval.end - interval.start > EPSILON_MM)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach((interval) => {
      const previous = merged.at(-1);
      if (!previous || interval.start > previous.end + EPSILON_MM) {
        merged.push({ ...interval });
        return;
      }
      previous.end = Math.max(previous.end, interval.end);
    });
  return merged;
}

function intersectIntervals(
  left: readonly FloorTopThroughBandIntervalV3[],
  right: readonly FloorTopThroughBandIntervalV3[],
): FloorTopThroughBandIntervalV3[] {
  const intersections: FloorTopThroughBandIntervalV3[] = [];
  left.forEach((a) => right.forEach((b) => {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end - start > EPSILON_MM) intersections.push({ start, end });
  }));
  return mergeIntervals(intersections);
}

function intervalsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd - EPSILON_MM && leftEnd > rightStart + EPSILON_MM;
}

function bandContainedIn(
  intervals: readonly FloorTopThroughBandIntervalV3[],
  start: number,
  end: number,
): boolean {
  return intervals.some((interval) =>
    start >= interval.start - EPSILON_MM && end <= interval.end + EPSILON_MM);
}

function largestInterval(
  intervals: readonly FloorTopThroughBandIntervalV3[],
): FloorTopThroughBandIntervalV3 | null {
  return [...intervals].sort((left, right) =>
    (right.end - right.start) - (left.end - left.start)
    || left.start - right.start
    || left.end - right.end)[0] ?? null;
}

function directedConnection(
  connection: FloorSolvedConnection,
  direction: "x" | "y",
): DirectedConnection | null {
  if (!connection.valid || !["inner-wall", "continuous"].includes(connection.support)) return null;
  if (direction === "x") {
    if (connection.orientation !== "vertical") return null;
    if (connection.sideA === "east" && connection.sideB === "west") {
      return { connection, beforeSlabId: connection.slabIds[0], afterSlabId: connection.slabIds[1] };
    }
    if (connection.sideB === "east" && connection.sideA === "west") {
      return { connection, beforeSlabId: connection.slabIds[1], afterSlabId: connection.slabIds[0] };
    }
    return null;
  }
  if (connection.orientation !== "horizontal") return null;
  if (connection.sideA === "north" && connection.sideB === "south") {
    return { connection, beforeSlabId: connection.slabIds[0], afterSlabId: connection.slabIds[1] };
  }
  if (connection.sideB === "north" && connection.sideA === "south") {
    return { connection, beforeSlabId: connection.slabIds[1], afterSlabId: connection.slabIds[0] };
  }
  return null;
}

function perpendicularRange(
  slab: FloorSolvedSlab,
  direction: "x" | "y",
): FloorTopThroughBandIntervalV3 {
  return direction === "x"
    ? { start: slab.y, end: slab.y + slab.height }
    : { start: slab.x, end: slab.x + slab.width };
}

function runStart(slab: FloorSolvedSlab, direction: "x" | "y"): number {
  return direction === "x" ? slab.x : slab.y;
}

function runEnd(slab: FloorSolvedSlab, direction: "x" | "y"): number {
  return runStart(slab, direction) + (direction === "x" ? slab.width : slab.height);
}

function hasOverlappingConnections(connections: readonly FloorSolvedConnection[]): boolean {
  const sorted = [...connections].sort((left, right) =>
    left.rangeStartMm - right.rangeStartMm
    || left.rangeEndMm - right.rangeEndMm
    || left.connectionId.localeCompare(right.connectionId));
  for (let index = 1; index < sorted.length; index += 1) {
    if (intervalsOverlap(
      sorted[index - 1].rangeStartMm,
      sorted[index - 1].rangeEndMm,
      sorted[index].rangeStartMm,
      sorted[index].rangeEndMm,
    )) return true;
  }
  return false;
}

function openingBlocksCorridor(
  context: FloorRebarCalculationContextV3,
  direction: "x" | "y",
  runStartMm: number,
  runEndMm: number,
  bandStartMm: number,
  bandEndMm: number,
): boolean {
  const corridorXStart = direction === "x" ? runStartMm : bandStartMm;
  const corridorXEnd = direction === "x" ? runEndMm : bandEndMm;
  const corridorYStart = direction === "x" ? bandStartMm : runStartMm;
  const corridorYEnd = direction === "x" ? bandEndMm : runEndMm;
  return context.plan.openings.some((opening) =>
    intervalsOverlap(corridorXStart, corridorXEnd, opening.x, opening.x + opening.width)
    && intervalsOverlap(corridorYStart, corridorYEnd, opening.y, opening.y + opening.height));
}

function hasExternalContinuousEndpoint(
  context: FloorRebarCalculationContextV3,
  direction: "x" | "y",
  orderedSlabIds: readonly string[],
  bandStartMm: number,
  bandEndMm: number,
): boolean {
  const selected = new Set(orderedSlabIds);
  const first = orderedSlabIds[0];
  const last = orderedSlabIds.at(-1);
  return context.solution.solvedConnections.some((connection) => {
    if (connection.support !== "continuous") return false;
    const directed = directedConnection(connection, direction);
    if (!directed || !intervalsOverlap(
      connection.rangeStartMm,
      connection.rangeEndMm,
      bandStartMm,
      bandEndMm,
    )) return false;
    return (directed.afterSlabId === first && !selected.has(directed.beforeSlabId))
      || (directed.beforeSlabId === last && !selected.has(directed.afterSlabId));
  });
}

function invalidGeometry(
  path: FloorTopThroughPath,
  orderedSlabIds: string[],
  errors: FloorTopIssue[],
): FloorTopThroughGeometryV3 {
  return {
    pathId: path.id,
    direction: path.direction,
    orderedSlabIds,
    orderedPairs: [],
    runStartMm: 0,
    runEndMm: 0,
    validBandIntervals: [],
    maxBandStartMm: null,
    maxBandEndMm: null,
    errors: sortIssues(errors),
  };
}

/** Resolve a V3 Through path only from solved slabs and formal solved connections. */
export function resolveFloorTopThroughPathGeometryV3(
  context: FloorRebarCalculationContextV3,
  path: FloorTopThroughPath,
): FloorTopThroughGeometryV3 {
  const errors: FloorTopIssue[] = [];
  const uniqueSlabIds = [...new Set(path.slabIds)];
  if (uniqueSlabIds.length !== path.slabIds.length || uniqueSlabIds.length < 2) {
    errors.push(issue(
      "through-path-chain-invalid",
      `“${path.name}”必须选择至少两个不重复板区。`,
      [path.id, ...path.slabIds],
    ));
  }
  const selected = new Set(uniqueSlabIds);
  const missing = uniqueSlabIds.filter((slabId) => !context.pathContext.slabsById.has(slabId));
  if (missing.length > 0) {
    errors.push(issue(
      "through-path-chain-invalid",
      `“${path.name}”引用了不存在的正式板区。`,
      [path.id, ...missing],
    ));
  }
  if (errors.length > 0) return invalidGeometry(path, uniqueSlabIds, errors);

  const pairConnections = new Map<string, DirectedConnection[]>();
  context.solution.solvedConnections.forEach((connection) => {
    const directed = directedConnection(connection, path.direction);
    if (!directed || !selected.has(directed.beforeSlabId) || !selected.has(directed.afterSlabId)) return;
    const key = `${directed.beforeSlabId}\u0000${directed.afterSlabId}`;
    const list = pairConnections.get(key) ?? [];
    list.push(directed);
    pairConnections.set(key, list);
  });

  pairConnections.forEach((connections) => {
    if (!hasOverlappingConnections(connections.map((item) => item.connection))) return;
    errors.push(issue(
      "through-path-connection-ambiguous",
      `“${path.name}”的一对板区存在范围重叠的多个正式连接。`,
      [path.id, ...connections.map((item) => item.connection.connectionId)],
    ));
  });

  const incoming = new Map(uniqueSlabIds.map((slabId) => [slabId, [] as string[]]));
  const outgoing = new Map(uniqueSlabIds.map((slabId) => [slabId, [] as string[]]));
  pairConnections.forEach((connections) => {
    const edge = connections[0];
    outgoing.get(edge.beforeSlabId)?.push(edge.afterSlabId);
    incoming.get(edge.afterSlabId)?.push(edge.beforeSlabId);
  });
  const branched = uniqueSlabIds.filter((slabId) =>
    (incoming.get(slabId)?.length ?? 0) > 1 || (outgoing.get(slabId)?.length ?? 0) > 1);
  if (branched.length > 0) {
    errors.push(issue(
      "through-path-chain-ambiguous",
      `“${path.name}”的正式连接图存在分支，无法确定唯一通墙顺序。`,
      [path.id, ...branched],
    ));
  }

  const starts = uniqueSlabIds.filter((slabId) => (incoming.get(slabId)?.length ?? 0) === 0);
  const ends = uniqueSlabIds.filter((slabId) => (outgoing.get(slabId)?.length ?? 0) === 0);
  const orderedSlabIds: string[] = [];
  if (branched.length === 0 && starts.length === 1 && ends.length === 1
    && pairConnections.size === uniqueSlabIds.length - 1) {
    const visited = new Set<string>();
    let current: string | undefined = starts[0];
    while (current && !visited.has(current)) {
      orderedSlabIds.push(current);
      visited.add(current);
      current = outgoing.get(current)?.[0];
    }
  }
  const connectionAmbiguous = errors.some((item) => item.code === "through-path-connection-ambiguous");
  if (orderedSlabIds.length !== uniqueSlabIds.length || connectionAmbiguous) {
    if (!connectionAmbiguous && !errors.some((item) => item.code === "through-path-chain-ambiguous")) {
      errors.push(issue(
        "through-path-chain-invalid",
        `“${path.name}”的所选板区未形成唯一、无环且完整的正式有向连接链。`,
        [path.id, ...uniqueSlabIds],
      ));
    }
    return invalidGeometry(path, orderedSlabIds, errors);
  }

  const solvedSlabs = orderedSlabIds.map((slabId) => context.pathContext.slabsById.get(slabId)!);
  let validBandIntervals = solvedSlabs.length > 0
    ? [{
        start: Math.max(...solvedSlabs.map((slab) => perpendicularRange(slab, path.direction).start)),
        end: Math.min(...solvedSlabs.map((slab) => perpendicularRange(slab, path.direction).end)),
      }]
    : [];
  const orderedPairs: FloorTopThroughPairGeometryV3[] = [];
  for (let index = 0; index < orderedSlabIds.length - 1; index += 1) {
    const beforeSlabId = orderedSlabIds[index];
    const afterSlabId = orderedSlabIds[index + 1];
    const candidates = pairConnections.get(`${beforeSlabId}\u0000${afterSlabId}`) ?? [];
    const pairIntervals = mergeIntervals(candidates.map(({ connection }) => ({
      start: connection.rangeStartMm,
      end: connection.rangeEndMm,
    })));
    orderedPairs.push({
      beforeSlabId,
      afterSlabId,
      connectionIds: candidates.map(({ connection }) => connection.connectionId).sort(),
      validBandIntervals: pairIntervals,
    });
    validBandIntervals = intersectIntervals(validBandIntervals, pairIntervals);
  }
  validBandIntervals = mergeIntervals(validBandIntervals);
  const maximum = largestInterval(validBandIntervals);
  const geometry: FloorTopThroughGeometryV3 = {
    pathId: path.id,
    direction: path.direction,
    orderedSlabIds,
    orderedPairs,
    runStartMm: runStart(solvedSlabs[0], path.direction),
    runEndMm: runEnd(solvedSlabs.at(-1)!, path.direction),
    validBandIntervals,
    maxBandStartMm: maximum?.start ?? null,
    maxBandEndMm: maximum?.end ?? null,
    errors: [],
  };

  if (!Number.isFinite(path.bandStartMm) || !Number.isFinite(path.bandEndMm)
    || path.bandStartMm >= path.bandEndMm) {
    errors.push(issue(
      "through-path-band-invalid",
      `“${path.name}”的通墙范围必须是有限数，且起点小于终点。`,
      [path.id],
    ));
  } else if (!bandContainedIn(validBandIntervals, path.bandStartMm, path.bandEndMm)) {
    errors.push(issue(
      "through-path-band-outside",
      `“${path.name}”的通墙范围未完整落入所有板区及正式连接共同覆盖的区间。`,
      [path.id, ...orderedSlabIds],
    ));
  } else {
    if (hasExternalContinuousEndpoint(
      context,
      path.direction,
      orderedSlabIds,
      path.bandStartMm,
      path.bandEndMm,
    )) {
      errors.push(issue(
        "through-path-continuous-endpoint",
        `“${path.name}”在所选带宽内仍连续连接到路径外板区，请完整选择连续链。`,
        [path.id, ...orderedSlabIds],
      ));
    }
    if (openingBlocksCorridor(
      context,
      path.direction,
      geometry.runStartMm,
      geometry.runEndMm,
      path.bandStartMm,
      path.bandEndMm,
    )) {
      errors.push(issue(
        "through-path-opening-blocked",
        `“${path.name}”的通墙走廊与洞口发生正面积相交。`,
        [path.id],
      ));
    }
  }
  return { ...geometry, errors: sortIssues(errors) };
}

function uniquePositions(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.filter((value, index) =>
    index === 0
    || Math.abs(value - sorted[index - 1]) > THROUGH_V3_LINE_POSITION_EPSILON_MM);
}

function positionsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((position, index) =>
    Math.abs(position - right[index]) <= THROUGH_V3_LINE_POSITION_EPSILON_MM);
}

function settingsEqual(
  left: FloorTopThroughResolvedSettingsV3,
  right: FloorTopThroughResolvedSettingsV3,
): boolean {
  return left.diameter === right.diameter
    && left.spacing === right.spacing
    && left.extraMode === right.extraMode;
}

function chainMatchesGeometry(
  chain: FloorRebarScanlineChain,
  geometry: FloorTopThroughGeometryV3,
): boolean {
  return chain.slabIds.length === geometry.orderedSlabIds.length
    && chain.slabIds.every((slabId, index) => slabId === geometry.orderedSlabIds[index]);
}

function coveringNormalPieces(
  span: FloorRebarScanlineChain["spans"][number],
  direction: "x" | "y",
  positionMm: number,
  normalPieces: readonly FloorBarPiece[],
  positionsByLine: ReadonlyMap<string, number>,
): FloorBarPiece[] {
  return normalPieces.filter((piece) => {
    if (piece.source !== "normal" || piece.direction !== direction || !piece.slabIds.includes(span.slabId)) {
      return false;
    }
    const linePosition = positionsByLine.get(piece.lineId);
    return linePosition !== undefined
      && Math.abs(linePosition - positionMm) <= THROUGH_V3_LINE_POSITION_EPSILON_MM
      && piece.runStartMm <= span.startMm + EPSILON_MM
      && piece.runEndMm >= span.endMm - EPSILON_MM;
  });
}

function unchangedApplication(
  input: ApplyFloorTopThroughPathsV3Input,
  errors: readonly FloorTopIssue[],
): FloorTopThroughApplicationV3 {
  return {
    lines: [...input.normalLines],
    pieces: [...input.normalPieces],
    resolvedPaths: [],
    claimedNormalPieceIds: new Set(),
    errors: sortIssues(errors),
  };
}

/** Atomically claim aligned Normal pieces and replace them with connection-aware Through pieces. */
export function applyFloorTopThroughPathsV3(
  input: ApplyFloorTopThroughPathsV3Input,
): FloorTopThroughApplicationV3 {
  const enabledPaths = input.paths.filter((path) => path.enabled).sort((left, right) =>
    left.id.localeCompare(right.id));
  if (enabledPaths.length === 0) return unchangedApplication(input, []);

  const errors: FloorTopIssue[] = [];
  const geometryByPathId = new Map(input.geometries.map((geometry) => [geometry.pathId, geometry]));
  const domainBySlabId = new Map<string, FloorRebarDomain>();
  input.domains.forEach((domain) => domain.slabIds.forEach((slabId) => domainBySlabId.set(slabId, domain)));
  const positionsByLine = new Map(input.normalLines.map((line) => [line.id, line.positionMm]));
  const seenPathIds = new Set<string>();

  type ValidatedPath = {
    path: FloorTopThroughPath;
    geometry: FloorTopThroughGeometryV3;
    domainIds: string[];
    settings: FloorTopThroughResolvedSettingsV3;
    positions: number[];
  };
  const validated: ValidatedPath[] = [];

  enabledPaths.forEach((path) => {
    if (seenPathIds.has(path.id)) {
      errors.push(issue("through-path-chain-invalid", `通墙路径ID“${path.id}”重复。`, [path.id]));
      return;
    }
    seenPathIds.add(path.id);
    const geometry = geometryByPathId.get(path.id);
    if (!geometry) {
      errors.push(issue(
        "through-path-chain-invalid",
        `“${path.name}”缺少正式V3通墙几何。`,
        [path.id],
      ));
      return;
    }
    errors.push(...geometry.errors);
    if (geometry.errors.length > 0) return;

    const missingDomains = geometry.orderedSlabIds.filter((slabId) => !domainBySlabId.has(slabId));
    if (missingDomains.length > 0) {
      errors.push(issue(
        "through-alignment-domain-invalid",
        `“${path.name}”存在无法映射到正式钢筋Domain的板区。`,
        [path.id, ...missingDomains],
      ));
      return;
    }
    const domainIds = [...new Set(geometry.orderedSlabIds.map((slabId) =>
      domainBySlabId.get(slabId)!.id))];
    const resolvedSettings = geometry.orderedSlabIds.map((slabId) =>
      input.resolveSettings(slabId, path.direction));
    if (resolvedSettings.some((settings) => !settings)) {
      errors.push(issue(
        "through-path-role-conflict",
        `“${path.name}”存在无法解析角色或规格的板区。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    const settings = resolvedSettings as FloorTopThroughResolvedSettingsV3[];
    if (settings.some((item) => item.role !== settings[0].role)) {
      errors.push(issue(
        "through-path-role-conflict",
        `“${path.name}”各板区的通墙方向主副筋角色不一致。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    if (settings.some((item) => !settingsEqual(item, settings[0]))) {
      errors.push(issue(
        "through-path-settings-conflict",
        `“${path.name}”各板区的通墙方向直径、间距或增加位置不一致。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }

    const positionsByDomain = domainIds.map((domainId) => uniquePositions(
      input.normalLines.flatMap((line) =>
        line.source === "normal"
        && line.domainId === domainId
        && line.direction === path.direction
        && containsHalfOpen(line.positionMm, path.bandStartMm, path.bandEndMm)
          ? [line.positionMm]
          : []),
    ));
    const positions = positionsByDomain[0] ?? [];
    if (positions.length === 0) {
      errors.push(issue(
        "through-path-no-lines",
        `“${path.name}”的所选带宽内没有可继承的普通面筋线。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    if (positionsByDomain.some((candidate) => !positionsEqual(candidate, positions))) {
      errors.push(issue(
        "through-path-line-phase-conflict",
        `“${path.name}”各Domain在所选带宽内的普通面筋位置不一致。`,
        [path.id, ...geometry.orderedSlabIds],
      ));
      return;
    }
    validated.push({ path, geometry, domainIds, settings: settings[0], positions });
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
          `“${left.path.name}”与“${right.path.name}”在同方向上发生正面积重叠。`,
          [left.path.id, right.path.id],
        ));
      }
    }
  }
  if (errors.length > 0) return unchangedApplication(input, errors);

  const claimed = new Set<string>();
  const throughLines: FloorBarLine[] = [];
  const throughPieces: FloorBarPiece[] = [];
  const resolvedPaths: ResolvedFloorTopThroughPathV3[] = [];

  validated.forEach(({ path, geometry, settings, positions }) => {
    const pathErrorCount = errors.length;
    positions.forEach((positionMm, lineIndex) => {
      const scan = buildFloorRebarScanlineFromContextV3(input.context.pathContext, {
        direction: path.direction,
        positionMm,
        slabIds: geometry.orderedSlabIds,
      });
      const chain = scan.chains.length === 1 ? scan.chains[0] : undefined;
      if (!scan.isValid || !chain || !chainMatchesGeometry(chain, geometry)) {
        errors.push(issue(
          "through-path-chain-invalid",
          `“${path.name}”在${positionMm}mm处未形成与目标顺序完全一致的正式扫描链。`,
          [
            path.id,
            ...geometry.orderedSlabIds,
            ...scan.issues.flatMap((item) => item.connectionIds ?? []),
          ],
        ));
        return;
      }
      if (scan.openingIntersections.some((opening) => opening.lengthMm > EPSILON_MM)) {
        errors.push(issue(
          "through-path-opening-blocked",
          `“${path.name}”在${positionMm}mm处与洞口相交。`,
          [path.id, ...scan.openingIntersections.map((opening) => opening.openingId)],
        ));
        return;
      }

      const candidatesById = new Map<string, FloorBarPiece>();
      let claimInvalid = false;
      chain.spans.forEach((span) => {
        const matches = coveringNormalPieces(
          span,
          path.direction,
          positionMm,
          input.normalPieces,
          positionsByLine,
        );
        if (matches.length === 0) {
          errors.push(issue(
            "through-path-normal-piece-missing",
            `“${path.name}”在${positionMm}mm处缺少完整覆盖“${span.slabId}”净跨的普通面筋Piece。`,
            [path.id, span.slabId],
          ));
          claimInvalid = true;
          return;
        }
        if (matches.length > 1) {
          errors.push(issue(
            "through-path-normal-piece-ambiguous",
            `“${path.name}”在${positionMm}mm处有多个普通面筋Piece覆盖同一净跨。`,
            [path.id, span.slabId, ...matches.map((piece) => piece.id)],
          ));
          claimInvalid = true;
          return;
        }
        candidatesById.set(matches[0].id, matches[0]);
      });
      if (claimInvalid) return;
      const candidates = [...candidatesById.values()].sort((left, right) => left.id.localeCompare(right.id));
      if (candidates.some((piece) =>
        piece.runStartMm < chain.startMm - EPSILON_MM
        || piece.runEndMm > chain.endMm + EPSILON_MM)) {
        errors.push(issue(
          "through-path-normal-piece-crosses-scope",
          `“${path.name}”在${positionMm}mm处的普通面筋Piece越过了通墙路径范围。`,
          [path.id, ...candidates.map((piece) => piece.id)],
        ));
        return;
      }
      const alreadyClaimed = candidates.filter((piece) => claimed.has(piece.id));
      if (alreadyClaimed.length > 0) {
        errors.push(issue(
          "through-path-overlap",
          `“${path.name}”重复认领了其他通墙路径已使用的普通面筋Piece。`,
          [path.id, ...alreadyClaimed.map((piece) => piece.id)],
        ));
        return;
      }

      if (chain.startEndpoint.kind === "connection-boundary"
        && chain.startEndpoint.support === "continuous"
        || chain.endEndpoint.kind === "connection-boundary"
        && chain.endEndpoint.support === "continuous") {
        errors.push(issue(
          "through-path-continuous-endpoint",
          `“${path.name}”在${positionMm}mm处仍以连续连接作为路径端点。`,
          [
            path.id,
            chain.startEndpoint.kind === "connection-boundary" ? chain.startEndpoint.connectionId : "",
            chain.endEndpoint.kind === "connection-boundary" ? chain.endEndpoint.connectionId : "",
          ].filter(Boolean),
        ));
        return;
      }
      const start = resolveFloorTopEndpointExtensionV3(
        chain.startEndpoint,
        "start",
        settings.extraMode,
        input.topAnchorExtraMm,
        input.context.plan.outerWallThickness,
      );
      const end = resolveFloorTopEndpointExtensionV3(
        chain.endEndpoint,
        "end",
        settings.extraMode,
        input.topAnchorExtraMm,
        input.context.plan.outerWallThickness,
      );
      if (start.error || end.error) {
        errors.push(...[start.error, end.error]
          .filter((item): item is FloorTopIssue => Boolean(item))
          .map((item) => issue(item.code, item.message, [path.id, ...(item.objectIds ?? [])])));
        return;
      }

      const netLengthMm = chain.spans.reduce((sum, span) => sum + span.lengthMm, 0);
      const intermediateWallMm = chain.transitions.reduce((sum, transition) =>
        sum + (transition.support === "inner-wall" ? transition.wallThicknessMm : 0), 0);
      if (Math.abs((chain.endMm - chain.startMm) - (netLengthMm + intermediateWallMm)) > EPSILON_MM) {
        errors.push(issue(
          "through-path-geometry-mismatch",
          `“${path.name}”在${positionMm}mm处的物理跨长与净跨及中间墙厚分解不一致。`,
          [path.id, ...chain.transitions.map((transition) => transition.connectionId)],
        ));
        return;
      }

      candidates.forEach((piece) => claimed.add(piece.id));
      const lineId = `top-through:${path.id}:line:${lineIndex + 1}`;
      const domainId = `through:${path.id}`;
      const referenceLine = input.normalLines.find((line) =>
        line.source === "normal"
        && line.direction === path.direction
        && Math.abs(line.positionMm - positionMm) <= THROUGH_V3_LINE_POSITION_EPSILON_MM
        && geometry.orderedSlabIds.some((slabId) => line.slabIds.includes(slabId)));
      throughLines.push({
        id: lineId,
        domainId,
        slabIds: [...geometry.orderedSlabIds],
        layer: "top",
        direction: path.direction,
        role: settings.role,
        source: "through",
        throughPathId: path.id,
        positionMm,
        ...(referenceLine?.alignmentMode
          ? {
              alignmentMode: referenceLine.alignmentMode,
              alignmentPhaseMm: referenceLine.alignmentPhaseMm,
              alignmentGroupId: referenceLine.alignmentGroupId,
            }
          : {}),
      });
      throughPieces.push({
        id: `${lineId}:piece`,
        lineId,
        domainId,
        slabIds: [...geometry.orderedSlabIds],
        layer: "top",
        direction: path.direction,
        role: settings.role,
        diameter: settings.diameter,
        spacing: settings.spacing,
        runStartMm: chain.startMm,
        runEndMm: chain.endMm,
        netLengthMm,
        startBoundaryId: start.boundaryId,
        endBoundaryId: end.boundaryId,
        startSupport: start.support,
        endSupport: end.support,
        startAnchorMm: start.extensionMm,
        endAnchorMm: end.extensionMm,
        startExtraApplied: start.extraApplied,
        endExtraApplied: end.extraApplied,
        topExtraValueMm: input.topAnchorExtraMm,
        intermediateWallMm,
        intermediateBoundaryIds: chain.transitions.map((transition) => transition.connectionId),
        singleLengthMm: netLengthMm
          + intermediateWallMm
          + start.extensionMm
          + end.extensionMm,
        source: "through",
        throughPathId: path.id,
      });
    });
    if (errors.length === pathErrorCount) {
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
        role: settings.role,
        diameter: settings.diameter,
        spacing: settings.spacing,
        extraMode: settings.extraMode,
        linePositionsMm: [...positions],
      });
    }
  });
  if (errors.length > 0) return unchangedApplication(input, errors);

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
