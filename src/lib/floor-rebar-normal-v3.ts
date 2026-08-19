import { FLOOR_GEOMETRY_EPSILON_MM, type FloorEdgeSide } from "./floor-plan";
import {
  resolveFloorOpeningEdgeAtPosition,
  type FloorOpeningEdgeResolution,
} from "./floor-opening-support";
import type { FloorRebarDomain } from "./floor-rebar-domain";
import {
  buildFloorRebarScanlineFromContextV3,
  type FloorRebarClearSpan,
  type FloorRebarConnectionEndpoint,
  type FloorRebarConnectionTransition,
  type FloorRebarOpeningIntersection,
  type FloorRebarPathContextV3,
  type FloorRebarPathEndpoint,
  type FloorRebarPathIssue,
  type FloorRebarScanlineChain,
} from "./floor-rebar-path";
import type { FloorBarLine } from "./floor-rebar-types";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorNormalV3GeometryIssue = {
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorNormalV3ClearFragment = {
  slabId: string;
  startMm: number;
  endMm: number;
  lengthMm: number;
};

export type FloorV3OpeningEndpoint = {
  kind: "opening-boundary";
  openingId: string;
  side: FloorEdgeSide;
  runMm: number;
  positionMm: number;
  support: "opening-cut" | "inner-wall";
  thicknessMm: number;
  boundaryRangeStartMm: number;
  boundaryRangeEndMm: number;
  matchingRuleIds: string[];
  boundaryId: string;
};

export type FloorV3FormalEndpoint = FloorRebarPathEndpoint | FloorV3OpeningEndpoint;

export type FloorNormalV3PieceDraft = {
  fragments: FloorNormalV3ClearFragment[];
  startEndpoint: FloorV3FormalEndpoint;
  endEndpoint: FloorV3FormalEndpoint;
  chainId: string;
  sourceOpeningIds: string[];
  chainIndex: number;
  pieceIndex: number;
};

export type BuildFloorNormalV3LineGeometryRequest = {
  context: FloorRebarPathContextV3;
  domain: FloorRebarDomain;
  line: FloorBarLine;
};

export type BuildFloorNormalV3LineGeometryResult = {
  drafts: FloorNormalV3PieceDraft[];
  issues: FloorNormalV3GeometryIssue[];
};

type FloorNormalV3PathDraft = {
  spans: FloorRebarClearSpan[];
  startEndpoint: FloorRebarPathEndpoint;
  endEndpoint: FloorRebarPathEndpoint;
  chainId: string;
};

type FloorNormalV3ClippedDraft = Omit<
  FloorNormalV3PieceDraft,
  "chainIndex" | "pieceIndex"
>;

type FloorNormalV3OpeningCut = {
  startMm: number;
  endMm: number;
  startOpeningId: string;
  endOpeningId: string;
  openingIds: string[];
};

export function stableFloorV3Dimension(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function stableUniqueFloorV3Ids(
  ids: readonly (string | undefined)[],
): string[] | undefined {
  const values = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  return values.length > 0 ? values : undefined;
}

function mapPathIssue(issue: FloorRebarPathIssue): FloorNormalV3GeometryIssue {
  return {
    code: issue.sourceIssueCode && issue.code === "rebar-path-topology-invalid"
      ? issue.sourceIssueCode
      : issue.code,
    message: issue.message,
    objectIds: stableUniqueFloorV3Ids([
      ...(issue.slabIds ?? []),
      ...(issue.connectionIds ?? []),
      ...(issue.openingIds ?? []),
    ]),
  };
}

function transitionSide(direction: "x" | "y", before: boolean): FloorEdgeSide {
  if (direction === "x") return before ? "east" : "west";
  return before ? "north" : "south";
}

function transitionEndpoint(
  transition: FloorRebarConnectionTransition,
  direction: "x" | "y",
  before: boolean,
): FloorRebarConnectionEndpoint {
  return {
    kind: "connection-boundary",
    slabId: before ? transition.beforeSlabId : transition.afterSlabId,
    otherSlabId: before ? transition.afterSlabId : transition.beforeSlabId,
    side: transitionSide(direction, before),
    runMm: before ? transition.runStartMm : transition.runEndMm,
    connectionId: transition.connectionId,
    support: transition.support,
    gapMm: transition.gapMm,
    wallThicknessMm: transition.wallThicknessMm,
    overlapRangeStartMm: transition.overlapRangeStartMm,
    overlapRangeEndMm: transition.overlapRangeEndMm,
  };
}

function draftsForChain(chain: FloorRebarScanlineChain): FloorNormalV3PathDraft[] {
  const drafts: FloorNormalV3PathDraft[] = [];
  let spans: FloorRebarClearSpan[] = [chain.spans[0]];
  let startEndpoint = chain.startEndpoint;
  chain.transitions.forEach((transition, index) => {
    const nextSpan = chain.spans[index + 1];
    if (transition.support === "continuous") {
      spans.push(nextSpan);
      return;
    }
    drafts.push({
      spans,
      startEndpoint,
      endEndpoint: transitionEndpoint(transition, chain.direction, true),
      chainId: chain.id,
    });
    spans = [nextSpan];
    startEndpoint = transitionEndpoint(transition, chain.direction, false);
  });
  drafts.push({ spans, startEndpoint, endEndpoint: chain.endEndpoint, chainId: chain.id });
  return drafts;
}

function normalizeOpeningCuts(
  draft: FloorNormalV3PathDraft,
  intersections: readonly FloorRebarOpeningIntersection[],
): { cuts: FloorNormalV3OpeningCut[]; issues: FloorNormalV3GeometryIssue[] } {
  const firstSpan = draft.spans[0];
  const lastSpan = draft.spans.at(-1);
  if (!firstSpan || !lastSpan) {
    return {
      cuts: [],
      issues: [{
        code: "floor-v3-normal-opening-clip-geometry-mismatch",
        message: "Opening clipping received a piece draft without clear spans.",
      }],
    };
  }
  const invalid = intersections.filter((intersection) =>
    !Number.isFinite(intersection.startMm)
    || !Number.isFinite(intersection.endMm)
    || !Number.isFinite(intersection.lengthMm));
  if (invalid.length > 0) {
    return {
      cuts: [],
      issues: [{
        code: "floor-v3-normal-opening-intersection-invalid",
        message: "An opening intersection contains invalid coordinates.",
        objectIds: stableUniqueFloorV3Ids(invalid.map((intersection) => intersection.openingId)),
      }],
    };
  }
  const sorted = intersections.flatMap((intersection) => {
    const startMm = Math.max(firstSpan.startMm, intersection.startMm);
    const endMm = Math.min(lastSpan.endMm, intersection.endMm);
    return endMm - startMm > EPSILON
      ? [{
          startMm,
          endMm,
          startOpeningId: intersection.openingId,
          endOpeningId: intersection.openingId,
          openingIds: [intersection.openingId],
        }]
      : [];
  }).sort((left, right) =>
    left.startMm - right.startMm
    || left.endMm - right.endMm
    || left.startOpeningId.localeCompare(right.startOpeningId));
  const cuts: FloorNormalV3OpeningCut[] = [];
  sorted.forEach((cut) => {
    const previous = cuts.at(-1);
    if (!previous || cut.startMm > previous.endMm + EPSILON) {
      cuts.push({ ...cut, openingIds: [...cut.openingIds] });
      return;
    }
    previous.openingIds = [...new Set([...previous.openingIds, ...cut.openingIds])].sort();
    if (cut.endMm > previous.endMm + EPSILON) {
      previous.endMm = cut.endMm;
      previous.endOpeningId = cut.endOpeningId;
    }
  });
  return { cuts, issues: [] };
}

function openingSide(direction: "x" | "y", start: boolean): FloorEdgeSide {
  if (direction === "x") return start ? "west" : "east";
  return start ? "south" : "north";
}

function openingEndpoint(
  request: BuildFloorNormalV3LineGeometryRequest,
  openingId: string,
  runMm: number,
  start: boolean,
): { endpoint?: FloorV3OpeningEndpoint; issue?: FloorNormalV3GeometryIssue } {
  const side = openingSide(request.line.direction, start);
  const resolution: FloorOpeningEdgeResolution | null = resolveFloorOpeningEdgeAtPosition(
    request.context.plan,
    { openingId, side, worldTangentMm: request.line.positionMm },
  );
  if (!resolution) {
    return {
      issue: {
        code: "floor-v3-normal-opening-boundary-unresolved",
        message: "The clipped piece endpoint could not resolve a formal opening boundary.",
        objectIds: [request.line.id, openingId],
      },
    };
  }
  if (resolution.conflictingSupports.length > 1) {
    return {
      issue: {
        code: "floor-v3-normal-opening-support-conflict",
        message: "The opening boundary matches conflicting support rules.",
        objectIds: stableUniqueFloorV3Ids([
          request.line.id,
          openingId,
          ...resolution.matchingRuleIds,
        ]),
      },
    };
  }
  return {
    endpoint: {
      kind: "opening-boundary",
      openingId,
      side,
      runMm,
      positionMm: request.line.positionMm,
      support: resolution.support,
      thicknessMm: resolution.thicknessMm,
      boundaryRangeStartMm: resolution.rangeStartMm,
      boundaryRangeEndMm: resolution.rangeEndMm,
      matchingRuleIds: resolution.matchingRuleIds,
      boundaryId: resolution.boundaryId,
    },
  };
}

function fragmentsForResidual(
  draft: FloorNormalV3PathDraft,
  startMm: number,
  endMm: number,
): FloorNormalV3ClearFragment[] {
  return draft.spans.flatMap((span) => {
    const fragmentStartMm = Math.max(span.startMm, startMm);
    const fragmentEndMm = Math.min(span.endMm, endMm);
    return fragmentEndMm - fragmentStartMm > EPSILON
      ? [{
          slabId: span.slabId,
          startMm: fragmentStartMm,
          endMm: fragmentEndMm,
          lengthMm: fragmentEndMm - fragmentStartMm,
        }]
      : [];
  });
}

function clipDraftAgainstOpenings(
  request: BuildFloorNormalV3LineGeometryRequest,
  draft: FloorNormalV3PathDraft,
  intersections: readonly FloorRebarOpeningIntersection[],
): { drafts: FloorNormalV3ClippedDraft[]; issues: FloorNormalV3GeometryIssue[] } {
  const normalized = normalizeOpeningCuts(draft, intersections);
  if (normalized.issues.length > 0) return { drafts: [], issues: normalized.issues };
  const firstSpan = draft.spans[0];
  const lastSpan = draft.spans.at(-1);
  if (!firstSpan || !lastSpan) return { drafts: [], issues: normalized.issues };
  if (normalized.cuts.length === 0) {
    return {
      drafts: [{
        fragments: draft.spans.map(({ slabId, startMm, endMm, lengthMm }) => ({
          slabId,
          startMm,
          endMm,
          lengthMm,
        })),
        startEndpoint: draft.startEndpoint,
        endEndpoint: draft.endEndpoint,
        sourceOpeningIds: [],
        chainId: draft.chainId,
      }],
      issues: [],
    };
  }

  const residuals: Array<{
    startMm: number;
    endMm: number;
    startOpeningId?: string;
    endOpeningId?: string;
    openingIds: string[];
  }> = [];
  let cursorMm = firstSpan.startMm;
  let startOpeningId: string | undefined;
  const encounteredOpeningIds: string[] = [];
  normalized.cuts.forEach((cut) => {
    encounteredOpeningIds.push(...cut.openingIds);
    if (cut.startMm - cursorMm > EPSILON) {
      residuals.push({
        startMm: cursorMm,
        endMm: cut.startMm,
        startOpeningId,
        endOpeningId: cut.startOpeningId,
        openingIds: [...new Set(encounteredOpeningIds)].sort(),
      });
    }
    cursorMm = Math.max(cursorMm, cut.endMm);
    startOpeningId = cut.endOpeningId;
  });
  if (lastSpan.endMm - cursorMm > EPSILON) {
    residuals.push({
      startMm: cursorMm,
      endMm: lastSpan.endMm,
      startOpeningId,
      openingIds: [...new Set(encounteredOpeningIds)].sort(),
    });
  }

  const clipped: FloorNormalV3ClippedDraft[] = [];
  const issues: FloorNormalV3GeometryIssue[] = [];
  residuals.forEach((residual) => {
    const fragments = fragmentsForResidual(draft, residual.startMm, residual.endMm);
    const firstFragment = fragments[0];
    const lastFragment = fragments.at(-1);
    if (!firstFragment
      || !lastFragment
      || Math.abs(firstFragment.startMm - residual.startMm) > EPSILON
      || Math.abs(lastFragment.endMm - residual.endMm) > EPSILON) {
      issues.push({
        code: "floor-v3-normal-opening-clip-geometry-mismatch",
        message: "A residual opening-clipped range cannot be traced to clear fragments.",
        objectIds: stableUniqueFloorV3Ids([
          request.line.id,
          ...residual.openingIds,
          ...fragments.map((fragment) => fragment.slabId),
        ]),
      });
      return;
    }
    const start: {
      endpoint?: FloorV3FormalEndpoint;
      issue?: FloorNormalV3GeometryIssue;
    } = residual.startOpeningId
      ? openingEndpoint(request, residual.startOpeningId, residual.startMm, false)
      : { endpoint: draft.startEndpoint };
    const end: {
      endpoint?: FloorV3FormalEndpoint;
      issue?: FloorNormalV3GeometryIssue;
    } = residual.endOpeningId
      ? openingEndpoint(request, residual.endOpeningId, residual.endMm, true)
      : { endpoint: draft.endEndpoint };
    if (start.issue) issues.push(start.issue);
    if (end.issue) issues.push(end.issue);
    if (!start.endpoint || !end.endpoint) return;
    clipped.push({
      fragments,
      startEndpoint: start.endpoint,
      endEndpoint: end.endpoint,
      sourceOpeningIds: residual.openingIds,
      chainId: draft.chainId,
    });
  });
  return issues.length > 0 ? { drafts: [], issues } : { drafts: clipped, issues: [] };
}

export function isFloorNormalV3PieceDraftGeometryValid(
  draft: Pick<FloorNormalV3PieceDraft, "fragments" | "startEndpoint" | "endEndpoint">,
): boolean {
  const first = draft.fragments[0];
  const last = draft.fragments.at(-1);
  if (!first || !last) return false;
  const netLengthMm = draft.fragments.reduce((sum, fragment) => sum + fragment.lengthMm, 0);
  return Number.isFinite(netLengthMm)
    && netLengthMm > EPSILON
    && draft.fragments.every((fragment) =>
      Number.isFinite(fragment.startMm)
      && Number.isFinite(fragment.endMm)
      && Number.isFinite(fragment.lengthMm)
      && fragment.endMm - fragment.startMm > EPSILON
      && Math.abs((fragment.endMm - fragment.startMm) - fragment.lengthMm) <= EPSILON)
    && Math.abs(draft.startEndpoint.runMm - first.startMm) <= EPSILON
    && Math.abs(draft.endEndpoint.runMm - last.endMm) <= EPSILON
    && Math.abs((last.endMm - first.startMm) - netLengthMm) <= EPSILON;
}

export function buildFloorNormalV3LineGeometry(
  request: BuildFloorNormalV3LineGeometryRequest,
): BuildFloorNormalV3LineGeometryResult {
  const scan = buildFloorRebarScanlineFromContextV3(request.context, {
    direction: request.line.direction,
    positionMm: request.line.positionMm,
    slabIds: request.domain.slabIds,
  });
  if (!scan.isValid) {
    const mapped = scan.issues
      .filter((issue) => issue.level === "error")
      .map(mapPathIssue)
      .map((issue) => ({
        ...issue,
        objectIds: stableUniqueFloorV3Ids([request.line.id, ...(issue.objectIds ?? [])]),
      }));
    return {
      drafts: [],
      issues: mapped.length > 0 ? mapped : [{
        code: "floor-v3-normal-line-path-invalid",
        message: "The normal rebar scanline could not form a valid formal path.",
        objectIds: [request.line.id],
      }],
    };
  }
  if (scan.chains.length === 0) {
    return {
      drafts: [],
      issues: [{
        code: "floor-v3-normal-line-no-chain",
        message: "The theoretical normal rebar line does not cross its clear domain.",
        objectIds: [request.line.id, request.domain.id],
      }],
    };
  }

  const issues: FloorNormalV3GeometryIssue[] = [];
  const sortedChains = [...scan.chains].sort((left, right) =>
    left.startMm - right.startMm
    || left.endMm - right.endMm
    || left.id.localeCompare(right.id));
  const drafts: FloorNormalV3PieceDraft[] = [];
  sortedChains.forEach((chain, chainIndex) => {
    const clipped: FloorNormalV3ClippedDraft[] = [];
    draftsForChain(chain).forEach((draft) => {
      const result = clipDraftAgainstOpenings(request, draft, scan.openingIntersections);
      issues.push(...result.issues);
      clipped.push(...result.drafts);
    });
    clipped.sort((left, right) => {
      const leftStart = left.fragments[0]?.startMm ?? Infinity;
      const rightStart = right.fragments[0]?.startMm ?? Infinity;
      const leftEnd = left.fragments.at(-1)?.endMm ?? Infinity;
      const rightEnd = right.fragments.at(-1)?.endMm ?? Infinity;
      return leftStart - rightStart || leftEnd - rightEnd || left.chainId.localeCompare(right.chainId);
    }).forEach((draft, pieceIndex) => {
      const indexed = { ...draft, chainIndex, pieceIndex };
      if (!isFloorNormalV3PieceDraftGeometryValid(indexed)) {
        issues.push({
          code: "floor-v3-normal-piece-geometry-mismatch",
          message: "Normal rebar clear fragments do not match the formal piece range.",
          objectIds: stableUniqueFloorV3Ids([
            request.line.id,
            ...indexed.sourceOpeningIds,
            ...indexed.fragments.map((fragment) => fragment.slabId),
          ]),
        });
        return;
      }
      drafts.push(indexed);
    });
  });
  if (issues.length > 0) return { drafts: [], issues };
  return {
    drafts: drafts.sort((left, right) => {
      const leftStart = left.fragments[0]?.startMm ?? Infinity;
      const rightStart = right.fragments[0]?.startMm ?? Infinity;
      const leftEnd = left.fragments.at(-1)?.endMm ?? Infinity;
      const rightEnd = right.fragments.at(-1)?.endMm ?? Infinity;
      return leftStart - rightStart
        || leftEnd - rightEnd
        || left.chainIndex - right.chainIndex
        || left.pieceIndex - right.pieceIndex;
    }),
    issues: [],
  };
}
