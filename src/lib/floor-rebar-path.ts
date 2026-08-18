import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorEdgeSide,
  type FloorPlanState,
} from "./floor-plan";
import {
  buildFloorTopologyExteriorRanges,
  solveFloorTopology,
  type FloorSolvedConnection,
  type FloorSolvedSlab,
  type FloorTopologyConstraintIssue,
  type FloorTopologyExteriorRange,
  type FloorTopologySolution,
} from "./floor-topology-solver";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorRebarScanDirection = "x" | "y";

export type FloorRebarClearSpan = {
  kind: "clear-slab";
  slabId: string;
  startMm: number;
  endMm: number;
  lengthMm: number;
};

export type FloorRebarConnectionTransition = {
  kind: "connection";
  connectionId: string;
  beforeSlabId: string;
  afterSlabId: string;
  support: "inner-wall" | "continuous";
  runStartMm: number;
  runEndMm: number;
  gapMm: number;
  wallThicknessMm: number;
  overlapRangeStartMm: number;
  overlapRangeEndMm: number;
};

export type FloorRebarPathEndpoint = {
  slabId: string;
  side: "west" | "east" | "south" | "north";
  runMm: number;
  support: "outer-wall";
  exteriorRangeStartMm: number;
  exteriorRangeEndMm: number;
};

export type FloorRebarScanlineChain = {
  id: string;
  direction: FloorRebarScanDirection;
  positionMm: number;
  spans: FloorRebarClearSpan[];
  transitions: FloorRebarConnectionTransition[];
  slabIds: string[];
  startMm: number;
  endMm: number;
  startEndpoint: FloorRebarPathEndpoint;
  endEndpoint: FloorRebarPathEndpoint;
};

export type FloorRebarOpeningIntersection = {
  openingId: string;
  startMm: number;
  endMm: number;
  lengthMm: number;
  slabIds: string[];
};

export type FloorRebarPathIssueCode =
  | "rebar-path-topology-invalid"
  | "rebar-path-clear-overlap"
  | "rebar-path-connection-geometry-mismatch"
  | "rebar-path-connection-ambiguous"
  | "rebar-path-branch-ambiguous"
  | "rebar-path-endpoint-unresolved";

export type FloorRebarPathIssue = {
  level: "warning" | "error";
  code: FloorRebarPathIssueCode;
  message: string;
  sourceIssueCode?: FloorTopologyConstraintIssue["code"] | "coordinate-model-invalid";
  slabIds?: string[];
  connectionIds?: string[];
  openingIds?: string[];
};

export type FloorRebarScanlineResult = {
  direction: FloorRebarScanDirection;
  positionMm: number;
  chains: FloorRebarScanlineChain[];
  openingIntersections: FloorRebarOpeningIntersection[];
  issues: FloorRebarPathIssue[];
  isValid: boolean;
};

export type FloorRebarPathContext = {
  plan: FloorPlanState;
  solution: FloorTopologySolution;
  slabsById: ReadonlyMap<string, FloorSolvedSlab>;
  exteriorRanges: readonly FloorTopologyExteriorRange[];
  topologyIssues: readonly FloorTopologyConstraintIssue[];
  isValid: boolean;
};

export type FloorRebarPathContextV3 = FloorRebarPathContext;

export type FloorRebarScanlineRequest = {
  direction: FloorRebarScanDirection;
  positionMm: number;
  slabIds?: readonly string[];
};

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}

/** Physical intervals are half-open. EPSILON only keeps a numerically exact lower boundary in range. */
function containsHalfOpen(value: number, start: number, end: number): boolean {
  return value >= start - EPSILON && value < end;
}

function isTopologyError(issue: FloorTopologyConstraintIssue): boolean {
  return issue.level === "error";
}

function topologyIssueToPathIssue(issue: FloorTopologyConstraintIssue): FloorRebarPathIssue {
  return {
    level: issue.level,
    code: "rebar-path-topology-invalid",
    sourceIssueCode: issue.code,
    message: issue.message,
    slabIds: issue.slabIds ? [...issue.slabIds].sort(compareString) : undefined,
    connectionIds: issue.connectionIds ? [...issue.connectionIds].sort(compareString) : undefined,
  };
}

