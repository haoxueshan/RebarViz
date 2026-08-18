import { FLOOR_GEOMETRY_EPSILON_MM, type FloorEdgeSide } from "./floor-plan";
import type { FloorRebarDomain } from "./floor-rebar-domain";
import {
  buildFloorRebarScanlineFromContextV3,
  type FloorRebarConnectionEndpoint,
  type FloorRebarConnectionTransition,
  type FloorRebarPathContextV3,
  type FloorRebarPathEndpoint,
  type FloorRebarPathIssue,
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
  support: "outer-wall" | "inner-wall" | "continuous";
  extensionMm: number;
  boundaryId: string;
  error?: FloorBottomV3PieceIssue;
};

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
  endpoint: FloorRebarPathEndpoint,
  outerWallThicknessMm: number,
): FloorBottomV3EndpointExtension {
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

type PieceDraft = {
  spans: FloorRebarClearSpan[];
  startEndpoint: FloorRebarPathEndpoint;
  endEndpoint: FloorRebarPathEndpoint;
};

function draftsForChain(chain: FloorRebarScanlineChain): PieceDraft[] {
  const drafts: PieceDraft[] = [];
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
    });
    spans = [nextSpan];
    startEndpoint = transitionEndpoint(transition, chain.direction, false);
  });
  drafts.push({ spans, startEndpoint, endEndpoint: chain.endEndpoint });
  return drafts;
}

function buildPiece(
  request: BuildFloorBottomV3LinePiecesRequest,
  draft: PieceDraft,
  chainIndex: number,
  pieceIndex: number,
): { piece?: FloorBarPiece; issues: FloorBottomV3PieceIssue[] } {
  const { domain, line, diameter, spacing, outerWallThicknessMm } = request;
  const issues: FloorBottomV3PieceIssue[] = [];
  const firstSpan = draft.spans[0];
  const lastSpan = draft.spans.at(-1);
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
  const netLengthMm = draft.spans.reduce((sum, span) => sum + span.lengthMm, 0);
  const runLengthMm = runEndMm - runStartMm;
  if (!Number.isFinite(netLengthMm)
    || netLengthMm <= EPSILON
    || Math.abs(runLengthMm - netLengthMm) > EPSILON
    || Math.abs(draft.startEndpoint.runMm - runStartMm) > EPSILON
    || Math.abs(draft.endEndpoint.runMm - runEndMm) > EPSILON) {
    issues.push({
      code: "bottom-v3-piece-geometry-mismatch",
      message: "地筋Piece的净跨累计长度与正式路径端点不一致，已停止计算。",
      objectIds: stableUniqueIds([line.id, ...draft.spans.map((span) => span.slabId)]),
    });
  }
  if (issues.length > 0) return { issues };
  const slabIds = [...new Set(draft.spans.map((span) => span.slabId))].sort();
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

  const pieces: FloorBarPiece[] = [];
  const issues: FloorBottomV3PieceIssue[] = [];
  [...scan.chains]
    .sort((left, right) => left.startMm - right.startMm || left.endMm - right.endMm || left.id.localeCompare(right.id))
    .forEach((chain, chainIndex) => {
      draftsForChain(chain).forEach((draft, pieceIndex) => {
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
