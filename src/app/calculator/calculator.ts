export type CountMode = 'project' | 'cover';
export type RebarDirection = 'x' | 'y';
export type RebarLayer = 'bottom' | 'top';

export interface SlabInputs {
  spanX: number;
  spanY: number;
  cover: number;
  countMode: CountMode;
}

export interface RebarInputs {
  diameter: number;
  spacing: number;
  firstAnchor: number;
  secondAnchor: number;
}

export interface RebarLayerInputs {
  x: RebarInputs;
  y: RebarInputs;
}

export interface CalculatorState {
  slab: SlabInputs;
  bottom: RebarLayerInputs;
  top: RebarLayerInputs;
  topFollowsBottom: boolean;
  topAnchorIncrement: number;
}

export interface CalculatedBar {
  key: `${RebarLayer}-${RebarDirection}`;
  layer: RebarLayer;
  direction: RebarDirection;
  diameter: number;
  count: number;
  singleLengthM: number;
  totalLengthM: number;
  weightKg: number;
  throughWall: boolean;
}

export interface CalculatorResult {
  bars: CalculatedBar[];
  bottomX: CalculatedBar;
  bottomY: CalculatedBar;
  topX: CalculatedBar;
  topY: CalculatedBar;
  totalWeightKg: number;
}

export const MAX_VISIBLE_SVG_BARS = 60;

export function createDefaultCalculatorState(): CalculatorState {
  return {
    slab: {
      spanX: 4200,
      spanY: 3600,
      cover: 15,
      countMode: 'project',
    },
    bottom: {
      x: { diameter: 12, spacing: 150, firstAnchor: 200, secondAnchor: 350 },
      y: { diameter: 10, spacing: 200, firstAnchor: 150, secondAnchor: 280 },
    },
    top: {
      x: { diameter: 10, spacing: 200, firstAnchor: 450, secondAnchor: 600 },
      y: { diameter: 10, spacing: 200, firstAnchor: 400, secondAnchor: 530 },
    },
    topFollowsBottom: true,
    topAnchorIncrement: 250,
  };
}

export function parseNumericInput(rawValue: string): number {
  if (rawValue.trim() === '') return 0;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function resolveTopInputs(state: CalculatorState): RebarLayerInputs {
  if (!state.topFollowsBottom) return state.top;

  const increment = Math.max(finiteOrZero(state.topAnchorIncrement), 0);
  return {
    x: {
      ...state.top.x,
      firstAnchor: finiteOrZero(state.bottom.x.firstAnchor + increment),
      secondAnchor: finiteOrZero(state.bottom.x.secondAnchor + increment),
    },
    y: {
      ...state.top.y,
      firstAnchor: finiteOrZero(state.bottom.y.firstAnchor + increment),
      secondAnchor: finiteOrZero(state.bottom.y.secondAnchor + increment),
    },
  };
}

export function setTopFollowMode(state: CalculatorState, followsBottom: boolean): CalculatorState {
  if (state.topFollowsBottom === followsBottom) return state;

  if (!followsBottom) {
    return {
      ...state,
      topFollowsBottom: false,
      top: resolveTopInputs(state),
    };
  }

  return { ...state, topFollowsBottom: true };
}

export function countBars(
  perpendicularSize: number,
  spacing: number,
  cover: number,
  mode: CountMode,
): number {
  if (perpendicularSize <= 0 || spacing <= 0) return 0;

  const rawCount = mode === 'cover'
    ? Math.ceil(Math.max(perpendicularSize - 2 * Math.max(cover, 0), 0) / spacing) + 1
    : Math.ceil(perpendicularSize / spacing);

  return finiteOrZero(rawCount);
}

export function theoreticalUnitWeight(diameter: number): number {
  return finiteOrZero(Math.PI * diameter * diameter / 4 * 7850 / 1_000_000);
}

export function calculateBarByDimensions(
  layer: RebarLayer,
  direction: RebarDirection,
  bar: RebarInputs,
  slab: SlabInputs,
  runSize: number,
  perpendicularSize: number,
  throughWall = false,
): CalculatedBar {
  const count = countBars(perpendicularSize, bar.spacing, slab.cover, slab.countMode);
  const singleLengthM = finiteOrZero((runSize + bar.firstAnchor + bar.secondAnchor) / 1000);
  const totalLengthM = finiteOrZero(count * singleLengthM);
  const weightKg = finiteOrZero(totalLengthM * theoreticalUnitWeight(bar.diameter));

  return {
    key: `${layer}-${direction}`,
    layer,
    direction,
    diameter: bar.diameter,
    count,
    singleLengthM,
    totalLengthM,
    weightKg,
    throughWall,
  };
}

export function calculateRebar(state: CalculatorState): CalculatorResult {
  const top = resolveTopInputs(state);
  const bottomX = calculateBarByDimensions('bottom', 'x', state.bottom.x, state.slab, state.slab.spanX, state.slab.spanY);
  const bottomY = calculateBarByDimensions('bottom', 'y', state.bottom.y, state.slab, state.slab.spanY, state.slab.spanX);
  const topX = calculateBarByDimensions('top', 'x', top.x, state.slab, state.slab.spanX, state.slab.spanY);
  const topY = calculateBarByDimensions('top', 'y', top.y, state.slab, state.slab.spanY, state.slab.spanX);
  const bars = [bottomX, bottomY, topX, topY];
  const totalWeightKg = finiteOrZero(bars.reduce((total, bar) => total + bar.weightKg, 0));

  return { bars, bottomX, bottomY, topX, topY, totalWeightKg };
}

export function validateCalculatorState(state: CalculatorState): string[] {
  const messages: string[] = [];
  const top = resolveTopInputs(state);
  const bars = [state.bottom.x, state.bottom.y, top.x, top.y];

  if (state.slab.spanX <= 0 || state.slab.spanY <= 0) {
    messages.push('净尺寸必须大于 0。');
  }
  if (state.slab.cover < 0) messages.push('保护层不能为负数。');
  if (bars.some((bar) => bar.diameter <= 0)) messages.push('钢筋直径必须大于 0。');
  if (bars.some((bar) => bar.spacing <= 0)) messages.push('钢筋间距必须大于 0。');
  if (bars.some((bar) => bar.firstAnchor < 0 || bar.secondAnchor < 0)) {
    messages.push('锚固长度不能为负数。');
  }
  if (state.topAnchorIncrement < 0) {
    messages.push('面筋每端增加长度不能为负数；计算时已按 0 处理。');
  }

  return messages;
}