function modelIssue(): FloorRebarPathIssue {
  return {
    level: "error",
    code: "rebar-path-topology-invalid",
    sourceIssueCode: "coordinate-model-invalid",
    message: "Floor rebar V3 path requires the clear-space-physical-v2 coordinate model.",
  };
}

function sortPathIssues(issues: readonly FloorRebarPathIssue[]): FloorRebarPathIssue[] {
  return [...issues].sort((left, right) =>
    left.level.localeCompare(right.level)
    || left.code.localeCompare(right.code)
    || (left.connectionIds?.join("|") ?? "").localeCompare(right.connectionIds?.join("|") ?? "")
    || (left.slabIds?.join("|") ?? "").localeCompare(right.slabIds?.join("|") ?? "")
    || left.message.localeCompare(right.message));
}

export function buildFloorRebarPathContextV3(plan: FloorPlanState): FloorRebarPathContext {
  // Keep one derived solve in the reusable context. The plan itself is never changed.
  const solution = solveFloorTopology(plan);
  const topologyIssues = [...solution.issues].sort((left, right) =>
    left.code.localeCompare(right.code)
    || (left.connectionIds?.join("|") ?? "").localeCompare(right.connectionIds?.join("|") ?? "")
    || (left.slabIds?.join("|") ?? "").localeCompare(right.slabIds?.join("|") ?? "")
    || left.message.localeCompare(right.message));
  const modelValid = plan.coordinateModel === "clear-space-physical-v2";
  const hasTopologyErrors = topologyIssues.some(isTopologyError);
  return {
    plan,
    solution,
    slabsById: new Map(solution.slabs.map((slab) => [slab.slabId, slab])),
    exteriorRanges: modelValid ? buildFloorTopologyExteriorRanges(plan, solution) : [],
    topologyIssues,
    isValid: modelValid && !hasTopologyErrors,
  };
}

function slabRunBounds(
  slab: FloorSolvedSlab,
  direction: FloorRebarScanDirection,
): { tangentStart: number; tangentEnd: number; runStart: number; runEnd: number } {
  if (direction === "x") {
    return { tangentStart: slab.y, tangentEnd: slab.y + slab.height, runStart: slab.x, runEnd: slab.x + slab.width };
  }
  return { tangentStart: slab.x, tangentEnd: slab.x + slab.width, runStart: slab.y, runEnd: slab.y + slab.height };
}

function spanForSlab(
  slab: FloorSolvedSlab,
  direction: FloorRebarScanDirection,
  positionMm: number,
): FloorRebarClearSpan | null {
  const bounds = slabRunBounds(slab, direction);
  if (!containsHalfOpen(positionMm, bounds.tangentStart, bounds.tangentEnd)) return null;
  return {
    kind: "clear-slab",
    slabId: slab.slabId,
    startMm: bounds.runStart,
    endMm: bounds.runEnd,
    lengthMm: bounds.runEnd - bounds.runStart,
  };
}

function endpointSide(direction: FloorRebarScanDirection, start: boolean): FloorEdgeSide {
  if (direction === "x") return start ? "west" : "east";
  return start ? "south" : "north";
}

function tangentBase(slab: FloorSolvedSlab, direction: FloorRebarScanDirection): number {
  return direction === "x" ? slab.y : slab.x;
}

function rangeMatchesPosition(
  positionMm: number,
  slab: FloorSolvedSlab,
  direction: FloorRebarScanDirection,
  range: FloorTopologyExteriorRange,
): boolean {
  if (range.orientation !== (direction === "x" ? "vertical" : "horizontal")) return false;
  return containsHalfOpen(positionMm, tangentBase(slab, direction) + range.startMm, tangentBase(slab, direction) + range.endMm);
}

