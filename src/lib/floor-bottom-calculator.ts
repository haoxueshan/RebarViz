import {
  buildFloorAtomicBoundarySegments,
  buildFloorTopologyCells,
  validateFloorPlanV2,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorTopologyCell,
} from "./floor-plan";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import {
  countBars,
  theoreticalUnitWeight,
  type CountMode,
} from "./slab-calculator";

export type FloorBarSettings = {
  diameter: number;
  spacing: number;
};

export type FloorBottomState = {
  countMode: CountMode;
  defaults: {
    x: FloorBarSettings;
    y: FloorBarSettings;
  };
  slabOverrides: Record<
    string,
    Partial<{ x: FloorBarSettings; y: FloorBarSettings }>
  >;
};

export type FloorRebarDomain = {
  id: string;
  slabIds: string[];
  cellIds: string[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type FloorBottomBomGroup = {
  id: string;
  domainId: string;
  slabIds: string[];
  direction: "x" | "y";
  diameter: number;
  spacing: number;
  singleLengthMm: number;
  count: number;
  totalLengthM: number;
  unitWeightKgM: number;
  weightKg: number;
  pieceIds: string[];
};

export type FloorBottomIssue = {
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorBottomCalculation = {
  domains: FloorRebarDomain[];
  lines: FloorBarLine[];
  pieces: FloorBarPiece[];
  groups: FloorBottomBomGroup[];
  totalBarLines: number;
  totalPieces: number;
  totalLengthM: number;
  totalWeightKg: number | null;
  errors: FloorBottomIssue[];
  warnings: FloorBottomIssue[];
  isValid: boolean;
};

export const DEFAULT_FLOOR_BOTTOM_STATE: FloorBottomState = {
  countMode: "project",
  defaults: {
    x: { diameter: 12, spacing: 150 },
    y: { diameter: 10, spacing: 200 },
  },
  slabOverrides: {},
};

const GEOMETRY_EPSILON = 1e-7;
export const LENGTH_GROUP_EPSILON_MM = 1e-6;
const COUNT_MODES: readonly CountMode[] = ["project", "round", "floor"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeSettings(value: unknown, fallback: FloorBarSettings): FloorBarSettings {
  if (!isObject(value)) return { ...fallback };
  return {
    diameter: finiteNumber(value.diameter, fallback.diameter),
    spacing: finiteNumber(value.spacing, fallback.spacing),
  };
}

export function normalizeFloorBottomState(
  value: unknown,
  slabIds?: ReadonlySet<string>,
): FloorBottomState {
  if (!isObject(value)) return structuredClone(DEFAULT_FLOOR_BOTTOM_STATE);
  const defaults = isObject(value.defaults) ? value.defaults : {};
  const slabOverrides: FloorBottomState["slabOverrides"] = {};
  if (isObject(value.slabOverrides)) {
    Object.entries(value.slabOverrides).forEach(([slabId, override]) => {
      if (slabIds && !slabIds.has(slabId)) return;
      if (!isObject(override)) return;
      const next: Partial<{ x: FloorBarSettings; y: FloorBarSettings }> = {};
      if (isObject(override.x)) next.x = normalizeSettings(override.x, DEFAULT_FLOOR_BOTTOM_STATE.defaults.x);
      if (isObject(override.y)) next.y = normalizeSettings(override.y, DEFAULT_FLOOR_BOTTOM_STATE.defaults.y);
      if (next.x || next.y) slabOverrides[slabId] = next;
    });
  }
  return {
    countMode: COUNT_MODES.includes(value.countMode as CountMode)
      ? value.countMode as CountMode
      : DEFAULT_FLOOR_BOTTOM_STATE.countMode,
    defaults: {
      x: normalizeSettings(defaults.x, DEFAULT_FLOOR_BOTTOM_STATE.defaults.x),
      y: normalizeSettings(defaults.y, DEFAULT_FLOOR_BOTTOM_STATE.defaults.y),
    },
    slabOverrides,
  };
}

export function resolveFloorBottomSettings(
  state: FloorBottomState,
  slabId: string,
  direction: "x" | "y",
): FloorBarSettings {
  return state.slabOverrides[slabId]?.[direction] ?? state.defaults[direction];
}

function segmentLength(segment: FloorAtomicBoundarySegment): number {
  return Math.abs(segment.endX - segment.startX) + Math.abs(segment.endY - segment.startY);
}

function cellSharedEdge(
  left: FloorTopologyCell,
  right: FloorTopologyCell,
): { orientation: "horizontal" | "vertical"; coordinate: number; start: number; end: number } | null {
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (overlapY > GEOMETRY_EPSILON && (Math.abs(left.x + left.width - right.x) <= GEOMETRY_EPSILON || Math.abs(right.x + right.width - left.x) <= GEOMETRY_EPSILON)) {
    return {
      orientation: "vertical",
      coordinate: Math.abs(left.x + left.width - right.x) <= GEOMETRY_EPSILON ? right.x : left.x,
      start: Math.max(left.y, right.y),
      end: Math.min(left.y + left.height, right.y + right.height),
    };
  }
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  if (overlapX > GEOMETRY_EPSILON && (Math.abs(left.y + left.height - right.y) <= GEOMETRY_EPSILON || Math.abs(right.y + right.height - left.y) <= GEOMETRY_EPSILON)) {
    return {
      orientation: "horizontal",
      coordinate: Math.abs(left.y + left.height - right.y) <= GEOMETRY_EPSILON ? right.y : left.y,
      start: Math.max(left.x, right.x),
      end: Math.min(left.x + left.width, right.x + right.width),
    };
  }
  return null;
}

function atomicCoversEdge(
  segment: FloorAtomicBoundarySegment,
  edge: NonNullable<ReturnType<typeof cellSharedEdge>>,
): boolean {
  if (segment.orientation !== edge.orientation) return false;
  if (edge.orientation === "vertical") {
    return Math.abs(segment.startX - edge.coordinate) <= GEOMETRY_EPSILON &&
      segment.startY < edge.end - GEOMETRY_EPSILON && segment.endY > edge.start + GEOMETRY_EPSILON;
  }
  return Math.abs(segment.startY - edge.coordinate) <= GEOMETRY_EPSILON &&
    segment.startX < edge.end - GEOMETRY_EPSILON && segment.endX > edge.start + GEOMETRY_EPSILON;
}

export function buildFloorBottomRebarDomains(
  plan: FloorPlanState,
): FloorRebarDomain[] {
  const cells = buildFloorTopologyCells(plan).filter(
    (cell): cell is FloorTopologyCell & { effectiveSlabId: string } => Boolean(cell.effectiveSlabId),
  );
  const atomic = buildFloorAtomicBoundarySegments(plan);
  const graph = new Map(cells.map((cell) => [cell.id, new Set<string>()]));
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      const left = cells[leftIndex];
      const right = cells[rightIndex];
      const edge = cellSharedEdge(left, right);
      if (!edge) continue;
      const connected = left.effectiveSlabId === right.effectiveSlabId || atomic.some(
        (segment) => segment.geometryKind === "shared-slab" &&
          segment.support === "continuous" &&
          segment.slabIds.includes(left.effectiveSlabId) &&
          segment.slabIds.includes(right.effectiveSlabId) &&
          atomicCoversEdge(segment, edge),
      );
      if (!connected) continue;
      graph.get(left.id)?.add(right.id);
      graph.get(right.id)?.add(left.id);
    }
  }

  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const visited = new Set<string>();
  const domains: FloorRebarDomain[] = [];
  cells.forEach((cell) => {
    if (visited.has(cell.id)) return;
    const queue = [cell.id];
    const component: FloorTopologyCell[] = [];
    visited.add(cell.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = cellsById.get(currentId);
      if (current) component.push(current);
      graph.get(currentId)?.forEach((nextId) => {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      });
    }
    const cellIds = component.map((item) => item.id).sort();
    const slabIds = [...new Set(component.flatMap((item) => item.effectiveSlabId ? [item.effectiveSlabId] : []))].sort();
    const minX = Math.min(...component.map((item) => item.x));
    const minY = Math.min(...component.map((item) => item.y));
    const maxX = Math.max(...component.map((item) => item.x + item.width));
    const maxY = Math.max(...component.map((item) => item.y + item.height));
    domains.push({
      id: `bottom-domain:${cellIds.join("|")}`,
      slabIds,
      cellIds,
      minX,
      minY,
      maxX,
      maxY,
    });
  });
  return domains.sort((left, right) => left.minY - right.minY || left.minX - right.minX || left.id.localeCompare(right.id));
}

function sameSettings(left: FloorBarSettings, right: FloorBarSettings): boolean {
  return left.diameter === right.diameter && left.spacing === right.spacing;
}

function directionLabel(direction: "x" | "y"): string {
  return direction === "x" ? "东西向" : "南北向";
}

function validateBottomState(
  plan: FloorPlanState,
  bottom: FloorBottomState,
  domains: readonly FloorRebarDomain[],
): FloorBottomIssue[] {
  const errors: FloorBottomIssue[] = [];
  if (!COUNT_MODES.includes(bottom.countMode)) {
    errors.push({ code: "bottom-count-mode-invalid", message: "地筋根数算法无效。" });
  }
  (["x", "y"] as const).forEach((direction) => {
    const settings = bottom.defaults[direction];
    if (!Number.isFinite(settings.diameter) || settings.diameter <= 0) {
      errors.push({ code: "bottom-diameter-invalid", message: `整层${directionLabel(direction)}地筋直径必须大于0。` });
    }
    if (!Number.isFinite(settings.spacing) || settings.spacing <= 0) {
      errors.push({ code: "bottom-spacing-invalid", message: `整层${directionLabel(direction)}地筋间距必须大于0。` });
    }
  });
  plan.slabs.forEach((slab) => {
    (["x", "y"] as const).forEach((direction) => {
      const override = bottom.slabOverrides[slab.id]?.[direction];
      if (!override) return;
      if (!Number.isFinite(override.diameter) || override.diameter <= 0) {
        errors.push({ code: "bottom-diameter-invalid", message: `“${slab.name}”${directionLabel(direction)}地筋直径必须大于0。`, objectIds: [slab.id] });
      }
      if (!Number.isFinite(override.spacing) || override.spacing <= 0) {
        errors.push({ code: "bottom-spacing-invalid", message: `“${slab.name}”${directionLabel(direction)}地筋间距必须大于0。`, objectIds: [slab.id] });
      }
    });
  });
  domains.forEach((domain) => {
    (["x", "y"] as const).forEach((direction) => {
      const settings = domain.slabIds.map((slabId) => resolveFloorBottomSettings(bottom, slabId, direction));
      if (settings.length > 1 && settings.some((item) => !sameSettings(item, settings[0]))) {
        const details = domain.slabIds.map((slabId) => {
          const slab = plan.slabs.find((item) => item.id === slabId);
          const item = resolveFloorBottomSettings(bottom, slabId, direction);
          return `${slab?.name ?? slabId} Φ${item.diameter}@${item.spacing}`;
        });
        errors.push({
          code: "bottom-continuous-settings-conflict",
          message: `连续楼板区域中的${directionLabel(direction)}地筋规格不一致（${details.join("；")}），请统一规格，或将对应边改为内墙分界。`,
          objectIds: domain.slabIds,
        });
      }
    });
  });
  return errors;
}

export type FloorLineInterval = {
  start: number;
  end: number;
  slabIds: Set<string>;
};

export function buildRawFloorLineIntervals(
  direction: "x" | "y",
  positionMm: number,
  cells: readonly FloorTopologyCell[],
): FloorLineInterval[] {
  return cells.flatMap((cell): FloorLineInterval[] => {
    // 理论位置恰好落在cell分界时采用[lower, upper)的确定性归属，避免钢筋线无声丢失。
    const crosses = direction === "x"
      ? positionMm >= cell.y - GEOMETRY_EPSILON && positionMm < cell.y + cell.height - GEOMETRY_EPSILON
      : positionMm >= cell.x - GEOMETRY_EPSILON && positionMm < cell.x + cell.width - GEOMETRY_EPSILON;
    if (!crosses || !cell.effectiveSlabId) return [];
    return [{
      start: direction === "x" ? cell.x : cell.y,
      end: direction === "x" ? cell.x + cell.width : cell.y + cell.height,
      slabIds: new Set([cell.effectiveSlabId]),
    }];
  }).sort((left, right) => left.start - right.start || left.end - right.end);
}

function segmentAxisRange(
  segment: FloorAtomicBoundarySegment,
  direction: "x" | "y",
): [number, number] {
  return direction === "x"
    ? [Math.min(segment.startY, segment.endY), Math.max(segment.startY, segment.endY)]
    : [Math.min(segment.startX, segment.endX), Math.max(segment.startX, segment.endX)];
}

function segmentOnRunCoordinate(
  segment: FloorAtomicBoundarySegment,
  direction: "x" | "y",
  runMm: number,
): boolean {
  return direction === "x"
    ? segment.orientation === "vertical" && Math.abs(segment.startX - runMm) <= GEOMETRY_EPSILON
    : segment.orientation === "horizontal" && Math.abs(segment.startY - runMm) <= GEOMETRY_EPSILON;
}

/**
 * Atomic段采用[lower, upper)归属；若当前位置没有后继起始段，则允许最后一段包含最大终点。
 * 这样局部support交点不会同时归属前后两段，整条宿主边最大端点又仍可解析。
 */
export function pointBelongsToAtomicSegment(
  segment: FloorAtomicBoundarySegment,
  direction: "x" | "y",
  runMm: number,
  positionMm: number,
  atomic: readonly FloorAtomicBoundarySegment[],
): boolean {
  if (!segmentOnRunCoordinate(segment, direction, runMm)) return false;
  const [start, end] = segmentAxisRange(segment, direction);
  if (positionMm < start - GEOMETRY_EPSILON || positionMm > end + GEOMETRY_EPSILON) return false;
  if (positionMm < end - GEOMETRY_EPSILON) return true;
  const hasSuccessor = atomic.some((candidate) => {
    if (candidate.id === segment.id || !segmentOnRunCoordinate(candidate, direction, runMm)) return false;
    const [candidateStart] = segmentAxisRange(candidate, direction);
    return Math.abs(candidateStart - positionMm) <= GEOMETRY_EPSILON &&
      candidate.slabIds.some((slabId) => segment.slabIds.includes(slabId));
  });
  return !hasSuccessor;
}

type CrossingBoundaryResolution = {
  segment?: FloorAtomicBoundarySegment;
  errorCode?: "bottom-line-crossing-boundary-missing" | "bottom-line-crossing-boundary-ambiguous";
};

export function findCrossingAtomicBoundary(
  atomic: readonly FloorAtomicBoundarySegment[],
  direction: "x" | "y",
  runMm: number,
  positionMm: number,
  leftSlabIds: ReadonlySet<string>,
  rightSlabIds: ReadonlySet<string>,
): CrossingBoundaryResolution {
  const candidates = atomic.filter((segment) =>
    segment.geometryKind === "shared-slab" &&
    pointBelongsToAtomicSegment(segment, direction, runMm, positionMm, atomic) &&
    segment.slabIds.some((slabId) => leftSlabIds.has(slabId)) &&
    segment.slabIds.some((slabId) => rightSlabIds.has(slabId)),
  );
  if (candidates.length === 0) return { errorCode: "bottom-line-crossing-boundary-missing" };
  const supports = new Set(candidates.map((segment) => segment.support));
  if (supports.size > 1) return { errorCode: "bottom-line-crossing-boundary-ambiguous" };
  return { segment: [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0] };
}

export type FloorLineIntervalMergeResult = {
  intervals: FloorLineInterval[];
  errors: FloorBottomIssue[];
};

export function mergeFloorLineIntervalsBySupport(
  direction: "x" | "y",
  positionMm: number,
  raw: readonly FloorLineInterval[],
  atomic: readonly FloorAtomicBoundarySegment[],
): FloorLineIntervalMergeResult {
  const merged: FloorLineInterval[] = [];
  const errors: FloorBottomIssue[] = [];
  raw.forEach((interval) => {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end + GEOMETRY_EPSILON) {
      merged.push({ start: interval.start, end: interval.end, slabIds: new Set(interval.slabIds) });
      return;
    }
    const overlaps = interval.start < previous.end - GEOMETRY_EPSILON;
    const sameSlab = [...interval.slabIds].some((slabId) => previous.slabIds.has(slabId));
    let canMerge = overlaps || sameSlab;
    if (!canMerge) {
      const crossing = findCrossingAtomicBoundary(
        atomic,
        direction,
        previous.end,
        positionMm,
        previous.slabIds,
        interval.slabIds,
      );
      if (!crossing.segment) {
        errors.push({
          code: crossing.errorCode ?? "bottom-line-crossing-boundary-missing",
          message: `地筋在 ${direction === "x" ? "X" : "Y"}=${previous.end}mm、垂直位置${positionMm}mm处无法确定跨板支承，已停止正式计算。`,
        });
      } else {
        canMerge = crossing.segment.support === "continuous";
      }
    }
    if (canMerge) {
      previous.end = Math.max(previous.end, interval.end);
      interval.slabIds.forEach((slabId) => previous.slabIds.add(slabId));
    } else {
      merged.push({ start: interval.start, end: interval.end, slabIds: new Set(interval.slabIds) });
    }
  });
  return { intervals: merged, errors };
}

export type FloorEndpointBoundaryResolution = {
  segment?: FloorAtomicBoundarySegment;
  errorCode?: "bottom-endpoint-boundary-missing" | "bottom-endpoint-boundary-ambiguous";
  candidateIds: string[];
};

export function resolveFloorEndpointBoundary(
  atomic: readonly FloorAtomicBoundarySegment[],
  direction: "x" | "y",
  runMm: number,
  positionMm: number,
  slabIds: ReadonlySet<string>,
): FloorEndpointBoundaryResolution {
  const candidates = atomic.filter((segment) =>
    pointBelongsToAtomicSegment(segment, direction, runMm, positionMm, atomic) &&
    segment.slabIds.some((slabId) => slabIds.has(slabId)),
  );
  const candidateIds = candidates.map((segment) => segment.id).sort();
  if (candidates.length === 0) return { errorCode: "bottom-endpoint-boundary-missing", candidateIds };
  if (new Set(candidates.map((segment) => segment.support)).size > 1) {
    return { errorCode: "bottom-endpoint-boundary-ambiguous", candidateIds };
  }
  return {
    segment: [...candidates].sort((left, right) => segmentLength(left) - segmentLength(right) || left.id.localeCompare(right.id))[0],
    candidateIds,
  };
}

function anchorForSupport(segment: FloorAtomicBoundarySegment): number | null {
  if (segment.support === "outer-wall" || segment.support === "inner-wall") return segment.thicknessMm;
  if (segment.support === "opening-cut") return 0;
  return null;
}

function emptyCalculation(
  domains: FloorRebarDomain[],
  errors: FloorBottomIssue[],
  warnings: FloorBottomIssue[],
): FloorBottomCalculation {
  return {
    domains,
    lines: [],
    pieces: [],
    groups: [],
    totalBarLines: 0,
    totalPieces: 0,
    totalLengthM: 0,
    totalWeightKg: null,
    errors,
    warnings,
    isValid: false,
  };
}

export function stableLengthKey(mm: number): string {
  return Number(mm.toFixed(6)).toString();
}

export function buildFloorBottomBomGroups(
  pieces: readonly FloorBarPiece[],
): FloorBottomBomGroup[] {
  const grouped = new Map<string, FloorBottomBomGroup>();
  pieces.forEach((piece) => {
    const key = [
      piece.domainId,
      piece.direction,
      piece.diameter,
      piece.spacing,
      stableLengthKey(piece.singleLengthMm),
    ].join(":");
    const unitWeightKgM = theoreticalUnitWeight(piece.diameter);
    const current = grouped.get(key) ?? {
      id: `bottom-bom:${key}`,
      domainId: piece.domainId,
      slabIds: [...piece.slabIds],
      direction: piece.direction,
      diameter: piece.diameter,
      spacing: piece.spacing,
      // 保留首根Piece的真实长度；stable key只影响分组，不改写正式Piece。
      singleLengthMm: piece.singleLengthMm,
      count: 0,
      totalLengthM: 0,
      unitWeightKgM,
      weightKg: 0,
      pieceIds: [],
    };
    // 相同stable key的长度差理论上严格不超过该容差。
    if (Math.abs(piece.singleLengthMm - current.singleLengthMm) > LENGTH_GROUP_EPSILON_MM) {
      throw new Error("Floor Bottom BOM长度分组超出容差。");
    }
    current.count += 1;
    current.totalLengthM += piece.singleLengthMm / 1000;
    current.weightKg += (piece.singleLengthMm / 1000) * unitWeightKgM;
    current.pieceIds.push(piece.id);
    current.slabIds = [...new Set([...current.slabIds, ...piece.slabIds])].sort();
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) =>
    left.domainId.localeCompare(right.domainId) || left.direction.localeCompare(right.direction) || left.singleLengthMm - right.singleLengthMm,
  );
}

export function calculateFloorBottomRebar(
  plan: FloorPlanState,
  input: FloorBottomState,
): FloorBottomCalculation {
  // 正式计算不做“坏值回退”；normalize仅用于存储迁移。否则NaN可能被默认值掩盖。
  const bottom = input;
  const geometryIssues = validateFloorPlanV2(plan);
  const warnings: FloorBottomIssue[] = geometryIssues
    .filter((issue) => issue.level === "warning")
    .map(({ code, message, objectIds }) => ({ code, message, objectIds }));
  const geometryErrors: FloorBottomIssue[] = geometryIssues
    .filter((issue) => issue.level === "error")
    .map(({ code, message, objectIds }) => ({ code, message, objectIds }));
  const domains = buildFloorBottomRebarDomains(plan);
  const errors = [...geometryErrors, ...validateBottomState(plan, bottom, domains)];
  if (errors.length > 0) return emptyCalculation(domains, errors, warnings);

  const allCells = buildFloorTopologyCells(plan);
  const cellsById = new Map(allCells.map((cell) => [cell.id, cell]));
  const atomic = buildFloorAtomicBoundarySegments(plan);
  const lines: FloorBarLine[] = [];
  const pieces: FloorBarPiece[] = [];
  const calculationErrors: FloorBottomIssue[] = [];

  domains.forEach((domain) => {
    const domainCells = domain.cellIds.flatMap((id) => {
      const cell = cellsById.get(id);
      return cell ? [cell] : [];
    });
    (["x", "y"] as const).forEach((direction) => {
      const settings = resolveFloorBottomSettings(bottom, domain.slabIds[0], direction);
      const perpendicularStart = direction === "x" ? domain.minY : domain.minX;
      const perpendicularEnd = direction === "x" ? domain.maxY : domain.maxX;
      const count = countBars(perpendicularEnd - perpendicularStart, settings.spacing, bottom.countMode);
      for (let index = 0; index < count; index += 1) {
        const positionMm = perpendicularStart + ((index + 0.5) * (perpendicularEnd - perpendicularStart)) / count;
        const line: FloorBarLine = {
          id: `${domain.id}:${direction}:line:${index + 1}`,
          domainId: domain.id,
          slabIds: [...domain.slabIds],
          layer: "bottom",
          direction,
          positionMm,
        };
        lines.push(line);
        const intervalResult = mergeFloorLineIntervalsBySupport(
          direction,
          positionMm,
          buildRawFloorLineIntervals(direction, positionMm, domainCells),
          atomic,
        );
        calculationErrors.push(...intervalResult.errors.map((error) => ({ ...error, objectIds: [line.id] })));
        intervalResult.intervals.forEach((interval, pieceIndex) => {
          const startBoundaryResult = resolveFloorEndpointBoundary(atomic, direction, interval.start, positionMm, interval.slabIds);
          const endBoundaryResult = resolveFloorEndpointBoundary(atomic, direction, interval.end, positionMm, interval.slabIds);
          if (!startBoundaryResult.segment || !endBoundaryResult.segment) {
            const ambiguous = startBoundaryResult.errorCode === "bottom-endpoint-boundary-ambiguous" || endBoundaryResult.errorCode === "bottom-endpoint-boundary-ambiguous";
            calculationErrors.push({
              code: ambiguous ? "bottom-endpoint-boundary-ambiguous" : "bottom-endpoint-boundary-missing",
              message: ambiguous
                ? `地筋线“${line.id}”的端点同时命中不同支承类型，无法确定正式锚固。`
                : `地筋线“${line.id}”无法解析完整的原子边界端点。`,
              objectIds: [line.id, ...startBoundaryResult.candidateIds, ...endBoundaryResult.candidateIds],
            });
            return;
          }
          const startBoundary = startBoundaryResult.segment;
          const endBoundary = endBoundaryResult.segment;
          const startAnchorMm = anchorForSupport(startBoundary);
          const endAnchorMm = anchorForSupport(endBoundary);
          if (startAnchorMm === null || endAnchorMm === null) {
            calculationErrors.push({
              code: "bottom-continuous-endpoint",
              message: `地筋线“${line.id}”在连续板边结束，表示Domain或区间合并不完整。`,
              objectIds: [line.id, startBoundary.id, endBoundary.id],
            });
            return;
          }
          const netLengthMm = interval.end - interval.start;
          pieces.push({
            id: `${line.id}:piece:${pieceIndex + 1}:${interval.start}-${interval.end}`,
            lineId: line.id,
            domainId: domain.id,
            slabIds: [...interval.slabIds].sort(),
            layer: "bottom",
            direction,
            diameter: settings.diameter,
            spacing: settings.spacing,
            runStartMm: interval.start,
            runEndMm: interval.end,
            netLengthMm,
            startBoundaryId: startBoundary.id,
            endBoundaryId: endBoundary.id,
            startSupport: startBoundary.support,
            endSupport: endBoundary.support,
            startAnchorMm,
            endAnchorMm,
            singleLengthMm: netLengthMm + startAnchorMm + endAnchorMm,
            source: "normal",
          });
        });
      }
    });
  });
  if (calculationErrors.length > 0) return emptyCalculation(domains, calculationErrors, warnings);

  const groups = buildFloorBottomBomGroups(pieces);
  const totalLengthM = pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000, 0);
  const totalWeightKg = pieces.reduce(
    (sum, piece) => sum + (piece.singleLengthMm / 1000) * theoreticalUnitWeight(piece.diameter),
    0,
  );
  return {
    domains,
    lines,
    pieces,
    groups,
    totalBarLines: lines.length,
    totalPieces: pieces.length,
    totalLengthM,
    totalWeightKg,
    errors: [],
    warnings,
    isValid: true,
  };
}
