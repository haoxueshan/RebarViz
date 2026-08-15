export type FloorRebarLayoutDirection = "x" | "y";

export type FloorRebarLayoutRequest = {
  /** 排布组标识，同组跨板区共享同一 Origin 与步长序列。 */
  key: string;
  direction: FloorRebarLayoutDirection;
  /** 钢筋根数 N：由上层 countBars 决定，本引擎不得重算。 */
  count: number;
  spacingMm: number;
  /** 垂直于钢筋方向的净跨区间起点（mm）。 */
  minMm: number;
  /** 垂直于钢筋方向的净跨区间终点（mm）。 */
  maxMm: number;
};

export type FloorRebarLayout = {
  key: string;
  direction: FloorRebarLayoutDirection;
  mode: "domain-centered" | "local-centered" | "inherited";
  originMm: number;
  positionsMm: number[];
  startOffsetMm: number;
  endOffsetMm: number;
};

/**
 * 对齐排布引擎：根数 N 与位置序列分离。
 * 首末钢筋到区域边缘等距：offset = (span - (N-1)*spacing) / 2，步长恒为 spacing。
 * 由于 countBars 保证 (N-1)*spacing <= span，offset 恒 >= 0。
 * 独立板区按自身净跨居中（local-centered），第二版由跨域继承升级为 inherited。
 */
export function buildFloorRebarLayout(request: FloorRebarLayoutRequest): FloorRebarLayout {
  const { key, direction, count, spacingMm, minMm, maxMm } = request;
  const spanMm = Math.max(0, maxMm - minMm);
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(spacingMm) || spacingMm <= 0) {
    return {
      key,
      direction,
      mode: "domain-centered",
      originMm: minMm,
      positionsMm: [],
      startOffsetMm: 0,
      endOffsetMm: 0,
    };
  }
  const coveredMm = (count - 1) * spacingMm;
  const offsetMm = Math.max(0, (spanMm - coveredMm) / 2);
  const positionsMm: number[] = [];
  for (let index = 0; index < count; index += 1) {
    positionsMm.push(minMm + offsetMm + index * spacingMm);
  }
  return {
    key,
    direction,
    mode: "domain-centered",
    originMm: minMm + offsetMm,
    positionsMm,
    startOffsetMm: offsetMm,
    endOffsetMm: Math.max(0, spanMm - coveredMm - offsetMm),
  };
}
