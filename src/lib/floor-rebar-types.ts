/** 一条尚未经过洞口裁断的理论钢筋空间位置线。Geometry V2只定义契约，不生成实例。 */
export type FloorBarLine = {
  id: string;
  slabId: string;
  layer: "bottom" | "top";
  direction: "x" | "y";
  positionMm: number;
};

/** 洞口裁断、通墙替换和屋檐端部延伸后，真正参与下料的一根实物钢筋。 */
export type FloorBarPiece = {
  id: string;
  lineId: string;
  slabId?: string;
  throughPathId?: string;
  layer: "bottom" | "top";
  direction: "x" | "y";
  diameter: number;
  startMm: number;
  endMm: number;
  singleLengthMm: number;
  source: "normal" | "through";
  startEaveMm: number;
  endEaveMm: number;
};

/**
 * 后续正式流水线必须保持：
 * Floor Geometry → Support Topology → Base Bar Lines → Opening Clipping
 * → Through Path Replacement → Eave Endpoint Extension → Physical Bar Pieces
 * → BOM Grouping → Weight。
 *
 * 通墙路径还必须携带/解析垂直于运行方向的有效band，不能仅凭slabIds计算。
 * Geometry V2不创建FloorBarLine/FloorBarPiece，也不计算根数、长度或重量。
 */
