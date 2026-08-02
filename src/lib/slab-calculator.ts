export type CountMode = "project" | "cover";
export type RoomArrangement = "single" | "x" | "y";
export type AnchorSource = "inner-wall" | "outer-wall" | "manual";
export type BarDirection = "x" | "y";
export type BarLayer = "bottom" | "top";
export type ThroughDirection = "none" | "x" | "y";

export type SlabRoom = {
  id: string;
  name: string;
  spanX: number;
  spanY: number;
};

export type SlabBaseState = {
  arrangement: RoomArrangement;
  rooms: SlabRoom[];
  innerWallThickness: number;
  outerWallThickness: number;
  cover: number;
  countMode: CountMode;
  topAnchorExtra: number;
};

export type AnchorRule = {
  source: AnchorSource;
  manualValue: number;
};

export type BarSettings = {
  diameter: number;
  spacing: number;
  startAnchor: AnchorRule;
  endAnchor: AnchorRule;
};

export type RebarLayerSettings = {
  x: BarSettings;
  y: BarSettings;
};

export type TopThroughRule = {
  enabled: boolean;
  direction: ThroughDirection;
  startAnchor: AnchorRule;
  endAnchor: AnchorRule;
};

export type SlabCalculatorState = {
  slab: SlabBaseState;
  bottom: RebarLayerSettings;
  top: RebarLayerSettings;
  through: TopThroughRule;
};

export type BarResult = {
  id: string;
  scopeName: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  diameter: number;
  count: number;
  singleLengthM: number;
  totalLengthM: number;
  unitWeightKgM: number;
  weightKg: number;
  startAnchorSource: AnchorSource;
  endAnchorSource: AnchorSource;
  startAnchor: number;
  endAnchor: number;
};

export type ThroughWallResult = {
  direction: Exclude<ThroughDirection, "none">;
  roomCount: number;
  netSpanTotal: number;
  intermediateWallTotal: number;
  throughBar: BarResult;
  perpendicularBar: BarResult;
};

export type SlabCalculation = {
  results: BarResult[];
  totalWeightKg: number;
  throughWall: ThroughWallResult | null;
  errors: string[];
};

const manualAnchor = (manualValue: number): AnchorRule => ({
  source: "manual",
  manualValue,
});

export const DEFAULT_SLAB_CALCULATOR_STATE: SlabCalculatorState = {
  slab: {
    arrangement: "single",
    rooms: [{ id: "room-a", name: "房间A", spanX: 4200, spanY: 3600 }],
    innerWallThickness: 240,
    outerWallThickness: 370,
    cover: 15,
    countMode: "project",
    topAnchorExtra: 250,
  },
  bottom: {
    x: {
      diameter: 12,
      spacing: 150,
      startAnchor: manualAnchor(200),
      endAnchor: manualAnchor(350),
    },
    y: {
      diameter: 10,
      spacing: 200,
      startAnchor: manualAnchor(150),
      endAnchor: manualAnchor(280),
    },
  },
  top: {
    x: {
      diameter: 10,
      spacing: 200,
      startAnchor: manualAnchor(450),
      endAnchor: manualAnchor(600),
    },
    y: {
      diameter: 10,
      spacing: 200,
      startAnchor: manualAnchor(400),
      endAnchor: manualAnchor(530),
    },
  },
  through: {
    enabled: false,
    direction: "none",
    startAnchor: { source: "outer-wall", manualValue: 620 },
    endAnchor: { source: "outer-wall", manualValue: 620 },
  },
};

export function cloneDefaultSlabCalculatorState(): SlabCalculatorState {
  return structuredClone(DEFAULT_SLAB_CALCULATOR_STATE);
}

function safeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export function resolveBottomAnchor(
  rule: AnchorRule,
  slab: SlabBaseState,
): number {
  if (rule.source === "inner-wall") {
    return safeNonNegative(slab.innerWallThickness);
  }
  if (rule.source === "outer-wall") {
    return safeNonNegative(slab.outerWallThickness);
  }
  return safeNonNegative(rule.manualValue);
}

export function resolveTopAnchor(
  rule: AnchorRule,
  slab: SlabBaseState,
): number {
  if (rule.source === "inner-wall") {
    return safeNonNegative(slab.innerWallThickness) + safeNonNegative(slab.topAnchorExtra);
  }
  if (rule.source === "outer-wall") {
    return safeNonNegative(slab.outerWallThickness) + safeNonNegative(slab.topAnchorExtra);
  }
  return safeNonNegative(rule.manualValue);
}

