import {
  buildRoomBoundaryZones,
  type RoomBoundaryZone,
} from "./slab-room-topology";

export type CountMode = "project" | "round" | "floor";
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

export type BarLengthMode = "uniform" | "zoned";

export type BarLengthVariant = {
  id: string;
  perpendicularStartMm: number;
  perpendicularEndMm: number;
  count: number;
  startAnchorSource: AnchorSource;
  endAnchorSource: AnchorSource;
  startAnchor: number;
  endAnchor: number;
  startExtraApplied: boolean;
  endExtraApplied: boolean;
  singleLengthM: number;
  totalLengthM: number;
  weightKg: number;
};

export type BarResult = {
  id: string;
  scopeId: string;
  scopeType: "room" | "through";
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
  lengthMode: BarLengthMode;
  lengthVariants: BarLengthVariant[];
};

export type ThroughWallResult = {
  direction: Exclude<ThroughDirection, "none">;
  roomCount: number;
  netSpanTotal: number;
  intermediateWallTotal: number;
  throughBar: BarResult;
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
  const rawCountMode = state.slab.countMode as string;
  const countMode = (rawCountMode === "cover" ? "project" : rawCountMode) as CountMode;
  const rooms = synchronizeRoomAnchors(
    state.slab.rooms.map((room) => ({ ...room })),
    arrangement,
  );
  return {
    ...state,
    slab: {
      arrangement,
      rooms,
      innerWallThickness: state.slab.innerWallThickness,
      outerWallThickness: state.slab.outerWallThickness,
      countMode,
      topAnchorExtra: state.slab.topAnchorExtra,
    },
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
  if (rule.source === "inner-wall") {
    return slab.innerWallThickness + (applyExtra ? slab.topAnchorExtra : 0);
  }
  if (rule.source === "outer-wall") {
    return slab.outerWallThickness;
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
  if (mode === "round") {
    return Math.max(1, Math.round(perpendicularSpan / spacing));
  }
  if (mode === "floor") {
    return Math.max(1, Math.floor(perpendicularSpan / spacing));
  }
  return Math.ceil(perpendicularSpan / spacing);
}

export function countModeLabel(mode: CountMode): string {
  const labels: Record<CountMode, string> = {
    project: "项目算法",
    round: "四舍五入算法",
    floor: "向下取整算法",
  };
  return labels[mode];
}

export function directionLabel(direction: BarDirection): string {
  return direction === "x" ? "东西向" : "南北向";
}

export function theoreticalUnitWeight(diameter: number): number {
  if (!Number.isFinite(diameter) || diameter <= 0) return 0;
  return (Math.PI * diameter * diameter * 7850) / 4 / 1_000_000;
}

type BarLengthZoneInput = {
  perpendicularStartMm: number;
  perpendicularEndMm: number;
  anchorRules: DirectionAnchorRules;
};

type CreateBarInput = {
  id: string;
  scopeId: string;
  scopeType: "room" | "through";
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
  lengthZones?: BarLengthZoneInput[];
};

function stableDimensionId(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function sameAnchorRule(left: AnchorRule, right: AnchorRule): boolean {
  if (left.source !== right.source) return false;
  return left.source !== "manual" || left.manualValue === right.manualValue;
}

export function allocateBarCountsByPosition(
  total: number,
  zones: ReadonlyArray<
    Pick<BarLengthZoneInput, "perpendicularStartMm" | "perpendicularEndMm">
  >,
  calculationWidthMm: number,
): number[] {
  const counts = zones.map(() => 0);
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isFinite(calculationWidthMm) ||
    calculationWidthMm <= 0 ||
    zones.length === 0
  ) {
    return counts;
  }

  const positionsBefore = (boundary: number): number => {
    const ratio = boundary / calculationWidthMm;
    if (!Number.isFinite(ratio)) return ratio > 0 ? total : 0;
    return Math.min(
      total,
      Math.max(0, Math.ceil(total * ratio - 0.5)),
    );
  };
  zones.forEach((zone, index) => {
    const startCount = positionsBefore(zone.perpendicularStartMm);
    const endCount =
      index === zones.length - 1
        ? total
        : positionsBefore(zone.perpendicularEndMm);
    counts[index] = Math.max(0, endCount - startCount);
  });
  return counts;
}

function mergeLengthZones(zones: BarLengthZoneInput[]): BarLengthZoneInput[] {
  return zones.reduce<BarLengthZoneInput[]>((merged, zone) => {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.perpendicularEndMm === zone.perpendicularStartMm &&
      sameAnchorRule(previous.anchorRules.start, zone.anchorRules.start) &&
      sameAnchorRule(previous.anchorRules.end, zone.anchorRules.end)
    ) {
      previous.perpendicularEndMm = zone.perpendicularEndMm;
      return merged;
    }
    merged.push({
      perpendicularStartMm: zone.perpendicularStartMm,
      perpendicularEndMm: zone.perpendicularEndMm,
      anchorRules: {
        start: copyAnchor(zone.anchorRules.start),
        end: copyAnchor(zone.anchorRules.end),
      },
    });
    return merged;
  }, []);
}

function createBarResult(input: CreateBarInput): BarResult {
  const topExtraMode = input.layer === "top" ? (input.topExtraMode ?? "both") : undefined;
  const startExtraSelected = topExtraMode
    ? shouldApplyTopExtra(topExtraMode, "start")
    : false;
  const endExtraSelected = topExtraMode
    ? shouldApplyTopExtra(topExtraMode, "end")
    : false;
  const count = countBars(
    input.perpendicularSpan,
    input.settings.spacing,
    input.slab.countMode,
  );
  const intermediateWallMm = input.intermediateWallMm ?? 0;
  const unitWeightKgM = theoreticalUnitWeight(input.settings.diameter);
  const lengthZones = mergeLengthZones(
    input.lengthZones?.length
      ? input.lengthZones
      : [
          {
            perpendicularStartMm: 0,
            perpendicularEndMm: input.perpendicularSpan,
            anchorRules: input.anchorRules,
          },
        ],
  );
  const variantCounts = allocateBarCountsByPosition(
    count,
    lengthZones,
    input.perpendicularSpan,
  );
  const lengthVariants = lengthZones.map<BarLengthVariant>((zone, index) => {
    const startAnchorSource = zone.anchorRules.start.source;
    const endAnchorSource = zone.anchorRules.end.source;
    const startExtraApplied =
      input.layer === "top" &&
      startExtraSelected &&
      startAnchorSource === "inner-wall";
    const endExtraApplied =
      input.layer === "top" &&
      endExtraSelected &&
      endAnchorSource === "inner-wall";
    const startAnchor =
      input.layer === "bottom"
        ? resolveBottomAnchor(zone.anchorRules.start, input.slab)
        : resolveTopAnchor(zone.anchorRules.start, input.slab, startExtraSelected);
    const endAnchor =
      input.layer === "bottom"
        ? resolveBottomAnchor(zone.anchorRules.end, input.slab)
        : resolveTopAnchor(zone.anchorRules.end, input.slab, endExtraSelected);
    const singleLengthM =
      (input.runSpan + intermediateWallMm + startAnchor + endAnchor) / 1000;
    const variantCount = variantCounts[index] ?? 0;
    const totalLengthM = variantCount * singleLengthM;
    return {
      id: `${input.id}:zone:${stableDimensionId(zone.perpendicularStartMm)}-${stableDimensionId(zone.perpendicularEndMm)}:${startAnchorSource}-${endAnchorSource}`,
      perpendicularStartMm: zone.perpendicularStartMm,
      perpendicularEndMm: zone.perpendicularEndMm,
      count: variantCount,
      startAnchorSource,
      endAnchorSource,
      startAnchor,
      endAnchor,
      startExtraApplied,
      endExtraApplied,
      singleLengthM,
      totalLengthM,
      weightKg: totalLengthM * unitWeightKgM,
    };
  });
  const firstVariant = lengthVariants[0];
  const totalLengthM = lengthVariants.reduce(
    (sum, variant) => sum + variant.totalLengthM,
    0,
  );
  const weightKg = lengthVariants.reduce(
    (sum, variant) => sum + variant.weightKg,
    0,
  );
  const singleLengthM =
    count > 0 ? totalLengthM / count : (firstVariant?.singleLengthM ?? 0);

  return {
    id: input.id,
    scopeId: input.scopeId,
    scopeType: input.scopeType,
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
    weightKg,
    startAnchorSource: firstVariant?.startAnchorSource ?? input.anchorRules.start.source,
    endAnchorSource: firstVariant?.endAnchorSource ?? input.anchorRules.end.source,
    startAnchor:
      firstVariant?.startAnchor ?? resolveBottomAnchor(input.anchorRules.start, input.slab),
    endAnchor:
      firstVariant?.endAnchor ?? resolveBottomAnchor(input.anchorRules.end, input.slab),
    topExtraMode,
    topExtraValue: input.layer === "top" ? input.slab.topAnchorExtra : 0,
    startExtraApplied: firstVariant?.startExtraApplied ?? false,
    endExtraApplied: firstVariant?.endExtraApplied ?? false,
    netRunSpanMm: input.runSpan,
    intermediateWallMm,
    calculationWidthMm: input.perpendicularSpan,
    spacing: input.settings.spacing,
    lengthMode: lengthVariants.length > 1 ? "zoned" : "uniform",
    lengthVariants,
  };
}

function effectiveZoneAnchor(
  configured: AnchorRule,
  automaticSource: RoomBoundaryZone["startSource"],
): AnchorRule {
  return configured.origin === "user"
    ? copyAnchor(configured)
    : wallAnchor(automaticSource, "auto");
}

function roomLengthZones(
  room: SlabRoom,
  layer: BarLayer,
  direction: BarDirection,
  slab: SlabBaseState,
): BarLengthZoneInput[] | undefined {
  if (slab.arrangement !== direction || slab.rooms.length <= 1) {
    return undefined;
  }
  const roomIndex = slab.rooms.findIndex((candidate) => candidate.id === room.id);
  if (roomIndex < 0) return undefined;
  const configured = room.anchors[layer][direction];
  return buildRoomBoundaryZones(
    slab.rooms,
    slab.arrangement,
    roomIndex,
    direction,
  ).map((zone) => ({
    perpendicularStartMm: zone.perpendicularStartMm,
    perpendicularEndMm: zone.perpendicularEndMm,
    anchorRules: {
      start: effectiveZoneAnchor(configured.start, zone.startSource),
      end: effectiveZoneAnchor(configured.end, zone.endSource),
    },
  }));
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
    scopeType: "room",
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
    lengthZones: roomLengthZones(room, layer, direction, slab),
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
    (slab.rooms.length - 1) * slab.innerWallThickness;
  const commonPerpendicularSpan = perpendicularSpans[0];
  const throughSettings = isX ? top.x : top.y;
  const scopeName = `${slab.rooms[0].name}—${slab.rooms.at(-1)?.name ?? "通墙路径"}`;

  const throughBar = createBarResult({
    id: `through-top-${direction}`,
    scopeId: `through-${direction}`,
    scopeType: "through",
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
  return {
    direction,
    roomCount: slab.rooms.length,
    netSpanTotal,
    intermediateWallTotal,
    throughBar,
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
  if (!(["project", "round", "floor"] as string[]).includes(slab.countMode)) {
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
  validateNonNegative(slab.topAnchorExtra, "内墙面筋锚固增加值", errors);

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
        !allEqual(
          slab.rooms.map((room) =>
            state.through.direction === "x" ? room.spanY : room.spanX,
          ),
        )
      ) {
        errors.push(
          "通墙组合区垂直净尺寸不一致，当前整体通墙模式不可形成。",
        );
      }
    }
  }

  return [...new Set(errors)];
}

const CALCULATION_SAFETY_ERROR =
  "钢筋计算结果超出安全数值范围，请检查尺寸、间距、直径和锚固输入。";

function nearlyEqual(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * 32 * scale;
}

function isSafeBarResult(result: BarResult): boolean {
  if (
    !Number.isSafeInteger(result.count) ||
    result.count <= 0 ||
    !Array.isArray(result.lengthVariants) ||
    result.lengthVariants.length === 0 ||
    (result.lengthMode === "uniform" && result.lengthVariants.length !== 1) ||
    (result.lengthMode === "zoned" && result.lengthVariants.length <= 1)
  ) {
    return false;
  }
  const positiveValues = [
    result.diameter,
    result.singleLengthM,
    result.totalLengthM,
    result.unitWeightKgM,
    result.weightKg,
    result.netRunSpanMm,
    result.calculationWidthMm,
    result.spacing,
  ];
  const nonNegativeValues = [
    result.startAnchor,
    result.endAnchor,
    result.topExtraValue,
    result.intermediateWallMm,
  ];
  if (
    positiveValues.some((value) => !Number.isFinite(value) || value <= 0) ||
    nonNegativeValues.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return false;
  }

  const variantIds = new Set<string>();
  let variantCount = 0;
  let variantLengthM = 0;
  let variantWeightKg = 0;
  let perpendicularCursorMm = 0;
  for (const variant of result.lengthVariants) {
    if (
      variantIds.has(variant.id) ||
      !Number.isSafeInteger(variant.count) ||
      variant.count < 0 ||
      !Number.isFinite(variant.perpendicularStartMm) ||
      !Number.isFinite(variant.perpendicularEndMm) ||
      variant.perpendicularStartMm < 0 ||
      variant.perpendicularEndMm <= variant.perpendicularStartMm ||
      !nearlyEqual(variant.perpendicularStartMm, perpendicularCursorMm) ||
      !Number.isFinite(variant.startAnchor) ||
      variant.startAnchor < 0 ||
      !Number.isFinite(variant.endAnchor) ||
      variant.endAnchor < 0 ||
      !Number.isFinite(variant.singleLengthM) ||
      variant.singleLengthM <= 0 ||
      !Number.isFinite(variant.totalLengthM) ||
      variant.totalLengthM < 0 ||
      !Number.isFinite(variant.weightKg) ||
      variant.weightKg < 0 ||
      !nearlyEqual(
        variant.singleLengthM * variant.count,
        variant.totalLengthM,
      ) ||
      !nearlyEqual(
        variant.totalLengthM * result.unitWeightKgM,
        variant.weightKg,
      )
    ) {
      return false;
    }
    variantIds.add(variant.id);
    variantCount += variant.count;
    variantLengthM += variant.totalLengthM;
    variantWeightKg += variant.weightKg;
    perpendicularCursorMm = variant.perpendicularEndMm;
  }
  return (
    Number.isSafeInteger(variantCount) &&
    variantCount === result.count &&
    Number.isFinite(variantLengthM) &&
    Number.isFinite(variantWeightKg) &&
    nearlyEqual(perpendicularCursorMm, result.calculationWidthMm) &&
    nearlyEqual(variantLengthM, result.totalLengthM) &&
    nearlyEqual(variantWeightKg, result.weightKg) &&
    nearlyEqual(result.singleLengthM * result.count, result.totalLengthM) &&
    nearlyEqual(result.totalLengthM * result.unitWeightKgM, result.weightKg)
  );
}

function hasSafeCalculatedResults(results: readonly BarResult[]): boolean {
  if (results.length === 0 || !results.every(isSafeBarResult)) return false;
  const totalWeightKg = results.reduce(
    (sum, result) => sum + result.weightKg,
    0,
  );
  return Number.isFinite(totalWeightKg) && totalWeightKg > 0;
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
  const normalTopResults = state.slab.rooms.flatMap((room) => [
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
    ? [
        throughWall.throughBar,
        ...normalTopResults.filter(
          (result) => result.direction !== throughWall.direction,
        ),
      ]
    : normalTopResults;
  const results = [...bottomResults, ...topResults];
  if (!hasSafeCalculatedResults(results)) {
    return {
      results: [],
      totalWeightKg: null,
      throughWall: null,
      errors: [CALCULATION_SAFETY_ERROR],
      isValid: false,
    };
  }
  const totalWeightKg = results.reduce(
    (sum, result) => sum + result.weightKg,
    0,
  );

  return { results, totalWeightKg, throughWall, errors: [], isValid: true };
}
