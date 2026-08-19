import type {
  FloorAtomicBoundarySegment,
  FloorResolvedSupport,
} from "./floor-plan";
import {
  stableFloorV3Dimension,
  stableUniqueFloorV3Ids,
  type FloorV3FormalEndpoint,
} from "./floor-rebar-normal-v3";
import type { TopExtraMode } from "./slab-calculator";

export type FloorTopEndpointAnchor = {
  anchorMm: number | null;
  extraApplied: boolean;
};

export type FloorTopV3PieceIssue = {
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorTopV3EndpointExtension = {
  support: FloorResolvedSupport;
  extensionMm: number;
  boundaryId: string;
  extraApplied: boolean;
  error?: FloorTopV3PieceIssue;
};

export function shouldApplyTopExtra(
  extraMode: TopExtraMode,
  endpoint: "start" | "end",
): boolean {
  return extraMode === "both" || extraMode === endpoint;
}

export function resolveFloorTopAnchorBySupport(
  support: FloorResolvedSupport,
  thicknessMm: number,
  endpoint: "start" | "end",
  extraMode: TopExtraMode,
  topAnchorExtra: number,
): FloorTopEndpointAnchor {
  if (support === "outer-wall") {
    return { anchorMm: thicknessMm, extraApplied: false };
  }
  if (support === "inner-wall") {
    const extraApplied = shouldApplyTopExtra(extraMode, endpoint);
    return {
      anchorMm: thicknessMm + (extraApplied ? topAnchorExtra : 0),
      extraApplied,
    };
  }
  if (support === "opening-cut") {
    return { anchorMm: 0, extraApplied: false };
  }
  return { anchorMm: null, extraApplied: false };
}

export function resolveFloorTopEndpointAnchor(
  segment: Pick<FloorAtomicBoundarySegment, "support" | "thicknessMm">,
  endpoint: "start" | "end",
  extraMode: TopExtraMode,
  topAnchorExtra: number,
): FloorTopEndpointAnchor {
  return resolveFloorTopAnchorBySupport(
    segment.support,
    segment.thicknessMm,
    endpoint,
    extraMode,
    topAnchorExtra,
  );
}

function invalidExtension(
  support: FloorResolvedSupport,
  boundaryId: string,
  objectIds: readonly (string | undefined)[],
): FloorTopV3EndpointExtension {
  return {
    support,
    extensionMm: 0,
    boundaryId,
    extraApplied: false,
    error: {
      code: "top-v3-endpoint-extension-invalid",
      message: "面筋路径端点延伸长度无效，已停止计算。",
      objectIds: stableUniqueFloorV3Ids(objectIds),
    },
  };
}

export function resolveFloorTopEndpointExtensionV3(
  endpoint: FloorV3FormalEndpoint,
  endpointPosition: "start" | "end",
  extraMode: TopExtraMode,
  topAnchorExtraMm: number,
  outerWallThicknessMm: number,
): FloorTopV3EndpointExtension {
  if (endpoint.kind === "opening-boundary") {
    const support = endpoint.support;
    const boundaryId = endpoint.boundaryId;
    const thicknessMm = support === "inner-wall" ? endpoint.thicknessMm : 0;
    if (!Number.isFinite(topAnchorExtraMm)
      || topAnchorExtraMm < 0
      || !Number.isFinite(thicknessMm)
      || thicknessMm < 0) {
      return invalidExtension(support, boundaryId, [
        endpoint.openingId,
        boundaryId,
        ...endpoint.matchingRuleIds,
      ]);
    }
    const resolved = resolveFloorTopAnchorBySupport(
      support,
      thicknessMm,
      endpointPosition,
      extraMode,
      topAnchorExtraMm,
    );
    if (resolved.anchorMm === null || !Number.isFinite(resolved.anchorMm)) {
      return invalidExtension(support, boundaryId, [endpoint.openingId, boundaryId]);
    }
    return {
      support,
      extensionMm: resolved.anchorMm,
      boundaryId,
      extraApplied: resolved.extraApplied,
    };
  }

  if (endpoint.kind === "connection-boundary" && endpoint.support === "continuous") {
    return {
      support: endpoint.support,
      extensionMm: 0,
      boundaryId: endpoint.connectionId,
      extraApplied: false,
      error: {
        code: "top-v3-continuous-domain-boundary",
        message: "连续连接出现在面筋Domain路径端点，Domain与正式路径不一致，已停止计算。",
        objectIds: stableUniqueFloorV3Ids([
          endpoint.connectionId,
          endpoint.slabId,
          endpoint.otherSlabId,
        ]),
      },
    };
  }

  const support: FloorResolvedSupport = endpoint.kind === "exterior"
    ? "outer-wall"
    : "inner-wall";
  const thicknessMm = endpoint.kind === "exterior"
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
  if (!Number.isFinite(topAnchorExtraMm)
    || topAnchorExtraMm < 0
    || !Number.isFinite(thicknessMm)
    || thicknessMm < 0) {
    return invalidExtension(support, boundaryId, [
      boundaryId,
      endpoint.slabId,
      endpoint.kind === "connection-boundary" ? endpoint.otherSlabId : undefined,
    ]);
  }
  const resolved = resolveFloorTopAnchorBySupport(
    support,
    thicknessMm,
    endpointPosition,
    extraMode,
    topAnchorExtraMm,
  );
  if (resolved.anchorMm === null || !Number.isFinite(resolved.anchorMm)) {
    return invalidExtension(support, boundaryId, [boundaryId, endpoint.slabId]);
  }
  return {
    support,
    extensionMm: resolved.anchorMm,
    boundaryId,
    extraApplied: resolved.extraApplied,
  };
}