export function countBars(
  perpendicularSpan: number,
  spacing: number,
  cover: number,
  mode: CountMode,
): number {
  if (
    !Number.isFinite(perpendicularSpan) ||
    !Number.isFinite(spacing) ||
    perpendicularSpan <= 0 ||
    spacing <= 0
  ) {
    return 0;
  }

  if (mode === "cover") {
    const effectiveWidth = Math.max(
      perpendicularSpan - 2 * safeNonNegative(cover),
      0,
    );
    return Math.ceil(effectiveWidth / spacing) + 1;
  }

  return Math.ceil(perpendicularSpan / spacing);
}

export function theoreticalUnitWeight(diameter: number): number {
  if (!Number.isFinite(diameter) || diameter <= 0) return 0;
  return (Math.PI * diameter * diameter * 7850) / 4 / 1_000_000;
}

type CreateBarInput = {
  id: string;
  scopeName: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  settings: BarSettings;
  runSpan: number;
  perpendicularSpan: number;
  slab: SlabBaseState;
  anchorRules?: { start: AnchorRule; end: AnchorRule };
};

function createBarResult(input: CreateBarInput): BarResult {
  const rules = input.anchorRules ?? {
    start: input.settings.startAnchor,
    end: input.settings.endAnchor,
  };
  const resolver = input.layer === "bottom" ? resolveBottomAnchor : resolveTopAnchor;
  const startAnchor = resolver(rules.start, input.slab);
  const endAnchor = resolver(rules.end, input.slab);
  const count = countBars(
    input.perpendicularSpan,
    input.settings.spacing,
    input.slab.cover,
    input.slab.countMode,
  );
  const lengthMm = safeNonNegative(input.runSpan) + startAnchor + endAnchor;
  const singleLengthM = lengthMm / 1000;
  const totalLengthM = count * singleLengthM;
  const unitWeightKgM = theoreticalUnitWeight(input.settings.diameter);

  return {
    id: input.id,
    scopeName: input.scopeName,
    layer: input.layer,
    direction: input.direction,
    throughWall: input.throughWall,
    diameter: safeNonNegative(input.settings.diameter),
    count,
    singleLengthM,
    totalLengthM,
    unitWeightKgM,
    weightKg: totalLengthM * unitWeightKgM,
    startAnchorSource: rules.start.source,
    endAnchorSource: rules.end.source,
    startAnchor,
    endAnchor,
  };
}

export function calculateRoomBar(
  room: SlabRoom,
  layer: BarLayer,
  direction: BarDirection,
  settings: BarSettings,
  slab: SlabBaseState,
): BarResult {
  const runSpan = direction === "x" ? room.spanX : room.spanY;
  const perpendicularSpan = direction === "x" ? room.spanY : room.spanX;
  return createBarResult({
    id: `${room.id}-${layer}-${direction}`,
    scopeName: room.name,
    layer,
    direction,
    throughWall: false,
    settings,
    runSpan,
    perpendicularSpan,
    slab,
  });
}

function allEqual(values: number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0]);
}

export function calculateTopThroughWall(
  state: SlabCalculatorState,
): ThroughWallResult | null {
  const { slab, through, top } = state;
  if (!through.enabled || through.direction === "none" || slab.rooms.length < 2) {
    return null;
  }
  if (slab.arrangement !== through.direction) return null;

  const direction = through.direction;
  const isX = direction === "x";
  const perpendicularSpans = slab.rooms.map((room) =>
    isX ? room.spanY : room.spanX,
  );
  if (!allEqual(perpendicularSpans)) return null;

  const netSpanTotal = slab.rooms.reduce(
    (sum, room) => sum + (isX ? room.spanX : room.spanY),
    0,
  );
  const intermediateWallTotal =
    (slab.rooms.length - 1) * safeNonNegative(slab.innerWallThickness);
  const commonPerpendicularSpan = perpendicularSpans[0];
  const throughSettings = isX ? top.x : top.y;
  const perpendicularSettings = isX ? top.y : top.x;
  const scopeName = `${slab.rooms[0].name}—${slab.rooms.at(-1)?.name ?? "通墙路径"}`;

  const throughBar = createBarResult({
    id: `through-top-${direction}`,
    scopeName,
    layer: "top",
    direction,
    throughWall: true,
    settings: throughSettings,
    runSpan: netSpanTotal + intermediateWallTotal,
    perpendicularSpan: commonPerpendicularSpan,
    slab,
    anchorRules: { start: through.startAnchor, end: through.endAnchor },
  });

  const perpendicularDirection: BarDirection = isX ? "y" : "x";
  const perpendicularBar = createBarResult({
    id: `through-area-top-${perpendicularDirection}`,
    scopeName: `${scopeName}组合区`,
    layer: "top",
    direction: perpendicularDirection,
    throughWall: false,
    settings: perpendicularSettings,
    runSpan: commonPerpendicularSpan,
    perpendicularSpan: netSpanTotal,
    slab,
  });

  return {
    direction,
    roomCount: slab.rooms.length,
    netSpanTotal,
    intermediateWallTotal,
    throughBar,
    perpendicularBar,
  };
}