function resolveEndpoint(
  span: FloorRebarClearSpan,
  direction: FloorRebarScanDirection,
  positionMm: number,
  start: boolean,
  context: FloorRebarPathContext,
): { endpoint: FloorRebarPathEndpoint | null; issue: FloorRebarPathIssue | null } {
  const slab = context.slabsById.get(span.slabId);
  if (!slab) {
    return {
      endpoint: null,
      issue: {
        level: "error",
        code: "rebar-path-endpoint-unresolved",
        message: `No solved slab exists for scanline endpoint ${span.slabId}.`,
        slabIds: [span.slabId],
      },
    };
  }
  const side = endpointSide(direction, start);
  const matching = context.exteriorRanges
    .filter((range) => range.slabId === slab.slabId && range.side === side)
    .filter((range) => rangeMatchesPosition(positionMm, slab, direction, range))
    .sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm);
  const range = matching[0];
  if (!range) {
    return {
      endpoint: null,
      issue: {
        level: "error",
        code: "rebar-path-endpoint-unresolved",
        message: `Scanline endpoint ${side} of slab ${slab.slabId} is not covered by a formal exterior range.`,
        slabIds: [slab.slabId],
      },
    };
  }
  const base = tangentBase(slab, direction);
  return {
    endpoint: {
      slabId: slab.slabId,
      side,
      runMm: start ? span.startMm : span.endMm,
      support: "outer-wall",
      exteriorRangeStartMm: base + range.startMm,
      exteriorRangeEndMm: base + range.endMm,
    },
    issue: null,
  };
}

function activeConnections(
  context: FloorRebarPathContext,
  direction: FloorRebarScanDirection,
  positionMm: number,
  spans: readonly FloorRebarClearSpan[],
  allowedSlabIds: ReadonlySet<string> | undefined,
): { connections: FloorSolvedConnection[]; issues: FloorRebarPathIssue[] } {
  const orientation = direction === "x" ? "vertical" : "horizontal";
  const spanById = new Map(spans.map((span) => [span.slabId, span]));
  const connections = [...context.solution.solvedConnections]
    .sort((left, right) => left.connectionId.localeCompare(right.connectionId))
    .filter((connection) => {
      if (!connection.valid || connection.orientation !== orientation) return false;
      if (!containsHalfOpen(positionMm, connection.rangeStartMm, connection.rangeEndMm)) return false;
      if (allowedSlabIds && (!allowedSlabIds.has(connection.slabIds[0]) || !allowedSlabIds.has(connection.slabIds[1]))) return false;
      return true;
    });
  const issues: FloorRebarPathIssue[] = [];
  const seenPairs = new Map<string, string[]>();
  connections.forEach((connection) => {
    const pair = [...connection.slabIds].sort(compareString).join("|");
    const ids = seenPairs.get(pair) ?? [];
    ids.push(connection.connectionId);
    seenPairs.set(pair, ids);
    if (!spanById.has(connection.slabIds[0]) || !spanById.has(connection.slabIds[1])) {
      issues.push({
        level: "error",
        code: "rebar-path-connection-geometry-mismatch",
        message: `Connection ${connection.connectionId} crosses a scanline without two matching clear spans.`,
        connectionIds: [connection.connectionId],
        slabIds: [...connection.slabIds].sort(compareString),
      });
    }
  });
  seenPairs.forEach((connectionIds, pair) => {
    if (connectionIds.length < 2) return;
    issues.push({
      level: "error",
      code: "rebar-path-connection-ambiguous",
      message: `Multiple solved connections are active for slab pair ${pair}.`,
      connectionIds: [...connectionIds].sort(compareString),
      slabIds: pair.split("|").sort(compareString),
    });
  });
  return { connections, issues };
}

