export type CountMode = "project" | "cover";
export type RoomArrangement = "single" | "x" | "y";
export type AnchorSource = "inner-wall" | "outer-wall" | "manual";
export type BarDirection = "x" | "y";
export type BarLayer = "bottom" | "top";
export type ThroughDirection = "none" | "x" | "y";
export type TopExtraMode = "start" | "end" | "both";

export type AnchorRule = {
  source: AnchorSource;
  manualValue: number;
};

export type DirectionAnchorRules = {
  start: AnchorRule;
  end: AnchorRule;
};

export type RoomLayerAnchorRules = {
  x: DirectionAnchorRules;
  y: DirectionAnchorRules;
};

export type RoomAnchorRules = {
  bottom: RoomLayerAnchorRules;
  top: RoomLayerAnchorRules;
};

export type SlabRoom = {
  id: string;
  name: string;
  spanX: number;
  spanY: number;
  anchors: RoomAnchorRules;
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

export type BarSettings = {
  diameter: number;
  spacing: number;
};

export type TopBarSettings = BarSettings & {
  extraMode: TopExtraMode;
};

export type RebarLayerSettings<T extends BarSettings = BarSettings> = {
  x: T;
  y: T;
};

export type TopThroughRule = {
  enabled: boolean;
  direction: ThroughDirection;
  startAnchor: AnchorRule;
  endAnchor: AnchorRule;
  extraMode: TopExtraMode;
};

export type SlabCalculatorState = {
  slab: SlabBaseState;
  bottom: RebarLayerSettings<BarSettings>;
  top: RebarLayerSettings<TopBarSettings>;
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
  topExtraMode?: TopExtraMode;
  topExtraValue: number;
  startExtraApplied: boolean;
  endExtraApplied: boolean;
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
  isValid: boolean;
};

function wallAnchor(source: "inner-wall" | "outer-wall"): AnchorRule {
  return { source, manualValue: 0 };
}

function copyAnchor(rule: AnchorRule): AnchorRule {
  return { source: rule.source, manualValue: rule.manualValue };
}

function directionRules(
  start: "inner-wall" | "outer-wall",
  end: "inner-wall" | "outer-wall",
): DirectionAnchorRules {
  return { start: wallAnchor(start), end: wallAnchor(end) };
}

export function createDefaultRoomAnchorRules(
  arrangement: RoomArrangement,
  index: number,
  roomCount: number,
): RoomAnchorRules {
  const first = index === 0;
  const last = index === roomCount - 1;
  const x =
    arrangement === "x"
      ? directionRules(first ? "outer-wall" : "inner-wall", last ? "outer-wall" : "inner-wall")
      : directionRules("outer-wall", "outer-wall");
  const y =
    arrangement === "y"
      ? directionRules(first ? "outer-wall" : "inner-wall", last ? "outer-wall" : "inner-wall")
      : directionRules("outer-wall", "outer-wall");

  return {
    bottom: {
      x: { start: copyAnchor(x.start), end: copyAnchor(x.end) },
      y: { start: copyAnchor(y.start), end: copyAnchor(y.end) },
    },
    top: {
      x: { start: copyAnchor(x.start), end: copyAnchor(x.end) },
      y: { start: copyAnchor(y.start), end: copyAnchor(y.end) },
    },
  };
}

function keepManualOrDefault(
  current: AnchorRule | undefined,
  fallback: AnchorRule,
): AnchorRule {
  return current?.source === "manual" ? copyAnchor(current) : copyAnchor(fallback);
}

export function synchronizeRoomAnchors(
  rooms: SlabRoom[],
  arrangement: RoomArrangement,
): SlabRoom[] {
  return rooms.map((room, index) => {
    const defaults = createDefaultRoomAnchorRules(arrangement, index, rooms.length);
    const anchors = room.anchors;
    const synchronized = (layer: BarLayer, direction: BarDirection): DirectionAnchorRules => ({
      start: keepManualOrDefault(anchors?.[layer]?.[direction]?.start, defaults[layer][direction].start),
      end: keepManualOrDefault(anchors?.[layer]?.[direction]?.end, defaults[layer][direction].end),
    });
    return {
      ...room,
      anchors: {
        bottom: { x: synchronized("bottom", "x"), y: synchronized("bottom", "y") },
        top: { x: synchronized("top", "x"), y: synchronized("top", "y") },
      },
    };
  });
}

const defaultRoom: SlabRoom = {
  id: "room-a",
  name: "房间A",
  spanX: 4200,
  spanY: 3600,
  anchors: createDefaultRoomAnchorRules("single", 0, 1),
};

export const DEFAULT_SLAB_CALCULATOR_STATE: SlabCalculatorState = {
  slab: {
    arrangement: "single",
    rooms: [defaultRoom],
    innerWallThickness: 240,
    outerWallThickness: 370,
    cover: 15,
    countMode: "project",
    topAnchorExtra: 250,
  },
  bottom: {
    x: { diameter: 12, spacing: 150 },
    y: { diameter: 10, spacing: 200 },
  },
  top: {
    x: { diameter: 10, spacing: 200, extraMode: "both" },
    y: { diameter: 10, spacing: 200, extraMode: "both" },
  },
  through: {
    enabled: false,
    direction: "none",
    startAnchor: wallAnchor("outer-wall"),
    endAnchor: wallAnchor("outer-wall"),
    extraMode: "both",
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
  if (rule.source === "inner-wall") return safeNonNegative(slab.innerWallThickness);
  if (rule.source === "outer-wall") return safeNonNegative(slab.outerWallThickness);
  return safeNonNegative(rule.manualValue);
}

export function resolveTopAnchor(
  rule: AnchorRule,
  slab: SlabBaseState,
  applyExtra = true,
): number {
  const extra = applyExtra ? safeNonNegative(slab.topAnchorExtra) : 0;
  if (rule.source === "inner-wall") {
    return safeNonNegative(slab.innerWallThickness) + extra;
  }
  if (rule.source === "outer-wall") {
    return safeNonNegative(slab.outerWallThickness) + extra;
  }
  return safeNonNegative(rule.manualValue);
}

export function shouldApplyTopExtra(
  mode: TopExtraMode,
  endpoint: "start" | "end",
): boolean {
  return mode === "both" || mode === endpoint;
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
    const effectiveWidth = Math.max(perpendicularSpan - 2 * safeNonNegative(cover), 0);
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
  anchorRules: DirectionAnchorRules;
  topExtraMode?: TopExtraMode;
};

function createBarResult(input: CreateBarInput): BarResult {
  const topExtraMode = input.layer === "top" ? (input.topExtraMode ?? "both") : undefined;
  const startExtraSelected = topExtraMode
    ? shouldApplyTopExtra(topExtraMode, "start")
    : false;
  const endExtraSelected = topExtraMode
    ? shouldApplyTopExtra(topExtraMode, "end")
    : false;
  const startExtraApplied =
    input.layer === "top" &&
    startExtraSelected &&
    input.anchorRules.start.source !== "manual";
  const endExtraApplied =
    input.layer === "top" &&
    endExtraSelected &&
    input.anchorRules.end.source !== "manual";
  const startAnchor =
    input.layer === "bottom"
      ? resolveBottomAnchor(input.anchorRules.start, input.slab)
      : resolveTopAnchor(input.anchorRules.start, input.slab, startExtraSelected);
  const endAnchor =
    input.layer === "bottom"
      ? resolveBottomAnchor(input.anchorRules.end, input.slab)
      : resolveTopAnchor(input.anchorRules.end, input.slab, endExtraSelected);
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
    startAnchorSource: input.anchorRules.start.source,
    endAnchorSource: input.anchorRules.end.source,
    startAnchor,
    endAnchor,
    topExtraMode,
    topExtraValue: input.layer === "top" ? safeNonNegative(input.slab.topAnchorExtra) : 0,
    startExtraApplied,
    endExtraApplied,
  };
}

export function calculateRoomBar(
  room: SlabRoom,
  layer: BarLayer,
  direction: BarDirection,
  settings: BarSettings,
  slab: SlabBaseState,
  topExtraMode?: TopExtraMode,
): BarResult {
  return createBarResult({
    id: `${room.id}-${layer}-${direction}`,
    scopeName: room.name,
    layer,
    direction,
    throughWall: false,
    settings,
    runSpan: direction === "x" ? room.spanX : room.spanY,
    perpendicularSpan: direction === "x" ? room.spanY : room.spanX,
    slab,
    anchorRules: room.anchors[layer][direction],
    topExtraMode,
  });
}

function allEqual(values: number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0]);
}

