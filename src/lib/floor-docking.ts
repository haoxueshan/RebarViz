import {
  FLOOR_GEOMETRY_EPSILON_MM,
  findFloorSlabNearMisses,
  floorSlabsOverlap,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import { describeSlabOverlap } from "./floor-geometry-tolerance";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

export type FloorDockDirection = "west" | "east" | "south" | "north";
export type FloorDockAlignment = "preserve" | "start" | "center" | "end";

export type FloorDockRequest = {
  sourceSlabId: string;
  targetSlabId: string;
  direction: FloorDockDirection;
  alignment: FloorDockAlignment;
};

export type FloorDockPreview = {
  sourceSlabId: string;
  targetSlabId: string;
  direction: FloorDockDirection;
  alignment: FloorDockAlignment;
  sourcePreview: FloorSlab;
  x: number;
  y: number;
  moveXmm: number;
  moveYmm: number;
  valid: boolean;
  conflicts: string[];
};

export const FLOOR_DOCK_DIRECTIONS: FloorDockDirection[] = ["west", "east", "south", "north"];
export const FLOOR_DOCK_ALIGNMENTS: FloorDockAlignment[] = ["preserve", "start", "center", "end"];

export function floorDockDirectionLabel(direction: FloorDockDirection): string {
  return direction === "west" ? "西侧" : direction === "east" ? "东侧" : direction === "south" ? "南侧" : "北侧";
}

export function floorDockAlignmentLabel(alignment: FloorDockAlignment): string {
  return alignment === "preserve" ? "保持当前位置" : alignment === "start" ? "起始对齐" : alignment === "center" ? "居中" : "末端对齐";
}

/** 只计算位置，不改动任何 State；Docking 结果必须是精确 0mm 共边。 */
export function calculateFloorDockPosition(
  source: FloorSlab,
  target: FloorSlab,
  direction: FloorDockDirection,
  alignment: FloorDockAlignment,
): { x: number; y: number } {
  let x = source.x;
  let y = source.y;
  if (direction === "north") {
    y = target.y + target.height;
    if (alignment === "start") x = target.x;
    else if (alignment === "center") x = target.x + (target.width - source.width) / 2;
    else if (alignment === "end") x = target.x + target.width - source.width;
  } else if (direction === "south") {
    y = target.y - source.height;
    if (alignment === "start") x = target.x;
    else if (alignment === "center") x = target.x + (target.width - source.width) / 2;
    else if (alignment === "end") x = target.x + target.width - source.width;
  } else if (direction === "east") {
    x = target.x + target.width;
    if (alignment === "start") y = target.y;
    else if (alignment === "center") y = target.y + (target.height - source.height) / 2;
    else if (alignment === "end") y = target.y + target.height - source.height;
  } else {
    x = target.x - source.width;
    if (alignment === "start") y = target.y;
    else if (alignment === "center") y = target.y + (target.height - source.height) / 2;
    else if (alignment === "end") y = target.y + target.height - source.height;
  }
  return { x, y };
}

export function previewFloorDock(plan: FloorPlanState, request: FloorDockRequest): FloorDockPreview | null {
  const source = plan.slabs.find((slab) => slab.id === request.sourceSlabId);
  const target = plan.slabs.find((slab) => slab.id === request.targetSlabId);
  if (!source || !target || source.id === target.id) return null;
  const { x, y } = calculateFloorDockPosition(source, target, request.direction, request.alignment);
  const sourcePreview: FloorSlab = { ...source, x, y };
  const conflicts = plan.slabs
    .filter((slab) => slab.id !== source.id && slab.id !== target.id && floorSlabsOverlap(sourcePreview, slab))
    .map((slab) => slab.name);
  return {
    sourceSlabId: source.id,
    targetSlabId: target.id,
    direction: request.direction,
    alignment: request.alignment,
    sourcePreview,
    x,
    y,
    moveXmm: x - source.x,
    moveYmm: y - source.y,
    valid: conflicts.length === 0,
    conflicts,
  };
}

/** 提交拼接；与第三方冲突时保持原位置（valid=false 不写入）。 */
export function applyFloorDock(plan: FloorPlanState, request: FloorDockRequest): FloorPlanState {
  const preview = previewFloorDock(plan, request);
  if (!preview || !preview.valid) return plan;
  return {
    ...plan,
    slabs: plan.slabs.map((slab) => slab.id === preview.sourceSlabId ? preview.sourcePreview : slab),
  };
}

export type FloorMultiAlignKind = "left" | "right" | "top" | "bottom";

export type FloorMultiAlignMove = {
  slabId: string;
  x: number;
  y: number;
  moveMm: number;
};

export type FloorMultiAlignPreview = {
  kind: FloorMultiAlignKind;
  valid: boolean;
  conflicts: string[];
  movedSlabCount: number;
  maxMoveMm: number;
  moves: FloorMultiAlignMove[];
};

export function calculateFloorMultiAlignMoves(
  plan: FloorPlanState,
  slabIds: readonly string[],
  kind: FloorMultiAlignKind,
): FloorMultiAlignMove[] {
  const selected = plan.slabs.filter((slab) => slabIds.includes(slab.id));
  if (selected.length < 2) return [];
  const reference = kind === "left"
    ? Math.min(...selected.map((slab) => slab.x))
    : kind === "right"
      ? Math.max(...selected.map((slab) => slab.x + slab.width))
      : kind === "top"
        ? Math.max(...selected.map((slab) => slab.y + slab.height))
        : Math.min(...selected.map((slab) => slab.y));
  return selected.map((slab) => {
    const x = kind === "left" ? reference : kind === "right" ? reference - slab.width : slab.x;
    const y = kind === "top" ? reference - slab.height : kind === "bottom" ? reference : slab.y;
    return { slabId: slab.id, x, y, moveMm: Math.max(Math.abs(x - slab.x), Math.abs(y - slab.y)) };
  });
}

export function previewFloorMultiAlign(
  plan: FloorPlanState,
  slabIds: readonly string[],
  kind: FloorMultiAlignKind,
): FloorMultiAlignPreview {
  const moves = calculateFloorMultiAlignMoves(plan, slabIds, kind);
  if (moves.length === 0) return { kind, valid: false, conflicts: [], movedSlabCount: 0, maxMoveMm: 0, moves };
  const nextSlabs = plan.slabs.map((slab) => {
    const move = moves.find((item) => item.slabId === slab.id);
    return move ? { ...slab, x: move.x, y: move.y } : slab;
  });
  const conflicts: string[] = [];
  for (let left = 0; left < nextSlabs.length; left += 1) {
    for (let right = left + 1; right < nextSlabs.length; right += 1) {
      if (floorSlabsOverlap(nextSlabs[left], nextSlabs[right])) {
        conflicts.push(nextSlabs[left].name);
      }
    }
  }
  return {
    kind,
    valid: conflicts.length === 0,
    conflicts: [...new Set(conflicts)],
    movedSlabCount: moves.length,
    maxMoveMm: Math.max(...moves.map((move) => move.moveMm)),
    moves,
  };
}

export function applyFloorMultiAlign(
  plan: FloorPlanState,
  slabIds: readonly string[],
  kind: FloorMultiAlignKind,
): FloorPlanState {
  const preview = previewFloorMultiAlign(plan, slabIds, kind);
  if (!preview.valid || preview.moves.length === 0) return plan;
  return {
    ...plan,
    slabs: plan.slabs.map((slab) => {
      const move = preview.moves.find((item) => item.slabId === slab.id);
      return move ? { ...slab, x: move.x, y: move.y } : slab;
    }),
  };
}

export type FloorDockSuggestion = {
  kind: "near-miss" | "overlap";
  sourceSlabId: string;
  targetSlabId: string;
  direction: FloorDockDirection;
  alignment: FloorDockAlignment;
  label: string;
};

function slabName(plan: FloorPlanState, slabId: string): string {
  return plan.slabs.find((slab) => slab.id === slabId)?.name ?? slabId;
}

/**
 * 为 near-miss 与轻微重叠生成精确拼接建议；角点等无法确定方向的关系不给出唯一修复。
 * 建议方向始终以 pair 中索引靠后的板区为 Source（只移动它）。
 */
export function suggestFloorDockFixes(plan: FloorPlanState): FloorDockSuggestion[] {
  const suggestions: FloorDockSuggestion[] = [];
  findFloorSlabNearMisses(plan).forEach((nearMiss) => {
    const direction: FloorDockDirection = nearMiss.sideB === "west" ? "east"
      : nearMiss.sideB === "east" ? "west"
        : nearMiss.sideB === "south" ? "north"
          : "south";
    suggestions.push({
      kind: "near-miss",
      sourceSlabId: nearMiss.slabIds[1],
      targetSlabId: nearMiss.slabIds[0],
      direction,
      alignment: "preserve",
      label: `将${slabName(plan, nearMiss.slabIds[1])}拼到${slabName(plan, nearMiss.slabIds[0])}${floorDockDirectionLabel(direction)}`,
    });
  });
  for (let leftIndex = 0; leftIndex < plan.slabs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plan.slabs.length; rightIndex += 1) {
      const left = plan.slabs[leftIndex];
      const right = plan.slabs[rightIndex];
      const info = describeSlabOverlap(left, right);
      if (!info) continue;
      // 角点重叠（两轴都很小）无法唯一确定方向，不提供自动修复。
      if (info.overlapWidthMm <= 5 + EPSILON && info.overlapHeightMm <= 5 + EPSILON) continue;
      const shortX = info.overlapWidthMm <= info.overlapHeightMm;
      const rightCenter = shortX ? right.x + right.width / 2 : right.y + right.height / 2;
      const leftCenter = shortX ? left.x + left.width / 2 : left.y + left.height / 2;
      const direction: FloorDockDirection = shortX
        ? (rightCenter >= leftCenter ? "east" : "west")
        : (rightCenter >= leftCenter ? "south" : "north");
      suggestions.push({
        kind: "overlap",
        sourceSlabId: right.id,
        targetSlabId: left.id,
        direction,
        alignment: "preserve",
        label: `将${right.name}贴齐${left.name}至${floorDockDirectionLabel(direction)}`,
      });
    }
  }
  return suggestions;
}

