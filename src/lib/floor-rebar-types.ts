import type { FloorResolvedSupport } from "./floor-plan";
import type { FloorBarRole } from "./floor-rebar-role";

export type { FloorBarRole } from "./floor-rebar-role";

export type FloorBarLayer = "bottom" | "top";
export type FloorBarSource = "normal" | "through";

/** 同一连续楼板Domain内、尚未经过洞口裁断的理论钢筋空间位置线。 */
export type FloorBarLine = {
  id: string;
  domainId: string;
  slabIds: string[];
  layer: FloorBarLayer;
  direction: "x" | "y";
  role: FloorBarRole;
  source: FloorBarSource;
  throughPathId?: string;
  /** X筋为全局Y坐标，Y筋为全局X坐标；始终使用net-layout-v1拓扑坐标。 */
  positionMm: number;
};

/** Opening裁断并解析两端Atomic Boundary后，真正参与下料的一根钢筋实物件。 */
export type FloorBarPiece = {
  id: string;
  lineId: string;
  domainId: string;
  slabIds: string[];
  layer: FloorBarLayer;
  direction: "x" | "y";
  role: FloorBarRole;
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
  /** 仅普通面筋的实际内墙端可为true；地筋始终为false。 */
  startExtraApplied: boolean;
  endExtraApplied: boolean;
  /** 当前Piece使用的整层面筋增加值；地筋固定为0。 */
  topExtraValueMm: number;
  /** 通墙面筋在真正起终点之间穿过的内墙厚度合计；普通筋固定为0。 */
  intermediateWallMm: number;
  /** 通墙面筋实际穿过的中间Atomic Boundary；普通筋固定为空数组。 */
  intermediateBoundaryIds: string[];
  singleLengthMm: number;
  source: FloorBarSource;
  throughPathId?: string;
};

/**
 * 整层正式流水线必须保持：
 * Floor Geometry → Support Topology → Base Bar Lines → Opening Clipping
 * → Through Path Replacement → Physical Bar Pieces
 * → BOM Grouping → Weight。
 *
 * Bottom/Top普通板筋先执行到Opening Clipping；Top Through随后认领并替换
 * 对应普通Piece，最终BOM只能消费替换后的Physical Bar Pieces。
 */