export function calculateTopThroughWall(
  state: SlabCalculatorState,
): ThroughWallResult | null {
  const { slab, through, top } = state;
  if (!through.enabled || through.direction === "none" || slab.rooms.length < 2) return null;
  if (slab.arrangement !== through.direction) return null;

  const direction = through.direction;
  const isX = direction === "x";
  const perpendicularSpans = slab.rooms.map((room) => (isX ? room.spanY : room.spanX));
  if (!allEqual(perpendicularSpans)) return null;

  const netSpanTotal = slab.rooms.reduce(
    (sum, room) => sum + (isX ? room.spanX : room.spanY),
    0,
  );
  const intermediateWallTotal =
    (slab.rooms.length - 1) * safeNonNegative(slab.innerWallThickness);
  const commonPerpendicularSpan = perpendicularSpans[0];
  const throughSettings = isX ? top.x : top.y;
  const perpendicularDirection: BarDirection = isX ? "y" : "x";
  const perpendicularSettings = top[perpendicularDirection];
  const perpendicularAnchors = slab.rooms[0].anchors.top[perpendicularDirection];
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
    topExtraMode: through.extraMode ?? "both",
  });
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
    anchorRules: perpendicularAnchors,
    topExtraMode: perpendicularSettings.extraMode ?? "both",
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