function labelDirection(direction: BarDirection): string {
  return direction === "x" ? "X向" : "Y向";
}

function validatePositive(
  value: number,
  label: string,
  errors: string[],
): void {
  if (!Number.isFinite(value) || value <= 0) errors.push(`${label}必须大于0`);
}

function validateNonNegative(
  value: number,
  label: string,
  errors: string[],
): void {
  if (!Number.isFinite(value) || value < 0) errors.push(`${label}不能为负数`);
}

function validateAnchorRule(
  rule: AnchorRule,
  label: string,
  errors: string[],
): void {
  if (rule.source === "manual") {
    validateNonNegative(rule.manualValue, `${label}手动锚固`, errors);
  }
}

export function validateSlabCalculator(state: SlabCalculatorState): string[] {
  const errors: string[] = [];
  const { slab } = state;
  if (slab.rooms.length === 0) errors.push("至少需要一个房间");

  slab.rooms.forEach((room, index) => {
    const name = room.name.trim() || `房间${index + 1}`;
    validatePositive(room.spanX, `${name}东西向净尺寸`, errors);
    validatePositive(room.spanY, `${name}南北向净尺寸`, errors);
  });
  validatePositive(slab.innerWallThickness, "内墙厚度", errors);
  validatePositive(slab.outerWallThickness, "外墙厚度", errors);
  validateNonNegative(slab.cover, "保护层", errors);
  validateNonNegative(slab.topAnchorExtra, "面筋锚固增加值", errors);

  (["bottom", "top"] as const).forEach((layer) => {
    (["x", "y"] as const).forEach((direction) => {
      const settings = state[layer][direction];
      const prefix = `${layer === "bottom" ? "地筋" : "面筋"}${labelDirection(direction)}`;
      validatePositive(settings.diameter, `${prefix}直径`, errors);
      validatePositive(settings.spacing, `${prefix}间距`, errors);
      validateAnchorRule(settings.startAnchor, `${prefix}起点`, errors);
      validateAnchorRule(settings.endAnchor, `${prefix}终点`, errors);
    });
  });

  if (slab.arrangement !== "single" && slab.rooms.length < 2) {
    errors.push("多房间排列至少需要两个房间");
  }
  if (slab.arrangement === "x" && !allEqual(slab.rooms.map((room) => room.spanY))) {
    errors.push("房间垂直方向尺寸不一致，需要拆分钢筋连续区");
  }
  if (slab.arrangement === "y" && !allEqual(slab.rooms.map((room) => room.spanX))) {
    errors.push("房间垂直方向尺寸不一致，需要拆分钢筋连续区");
  }

  if (state.through.enabled) {
    if (state.through.direction === "none") {
      errors.push("启用通墙后必须选择X向或Y向");
    } else {
      if (slab.rooms.length < 2) errors.push("面筋通墙至少需要两个房间");
      if (slab.arrangement !== state.through.direction) {
        errors.push(
          `${labelDirection(state.through.direction)}通墙要求房间沿${labelDirection(state.through.direction)}排列`,
        );
      }
      validateAnchorRule(state.through.startAnchor, "通墙路径起点", errors);
      validateAnchorRule(state.through.endAnchor, "通墙路径终点", errors);
    }
  }

  return [...new Set(errors)];
}

export function calculateSlabResults(state: SlabCalculatorState): SlabCalculation {
  const errors = validateSlabCalculator(state);
  const bottomResults = state.slab.rooms.flatMap((room) => [
    calculateRoomBar(room, "bottom", "x", state.bottom.x, state.slab),
    calculateRoomBar(room, "bottom", "y", state.bottom.y, state.slab),
  ]);
  const throughWall = errors.length === 0 ? calculateTopThroughWall(state) : null;

  const topResults = throughWall
    ? [throughWall.throughBar, throughWall.perpendicularBar]
    : state.slab.rooms.flatMap((room) => [
        calculateRoomBar(room, "top", "x", state.top.x, state.slab),
        calculateRoomBar(room, "top", "y", state.top.y, state.slab),
      ]);
  const results = [...bottomResults, ...topResults];
  const totalWeightKg = results.reduce(
    (sum, result) => sum + (Number.isFinite(result.weightKg) ? result.weightKg : 0),
    0,
  );

  return { results, totalWeightKg, throughWall, errors };
}