export type FloorSlabSideRelation = {
  side: "west" | "east" | "south" | "north";
  label: string;
  otherSlabId: string | null;
  support: "outer-wall" | "inner-wall" | "continuous" | "opening-cut";
};

/** 描述板区四侧的位置关系（建筑外边 / 共享板边及其支承），供 Inspector“位置关系”模块展示。 */
export function describeFloorSlabSideRelations(plan: FloorPlanState, slabId: string): FloorSlabSideRelation[] {
  const slab = plan.slabs.find((item) => item.id === slabId);
  if (!slab) return [];
  const relations: FloorSlabSideRelation[] = [];
  (["west", "east", "south", "north"] as const).forEach((side) => {
    const coordinate = side === "west" ? slab.x : side === "east" ? slab.x + slab.width : side === "south" ? slab.y : slab.y + slab.height;
    const other = plan.slabs.find((candidate) => {
      if (candidate.id === slabId) return false;
      const candidateEdge = side === "west" ? candidate.x + candidate.width
        : side === "east" ? candidate.x
          : side === "south" ? candidate.y + candidate.height
            : candidate.y;
      if (Math.abs(candidateEdge - coordinate) > EPSILON) return false;
      if (side === "west" || side === "east") {
        return candidate.y < slab.y + slab.height - EPSILON && candidate.y + candidate.height > slab.y + EPSILON;
      }
      return candidate.x < slab.x + slab.width - EPSILON && candidate.x + candidate.width > slab.x + EPSILON;
    });
    if (!other) {
      relations.push({ side, label: "建筑外边", otherSlabId: null, support: "outer-wall" });
      return;
    }
    const opposite = side === "west" ? "east" : side === "east" ? "west" : side === "south" ? "north" : "south";
    const shared = plan.supportRules.find((rule) =>
      rule.target.kind === "slab-edge"
      && ((rule.target.slabId === other.id && rule.target.side === opposite) || (rule.target.slabId === slabId && rule.target.side === side)));
    const support: FloorSlabSideRelation["support"] = shared ? shared.support : "inner-wall";
    relations.push({
      side,
      label: `${other.name} · ${support === "inner-wall" ? "内墙" : "连续楼板"}`,
      otherSlabId: other.id,
      support,
    });
  });
  return relations;
}
