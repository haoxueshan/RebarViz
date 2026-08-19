import type { FloorRebarDomain } from "./floor-rebar-domain";
import type {
  FloorRebarPathContextV3,
  FloorRebarPathIssue,
} from "./floor-rebar-path";
import {
  buildFloorNormalV3LineGeometry,
  isFloorNormalV3PieceDraftGeometryValid,
  stableFloorV3Dimension,
  stableUniqueFloorV3Ids,
  type FloorNormalV3ClearFragment,
  type FloorNormalV3GeometryIssue,
  type FloorNormalV3PieceDraft,
  type FloorV3FormalEndpoint,
  type FloorV3OpeningEndpoint,
} from "./floor-rebar-normal-v3";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";

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

export type FloorBottomV3OpeningEndpoint = FloorV3OpeningEndpoint;
export type FloorBottomV3FormalEndpoint = FloorV3FormalEndpoint;
export type FloorBottomV3ClearFragment = FloorNormalV3ClearFragment;

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

const BOTTOM_GEOMETRY_CODES: Readonly<Record<string, string>> = {
  "floor-v3-normal-opening-clip-geometry-mismatch": "bottom-v3-opening-clip-geometry-mismatch",
  "floor-v3-normal-opening-intersection-invalid": "bottom-v3-opening-intersection-invalid",
  "floor-v3-normal-opening-boundary-unresolved": "bottom-v3-opening-boundary-unresolved",
  "floor-v3-normal-opening-support-conflict": "bottom-v3-opening-support-conflict",
  "floor-v3-normal-piece-geometry-mismatch": "bottom-v3-piece-geometry-mismatch",
  "floor-v3-normal-line-path-invalid": "bottom-v3-line-path-invalid",
  "floor-v3-normal-line-no-chain": "bottom-v3-line-no-chain",
};

const BOTTOM_GEOMETRY_MESSAGES: Readonly<Record<string, string>> = {
  "floor-v3-normal-piece-geometry-mismatch": "地筋Piece的净跨累计长度与正式路径端点不一致，已停止计算。",
  "floor-v3-normal-line-path-invalid": "地筋扫描线无法形成有效的正式路径，已停止计算。",
  "floor-v3-normal-line-no-chain": "地筋理论排布线没有穿过所属净空Domain，已停止计算。",
};

function mapFloorNormalV3GeometryIssueToBottomIssue(
  issue: FloorNormalV3GeometryIssue,
): FloorBottomV3PieceIssue {
  return {
    ...issue,
    code: BOTTOM_GEOMETRY_CODES[issue.code] ?? issue.code,
    message: BOTTOM_GEOMETRY_MESSAGES[issue.code] ?? issue.message,
  };
}

export function mapFloorRebarPathIssueToBottomIssue(
  issue: FloorRebarPathIssue,
): FloorBottomV3PieceIssue {
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

/** Bottom owns extension policy; shared geometry only describes formal endpoints. */
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
          objectIds: stableUniqueFloorV3Ids([
            endpoint.openingId,
            endpoint.boundaryId,
            ...endpoint.matchingRuleIds,
          ]),
        },
      };
    }
    return { support: endpoint.support, extensionMm, boundaryId: endpoint.boundaryId };
  }
  if (endpoint.kind === "connection-boundary" && endpoint.support === "continuous") {
    return {
      support: endpoint.support,
      extensionMm: 0,
      boundaryId: endpoint.connectionId,
      error: {
        code: "bottom-v3-continuous-domain-boundary",
        message: "连续连接出现在地筋Domain路径端点，Domain与正式路径不一致，已停止计算。",
        objectIds: stableUniqueFloorV3Ids([
          endpoint.connectionId,
          endpoint.slabId,
          endpoint.otherSlabId,
        ]),
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
        stableFloorV3Dimension(endpoint.exteriorRangeStartMm),
        stableFloorV3Dimension(endpoint.exteriorRangeEndMm),
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
        objectIds: stableUniqueFloorV3Ids([
          boundaryId,
          endpoint.slabId,
          endpoint.kind === "connection-boundary" ? endpoint.otherSlabId : undefined,
        ]),
      },
    };
  }
  return { support, extensionMm, boundaryId };
}

export function buildFloorBottomV3PieceFromDraft(
  request: BuildFloorBottomV3LinePiecesRequest,
  draft: FloorNormalV3PieceDraft,
): { piece?: FloorBarPiece; issues: FloorBottomV3PieceIssue[] } {
  const { domain, line, diameter, spacing, outerWallThicknessMm } = request;
  const firstFragment = draft.fragments[0];
  const lastFragment = draft.fragments.at(-1);
  if (!firstFragment || !lastFragment || !isFloorNormalV3PieceDraftGeometryValid(draft)) {
    return {
      issues: [{
        code: "bottom-v3-piece-geometry-mismatch",
        message: "地筋Piece的净跨累计长度与正式路径端点不一致，已停止计算。",
        objectIds: stableUniqueFloorV3Ids([
          line.id,
          ...draft.sourceOpeningIds,
          ...draft.fragments.map((fragment) => fragment.slabId),
        ]),
      }],
    };
  }
  const start = resolveFloorBottomEndpointExtensionV3(draft.startEndpoint, outerWallThicknessMm);
  const end = resolveFloorBottomEndpointExtensionV3(draft.endEndpoint, outerWallThicknessMm);
  const issues = [start.error, end.error].filter(
    (issue): issue is FloorBottomV3PieceIssue => Boolean(issue),
  );
  if (issues.length > 0) return { issues };

  const runStartMm = firstFragment.startMm;
  const runEndMm = lastFragment.endMm;
  const netLengthMm = draft.fragments.reduce((sum, fragment) => sum + fragment.lengthMm, 0);
  const slabIds = [...new Set(draft.fragments.map((fragment) => fragment.slabId))].sort();
  return {
    issues: [],
    piece: {
      id: `${line.id}:piece:${draft.chainIndex + 1}:${draft.pieceIndex + 1}:${stableFloorV3Dimension(runStartMm)}-${stableFloorV3Dimension(runEndMm)}`,
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
  const geometry = buildFloorNormalV3LineGeometry(request);
  if (geometry.issues.length > 0) {
    return {
      pieces: [],
      issues: geometry.issues.map(mapFloorNormalV3GeometryIssueToBottomIssue),
    };
  }
  const pieces: FloorBarPiece[] = [];
  const issues: FloorBottomV3PieceIssue[] = [];
  geometry.drafts.forEach((draft) => {
    const built = buildFloorBottomV3PieceFromDraft(request, draft);
    issues.push(...built.issues);
    if (built.piece) pieces.push(built.piece);
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
