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
  /**
   * 可选继承相位（0 <= phase < spacingMm）。存在时按共享相位生成，
   * 且仅在能生成 exactly count 根时采用；否则返回空序列由上层报告。
   */
  inheritedPhaseMm?: number;
};

export type FloorRebarLayout = {
  key: string;
  direction: FloorRebarLayoutDirection;
  mode: "domain-centered" | "local-centered" | "inherited";
  originMm: number;
  positionsMm: number[];
  startOffsetMm: number;
  endOffsetMm: number;
  /** 上层 countBars 给出的根数。 */
  requestedCount: number;
  /** 实际生成的位置数；inherited 模式下若无法满足 count 会小于 requestedCount。 */
  resolvedCount: number;
  countAdjustedByPhase: boolean;
};

function normalizePhase(phaseMm: number, spacingMm: number): number {
  const modulo = phaseMm % spacingMm;
  return modulo < 0 ? modulo + spacingMm : modulo;
}

/**
 * 对齐排布引擎：根数 N 与位置序列分离。
 * domain-centered：首末钢筋等距 offset = (span - (N-1)*spacing) / 2，步长恒为 spacing。
 * inherited：第一根 = min + ((phase - min mod spacing) mod spacing)，步长恒为 spacing，
 * 且只有 positions.length === count 时才返回有效序列（PRD V1：不允许改变正式根数）。
 */
export function buildFloorRebarLayout(request: FloorRebarLayoutRequest): FloorRebarLayout {
  const { key, direction, count, spacingMm, minMm, maxMm, inheritedPhaseMm } = request;
  const spanMm = Math.max(0, maxMm - minMm);
  const base = { key, direction, requestedCount: count };
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(spacingMm) || spacingMm <= 0) {
    return {
      ...base,
      mode: "domain-centered",
      originMm: minMm,
      positionsMm: [],
      startOffsetMm: 0,
      endOffsetMm: 0,
      resolvedCount: 0,
      countAdjustedByPhase: false,
    };
  }
  if (inheritedPhaseMm !== undefined && Number.isFinite(inheritedPhaseMm)) {
    const phase = normalizePhase(inheritedPhaseMm, spacingMm);
    const modulo = ((minMm % spacingMm) + spacingMm) % spacingMm;
    const offsetMm = ((phase - modulo) % spacingMm + spacingMm) % spacingMm;
    const firstMm = minMm + offsetMm;
    const positionsMm: number[] = [];
    for (let position = firstMm; position <= maxMm + 1e-9 && positionsMm.length < count; position += spacingMm) {
      positionsMm.push(position);
    }
    if (positionsMm.length === count) {
      return {
        ...base,
        mode: "inherited",
        originMm: firstMm,
        positionsMm,
        startOffsetMm: offsetMm,
        endOffsetMm: Math.max(0, spanMm - offsetMm - (count - 1) * spacingMm),
        resolvedCount: count,
        countAdjustedByPhase: false,
      };
    }
    // PRD V1：宁可不生成，也不硬塞根数或改变正式根数。
    return {
      ...base,
      mode: "inherited",
      originMm: firstMm,
      positionsMm: [],
      startOffsetMm: offsetMm,
      endOffsetMm: 0,
      resolvedCount: positionsMm.length,
      countAdjustedByPhase: true,
    };
  }
  const coveredMm = (count - 1) * spacingMm;
  const offsetMm = Math.max(0, (spanMm - coveredMm) / 2);
  const positionsMm: number[] = [];
  for (let index = 0; index < count; index += 1) {
    positionsMm.push(minMm + offsetMm + index * spacingMm);
  }
  return {
    ...base,
    mode: "domain-centered",
    originMm: minMm + offsetMm,
    positionsMm,
    startOffsetMm: offsetMm,
    endOffsetMm: Math.max(0, spanMm - coveredMm - offsetMm),
    resolvedCount: count,
    countAdjustedByPhase: false,
  };
}
