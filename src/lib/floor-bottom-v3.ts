import { FLOOR_GEOMETRY_EPSILON_MM, type FloorEdgeSide } from "./floor-plan";
import {
  resolveFloorOpeningEdgeAtPosition,
  type FloorOpeningEdgeResolution,
} from "./floor-opening-support";
import type { FloorRebarDomain } from "./floor-rebar-domain";
import {
  buildFloorRebarScanlineFromContextV3,
  type FloorRebarConnectionEndpoint,
  type FloorRebarConnectionTransition,
  type FloorRebarPathContextV3,
  type FloorRebarPathEndpoint,
  type FloorRebarPathIssue,
  type FloorRebarOpeningIntersection,
  type FloorRebarScanlineChain,
  type FloorRebarClearSpan,
} from "./floor-rebar-path";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorBottomV3PieceIssue = {
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorBottomV3EndpointExtension = {
  support: "outer-wall" | "inner-wall" | "continuous" | "opening-cut";
  extensionMm: number;
  boundaryId: string;
  error?: FloorBottomV3PieceIssue;
};

export type FloorBottomV3OpeningEndpoint = {
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

export type FloorBottomV3FormalEndpoint =
  | FloorRebarPathEndpoint
  | FloorBottomV3OpeningEndpoint;

export type BuildFloorBottomV3LinePiecesRequest = {
  context: FloorRebarPathContextV3;
  domain: FloorRebarDomain;
  line: FloorBarLine;
  diameter: number;
  spacing: number;
  outerWallThicknessMm: number;
};

export type BuildFloorBottomV3LinePiecesResult = {
  pieces: FloorBarPiece[];
  issues: FloorBottomV3PieceIssue[];
};

function stableDimension(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function stableUniqueIds(ids: readonly (string | undefined)[]): string[] | undefined {
  const values = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
  return values.length > 0 ? values : undefined;
}

export function mapFloorRebarPathIssueToBottomIssue(
  issue: FloorRebarPathIssue,
): FloorBottomV3PieceIssue {
  return {
    code: issue.sourceIssueCode && issue.code === "rebar-path-topology-invalid"
      ? issue.sourceIssueCode
      : issue.code,
    message: issue.message,
    objectIds: stableUniqueIds([
      ...(issue.slabIds ?? []),
      ...(issue.connectionIds ?? []),
      ...(issue.openingIds ?? []),
    ]),
  };
}

/** Bottom owns extension policy; the generic path engine only describes geometry. */
export function resolveFloorBottomEndpointExtensionV3(
  endpoint: FloorBottomV3FormalEndpoint,
  outerWallThicknessMm: number,
): FloorBottomV3EndpointExtension {
  if (endpoint.kind === "opening-boundary") {
    const extensionMm = endpoint.support === "inner-wall" ? endpoint.thicknessMm : 0;
    if (!Number.isFinite(extensionMm) || extensionMm < 0) {
      return {
        support: endpoint.support,
        extensionMm: 0,
        boundaryId: endpoint.boundaryId,
        error: {
          code: "bottom-v3-endpoint-extension-invalid",
          message: "The opening boundary extension is invalid; calculation stopped.",
          objectIds: stableUniqueIds([
            endpoint.openingId,
            endpoint.boundaryId,
            ...endpoint.matchingRuleIds,
          ]),
        },
      };
    }
    return {
      support: endpoint.support,
      extensionMm,
      boundaryId: endpoint.boundaryId,
    };
  }
  if (endpoint.kind === "connection-boundary" && endpoint.support === "continuous") {
    return {
      support: endpoint.support,
      extensionMm: 0,
      boundaryId: endpoint.connectionId,
      error: {
        code: "bottom-v3-continuous-domain-boundary",
        message: "连续连接出现在地筋Domain路径端点，Domain与正式路径不一致，已停止计算。",
        objectIds: stableUniqueIds([endpoint.connectionId, endpoint.slabId, endpoint.otherSlabId]),
      },
    };
  }

  const extensionMm = endpoint.kind === "exterior"
    ? outerWallThicknessMm
    : endpoint.wallThicknessMm;
  const boundaryId = endpoint.kind === "exterior"
    ? [
        "v3-exterior",
        endpoint.slabId,
        endpoint.side,
        stableDimension(endpoint.exteriorRangeStartMm),
        stableDimension(endpoint.exteriorRangeEndMm),
      ].join(":")
    : endpoint.connectionId;
  const support = endpoint.kind === "exterior" ? "outer-wall" : "inner-wall";
  if (!Number.isFinite(extensionMm) || extensionMm < 0) {
    return {
      support,
      extensionMm: 0,
      boundaryId,
      error: {
        code: "bottom-v3-endpoint-extension-invalid",
        message: "地筋路径端点延伸长度无效，已停止计算。",
        objectIds: stableUniqueIds([
          boundaryId,
          endpoint.slabId,
          endpoint.kind === "connection-boundary" ? endpoint.otherSlabId : undefined,
        ]),
      },
    };
  }
  return { support, extensionMm, boundaryId };
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

export type FloorBottomV3ClearFragment = {
  slabId: string;
  startMm: number;
  endMm: number;
  lengthMm: number;
};

type FloorBottomV3PieceDraft = {
  spans: FloorRebarClearSpan[];
  startEndpoint: FloorRebarPathEndpoint;
  endEndpoint: FloorRebarPathEndpoint;
  chainId: string;
};

type FloorBottomV3ClippedDraft = {
  fragments: FloorBottomV3ClearFragment[];
  startEndpoint: FloorBottomV3FormalEndpoint;
  endEndpoint: FloorBottomV3FormalEndpoint;
  sourceOpeningIds: string[];
  chainId: string;
};

type FloorBottomV3OpeningCut = {
  startMm: number;
  endMm: number;
  startOpeningId: string;
  endOpeningId: string;
  openingIds: string[];
};

function draftsForChain(chain: FloorRebarScanlineChain): FloorBottomV3PieceDraft[] {
  const drafts: FloorBottomV3PieceDraft[] = [];
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
  draft: FloorBottomV3PieceDraft,
  intersections: readonly FloorRebarOpeningIntersection[],
): { cuts: FloorBottomV3OpeningCut[]; issues: FloorBottomV3PieceIssue[] } {
  const firstSpan = draft.spans[0];
  const lastSpan = draft.spans.at(-1);
  if (!firstSpan || !lastSpan) {
    return {
      cuts: [],
      issues: [{
        code: "bottom-v3-opening-clip-geometry-mismatch",
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
        code: "bottom-v3-opening-intersection-invalid",
        message: "An opening intersection contains invalid coordinates.",
        objectIds: stableUniqueIds(invalid.map((intersection) => intersection.openingId)),
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
  const cuts: FloorBottomV3OpeningCut[] = [];
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
  request: BuildFloorBottomV3LinePiecesRequest,
  openingId: string,
  runMm: number,
  start: boolean,
): { endpoint?: FloorBottomV3OpeningEndpoint; issue?: FloorBottomV3PieceIssue } {
  const side = openingSide(request.line.direction, start);
  const resolution: FloorOpeningEdgeResolution | null = resolveFloorOpeningEdgeAtPosition(
    request.context.plan,
    {
      openingId,
      side,
      worldTangentMm: request.line.positionMm,
    },
  );
  if (!resolution) {
    return {
      issue: {
        code: "bottom-v3-opening-boundary-unresolved",
        message: "The clipped piece endpoint could not resolve a formal opening boundary.",
        objectIds: [request.line.id, openingId],
      },
    };
  }
  if (resolution.conflictingSupports.length > 1) {
    return {
      issue: {
        code: "bottom-v3-opening-support-conflict",
        message: "The opening boundary matches conflicting support rules.",
        objectIds: stableUniqueIds([
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
  draft: FloorBottomV3PieceDraft,
  startMm: number,
  endMm: number,
): FloorBottomV3ClearFragment[] {
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
  request: BuildFloorBottomV3LinePiecesRequest,
  draft: FloorBottomV3PieceDraft,
  intersections: readonly FloorRebarOpeningIntersection[],
): { drafts: FloorBottomV3ClippedDraft[]; issues: FloorBottomV3PieceIssue[] } {
  const normalized = normalizeOpeningCuts(draft, intersections);
  if (normalized.issues.length > 0) return { drafts: [], issues: normalized.issues };
  const firstSpan = draft.spans[0];
  const lastSpan = draft.spans.at(-1);
  if (!firstSpan || !lastSpan) return { drafts: [], issues: normalized.issues };
  if (normalized.cuts.length === 0) {
    return {
      drafts: [{
        fragments: draft.spans.map(({ slabId, startMm, endMm, lengthMm }) => ({ slabId, startMm, endMm, lengthMm })),
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

  const clipped: FloorBottomV3ClippedDraft[] = [];
  const issues: FloorBottomV3PieceIssue[] = [];
  residuals.forEach((residual) => {
    const fragments = fragmentsForResidual(draft, residual.startMm, residual.endMm);
    const firstFragment = fragments[0];
    const lastFragment = fragments.at(-1);
    if (!firstFragment
      || !lastFragment
      || Math.abs(firstFragment.startMm - residual.startMm) > EPSILON
      || Math.abs(lastFragment.endMm - residual.endMm) > EPSILON) {
      issues.push({
        code: "bottom-v3-opening-clip-geometry-mismatch",
        message: "A residual opening-clipped range cannot be traced to clear fragments.",
        objectIds: stableUniqueIds([
          request.line.id,
          ...residual.openingIds,
          ...fragments.map((fragment) => fragment.slabId),
        ]),
      });
      return;
    }
    const start: {
      endpoint?: FloorBottomV3FormalEndpoint;
      issue?: FloorBottomV3PieceIssue;
    } = residual.startOpeningId
      ? openingEndpoint(request, residual.startOpeningId, residual.startMm, false)
      : { endpoint: draft.startEndpoint };
    const end: {
      endpoint?: FloorBottomV3FormalEndpoint;
      issue?: FloorBottomV3PieceIssue;
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

function buildPiece(
  request: BuildFloorBottomV3LinePiecesRequest,
  draft: FloorBottomV3ClippedDraft,
  chainIndex: number,
  pieceIndex: number,
): { piece?: FloorBarPiece; issues: FloorBottomV3PieceIssue[] } {
  const { domain, line, diameter, spacing, outerWallThicknessMm } = request;
  const issues: FloorBottomV3PieceIssue[] = [];
  const firstSpan = draft.fragments[0];
  const lastSpan = draft.fragments.at(-1);
  if (!firstSpan || !lastSpan) {
    return {
      issues: [{
        code: "bottom-v3-piece-geometry-mismatch",
        message: "地筋Piece没有可追溯的净跨，已停止计算。",
        objectIds: [line.id],
      }],
    };
  }
  const start = resolveFloorBottomEndpointExtensionV3(draft.startEndpoint, outerWallThicknessMm);
  const end = resolveFloorBottomEndpointExtensionV3(draft.endEndpoint, outerWallThicknessMm);
  if (start.error) issues.push(start.error);
  if (end.error) issues.push(end.error);
  const runStartMm = firstSpan.startMm;
  const runEndMm = lastSpan.endMm;
  const netLengthMm = draft.fragments.reduce((sum, fragment) => sum + fragment.lengthMm, 0);
  if (!Number.isFinite(netLengthMm)
    || netLengthMm <= EPSILON
    || Math.abs(draft.startEndpoint.runMm - runStartMm) > EPSILON
    || Math.abs(draft.endEndpoint.runMm - runEndMm) > EPSILON) {
    issues.push({
      code: "bottom-v3-piece-geometry-mismatch",
      message: "地筋Piece的净跨累计长度与正式路径端点不一致，已停止计算。",
      objectIds: stableUniqueIds([
        line.id,
        ...draft.sourceOpeningIds,
        ...draft.fragments.map((fragment) => fragment.slabId),
      ]),
    });
  }
  if (issues.length > 0) return { issues };
  const slabIds = [...new Set(draft.fragments.map((fragment) => fragment.slabId))].sort();
  return {
    issues: [],
    piece: {
      id: `${line.id}:piece:${chainIndex + 1}:${pieceIndex + 1}:${stableDimension(runStartMm)}-${stableDimension(runEndMm)}`,
      lineId: line.id,
      domainId: domain.id,
      slabIds,
      layer: "bottom",
      direction: line.direction,
      role: line.role,
      diameter,
      spacing,
      runStartMm,
      runEndMm,
      netLengthMm,
      startBoundaryId: start.boundaryId,
      endBoundaryId: end.boundaryId,
      startSupport: start.support,
      endSupport: end.support,
      startAnchorMm: start.extensionMm,
      endAnchorMm: end.extensionMm,
      startExtraApplied: false,
      endExtraApplied: false,
      topExtraValueMm: 0,
      intermediateWallMm: 0,
      intermediateBoundaryIds: [],
      singleLengthMm: netLengthMm + start.extensionMm + end.extensionMm,
      source: "normal",
    },
  };
}

export function buildFloorBottomV3LinePieces(
  request: BuildFloorBottomV3LinePiecesRequest,
): BuildFloorBottomV3LinePiecesResult {
  const scan = buildFloorRebarScanlineFromContextV3(request.context, {
    direction: request.line.direction,
    positionMm: request.line.positionMm,
    slabIds: request.domain.slabIds,
  });
  if (!scan.isValid) {
    const mapped = scan.issues
      .filter((issue) => issue.level === "error")
      .map(mapFloorRebarPathIssueToBottomIssue)
      .map((issue) => ({
        ...issue,
        objectIds: stableUniqueIds([request.line.id, ...(issue.objectIds ?? [])]),
      }));
    return {
      pieces: [],
      issues: mapped.length > 0 ? mapped : [{
        code: "bottom-v3-line-path-invalid",
        message: "地筋扫描线无法形成有效的正式路径，已停止计算。",
        objectIds: [request.line.id],
      }],
    };
  }
  if (scan.chains.length === 0) {
    return {
      pieces: [],
      issues: [{
        code: "bottom-v3-line-no-chain",
        message: "地筋理论排布线没有穿过所属净空Domain，已停止计算。",
        objectIds: [request.line.id, request.domain.id],
      }],
    };
  }

  const issues: FloorBottomV3PieceIssue[] = [];
  const sortedChains = [...scan.chains]
    .sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || left.id.localeCompare(right.id));
  const clippedByChain = sortedChains.map((chain) => {
    const clipped: FloorBottomV3ClippedDraft[] = [];
    draftsForChain(chain).forEach((draft) => {
      const result = clipDraftAgainstOpenings(request, draft, scan.openingIntersections);
      issues.push(...result.issues);
      clipped.push(...result.drafts);
    });
    return clipped.sort((left, right) => {
      const leftStart = left.fragments[0]?.startMm ?? Infinity;
      const rightStart = right.fragments[0]?.startMm ?? Infinity;
      const leftEnd = left.fragments.at(-1)?.endMm ?? Infinity;
      const rightEnd = right.fragments.at(-1)?.endMm ?? Infinity;
      return leftStart - rightStart || leftEnd - rightEnd || left.chainId.localeCompare(right.chainId);
    });
  });
  if (issues.length > 0) return { pieces: [], issues };

  const pieces: FloorBarPiece[] = [];
  clippedByChain.forEach((drafts, chainIndex) => {
    drafts.forEach((draft, pieceIndex) => {
      const built = buildPiece(request, draft, chainIndex, pieceIndex);
      issues.push(...built.issues);
      if (built.piece) pieces.push(built.piece);
    });
  });
  if (issues.length > 0) return { pieces: [], issues };
  return {
    pieces: pieces.sort((left, right) =>
      left.runStartMm - right.runStartMm
      || left.runEndMm - right.runEndMm
      || left.id.localeCompare(right.id)),
    issues: [],
  };
}
