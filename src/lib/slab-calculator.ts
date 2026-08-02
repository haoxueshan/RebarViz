export type CountMode = "project" | "cover";
export type RoomArrangement = "single" | "x" | "y";
export type AnchorSource = "inner-wall" | "outer-wall" | "manual";
export type AnchorOrigin = "auto" | "user";
export type BarDirection = "x" | "y";
export type BarLayer = "bottom" | "top";
export type ThroughDirection = "none" | "x" | "y";
export type TopExtraMode = "start" | "end" | "both";

export type AnchorRule = {
  source: AnchorSource;
  manualValue: number;
  origin: AnchorOrigin;
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
  scopeId: string;
  roomId?: string;
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
  netRunSpanMm: number;
  intermediateWallMm: number;
  calculationWidthMm: number;
  spacing: number;
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
  totalWeightKg: number | null;
  throughWall: ThroughWallResult | null;
  errors: string[];
  isValid: boolean;
};

function wallAnchor(
  source: "inner-wall" | "outer-wall",
  origin: AnchorOrigin = "auto",
): AnchorRule {
  return { source, manualValue: 0, origin };
}

function copyAnchor(rule: AnchorRule): AnchorRule {
  return {
    source: rule.source,
    manualValue: rule.manualValue,
    origin: rule.origin,
  };
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

type LegacyAnchorRule = Omit<AnchorRule, "origin"> & {
  origin?: string;
};

function normalizeAnchorRule(
  current: LegacyAnchorRule | undefined,
  fallback: AnchorRule,
): AnchorRule {
  if (!current) return copyAnchor(fallback);
  if (!(["inner-wall", "outer-wall", "manual"] as string[]).includes(current.source)) {
    return {
      source: current.source,
      manualValue: current.manualValue,
      origin: (current.origin ?? "user") as AnchorOrigin,
    };
  }
  if (
    current.origin !== undefined &&
    !(["auto", "user"] as string[]).includes(current.origin)
  ) {
    return {
      source: current.source,
      manualValue: current.manualValue,
      origin: current.origin as AnchorOrigin,
    };
  }
  const origin =
    current.origin === "auto" || current.origin === "user"
      ? current.origin
      : current.source === "manual" || current.source !== fallback.source
        ? "user"
        : "auto";
  if (origin === "auto") return copyAnchor(fallback);
  return {
    source: current.source,
    manualValue: current.manualValue,
    origin: "user",
  };
}

export function synchronizeRoomAnchors(
  rooms: SlabRoom[],
  arrangement: RoomArrangement,
): SlabRoom[] {
  return rooms.map((room, index) => {
    const defaults = createDefaultRoomAnchorRules(arrangement, index, rooms.length);
    const anchors = room.anchors;
    const synchronized = (layer: BarLayer, direction: BarDirection): DirectionAnchorRules => ({
      start: normalizeAnchorRule(
        anchors?.[layer]?.[direction]?.start,
        defaults[layer][direction].start,
      ),
      end: normalizeAnchorRule(
        anchors?.[layer]?.[direction]?.end,
        defaults[layer][direction].end,
      ),
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

export function restoreRoomAnchorToAuto(
  rooms: SlabRoom[],
  arrangement: RoomArrangement,
  roomId: string,
  layer: BarLayer,
  direction: BarDirection,
  endpoint: "start" | "end",
): SlabRoom[] {
  return rooms.map((room, index) => {
    if (room.id !== roomId) return room;
    const fallback = createDefaultRoomAnchorRules(
      arrangement,
      index,
      rooms.length,
    )[layer][direction][endpoint];
    return {
      ...room,
      anchors: {
        ...room.anchors,
        [layer]: {
          ...room.anchors[layer],
          [direction]: {
            ...room.anchors[layer][direction],
            [endpoint]: copyAnchor(fallback),
          },
        },
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

export function normalizeSlabCalculatorState(
  state: SlabCalculatorState,
): SlabCalculatorState {
  const arrangement = state.slab.arrangement;
  const rooms = synchronizeRoomAnchors(
    state.slab.rooms.map((room) => ({ ...room })),
    arrangement,
  );
  return {
    ...state,
    slab: { ...state.slab, rooms },
    bottom: {
      x: { ...state.bottom.x },
      y: { ...state.bottom.y },
    },
    top: {
      x: { ...state.top.x, extraMode: state.top.x.extraMode ?? "both" },
      y: { ...state.top.y, extraMode: state.top.y.extraMode ?? "both" },
    },
    through: {
      ...state.through,
      startAnchor: normalizeAnchorRule(
        state.through.startAnchor,
        wallAnchor("outer-wall"),
      ),
      endAnchor: normalizeAnchorRule(
        state.through.endAnchor,
        wallAnchor("outer-wall"),
      ),
      extraMode: state.through.extraMode ?? "both",
    },
  };
}

export function resolveBottomAnchor(
  rule: AnchorRule,
  slab: SlabBaseState,
): number {
  if (rule.source === "inner-wall") return slab.innerWallThickness;
  if (rule.source === "outer-wall") return slab.outerWallThickness;
  return rule.manualValue;
}

export function resolveTopAnchor(
  rule: AnchorRule,
  slab: SlabBaseState,
  applyExtra = true,
): number {
  const extra = applyExtra ? slab.topAnchorExtra : 0;
  if (rule.source === "inner-wall") {
    return slab.innerWallThickness + extra;
  }
  if (rule.source === "outer-wall") {
    return slab.outerWallThickness + extra;
  }
  return rule.manualValue;
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
    const effectiveWidth = Math.max(
      perpendicularSpan - 2 * (Number.isFinite(cover) ? Math.max(cover, 0) : 0),
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
  scopeId: string;
  roomId?: string;
  scopeName: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  settings: BarSettings;
  runSpan: number;
  intermediateWallMm?: number;
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
  const intermediateWallMm = input.intermediateWallMm ?? 0;
  const lengthMm = input.runSpan + intermediateWallMm + startAnchor + endAnchor;
  const singleLengthM = lengthMm / 1000;
  const totalLengthM = count * singleLengthM;
  const unitWeightKgM = theoreticalUnitWeight(input.settings.diameter);

  return {
    id: input.id,
    scopeId: input.scopeId,
    roomId: input.roomId,
    scopeName: input.scopeName,
    layer: input.layer,
    direction: input.direction,
    throughWall: input.throughWall,
    diameter: input.settings.diameter,
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
    topExtraValue: input.layer === "top" ? input.slab.topAnchorExtra : 0,
    startExtraApplied,
    endExtraApplied,
    netRunSpanMm: input.runSpan,
    intermediateWallMm,
    calculationWidthMm: input.perpendicularSpan,
    spacing: input.settings.spacing,
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
    scopeId: room.id,
    roomId: room.id,
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

function anchorRulesEquivalent(a: AnchorRule, b: AnchorRule): boolean {
  return (
    a.source === b.source &&
    (a.source !== "manual" || a.manualValue === b.manualValue)
  );
}

export function haveConsistentPerpendicularTopAnchors(
  state: SlabCalculatorState,
  throughDirection: Exclude<ThroughDirection, "none">,
): boolean {
  const perpendicularDirection: BarDirection =
    throughDirection === "x" ? "y" : "x";
  const mode = state.top[perpendicularDirection].extraMode ?? "both";
  const first = state.slab.rooms[0]?.anchors.top[perpendicularDirection];
  if (!first) return false;
  const firstStart = resolveTopAnchor(
    first.start,
    state.slab,
    shouldApplyTopExtra(mode, "start"),
  );
  const firstEnd = resolveTopAnchor(
    first.end,
    state.slab,
    shouldApplyTopExtra(mode, "end"),
  );
  return state.slab.rooms.every((room) => {
    const rules = room.anchors.top[perpendicularDirection];
    return (
      anchorRulesEquivalent(rules.start, first.start) &&
      anchorRulesEquivalent(rules.end, first.end) &&
      resolveTopAnchor(
        rules.start,
        state.slab,
        shouldApplyTopExtra(mode, "start"),
      ) === firstStart &&
      resolveTopAnchor(
        rules.end,
        state.slab,
        shouldApplyTopExtra(mode, "end"),
      ) === firstEnd
    );
  });
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
  if (!haveConsistentPerpendicularTopAnchors(state, direction)) return null;

  const netSpanTotal = slab.rooms.reduce(
    (sum, room) => sum + (isX ? room.spanX : room.spanY),
    0,
  );
  const intermediateWallTotal =
    (slab.rooms.length - 1) * slab.innerWallThickness;
  const commonPerpendicularSpan = perpendicularSpans[0];
  const throughSettings = isX ? top.x : top.y;
  const perpendicularDirection: BarDirection = isX ? "y" : "x";
  const perpendicularSettings = top[perpendicularDirection];
  const perpendicularAnchors = slab.rooms[0].anchors.top[perpendicularDirection];
  const scopeName = `${slab.rooms[0].name}—${slab.rooms.at(-1)?.name ?? "通墙路径"}`;

  const throughBar = createBarResult({
    id: `through-top-${direction}`,
    scopeId: `through-${direction}`,
    scopeName,
    layer: "top",
    direction,
    throughWall: true,
    settings: throughSettings,
    runSpan: netSpanTotal,
    intermediateWallMm: intermediateWallTotal,
    perpendicularSpan: commonPerpendicularSpan,
    slab,
    anchorRules: { start: through.startAnchor, end: through.endAnchor },
    topExtraMode: through.extraMode ?? "both",
  });
  const perpendicularBar = createBarResult({
    id: `through-area-top-${perpendicularDirection}`,
    scopeId: `through-area-${perpendicularDirection}`,
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
  if (!(["inner-wall", "outer-wall", "manual"] as string[]).includes(rule.source)) {
    errors.push(`${label}锚固来源无效`);
    return;
  }
  if (!(["auto", "user"] as string[]).includes(rule.origin)) {
    errors.push(`${label}锚固状态无效`);
  }
  if (rule.source === "manual") {
    validatePositive(rule.manualValue, `${label}手动锚固`, errors);
  }
}

export function validateSlabCalculator(input: SlabCalculatorState): string[] {
  const state = normalizeSlabCalculatorState(input);
  const errors: string[] = [];
  const { slab } = state;
  if (!(["single", "x", "y"] as string[]).includes(slab.arrangement)) {
    errors.push("房间排列方向无效");
  }
  if (!(["project", "cover"] as string[]).includes(slab.countMode)) {
    errors.push("根数算法无效");
  }
  if (slab.rooms.length === 0) errors.push("至少需要一个房间");

  const roomIds = slab.rooms.map((room) => room.id);
  if (new Set(roomIds).size !== roomIds.length) {
    errors.push("房间ID必须唯一");
  }

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

  (["x", "y"] as const).forEach((direction) => {
    if (
      !(["start", "end", "both"] as string[]).includes(
        state.top[direction].extraMode,
      )
    ) {
      errors.push(`面筋${labelDirection(direction)}增加位置无效`);
    }
  });
  if (!(["none", "x", "y"] as string[]).includes(state.through.direction)) {
    errors.push("通墙方向无效");
  }
  if (
    !(["start", "end", "both"] as string[]).includes(
      state.through.extraMode,
    )
  ) {
    errors.push("通墙面筋增加位置无效");
  }

  if (slab.arrangement !== "single" && slab.rooms.length < 2) {
    errors.push("多房间排列至少需要两个房间");
  }
  if (slab.arrangement === "single" && slab.rooms.length !== 1) {
    errors.push("单房间模式只能保留一个房间");
  }
  if (slab.arrangement === "x" && !allEqual(slab.rooms.map((room) => room.spanY))) {
    errors.push("房间垂直方向尺寸不一致，需要拆分钢筋连续区");
  }
  if (slab.arrangement === "y" && !allEqual(slab.rooms.map((room) => room.spanX))) {
    errors.push("房间垂直方向尺寸不一致，需要拆分钢筋连续区");
  }

  if (slab.countMode === "cover" && Number.isFinite(slab.cover) && slab.cover >= 0) {
    slab.rooms.forEach((room, index) => {
      const name = room.name.trim() || `房间${index + 1}`;
      if (Number.isFinite(room.spanX) && room.spanX > 0 && room.spanX <= 2 * slab.cover) {
        errors.push(`${name}东西向计算宽度必须大于两倍保护层`);
      }
      if (Number.isFinite(room.spanY) && room.spanY > 0 && room.spanY <= 2 * slab.cover) {
        errors.push(`${name}南北向计算宽度必须大于两倍保护层`);
      }
    });
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
      if (
        slab.arrangement === state.through.direction &&
        slab.rooms.length >= 2 &&
        (!allEqual(
          slab.rooms.map((room) =>
            state.through.direction === "x" ? room.spanY : room.spanX,
          ),
        ) ||
          !haveConsistentPerpendicularTopAnchors(
            state,
            state.through.direction,
          ))
      ) {
        errors.push(
          "通墙组合区垂直方向尺寸或锚固不一致，请统一设置或拆分连续区。",
        );
      }
    }
  }

  return [...new Set(errors)];
}

export function calculateSlabResults(input: SlabCalculatorState): SlabCalculation {
  const state = normalizeSlabCalculatorState(input);
  const errors = validateSlabCalculator(state);
  if (errors.length > 0) {
    return {
      results: [],
      totalWeightKg: null,
      throughWall: null,
      errors,
      isValid: false,
    };
  }

  const bottomResults = state.slab.rooms.flatMap((room) => [
    calculateRoomBar(room, "bottom", "x", state.bottom.x, state.slab),
    calculateRoomBar(room, "bottom", "y", state.bottom.y, state.slab),
  ]);
  const throughWall = calculateTopThroughWall(state);
  if (state.through.enabled && !throughWall) {
    return {
      results: [],
      totalWeightKg: null,
      throughWall: null,
      errors: ["通墙组合区无法形成有效计算结果，请检查房间和锚固设置。"],
      isValid: false,
    };
  }
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

  return { results, totalWeightKg, throughWall, errors: [], isValid: true };
}
