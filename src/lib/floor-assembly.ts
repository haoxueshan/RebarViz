import {
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import { buildCanonicalFloorSlabAdjacency } from "./floor-topology-adapter";

/**
 * Floor Assembly V1.3.1（纯派生分析层）：
 * 只分析整层板块的拓扑连接关系，不做任何 Mutation。
 *
 * - Connectivity 唯一来源：Canonical Adapter 的 shared-slab 邻接（V1 Rect Touch / V3 Connection）；
 * - inner-wall / continuous 都属于同一建筑组件；
 * - Opening 不参与组件划分；
 * - Physical Rect 接触、屏幕距离都不能当作连接依据；
 * - Near Miss / Overlap 不算连接。
 */

export type FloorAssemblyComponent = {
  id: string;
  slabIds: string[];
  slabCount: number;
  netBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  areaMm2: number;
  isPrimary: boolean;
};

export type FloorAssemblyIssue = {
  level: "info" | "warning" | "error";
  code: "disconnected-floor-component" | "isolated-slab" | "multiple-primary-components";
  message: string;
  slabIds: string[];
};

export type FloorAssembly = {
  slabCount: number;
  connectedComponentCount: number;
  components: FloorAssemblyComponent[];
  primaryComponentId: string | null;
  primarySlabIds: string[];
  disconnectedSlabIds: string[];
  issues: FloorAssemblyIssue[];
  isFullyConnected: boolean;
};

function stableOrder(plan: FloorPlanState): FloorSlab[] {
  return [...plan.slabs].sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
}

function componentKey(ids: readonly string[]): string {
  return `assembly:${[...ids].sort().join("|")}`;
}

/** 选择 Primary：板数最多 → 总净面积最大 → (minX, minY, id) 稳定排序。 */
function isBetterPrimary(
  candidate: Omit<FloorAssemblyComponent, "isPrimary">,
  current: Omit<FloorAssemblyComponent, "isPrimary">,
): boolean {
  if (candidate.slabCount !== current.slabCount) return candidate.slabCount > current.slabCount;
  if (candidate.areaMm2 !== current.areaMm2) return candidate.areaMm2 > current.areaMm2;
  if (candidate.netBounds.minX !== current.netBounds.minX) return candidate.netBounds.minX < current.netBounds.minX;
  if (candidate.netBounds.minY !== current.netBounds.minY) return candidate.netBounds.minY < current.netBounds.minY;
  return candidate.id < current.id;
}

export function buildFloorAssembly(plan: FloorPlanState): FloorAssembly {
  const slabById = new Map(plan.slabs.map((slab) => [slab.id, slab]));
  const adjacency = new Map<string, Set<string>>(plan.slabs.map((slab) => [slab.id, new Set<string>()]));
  // Canonical Adjacency：V1 走 Legacy Rect Touch，V3 走 FloorEdgeConnection（240 Gap 仍属同一组件）。
  buildCanonicalFloorSlabAdjacency(plan).forEach(({ slabIds: [left, right] }) => {
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  });

  const visited = new Set<string>();
  const raw: Omit<FloorAssemblyComponent, "isPrimary">[] = [];
  stableOrder(plan).forEach((slab) => {
    if (visited.has(slab.id)) return;
    const queue = [slab.id];
    const members: string[] = [];
    visited.add(slab.id);
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      members.push(currentId);
      adjacency.get(currentId)?.forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push(nextId);
      });
    }
    members.sort((left, right) => {
      const leftSlab = slabById.get(left);
      const rightSlab = slabById.get(right);
      if (!leftSlab || !rightSlab) return left.localeCompare(right);
      return leftSlab.x - rightSlab.x || leftSlab.y - rightSlab.y || left.localeCompare(right);
    });
    const netBounds = members.reduce((bounds, id) => {
      const item = slabById.get(id);
      if (!item) return bounds;
      return {
        minX: Math.min(bounds.minX, item.x),
        minY: Math.min(bounds.minY, item.y),
        maxX: Math.max(bounds.maxX, item.x + item.width),
        maxY: Math.max(bounds.maxY, item.y + item.height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const areaMm2 = members.reduce((sum, id) => {
      const item = slabById.get(id);
      return sum + (item ? item.width * item.height : 0);
    }, 0);
    raw.push({
      id: componentKey(members),
      slabIds: members,
      slabCount: members.length,
      netBounds,
      areaMm2,
    });
  });

  raw.sort((left, right) =>
    right.slabCount - left.slabCount
    || right.areaMm2 - left.areaMm2
    || left.netBounds.minX - right.netBounds.minX
    || left.netBounds.minY - right.netBounds.minY
    || left.id.localeCompare(right.id));

  const primary = raw.length > 0 ? raw.reduce((best, candidate) => (isBetterPrimary(candidate, best) ? candidate : best), raw[0]) : null;
  const components: FloorAssemblyComponent[] = raw.map((component) => ({
    ...component,
    isPrimary: primary ? component.id === primary.id : false,
  }));
  const primarySlabIds = primary ? [...primary.slabIds] : [];
  const disconnectedSlabIds = plan.slabs
    .filter((slab) => !primarySlabIds.includes(slab.id))
    .map((slab) => slab.id)
    .sort((left, right) => {
      const leftSlab = slabById.get(left);
      const rightSlab = slabById.get(right);
      if (!leftSlab || !rightSlab) return left.localeCompare(right);
      return leftSlab.x - rightSlab.x || leftSlab.y - rightSlab.y || left.localeCompare(right);
    });
  const isFullyConnected = plan.slabs.length <= 1 || disconnectedSlabIds.length === 0;

  const issues: FloorAssemblyIssue[] = [];
  if (!isFullyConnected) {
    issues.push({
      level: "warning",
      code: "disconnected-floor-component",
      message: `${disconnectedSlabIds.length}个板区尚未连接到整层主体。`,
      slabIds: [...disconnectedSlabIds],
    });
  }
  components.forEach((component) => {
    if (!component.isPrimary && component.slabCount === 1 && plan.slabs.length > 1) {
      issues.push({
        level: "warning",
        code: "isolated-slab",
        message: `板区 ${component.slabIds.map((id) => slabById.get(id)?.name ?? id).join("、")} 是孤立板区，尚未与整层连接。`,
        slabIds: [...component.slabIds],
      });
    }
  });
  issues.sort((left, right) =>
    left.level.localeCompare(right.level)
    || left.code.localeCompare(right.code)
    || left.slabIds.join("|").localeCompare(right.slabIds.join("|")));

  return {
    slabCount: plan.slabs.length,
    connectedComponentCount: components.length,
    components,
    primaryComponentId: primary?.id ?? null,
    primarySlabIds,
    disconnectedSlabIds,
    issues,
    isFullyConnected,
  };
}
