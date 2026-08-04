import type {
  AnchorSource,
  BarDirection,
  BarLayer,
  BarResult,
  SlabCalculation,
  SlabCalculatorState,
} from "./slab-calculator";

export const DEFAULT_MAX_LINES_PER_RESULT = 5;

const SVG_WIDTH = 1000;
const PLOT_RECT = { x: 110, y: 72, width: 780, height: 430 };
const FALLBACK_ROOM_SPAN = 1000;
const FALLBACK_WALL_THICKNESS = 200;
const MAX_DRAWING_DIMENSION = 10_000_000;

export type DiagramPoint = {
  x: number;
  y: number;
};

export type DiagramRect = DiagramPoint & {
  width: number;
  height: number;
};

type WorldRect = DiagramRect;

export type SlabDiagramRoom = {
  id: string;
  index: number;
  name: string;
  spanX: number;
  spanY: number;
  worldRect: WorldRect;
  rect: DiagramRect;
  label: string;
};

export type SlabDiagramWall = {
  id: string;
  kind: "outer" | "inner";
  thicknessMm: number;
  rect: DiagramRect;
  label: string;
  labelPoint: DiagramPoint;
};

export type SlabDiagramSegment = {
  id: string;
  kind: "net" | "anchor-start" | "anchor-end" | "extra-start" | "extra-end";
  start: DiagramPoint;
  end: DiagramPoint;
  compressed?: boolean;
};

export type SlabDiagramBarGroup = {
  resultId: string;
  roomId?: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  scopeType: "room" | "through";
  representativeCount: number;
  netSegments: SlabDiagramSegment[];
  startAnchorSegments: SlabDiagramSegment[];
  endAnchorSegments: SlabDiagramSegment[];
  extraSegments: SlabDiagramSegment[];
  specificationLabel: string;
  countLabel: string;
  runLabel: string;
  anchorLabel: string;
  extraLabel: string;
  startExtraApplied: boolean;
  endExtraApplied: boolean;
};

export type SlabDiagramScene = {
  width: number;
  height: number;
  plotRect: DiagramRect;
  worldWidthMm: number;
  worldHeightMm: number;
  scale: number;
  rooms: SlabDiagramRoom[];
  walls: SlabDiagramWall[];
  barGroups: SlabDiagramBarGroup[];
  notes: string[];
  selectionFiltered: boolean;
  xAxis: { start: DiagramPoint; end: DiagramPoint };
  yAxis: { start: DiagramPoint; end: DiagramPoint };
};

type WorldRoom = {
  id: string;
  index: number;
  name: string;
  originalSpanX: number;
  originalSpanY: number;
  rect: WorldRect;
};

type WorldLayout = {
  rooms: WorldRoom[];
  walls: Array<{
    id: string;
    kind: "outer" | "inner";
    thicknessMm: number;
    rect: WorldRect;
  }>;
  width: number;
  height: number;
  outerWall: number;
  innerWall: number;
  usedFallback: boolean;
  unequalPerpendicularSpans: boolean;
};

type CoordinateTransform = {
  scale: number;
  point: (point: DiagramPoint) => DiagramPoint;
  rect: (rect: WorldRect) => DiagramRect;
};

type WorldBarLine = {
  start: DiagramPoint;
  end: DiagramPoint;
  startBoundaryMm: number;
  endBoundaryMm: number;
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function safePositive(value: number, fallback: number): number {
  if (!isFinitePositive(value)) return fallback;
  return Math.min(value, MAX_DRAWING_DIMENSION);
}

function safeNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, MAX_DRAWING_DIMENSION);
}