function transitionForConnection(
  connection: FloorSolvedConnection,
  spans: ReadonlyMap<string, FloorRebarClearSpan>,
  context: FloorRebarPathContext,
): { beforeSlabId: string; afterSlabId: string; transition: FloorRebarConnectionTransition | null; issue: FloorRebarPathIssue | null } {
  const first = spans.get(connection.slabIds[0]);
  const second = spans.get(connection.slabIds[1]);
  if (!first || !second) {
    return {
      beforeSlabId: connection.slabIds[0],
      afterSlabId: connection.slabIds[1],
      transition: null,
      issue: {
        level: "error",
        code: "rebar-path-connection-geometry-mismatch",
        message: `Connection ${connection.connectionId} has no two clear spans on this scanline.`,
        connectionIds: [connection.connectionId],
        slabIds: [...connection.slabIds].sort(compareString),
      },
    };
  }
  const before = first.startMm < second.startMm || (first.startMm === second.startMm && first.slabId.localeCompare(second.slabId) < 0)
    ? first
    : second;
  const after = before === first ? second : first;
  const actualGapMm = after.startMm - before.endMm;
  const wall = connection.support === "inner-wall"
    ? context.solution.walls.find((item) => item.connectionId === connection.connectionId)
    : undefined;
  const wallThicknessMm = connection.support === "inner-wall"
    ? (wall?.thicknessMm ?? connection.gapMm)
    : 0;
  if (Math.abs(actualGapMm - connection.gapMm) > EPSILON
    || (connection.support === "inner-wall" && Math.abs(wallThicknessMm - connection.gapMm) > EPSILON)) {
    return {
      beforeSlabId: before.slabId,
      afterSlabId: after.slabId,
      transition: null,
      issue: {
        level: "error",
        code: "rebar-path-connection-geometry-mismatch",
        message: `Connection ${connection.connectionId} gap does not match its solved physical geometry.`,
        connectionIds: [connection.connectionId],
        slabIds: [before.slabId, after.slabId],
      },
    };
  }
  return {
    beforeSlabId: before.slabId,
    afterSlabId: after.slabId,
    transition: {
      kind: "connection",
      connectionId: connection.connectionId,
      beforeSlabId: before.slabId,
      afterSlabId: after.slabId,
      support: connection.support,
      runStartMm: before.endMm,
      runEndMm: after.startMm,
      gapMm: connection.gapMm,
      wallThicknessMm,
      overlapRangeStartMm: connection.rangeStartMm,
      overlapRangeEndMm: connection.rangeEndMm,
    },
    issue: null,
  };
}

type ScanGraphEdge = {
  beforeSlabId: string;
  afterSlabId: string;
  transition: FloorRebarConnectionTransition;
};

