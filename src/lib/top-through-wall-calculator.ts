import {
  calculateBarByDimensions,
  resolveTopInputs,
  type CalculatedBar,
  type CalculatorResult,
  type CalculatorState,
  type RebarDirection,
} from '@/app/calculator/calculator';

export type ThroughDirection = 'none' | 'x' | 'y';

export interface ThroughRoom {
  id: string;
  name: string;
  netSpan: number;
  perpendicularSpan: number;
  wallAfter: number;
  continuousWithNext: boolean;
}

export interface TopThroughWallState {
  enabled: boolean;
  direction: ThroughDirection;
  rooms: ThroughRoom[];
}

export interface ThroughWallResult {
  direction: RebarDirection;
  roomCount: number;
  netSpanTotal: number;
  intermediateWallTotal: number;
  perpendicularSpan: number;
  throughBar: CalculatedBar;
  perpendicularBar: CalculatedBar;
}

export interface ThroughWallCalculation {
  active: boolean;
  errors: string[];
  result: ThroughWallResult | null;
}

export function createDefaultThroughWallState(): TopThroughWallState {
  return {
    enabled: false,
    direction: 'none',
    rooms: [
      {
        id: 'through-room-1',
        name: '房间A',
        netSpan: 4200,
        perpendicularSpan: 3600,
        wallAfter: 240,
        continuousWithNext: true,
      },
      {
        id: 'through-room-2',
        name: '房间B',
        netSpan: 3600,
        perpendicularSpan: 3600,
        wallAfter: 0,
        continuousWithNext: false,
      },
    ],
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function sumRoomNetSpans(rooms: ThroughRoom[]): number {
  return finiteOrZero(rooms.reduce((total, room) => total + finiteOrZero(room.netSpan), 0));
}

export function sumIntermediateWalls(rooms: ThroughRoom[]): number {
  return finiteOrZero(
    rooms.slice(0, -1).reduce((total, room) => total + finiteOrZero(room.wallAfter), 0),
  );
}

export function validateThroughWallState(throughWall: TopThroughWallState): string[] {
  if (!throughWall.enabled) return [];

  const messages: string[] = [];
  const { rooms } = throughWall;
  if (throughWall.direction !== 'x' && throughWall.direction !== 'y') {
    messages.push('请选择面筋通墙方向。');
  }
  if (rooms.length < 2) messages.push('面筋通墙至少需要两个房间。');
  if (new Set(rooms.map((room) => room.id)).size !== rooms.length) {
    messages.push('房间数据存在重复，请检查是否重复录入了同一道中间墙。');
  }
  if (rooms.some((room) => !Number.isFinite(room.netSpan) || room.netSpan <= 0)) {
    messages.push('每个房间的通墙方向净掏空尺寸必须大于 0。');
  }
  if (rooms.some((room) => !Number.isFinite(room.perpendicularSpan) || room.perpendicularSpan <= 0)) {
    messages.push('每个房间的垂直方向净宽必须大于 0。');
  }
  if (rooms.slice(0, -1).some((room) => !Number.isFinite(room.wallAfter) || room.wallAfter < 0)) {
    messages.push('中间墙厚不能为负数。');
  }
  const lastRoom = rooms.at(-1);
  if (lastRoom && lastRoom.wallAfter !== 0) {
    messages.push('最后一个房间后面不能设置墙厚，最后一间的墙厚必须为 0。');
  }
  if (rooms.slice(0, -1).some((room) => !room.continuousWithNext)) {
    messages.push('房间不能形成同一直线连续区域，需要拆分钢筋连续区。');
  }

  const firstPerpendicularSpan = rooms[0]?.perpendicularSpan;
  if (
    firstPerpendicularSpan !== undefined
    && rooms.some((room) => room.perpendicularSpan !== firstPerpendicularSpan)
  ) {
    messages.push('房间垂直方向宽度不一致，需要拆分钢筋连续区。');
  }

  return messages;
}

export function calculateTopThroughWall(
  state: CalculatorState,
  throughWall: TopThroughWallState,
): ThroughWallCalculation {
  if (!throughWall.enabled) return { active: false, errors: [], result: null };

  const errors = validateThroughWallState(throughWall);
  if (errors.length > 0 || (throughWall.direction !== 'x' && throughWall.direction !== 'y')) {
    return { active: true, errors, result: null };
  }

  const direction = throughWall.direction;
  const netSpanTotal = sumRoomNetSpans(throughWall.rooms);
  const intermediateWallTotal = sumIntermediateWalls(throughWall.rooms);
  const perpendicularSpan = throughWall.rooms[0].perpendicularSpan;
  const top = resolveTopInputs(state);
  const perpendicularDirection: RebarDirection = direction === 'x' ? 'y' : 'x';
  const throughInputs = top[direction];
  const perpendicularInputs = top[perpendicularDirection];

  const throughBar = calculateBarByDimensions(
    'top',
    direction,
    throughInputs,
    state.slab,
    netSpanTotal + intermediateWallTotal,
    perpendicularSpan,
    true,
  );
  const perpendicularBar = calculateBarByDimensions(
    'top',
    perpendicularDirection,
    perpendicularInputs,
    state.slab,
    perpendicularSpan,
    netSpanTotal,
  );

  return {
    active: true,
    errors: [],
    result: {
      direction,
      roomCount: throughWall.rooms.length,
      netSpanTotal,
      intermediateWallTotal,
      perpendicularSpan,
      throughBar,
      perpendicularBar,
    },
  };
}

export function applyThroughWallResult(
  baseResult: CalculatorResult,
  calculation: ThroughWallCalculation,
): CalculatorResult {
  if (!calculation.result) return baseResult;

  const topX = calculation.result.direction === 'x'
    ? calculation.result.throughBar
    : calculation.result.perpendicularBar;
  const topY = calculation.result.direction === 'y'
    ? calculation.result.throughBar
    : calculation.result.perpendicularBar;
  const bars = [baseResult.bottomX, baseResult.bottomY, topX, topY];
  const totalWeightKg = bars.reduce((total, bar) => total + bar.weightKg, 0);

  return {
    bars,
    bottomX: baseResult.bottomX,
    bottomY: baseResult.bottomY,
    topX,
    topY,
    totalWeightKg: Number.isFinite(totalWeightKg) ? totalWeightKg : 0,
  };
}