function dimensionText(value: number): string {
  return Number.isFinite(value) && value > 0 ? `${value}` : "待完善";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildWorldLayout(state: SlabCalculatorState): WorldLayout {
  const sourceRooms = state.slab.rooms;
  const arrangement = state.slab.arrangement === "y" ? "y" : "x";
  const outerWall = safePositive(
    state.slab.outerWallThickness,
    FALLBACK_WALL_THICKNESS,
  );
  const innerWall = safePositive(
    state.slab.innerWallThickness,
    FALLBACK_WALL_THICKNESS,
  );
  let usedFallback =
    !isFinitePositive(state.slab.outerWallThickness) ||
    !isFinitePositive(state.slab.innerWallThickness);

  const safeRooms = sourceRooms.map((room, index) => {
    const spanX = safePositive(room.spanX, FALLBACK_ROOM_SPAN);
    const spanY = safePositive(room.spanY, FALLBACK_ROOM_SPAN);
    if (!isFinitePositive(room.spanX) || !isFinitePositive(room.spanY)) {
      usedFallback = true;
    }
    return {
      id: room.id,
      index,
      name: room.name,
      originalSpanX: room.spanX,
      originalSpanY: room.spanY,
      spanX,
      spanY,
    };
  });

  const maxSpanX = safeRooms.length
    ? Math.max(...safeRooms.map((room) => room.spanX))
    : FALLBACK_ROOM_SPAN;
  const maxSpanY = safeRooms.length
    ? Math.max(...safeRooms.map((room) => room.spanY))
    : FALLBACK_ROOM_SPAN;
  const netSpanX = safeRooms.reduce((sum, room) => sum + room.spanX, 0);
  const netSpanY = safeRooms.reduce((sum, room) => sum + room.spanY, 0);
  const wallCount = Math.max(safeRooms.length - 1, 0);
  const width =
    arrangement === "x"
      ? outerWall * 2 + (safeRooms.length ? netSpanX + wallCount * innerWall : maxSpanX)
      : outerWall * 2 + maxSpanX;
  const height =
    arrangement === "y"
      ? outerWall * 2 + (safeRooms.length ? netSpanY + wallCount * innerWall : maxSpanY)
      : outerWall * 2 + maxSpanY;

  let cursorX = outerWall;
  let cursorY = outerWall;
  const rooms: WorldRoom[] = safeRooms.map((room) => {
    const worldRoom: WorldRoom = {
      id: room.id,
      index: room.index,
      name: room.name,
      originalSpanX: room.originalSpanX,
      originalSpanY: room.originalSpanY,
      rect: {
        x: arrangement === "x" ? cursorX : outerWall,
        y: arrangement === "y" ? cursorY : outerWall,
        width: room.spanX,
        height: room.spanY,
      },
    };
    if (arrangement === "x") cursorX += room.spanX + innerWall;
    else cursorY += room.spanY + innerWall;
    return worldRoom;
  });

  const walls: WorldLayout["walls"] = [
    {
      id: "outer-south",
      kind: "outer",
      thicknessMm: outerWall,
      rect: { x: 0, y: 0, width, height: outerWall },
    },
    {
      id: "outer-north",
      kind: "outer",
      thicknessMm: outerWall,
      rect: { x: 0, y: height - outerWall, width, height: outerWall },
    },
    {
      id: "outer-west",
      kind: "outer",
      thicknessMm: outerWall,
      rect: { x: 0, y: outerWall, width: outerWall, height: height - outerWall * 2 },
    },
    {
      id: "outer-east",
      kind: "outer",
      thicknessMm: outerWall,
      rect: {
        x: width - outerWall,
        y: outerWall,
        width: outerWall,
        height: height - outerWall * 2,
      },
    },
  ];

  rooms.slice(0, -1).forEach((room, index) => {
    walls.push(
      arrangement === "x"
        ? {
            id: `inner-${index}`,
            kind: "inner",
            thicknessMm: innerWall,
            rect: {
              x: room.rect.x + room.rect.width,
              y: outerWall,
              width: innerWall,
              height: maxSpanY,
            },
          }
        : {
            id: `inner-${index}`,
            kind: "inner",
            thicknessMm: innerWall,
            rect: {
              x: outerWall,
              y: room.rect.y + room.rect.height,
              width: maxSpanX,
              height: innerWall,
            },
          },
    );
  });

  const perpendicularSpans = safeRooms.map((room) =>
    arrangement === "x" ? room.spanY : room.spanX,
  );
  const unequalPerpendicularSpans =
    perpendicularSpans.length > 1 &&
    perpendicularSpans.some((span) => span !== perpendicularSpans[0]);

  return {
    rooms,
    walls,
    width: safePositive(width, FALLBACK_ROOM_SPAN + outerWall * 2),
    height: safePositive(height, FALLBACK_ROOM_SPAN + outerWall * 2),
    outerWall,
    innerWall,
    usedFallback,
    unequalPerpendicularSpans,
  };
}

function createTransform(layout: WorldLayout): CoordinateTransform {
  const scale = Math.min(
    PLOT_RECT.width / layout.width,
    PLOT_RECT.height / layout.height,
  );
  const renderedWidth = layout.width * scale;
  const renderedHeight = layout.height * scale;
  const offsetX = PLOT_RECT.x + (PLOT_RECT.width - renderedWidth) / 2;
  const offsetY = PLOT_RECT.y + (PLOT_RECT.height - renderedHeight) / 2;
  const point = ({ x, y }: DiagramPoint): DiagramPoint => ({
    x: offsetX + x * scale,
    y: offsetY + (layout.height - y) * scale,
  });
  return {
    scale,
    point,
    rect: (rect) => {
      const northWest = point({ x: rect.x, y: rect.y + rect.height });
      return {
        x: northWest.x,
        y: northWest.y,
        width: rect.width * scale,
        height: rect.height * scale,
      };
    },
  };
}

export function getRepresentativeCount(
  result: Pick<BarResult, "count"> | null | undefined,
  maxLinesPerResult = DEFAULT_MAX_LINES_PER_RESULT,
): number {
  if (
    !result ||
    !Number.isFinite(result.count) ||
    result.count <= 0 ||
    !Number.isFinite(maxLinesPerResult) ||
    maxLinesPerResult <= 0
  ) {
    return 0;
  }
  return Math.min(Math.max(1, Math.trunc(result.count)), Math.max(1, Math.trunc(maxLinesPerResult)));
}

function representativeFractions(count: number, layer: BarLayer): number[] {
  if (count <= 0) return [];
  const offset = layer === "top" ? 0.018 : -0.018;
  return Array.from({ length: count }, (_, index) =>
    clamp((index + 1) / (count + 1) + offset, 0.06, 0.94),
  );
}

function sourceLabel(source: AnchorSource): string {
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

function endpointLabel(result: BarResult, endpoint: "start" | "end"): string {
  const label =
    result.direction === "x"
      ? endpoint === "start"
        ? "西端"
        : "东端"
      : endpoint === "start"
        ? "南端"
        : "北端";
  return result.throughWall ? `最${label}` : label;
}

function actualExtraApplied(result: BarResult, endpoint: "start" | "end"): boolean {
  const selected = endpoint === "start" ? result.startExtraApplied : result.endExtraApplied;
  return result.layer === "top" && selected && Number.isFinite(result.topExtraValue) && result.topExtraValue > 0;
}

export function formatDiagramExtraLabel(result: BarResult): string {
  if (result.layer === "bottom") return "地筋不适用面筋增加值";
  const startApplied = actualExtraApplied(result, "start");
  const endApplied = actualExtraApplied(result, "end");
  const extra = safeNonNegative(result.topExtraValue);
  if (startApplied && endApplied) return `两端实际增加${extra}mm`;
  if (startApplied) return `${endpointLabel(result, "start")}实际增加${extra}mm`;
  if (endApplied) return `${endpointLabel(result, "end")}实际增加${extra}mm`;
  if (
    result.startAnchorSource === "manual" ||
    result.endAnchorSource === "manual"
  ) {
    return "手动锚固为最终值，未叠加增加值";
  }
  return "未实际叠加面筋增加值";
}

function formatAnchor(result: BarResult, endpoint: "start" | "end"): string {
  const source = endpoint === "start" ? result.startAnchorSource : result.endAnchorSource;
  const value = endpoint === "start" ? result.startAnchor : result.endAnchor;
  const suffix =
    source === "manual"
      ? "（最终值）"
      : actualExtraApplied(result, endpoint)
        ? `（已增加${safeNonNegative(result.topExtraValue)}mm）`
        : result.layer === "top"
          ? "（未增加）"
          : "";
  return `${endpointLabel(result, endpoint)}${sourceLabel(source)}${value}mm${suffix}`;
}

function topologyBoundary(
  room: WorldRoom,
  rooms: WorldRoom[],
  direction: BarDirection,
  endpoint: "start" | "end",
  arrangement: SlabCalculatorState["slab"]["arrangement"],
  layout: WorldLayout,
): { thickness: number; external: boolean } {
  const lastIndex = rooms.length - 1;
  if (arrangement === direction) {
    const external = endpoint === "start" ? room.index === 0 : room.index === lastIndex;
    return {
      thickness: external ? layout.outerWall : layout.innerWall,
      external,
    };
  }
  return { thickness: layout.outerWall, external: true };
}

function moveAlong(
  point: DiagramPoint,
  direction: BarDirection,
  distance: number,
): DiagramPoint {
  return direction === "x"
    ? { x: point.x + distance, y: point.y }
    : { x: point.x, y: point.y + distance };
}

function normalWorldLines(
  result: BarResult,
  room: WorldRoom,
  rooms: WorldRoom[],
  state: SlabCalculatorState,
  layout: WorldLayout,
  count: number,
): WorldBarLine[] {
  const startBoundary = topologyBoundary(
    room,
    rooms,
    result.direction,
    "start",
    state.slab.arrangement,
    layout,
  );
  const endBoundary = topologyBoundary(
    room,
    rooms,
    result.direction,
    "end",
    state.slab.arrangement,
    layout,
  );
  return representativeFractions(count, result.layer).map((fraction) => {
    if (result.direction === "x") {
      const y = room.rect.y + room.rect.height * fraction;
      return {
        start: { x: room.rect.x, y },
        end: { x: room.rect.x + room.rect.width, y },
        startBoundaryMm: startBoundary.thickness + (startBoundary.external ? Math.min(room.rect.width * 0.08, 600) : 0),
        endBoundaryMm: endBoundary.thickness + (endBoundary.external ? Math.min(room.rect.width * 0.08, 600) : 0),
      };
    }
    const x = room.rect.x + room.rect.width * fraction;
    return {
      start: { x, y: room.rect.y },
      end: { x, y: room.rect.y + room.rect.height },
      startBoundaryMm: startBoundary.thickness + (startBoundary.external ? Math.min(room.rect.height * 0.08, 600) : 0),
      endBoundaryMm: endBoundary.thickness + (endBoundary.external ? Math.min(room.rect.height * 0.08, 600) : 0),
    };
  });
}

function throughWorldLines(
  result: BarResult,
  rooms: WorldRoom[],
  layout: WorldLayout,
  count: number,
): WorldBarLine[] {
  const first = rooms[0];
  const last = rooms.at(-1);
  if (!first || !last) return [];
  const fractions = representativeFractions(count, result.layer);
  if (result.direction === "x") {
    return fractions.map((fraction) => {
      const y = first.rect.y + first.rect.height * fraction;
      return {
        start: { x: first.rect.x, y },
        end: { x: last.rect.x + last.rect.width, y },
        startBoundaryMm: layout.outerWall + Math.min(result.netRunSpanMm * 0.08, 600),
        endBoundaryMm: layout.outerWall + Math.min(result.netRunSpanMm * 0.08, 600),
      };
    });
  }
  return fractions.map((fraction) => {
    const x = first.rect.x + first.rect.width * fraction;
    return {
      start: { x, y: first.rect.y },
      end: { x, y: last.rect.y + last.rect.height },
      startBoundaryMm: layout.outerWall + Math.min(result.netRunSpanMm * 0.08, 600),
      endBoundaryMm: layout.outerWall + Math.min(result.netRunSpanMm * 0.08, 600),
    };
  });
}

function sampleRoomByNetDistance(
  rooms: WorldRoom[],
  axis: "x" | "y",
  distance: number,
): { room: WorldRoom; coordinate: number } | null {
  let covered = 0;
  for (const room of rooms) {
    const span = axis === "x" ? room.rect.width : room.rect.height;
    if (distance <= covered + span || room === rooms.at(-1)) {
      const offset = clamp(distance - covered, 0, span);
      return {
        room,
        coordinate: (axis === "x" ? room.rect.x : room.rect.y) + offset,
      };
    }
    covered += span;
  }
  return null;
}

function perpendicularWorldLines(
  result: BarResult,
  throughDirection: BarDirection,
  rooms: WorldRoom[],
  layout: WorldLayout,
  count: number,
): WorldBarLine[] {
  const axis = throughDirection;
  const totalNet = rooms.reduce(
    (sum, room) => sum + (axis === "x" ? room.rect.width : room.rect.height),
    0,
  );
  return representativeFractions(count, result.layer).flatMap((fraction) => {
    const sample = sampleRoomByNetDistance(rooms, axis, totalNet * fraction);
    if (!sample) return [];
    if (result.direction === "y") {
      return [{
        start: { x: sample.coordinate, y: sample.room.rect.y },
        end: { x: sample.coordinate, y: sample.room.rect.y + sample.room.rect.height },
        startBoundaryMm: layout.outerWall + Math.min(sample.room.rect.height * 0.08, 600),
        endBoundaryMm: layout.outerWall + Math.min(sample.room.rect.height * 0.08, 600),
      }];
    }
    return [{
      start: { x: sample.room.rect.x, y: sample.coordinate },
      end: { x: sample.room.rect.x + sample.room.rect.width, y: sample.coordinate },
      startBoundaryMm: layout.outerWall + Math.min(sample.room.rect.width * 0.08, 600),
      endBoundaryMm: layout.outerWall + Math.min(sample.room.rect.width * 0.08, 600),
    }];
  });
}

function transformSegment(
  id: string,
  kind: SlabDiagramSegment["kind"],
  start: DiagramPoint,
  end: DiagramPoint,
  transform: CoordinateTransform,
  compressed?: boolean,
): SlabDiagramSegment {
  return {
    id,
    kind,
    start: transform.point(start),
    end: transform.point(end),
    compressed,
  };
}

function buildBarGroup(
  result: BarResult,
  worldLines: WorldBarLine[],
  transform: CoordinateTransform,
): SlabDiagramBarGroup {
  const netSegments: SlabDiagramSegment[] = [];
  const startAnchorSegments: SlabDiagramSegment[] = [];
  const endAnchorSegments: SlabDiagramSegment[] = [];
  const extraSegments: SlabDiagramSegment[] = [];
  const startActual = safeNonNegative(result.startAnchor);
  const endActual = safeNonNegative(result.endAnchor);
  const extra = safeNonNegative(result.topExtraValue);
  const startApplied = actualExtraApplied(result, "start");
  const endApplied = actualExtraApplied(result, "end");

  worldLines.forEach((line, index) => {
    const startVisual = Math.min(startActual, line.startBoundaryMm);
    const endVisual = Math.min(endActual, line.endBoundaryMm);
    const startOuter = moveAlong(line.start, result.direction, -startVisual);
    const endOuter = moveAlong(line.end, result.direction, endVisual);
    netSegments.push(
      transformSegment(`${result.id}-net-${index}`, "net", line.start, line.end, transform),
    );
    if (startVisual > 0) {
      startAnchorSegments.push(
        transformSegment(
          `${result.id}-anchor-start-${index}`,
          "anchor-start",
          startOuter,
          line.start,
          transform,
          startActual > startVisual,
        ),
      );
    }
    if (endVisual > 0) {
      endAnchorSegments.push(
        transformSegment(
          `${result.id}-anchor-end-${index}`,
          "anchor-end",
          line.end,
          endOuter,
          transform,
          endActual > endVisual,
        ),
      );
    }
    if (startApplied && startVisual > 0) {
      const visibleExtra = startActual > 0 ? startVisual * Math.min(extra / startActual, 1) : 0;
      extraSegments.push(
        transformSegment(
          `${result.id}-extra-start-${index}`,
          "extra-start",
          startOuter,
          moveAlong(startOuter, result.direction, visibleExtra),
          transform,
        ),
      );
    }
    if (endApplied && endVisual > 0) {
      const visibleExtra = endActual > 0 ? endVisual * Math.min(extra / endActual, 1) : 0;
      extraSegments.push(
        transformSegment(
          `${result.id}-extra-end-${index}`,
          "extra-end",
          moveAlong(endOuter, result.direction, -visibleExtra),
          endOuter,
          transform,
        ),
      );
    }
  });

  const typeLabel = `${result.layer === "bottom" ? "地筋" : "面筋"}·${result.direction.toUpperCase()}向${result.throughWall ? "通墙" : result.scopeType === "through" ? "组合区" : ""}`;
  const runParts = [
    `净跨${result.netRunSpanMm}mm`,
    result.intermediateWallMm > 0 ? `中间墙${result.intermediateWallMm}mm` : null,
  ].filter(Boolean);

  return {
    resultId: result.id,
    roomId: result.roomId,
    layer: result.layer,
    direction: result.direction,
    throughWall: result.throughWall,
    scopeType: result.scopeType,
    representativeCount: worldLines.length,
    netSegments,
    startAnchorSegments,
    endAnchorSegments,
    extraSegments,
    specificationLabel: `${typeLabel} · Φ${result.diameter}@${result.spacing}`,
    countLabel: `实际${result.count}根（图示${worldLines.length}条代表线）`,
    runLabel: runParts.join(" + "),
    anchorLabel: `${formatAnchor(result, "start")} → ${formatAnchor(result, "end")}`,
    extraLabel: formatDiagramExtraLabel(result),
    startExtraApplied: startApplied,
    endExtraApplied: endApplied,
  };
}

function buildBarGroups(
  state: SlabCalculatorState,
  calculation: SlabCalculation | null | undefined,
  visibleResultIds: ReadonlySet<string> | undefined,
  layout: WorldLayout,
  transform: CoordinateTransform,
  maxLinesPerResult: number,
): SlabDiagramBarGroup[] {
  if (!calculation?.isValid) return [];
  const roomById = new Map(layout.rooms.map((room) => [room.id, room]));
  const throughWall = calculation.throughWall;
  const seen = new Set<string>();

  return calculation.results.flatMap((result) => {
    if (seen.has(result.id)) return [];
    seen.add(result.id);
    if (visibleResultIds && !visibleResultIds.has(result.id)) return [];
    const count = getRepresentativeCount(result, maxLinesPerResult);
    if (count === 0) return [];

    let worldLines: WorldBarLine[] = [];
    if (result.scopeType === "room" && result.roomId) {
      const room = roomById.get(result.roomId);
      if (room) {
        worldLines = normalWorldLines(
          result,
          room,
          layout.rooms,
          state,
          layout,
          count,
        );
      }
    } else if (throughWall && result.id === throughWall.throughBar.id) {
      worldLines = throughWorldLines(result, layout.rooms, layout, count);
    } else if (throughWall && result.id === throughWall.perpendicularBar.id) {
      worldLines = perpendicularWorldLines(
        result,
        throughWall.direction,
        layout.rooms,
        layout,
        count,
      );
    }
    return worldLines.length > 0
      ? [buildBarGroup(result, worldLines, transform)]
      : [];
  });
}

function wallLabelPoint(wall: DiagramRect, kind: "outer" | "inner"): DiagramPoint {
  if (kind === "outer") {
    return { x: wall.x + wall.width / 2, y: wall.y + Math.min(wall.height / 2 + 4, 14) };
  }
  return wall.width >= wall.height
    ? { x: wall.x + wall.width - 4, y: wall.y + wall.height / 2 + 4 }
    : { x: wall.x + wall.width / 2, y: wall.y - 5 };
}

export function buildSlabDiagramScene(
  state: SlabCalculatorState,
  calculation?: SlabCalculation | null,
  options: {
    visibleResultIds?: ReadonlySet<string>;
    maxLinesPerResult?: number;
  } = {},
): SlabDiagramScene {
  const layout = buildWorldLayout(state);
  const transform = createTransform(layout);
  const barGroups = buildBarGroups(
    state,
    calculation,
    options.visibleResultIds,
    layout,
    transform,
    options.maxLinesPerResult ?? DEFAULT_MAX_LINES_PER_RESULT,
  );
  const rooms = layout.rooms.map<SlabDiagramRoom>((room) => ({
    id: room.id,
    index: room.index,
    name: room.name,
    spanX: room.originalSpanX,
    spanY: room.originalSpanY,
    worldRect: room.rect,
    rect: transform.rect(room.rect),
    label: `${room.name || `房间${room.index + 1}`} · ${dimensionText(room.originalSpanX)}×${dimensionText(room.originalSpanY)}mm`,
  }));
  const walls = layout.walls.map<SlabDiagramWall>((wall) => {
    const rect = transform.rect(wall.rect);
    return {
      id: wall.id,
      kind: wall.kind,
      thicknessMm: wall.thicknessMm,
      rect,
      label: `${wall.kind === "outer" ? "外墙" : "内墙"}${wall.thicknessMm}mm`,
      labelPoint: wallLabelPoint(rect, wall.kind),
    };
  });
  const notes = [
    "房间净尺寸与墙厚按实际比例缩放；钢筋线为代表线，真实根数读取正式结果。",
  ];
  if (layout.unequalPerpendicularSpans) {
    notes.push("普通多房间按起点侧对齐示意。",);
  }
  if (layout.usedFallback) {
    notes.push("输入尺寸待完善，当前布局使用安全绘图回退值。",);
  }
  if (options.visibleResultIds) {
    notes.push("仅显示本次所选钢筋。",);
  }
  if (!calculation) {
    notes.push("布局预览不展示正式钢筋结果。",);
  }

  const legendRows = Math.ceil(barGroups.length / 2);
  const height = Math.max(640, 588 + notes.length * 16 + legendRows * 68);
  return {
    width: SVG_WIDTH,
    height,
    plotRect: { ...PLOT_RECT },
    worldWidthMm: layout.width,
    worldHeightMm: layout.height,
    scale: transform.scale,
    rooms,
    walls,
    barGroups,
    notes,
    selectionFiltered: options.visibleResultIds !== undefined,
    xAxis: {
      start: { x: PLOT_RECT.x, y: PLOT_RECT.y + PLOT_RECT.height + 32 },
      end: { x: PLOT_RECT.x + PLOT_RECT.width, y: PLOT_RECT.y + PLOT_RECT.height + 32 },
    },
    yAxis: {
      start: { x: PLOT_RECT.x - 38, y: PLOT_RECT.y + PLOT_RECT.height },
      end: { x: PLOT_RECT.x - 38, y: PLOT_RECT.y },
    },
  };
}