function buildChains(
  context: FloorRebarPathContext,
  request: FloorRebarScanlineRequest,
  spans: FloorRebarClearSpan[],
  connections: FloorSolvedConnection[],
): { chains: FloorRebarScanlineChain[]; issues: FloorRebarPathIssue[] } {
  const issues: FloorRebarPathIssue[] = [];
  const spanById = new Map(spans.map((span) => [span.slabId, span]));
  const edges: ScanGraphEdge[] = [];
  connections.forEach((connection) => {
    const built = transitionForConnection(connection, spanById, context);
    if (built.issue) issues.push(built.issue);
    if (built.transition) edges.push({ beforeSlabId: built.beforeSlabId, afterSlabId: built.afterSlabId, transition: built.transition });
  });
  if (issues.length > 0) return { chains: [], issues };
  const adjacency = new Map<string, ScanGraphEdge[]>(spans.map((span) => [span.slabId, []]));
  edges.forEach((edge) => {
    adjacency.get(edge.beforeSlabId)?.push(edge);
    adjacency.get(edge.afterSlabId)?.push(edge);
  });
  adjacency.forEach((incident, slabId) => {
    if (incident.length <= 2) return;
    const connectionIds = incident.map((edge) => edge.transition.connectionId).sort(compareString);
    issues.push({
      level: "error",
      code: "rebar-path-branch-ambiguous",
      message: `Scanline slab ${slabId} has more than two active connection branches.`,
      slabIds: [slabId],
      connectionIds,
    });
  });
  if (issues.length > 0) return { chains: [], issues };

  const seen = new Set<string>();
  const components: FloorRebarClearSpan[][] = [];
  spans.forEach((span) => {
    if (seen.has(span.slabId)) return;
    const component: FloorRebarClearSpan[] = [];
    const queue = [span.slabId];
    seen.add(span.slabId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentSpan = spanById.get(current);
      if (currentSpan) component.push(currentSpan);
      (adjacency.get(current) ?? []).forEach((edge) => {
        const next = edge.beforeSlabId === current ? edge.afterSlabId : edge.beforeSlabId;
        if (seen.has(next)) return;
        seen.add(next);
        queue.push(next);
      });
    }
    component.sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || compareString(left.slabId, right.slabId));
    components.push(component);
  });
  components.sort((left, right) => left[0].startMm - right[0].startMm || compareString(left[0].slabId, right[0].slabId));

  const chains: FloorRebarScanlineChain[] = [];
  components.forEach((component, index) => {
    const componentIds = new Set(component.map((span) => span.slabId));
    const componentEdges = edges.filter((edge) => componentIds.has(edge.beforeSlabId) && componentIds.has(edge.afterSlabId));
    const orderedTransitions = componentEdges.sort((left, right) =>
      left.transition.runStartMm - right.transition.runStartMm
      || left.transition.runEndMm - right.transition.runEndMm
      || compareString(left.transition.connectionId, right.transition.connectionId));
    const startSpan = component[0];
    const endSpan = component[component.length - 1];
    const startResolved = resolveEndpoint(startSpan, request.direction, request.positionMm, true, context);
    const endResolved = resolveEndpoint(endSpan, request.direction, request.positionMm, false, context);
    if (startResolved.issue) issues.push(startResolved.issue);
    if (endResolved.issue) issues.push(endResolved.issue);
    if (!startResolved.endpoint || !endResolved.endpoint) return;
    chains.push({
      id: `rebar-scanline:${request.direction}:${request.positionMm}:${index}:${component.map((span) => span.slabId).join("|")}`,
      direction: request.direction,
      positionMm: request.positionMm,
      spans: component,
      transitions: orderedTransitions.map((edge) => edge.transition),
      slabIds: component.map((span) => span.slabId),
      startMm: startSpan.startMm,
      endMm: endSpan.endMm,
      startEndpoint: startResolved.endpoint,
      endEndpoint: endResolved.endpoint,
    });
  });
  if (issues.length > 0) return { chains: [], issues };
  return { chains, issues: [] };
}

function openingIntersections(
  context: FloorRebarPathContext,
  request: FloorRebarScanlineRequest,
  spans: readonly FloorRebarClearSpan[],
): FloorRebarOpeningIntersection[] {
  const results: FloorRebarOpeningIntersection[] = [];
  context.plan.openings.forEach((opening) => {
    const tangentStart = request.direction === "x" ? opening.y : opening.x;
    const tangentEnd = tangentStart + (request.direction === "x" ? opening.height : opening.width);
    if (!containsHalfOpen(request.positionMm, tangentStart, tangentEnd)) return;
    const runStart = request.direction === "x" ? opening.x : opening.y;
    const runEnd = runStart + (request.direction === "x" ? opening.width : opening.height);
    if (runEnd - runStart <= EPSILON) return;
    const intersections = spans
      .map((span) => ({
        startMm: Math.max(span.startMm, runStart),
        endMm: Math.min(span.endMm, runEnd),
        slabId: span.slabId,
      }))
      .filter((intersection) => intersection.endMm - intersection.startMm > EPSILON)
      .sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || compareString(left.slabId, right.slabId));
    const merged: Array<{ startMm: number; endMm: number; slabIds: string[] }> = [];
    intersections.forEach((intersection) => {
      const previous = merged[merged.length - 1];
      if (!previous || intersection.startMm - previous.endMm > EPSILON) {
        merged.push({ startMm: intersection.startMm, endMm: intersection.endMm, slabIds: [intersection.slabId] });
        return;
      }
      previous.endMm = Math.max(previous.endMm, intersection.endMm);
      if (!previous.slabIds.includes(intersection.slabId)) previous.slabIds.push(intersection.slabId);
    });
    merged.forEach((intersection) => results.push({
      openingId: opening.id,
      startMm: intersection.startMm,
      endMm: intersection.endMm,
      lengthMm: intersection.endMm - intersection.startMm,
      slabIds: intersection.slabIds.sort(compareString),
    }));
  });
  return results.sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || compareString(left.openingId, right.openingId));
}

