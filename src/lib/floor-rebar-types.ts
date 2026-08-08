import type { FloorResolvedSupport } from "./floor-plan";

/** 同一连续楼板Domain内、尚未经过洞口裁断的理论地筋空间位置线。 */
export type FloorBarLine = {
  id: string;
  domainId: string;
  slabIds: string[];
  layer: "bottom";
  direction: "x" | "y";
  /** X筋为全局Y坐标，Y筋为全局X坐标；始终使用net-layout-v1拓扑坐标。 */
  positionMm: number;
};

/** Opening裁断并解析两端Atomic Boundary后，真正参与下料的一根地筋实物件。 */
export type FloorBarPiece = {
  id: string;
  lineId: string;
  domainId: string;
  slabIds: string[];
  layer: "bottom";
  direction: "x" | "y";
  diameter: number;
  spacing: number;
  runStartMm: number;
  runEndMm: number;
  netLengthMm: number;
  startBoundaryId: string;
  endBoundaryId: string;
  startSupport: FloorResolvedSupport;
  endSupport: FloorResolvedSupport;
  startAnchorMm: number;
  endAnchorMm: number;
  singleLengthMm: number;
  source: "normal";
};

/**
 * 整层正式流水线必须保持：
 * Floor Geometry → Support Topology → Base Bar Lines → Opening Clipping
 * → Through Path Replacement → Eave Endpoint Extension → Physical Bar Pieces
 * → BOM Grouping → Weight。
 *
 * Bottom Rebar V1只执行到Opening Clipping后的普通地筋Piece与地筋BOM；
 * 面筋、通墙路径和屋檐仍不在本阶段生成。
 */
