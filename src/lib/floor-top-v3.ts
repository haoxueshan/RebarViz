import type { FloorRebarDomain } from "./floor-rebar-domain";
import type { FloorRebarPathContextV3 } from "./floor-rebar-path";
import {
  buildFloorNormalV3LineGeometry,
  isFloorNormalV3PieceDraftGeometryValid,
  stableFloorV3Dimension,
  stableUniqueFloorV3Ids,
  type FloorNormalV3GeometryIssue,
  type FloorNormalV3PieceDraft,
} from "./floor-rebar-normal-v3";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import {
  resolveFloorTopEndpointExtensionV3,
  type FloorTopV3PieceIssue,
} from "./floor-top-policy";
import type { TopExtraMode } from "./slab-calculator";

export type BuildFloorTopV3LinePiecesRequest = {
  context: FloorRebarPathContextV3;
  domain: FloorRebarDomain;
  line: FloorBarLine;
  diameter: number;
  spacing: number;
  extraMode: TopExtraMode;
  topAnchorExtraMm: number;
  outerWallThicknessMm: number;
};

export type BuildFloorTopV3LinePiecesResult = {
  pieces: FloorBarPiece[];
  issues: FloorTopV3PieceIssue[];
};

const TOP_GEOMETRY_CODES: Readonly<Record<string, string>> = {
  "floor-v3-normal-opening-clip-geometry-mismatch": "top-v3-opening-clip-geometry-mismatch",
  "floor-v3-normal-opening-intersection-invalid": "top-v3-opening-intersection-invalid",
  "floor-v3-normal-opening-boundary-unresolved": "top-v3-opening-boundary-unresolved",
  "floor-v3-normal-opening-support-conflict": "top-v3-opening-support-conflict",
  "floor-v3-normal-piece-geometry-mismatch": "top-v3-piece-geometry-mismatch",
  "floor-v3-normal-line-path-invalid": "top-v3-line-path-invalid",
  "floor-v3-normal-line-no-chain": "top-v3-line-no-chain",
};

function mapGeometryIssue(issue: FloorNormalV3GeometryIssue): FloorTopV3PieceIssue {
  return { ...issue, code: TOP_GEOMETRY_CODES[issue.code] ?? issue.code };
}

export function buildFloorTopV3PieceFromDraft(
  request: BuildFloorTopV3LinePiecesRequest,
  draft: FloorNormalV3PieceDraft,
): { piece?: FloorBarPiece; issues: FloorTopV3PieceIssue[] } {
  const firstFragment = draft.fragments[0];
  const lastFragment = draft.fragments.at(-1);
  if (!firstFragment || !lastFragment || !isFloorNormalV3PieceDraftGeometryValid(draft)) {
    return {
      issues: [{
        code: "top-v3-piece-geometry-mismatch",
        message: "面筋Piece的净跨累计长度与正式路径端点不一致，已停止计算。",
        objectIds: stableUniqueFloorV3Ids([
          request.line.id,
          ...draft.sourceOpeningIds,
          ...draft.fragments.map((fragment) => fragment.slabId),
        ]),
      }],
    };
  }
  const start = resolveFloorTopEndpointExtensionV3(
    draft.startEndpoint,
    "start",
    request.extraMode,
    request.topAnchorExtraMm,
    request.outerWallThicknessMm,
  );
  const end = resolveFloorTopEndpointExtensionV3(
    draft.endEndpoint,
    "end",
    request.extraMode,
    request.topAnchorExtraMm,
    request.outerWallThicknessMm,
  );
  const issues = [start.error, end.error].filter(
    (issue): issue is FloorTopV3PieceIssue => Boolean(issue),
  );
  if (issues.length > 0) return { issues };

  const runStartMm = firstFragment.startMm;
  const runEndMm = lastFragment.endMm;
  const netLengthMm = draft.fragments.reduce((sum, fragment) => sum + fragment.lengthMm, 0);
  return {
    issues: [],
    piece: {
      id: `${request.line.id}:piece:${draft.chainIndex + 1}:${draft.pieceIndex + 1}:${stableFloorV3Dimension(runStartMm)}-${stableFloorV3Dimension(runEndMm)}`,
      lineId: request.line.id,
      domainId: request.domain.id,
      slabIds: [...new Set(draft.fragments.map((fragment) => fragment.slabId))].sort(),
      layer: "top",
      direction: request.line.direction,
      role: request.line.role,
      diameter: request.diameter,
      spacing: request.spacing,
      runStartMm,
      runEndMm,
      netLengthMm,
      startBoundaryId: start.boundaryId,
      endBoundaryId: end.boundaryId,
      startSupport: start.support,
      endSupport: end.support,
      startAnchorMm: start.extensionMm,
      endAnchorMm: end.extensionMm,
      startExtraApplied: start.extraApplied,
      endExtraApplied: end.extraApplied,
      topExtraValueMm: request.topAnchorExtraMm,
      intermediateWallMm: 0,
      intermediateBoundaryIds: [],
      singleLengthMm: netLengthMm + start.extensionMm + end.extensionMm,
      source: "normal",
    },
  };
}

export function buildFloorTopV3LinePieces(
  request: BuildFloorTopV3LinePiecesRequest,
): BuildFloorTopV3LinePiecesResult {
  const geometry = buildFloorNormalV3LineGeometry(request);
  if (geometry.issues.length > 0) {
    return { pieces: [], issues: geometry.issues.map(mapGeometryIssue) };
  }
  const pieces: FloorBarPiece[] = [];
  const issues: FloorTopV3PieceIssue[] = [];
  geometry.drafts.forEach((draft) => {
    const built = buildFloorTopV3PieceFromDraft(request, draft);
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