function scanlineFromContext(
  context: FloorRebarPathContext,
  request: FloorRebarScanlineRequest,
): FloorRebarScanlineResult {
  const baseResult = {
    direction: request.direction,
    positionMm: request.positionMm,
    chains: [] as FloorRebarScanlineChain[],
    openingIntersections: [] as FloorRebarOpeningIntersection[],
    issues: [] as FloorRebarPathIssue[],
    isValid: false,
  };
  const topologyIssues = context.topologyIssues.map(topologyIssueToPathIssue);
  if (!context.isValid) {
    const issues = [...topologyIssues];
    if (context.plan.coordinateModel !== "clear-space-physical-v2") issues.push(modelIssue());
    if (issues.length === 0) issues.push(modelIssue());
    return { ...baseResult, issues: sortPathIssues(issues) };
  }
  const topologyWarnings = topologyIssues.filter((issue) => issue.level === "warning");
  const allowedSlabIds = request.slabIds ? new Set(request.slabIds) : undefined;
  const spans = context.solution.slabs
    .filter((slab) => !allowedSlabIds || allowedSlabIds.has(slab.slabId))
    .map((slab) => spanForSlab(slab, request.direction, request.positionMm))
    .filter((span): span is FloorRebarClearSpan => span !== null)
    .sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || compareString(left.slabId, right.slabId));
  const issues: FloorRebarPathIssue[] = [];
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index - 1].endMm - spans[index].startMm <= EPSILON) continue;
    issues.push({
      level: "error",
      code: "rebar-path-clear-overlap",
      message: `Clear spans ${spans[index - 1].slabId} and ${spans[index].slabId} overlap on the scanline.`,
      slabIds: [spans[index - 1].slabId, spans[index].slabId].sort(compareString),
    });
  }
  if (issues.length > 0) return { ...baseResult, issues: sortPathIssues([...topologyWarnings, ...issues]) };
  const active = activeConnections(context, request.direction, request.positionMm, spans, allowedSlabIds);
  issues.push(...active.issues);
  if (issues.length > 0) return { ...baseResult, issues: sortPathIssues([...topologyWarnings, ...issues]) };
  const graph = buildChains(context, request, spans, active.connections);
  issues.push(...graph.issues);
  if (issues.length > 0) return { ...baseResult, issues: sortPathIssues([...topologyWarnings, ...issues]) };
  return {
    ...baseResult,
    chains: graph.chains,
    openingIntersections: openingIntersections(context, request, spans),
    issues: sortPathIssues(topologyIssues),
    isValid: true,
  };
}

export function buildFloorRebarScanlineFromContextV3(
  context: FloorRebarPathContext,
  request: FloorRebarScanlineRequest,
): FloorRebarScanlineResult {
  return scanlineFromContext(context, request);
}

export const buildFloorRebarScanlineFromContext = buildFloorRebarScanlineFromContextV3;

export function buildFloorRebarScanlineV3(
  context: FloorRebarPathContext,
  request: FloorRebarScanlineRequest,
): FloorRebarScanlineResult;
export function buildFloorRebarScanlineV3(
  plan: FloorPlanState,
  request: FloorRebarScanlineRequest,
): FloorRebarScanlineResult;
export function buildFloorRebarScanlineV3(
  contextOrPlan: FloorRebarPathContext | FloorPlanState,
  request: FloorRebarScanlineRequest,
): FloorRebarScanlineResult {
  const context = "solution" in contextOrPlan
    ? contextOrPlan as FloorRebarPathContext
    : buildFloorRebarPathContextV3(contextOrPlan as FloorPlanState);
  return scanlineFromContext(context, request);
}