function validatePositive(value: number, label: string, errors: string[]): void {
  if (!Number.isFinite(value) || value <= 0) errors.push(`${label}必须大于0`);
}

function validateNonNegative(value: number, label: string, errors: string[]): void {
  if (!Number.isFinite(value) || value < 0) errors.push(`${label}不能为负数`);
}

function validateAnchorRule(rule: AnchorRule, label: string, errors: string[]): void {
  if (rule.source === "manual") validateNonNegative(rule.manualValue, `${label}手动锚固`, errors);
}

export function validateSlabCalculator(state: SlabCalculatorState): string[] {
  const errors: string[] = [];
  const { slab } = state;
  if (slab.rooms.length === 0) errors.push("至少需要一个房间");

  slab.rooms.forEach((room, index) => {
    const name = room.name.trim() || `房间${index + 1}`;
    validatePositive(room.spanX, `${name}东西向净尺寸`, errors);
    validatePositive(room.spanY, `${name}南北向净尺寸`, errors);
    (["bottom", "top"] as const).forEach((layer) => {
      (["x", "y"] as const).forEach((direction) => {
        const prefix = `${name}${layer === "bottom" ? "地筋" : "面筋"}${labelDirection(direction)}`;
        validateAnchorRule(room.anchors[layer][direction].start, `${prefix}起点`, errors);
        validateAnchorRule(room.anchors[layer][direction].end, `${prefix}终点`, errors);
      });
    });
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
        calculateRoomBar(
          room,
          "top",
          "x",
          state.top.x,
          state.slab,
          state.top.x.extraMode ?? "both",
        ),
        calculateRoomBar(
          room,
          "top",
          "y",
          state.top.y,
          state.slab,
          state.top.y.extraMode ?? "both",
        ),
      ]);
  const results = [...bottomResults, ...topResults];
  const totalWeightKg = results.reduce(
    (sum, result) => sum + (Number.isFinite(result.weightKg) ? result.weightKg : 0),
    0,
  );

  return { results, totalWeightKg, throughWall, errors, isValid: errors.length === 0 };
}
