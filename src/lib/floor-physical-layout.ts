import {
  buildFloorAtomicBoundarySegments,
  resolveFloorBoundarySupportDetails,
  type FloorOpening,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSlab,
} from "./floor-plan";
import {
  buildFloorTopologyExteriorRanges,
  solveFloorTopology,
  type FloorTopologySolution,
} from "./floor-topology-solver";

/**
 * Floor Physical Wall Layout V1.3（纯派生显示层）：
 * - Legacy net-layout-v1：把净跨拓扑坐标映射到真实建筑物理平面。
 * - V3 clear-space-physical-v2：直接消费 Solved Clear Slabs / Walls，禁止再次增加墙偏移。
 *
 * 关键不变量：
 * 1. 本模块只返回派生副本，禁止写回 FloorPlanState；
 * 2. 本模块是纯函数，无 React / DOM / localStorage / 副作用；
 * 3. 墙体是唯一 Geometry 来源（Canvas 与 Print 共用）；
 * 4. Legacy 钢筋坐标需要显示映射；V3 钢筋坐标已经是 Physical，不得二次映射。
 */

const EPSILON = 1e-4;

export type FloorPhysicalSlab = {
  slabId: string;
  /** 原净跨位置 */
  netX: number;
  netY: number;
  /** 物理显示位置 */
  x: number;
  y: number;
  /** 净房间尺寸不变 */
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export type FloorPhysicalOpening = {
  openingId: string;
  netX: number;
  netY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

export type FloorPhysicalWall = {
  id: string;
  kind: "inner-wall" | "outer-wall";
  orientation: "horizontal" | "vertical";
  x: number;
  y: number;
  width: number;
  height: number;
  lengthMm: number;
  thicknessMm: number;
  slabIds: string[];
  sourceAtomicIds: string[];
  side?: "west" | "east" | "south" | "north";
};

export type FloorPhysicalLayoutIssue = {
  level: "warning" | "error";
  code: string;
  message: string;
  slabIds?: string[];
  atomicIds?: string[];
};

export type FloorPhysicalLayout = {
  slabs: FloorPhysicalSlab[];
  openings: FloorPhysicalOpening[];
  walls: FloorPhysicalWall[];
  /** 完整物理范围：板区 + 洞口 + 墙（含外墙）。 */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** 默认楼板取景范围：板区 + 墙（不含远端异常洞口）。 */
  floorBounds: { minX: number; minY: number; maxX: number; maxY: number };
  issues: FloorPhysicalLayoutIssue[];
};

type ConstraintEdge = {
  lowId: string;
  highId: string;
  gap: number;
};

type PairBand = {
  lowId: string;
  highId: string;
  orientation: "vertical" | "horizontal";
  gap: number;
  hasInner: boolean;
  hasContinuous: boolean;
};

function slabIndex(plan: FloorPlanState): Map<string, FloorSlab> {
  return new Map(plan.slabs.map((slab) => [slab.id, slab]));
}

function segmentSupportKinds(segment: { geometryKind: "shared-slab" | "building-exterior" | "opening-edge"; targets: FloorPlanState["supportRules"][number]["target"][]; }, plan: FloorPlanState): Set<FloorResolvedSupport> {
  const details = resolveFloorBoundarySupportDetails(segment.geometryKind, segment.targets, plan);
  if (details.conflictingSupports.length > 0) return new Set(details.conflictingSupports);
  return new Set([details.support]);
}

function unionBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  rect: { x: number; y: number; width: number; height: number },
) {
  bounds.minX = Math.min(bounds.minX, rect.x);
  bounds.minY = Math.min(bounds.minY, rect.y);
  bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
  bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
  return bounds;
}

function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function finalizeBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return bounds;
}

/**
 * 从 Atomic Boundary 提取 X/Y 轴约束。
 * - vertical shared 段 → X 约束：east.physicalX = west.physicalX + west.width + gap
 * - horizontal shared 段 → Y 约束：north.physicalY = south.physicalY + south.height + gap
 * 同一 slab pair + 方向存在 inner-wall 段时按内墙厚建带；全部 continuous 则 gap=0。
 */
function buildConstraintEdges(plan: FloorPlanState): { x: ConstraintEdge[]; y: ConstraintEdge[]; bands: PairBand[] } {
  const atomic = buildFloorAtomicBoundarySegments(plan);
  const byId = slabIndex(plan);
  const groups = new Map<string, {
    orientation: "vertical" | "horizontal";
    lowId: string;
    highId: string;
    hasInner: boolean;
    hasContinuous: boolean;
  }>();

  atomic.filter((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.length >= 2).forEach((segment) => {
    const [firstId, secondId] = segment.slabIds;
    const first = byId.get(firstId);
    const second = byId.get(secondId);
    if (!first || !second) return;
    const kinds = segmentSupportKinds(segment, plan);
    const hasInner = kinds.has("inner-wall");
    const hasContinuous = kinds.has("continuous");
    if (segment.orientation === "vertical") {
      const coordinate = segment.startX;
      const firstIsWest = Math.abs(first.x + first.width - coordinate) <= EPSILON && Math.abs(second.x - coordinate) <= EPSILON;
      const lowId = firstIsWest ? firstId : secondId;
      const highId = firstIsWest ? secondId : firstId;
      const key = `${lowId}|${highId}|v`;
      const group = groups.get(key) ?? { orientation: "vertical" as const, lowId, highId, hasInner: false, hasContinuous: false };
      group.hasInner = group.hasInner || hasInner;
      group.hasContinuous = group.hasContinuous || hasContinuous;
      groups.set(key, group);
      return;
    }
    const coordinate = segment.startY;
    const firstIsSouth = Math.abs(first.y + first.height - coordinate) <= EPSILON && Math.abs(second.y - coordinate) <= EPSILON;
    const lowId = firstIsSouth ? firstId : secondId;
    const highId = firstIsSouth ? secondId : firstId;
    const key = `${lowId}|${highId}|h`;
    const group = groups.get(key) ?? { orientation: "horizontal" as const, lowId, highId, hasInner: false, hasContinuous: false };
    group.hasInner = group.hasInner || hasInner;
    group.hasContinuous = group.hasContinuous || hasContinuous;
    groups.set(key, group);
  });

  const bands: PairBand[] = [];
  const xEdges: ConstraintEdge[] = [];
  const yEdges: ConstraintEdge[] = [];
  groups.forEach((group) => {
    const gap = group.hasInner ? Math.max(plan.innerWallThickness, 0) : 0;
    const band: PairBand = {
      lowId: group.lowId,
      highId: group.highId,
      orientation: group.orientation,
      gap,
      hasInner: group.hasInner,
      hasContinuous: group.hasContinuous,
    };
    bands.push(band);
    const edge: ConstraintEdge = { lowId: group.lowId, highId: group.highId, gap };
    (group.orientation === "vertical" ? xEdges : yEdges).push(edge);
  });
  bands.sort((left, right) => left.lowId.localeCompare(right.lowId) || left.highId.localeCompare(right.highId));
  xEdges.sort((left, right) => left.lowId.localeCompare(right.lowId) || left.highId.localeCompare(right.highId) || left.gap - right.gap);
  yEdges.sort((left, right) => left.lowId.localeCompare(right.lowId) || left.highId.localeCompare(right.highId) || left.gap - right.gap);
  return { x: xEdges, y: yEdges, bands };
}

/**
 * 单轴约束图求解：
 * - 每个连通分量选择 (net坐标, id) 稳定排序后的第一个板区作为 Anchor（physical = net）；
 * - BFS 传播约束，检测环冲突（不覆盖已有值，报 issue 并保持 best-effort 结果）。
 */
function solveAxis(
  axis: "x" | "y",
  edges: ConstraintEdge[],
  slabs: FloorSlab[],
  issues: FloorPhysicalLayoutIssue[],
): Map<string, number> {
  const sizeOf = (slab: FloorSlab) => (axis === "x" ? slab.width : slab.height);
  const netOf = (slab: FloorSlab) => (axis === "x" ? slab.x : slab.y);
  const byId = new Map(slabs.map((slab) => [slab.id, slab]));
  const adjacency = new Map<string, Array<{ toId: string; delta: number }>>();
  const add = (fromId: string, toId: string, delta: number) => {
    const list = adjacency.get(fromId) ?? [];
    list.push({ toId, delta });
    adjacency.set(fromId, list);
  };
  edges.forEach((edge) => {
    const low = byId.get(edge.lowId);
    const high = byId.get(edge.highId);
    if (!low || !high) return;
    // low→high：high = low + low.size + gap；high→low：low = high - low.size - gap（目标侧尺寸）。
    add(edge.lowId, edge.highId, sizeOf(low) + edge.gap);
    add(edge.highId, edge.lowId, -(sizeOf(low) + edge.gap));
  });
  adjacency.forEach((list) => list.sort((left, right) => left.delta - right.delta || left.toId.localeCompare(right.toId)));

  const assigned = new Map<string, number>();
  const componentOf = (startId: string): string[] => {
    const seen = new Set<string>([startId]);
    const queue = [startId];
    const members = [startId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      (adjacency.get(currentId) ?? []).forEach((edge) => {
        if (seen.has(edge.toId)) return;
        seen.add(edge.toId);
        members.push(edge.toId);
        queue.push(edge.toId);
      });
    }
    return members;
  };
  const orderedSlabs = [...slabs].sort((left, right) => netOf(left) - netOf(right) || left.y - right.y || left.id.localeCompare(right.id));

  orderedSlabs.forEach((slab) => {
    if (assigned.has(slab.id)) return;
    const members = componentOf(slab.id);
    members.sort((left, right) => {
      const leftSlab = byId.get(left);
      const rightSlab = byId.get(right);
      if (!leftSlab || !rightSlab) return left.localeCompare(right);
      return netOf(leftSlab) - netOf(rightSlab) || left.localeCompare(right);
    });
    const anchorId = members[0];
    const anchor = byId.get(anchorId);
    if (!anchor) return;
    assigned.set(anchorId, netOf(anchor));
    const queue = [anchorId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentValue = assigned.get(currentId)!;
      (adjacency.get(currentId) ?? []).forEach((edge) => {
        const candidate = currentValue + edge.delta;
        const existing = assigned.get(edge.toId);
        if (existing === undefined) {
          assigned.set(edge.toId, candidate);
          queue.push(edge.toId);
          return;
        }
        if (Math.abs(existing - candidate) > EPSILON) {
          issues.push({
            level: "error",
            code: "physical-layout-constraint-conflict",
            message: `物理布局约束冲突：板区 ${edge.toId} 在 ${axis === "x" ? "X" : "Y"} 方向得到 ${formatConflictMm(existing)}mm 与 ${formatConflictMm(candidate)}mm 两个不一致位置，已保留第一个确定值。`,
            slabIds: [edge.toId],
          });
        }
      });
    }
  });
  return assigned;
}

function formatConflictMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function physicalSlabPositions(plan: FloorPlanState, xMap: Map<string, number>, yMap: Map<string, number>): FloorPhysicalSlab[] {
  return plan.slabs.map((slab) => ({
    slabId: slab.id,
    netX: slab.x,
    netY: slab.y,
    x: xMap.get(slab.id) ?? slab.x,
    y: yMap.get(slab.id) ?? slab.y,
    width: slab.width,
    height: slab.height,
    offsetX: (xMap.get(slab.id) ?? slab.x) - slab.x,
    offsetY: (yMap.get(slab.id) ?? slab.y) - slab.y,
  })).sort((left, right) => left.x - right.x || left.y - right.y || left.slabId.localeCompare(right.slabId));
}

function buildInnerWalls(
  plan: FloorPlanState,
  physicalBySlab: Map<string, FloorPhysicalSlab>,
): { walls: FloorPhysicalWall[]; atomicIds: Set<string> } {
  const byId = slabIndex(plan);
  const walls: FloorPhysicalWall[] = [];
  const atomicIds = new Set<string>();
  const thickness = plan.innerWallThickness;
  if (thickness <= EPSILON) return { walls, atomicIds };
  buildFloorAtomicBoundarySegments(plan)
    .filter((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.length >= 2)
    .forEach((segment) => {
      const kinds = segmentSupportKinds(segment, plan);
      if (!kinds.has("inner-wall")) return;
      const [firstId, secondId] = segment.slabIds;
      const first = byId.get(firstId);
      const second = byId.get(secondId);
      const firstPhys = physicalBySlab.get(firstId);
      const secondPhys = physicalBySlab.get(secondId);
      if (!first || !second || !firstPhys || !secondPhys) return;
      if (segment.orientation === "vertical") {
        const coordinate = segment.startX;
        const firstIsWest = Math.abs(first.x + first.width - coordinate) <= EPSILON && Math.abs(second.x - coordinate) <= EPSILON;
        const west = firstIsWest ? first : second;
        const east = firstIsWest ? second : first;
        const westPhys = firstIsWest ? firstPhys : secondPhys;
        const x = westPhys.x + west.width;
        const y = westPhys.y + (segment.startY - west.y);
        walls.push({
          id: `wall:inner:${segment.id}`,
          kind: "inner-wall",
          orientation: "vertical",
          x,
          y,
          width: thickness,
          height: segment.endY - segment.startY,
          lengthMm: segment.endY - segment.startY,
          thicknessMm: thickness,
          slabIds: [west.id, east.id],
          sourceAtomicIds: [segment.id],
          side: "east",
        });
        atomicIds.add(segment.id);
        return;
      }
      const coordinate = segment.startY;
      const firstIsSouth = Math.abs(first.y + first.height - coordinate) <= EPSILON && Math.abs(second.y - coordinate) <= EPSILON;
      const south = firstIsSouth ? first : second;
      const north = firstIsSouth ? second : first;
      const southPhys = firstIsSouth ? firstPhys : secondPhys;
      const y = southPhys.y + south.height;
      const x = southPhys.x + (segment.startX - south.x);
      walls.push({
        id: `wall:inner:${segment.id}`,
        kind: "inner-wall",
        orientation: "horizontal",
        x,
        y,
        width: segment.endX - segment.startX,
        height: thickness,
        lengthMm: segment.endX - segment.startX,
        thicknessMm: thickness,
        slabIds: [south.id, north.id],
        sourceAtomicIds: [segment.id],
        side: "north",
      });
      atomicIds.add(segment.id);
    });
  walls.sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
  return { walls, atomicIds };
}

function buildOuterWalls(
  plan: FloorPlanState,
  physicalBySlab: Map<string, FloorPhysicalSlab>,
): FloorPhysicalWall[] {
  const byId = slabIndex(plan);
  const walls: FloorPhysicalWall[] = [];
  const thickness = plan.outerWallThickness;
  if (thickness <= EPSILON) return walls;
  buildFloorAtomicBoundarySegments(plan)
    .filter((segment) => segment.geometryKind === "building-exterior" && segment.slabIds.length === 1)
    .forEach((segment) => {
      const owner = byId.get(segment.slabIds[0]);
      const ownerPhys = physicalBySlab.get(segment.slabIds[0]);
      if (!owner || !ownerPhys) return;
      const kind: FloorPhysicalWall["kind"] = "outer-wall";
      if (segment.orientation === "vertical") {
        const coordinate = segment.startX;
        const isWest = Math.abs(owner.x - coordinate) <= EPSILON;
        const x = isWest ? ownerPhys.x - thickness : ownerPhys.x + owner.width;
        walls.push({
          id: `wall:outer:${segment.id}`,
          kind,
          orientation: "vertical",
          x,
          y: ownerPhys.y + (segment.startY - owner.y),
          width: thickness,
          height: segment.endY - segment.startY,
          lengthMm: segment.endY - segment.startY,
          thicknessMm: thickness,
          slabIds: [owner.id],
          sourceAtomicIds: [segment.id],
          side: isWest ? "west" : "east",
        });
        return;
      }
      const coordinate = segment.startY;
      const isSouth = Math.abs(owner.y - coordinate) <= EPSILON;
      const y = isSouth ? ownerPhys.y - thickness : ownerPhys.y + owner.height;
      walls.push({
        id: `wall:outer:${segment.id}`,
        kind,
        orientation: "horizontal",
        x: ownerPhys.x + (segment.startX - owner.x),
        y,
        width: segment.endX - segment.startX,
        height: thickness,
        lengthMm: segment.endX - segment.startX,
        thicknessMm: thickness,
        slabIds: [owner.id],
        sourceAtomicIds: [segment.id],
        side: isSouth ? "south" : "north",
      });
    });
  walls.sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
  return walls;
}

function buildPhysicalOpenings(
  plan: FloorPlanState,
  physicalBySlab: Map<string, FloorPhysicalSlab>,
  issues: FloorPhysicalLayoutIssue[],
): FloorPhysicalOpening[] {
  const orderedSlabs = [...plan.slabs].sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
  return plan.openings.map((opening: FloorOpening): FloorPhysicalOpening => {
    const hosts = orderedSlabs.filter((slab) =>
      opening.x >= slab.x - EPSILON && opening.x + opening.width <= slab.x + slab.width + EPSILON
      && opening.y >= slab.y - EPSILON && opening.y + opening.height <= slab.y + slab.height + EPSILON);
    const host = hosts[0];
    if (hosts.length > 1) {
      issues.push({
        level: "warning",
        code: "physical-opening-host-ambiguous",
        message: `洞口 ${opening.name} 同时属于 ${hosts.length} 个板区，物理显示使用 ${host.name} 的偏移。`,
        slabIds: hosts.map((slab) => slab.id),
      });
    }
    if (!host) {
      return { openingId: opening.id, netX: opening.x, netY: opening.y, x: opening.x, y: opening.y, width: opening.width, height: opening.height, offsetX: 0, offsetY: 0 };
    }
    const phys = physicalBySlab.get(host.id);
    const offsetX = phys?.offsetX ?? 0;
    const offsetY = phys?.offsetY ?? 0;
    return {
      openingId: opening.id,
      netX: opening.x,
      netY: opening.y,
      x: opening.x + offsetX,
      y: opening.y + offsetY,
      width: opening.width,
      height: opening.height,
      offsetX,
      offsetY,
    };
  }).sort((left, right) => left.x - right.x || left.y - right.y || left.openingId.localeCompare(right.openingId));
}

/** 主入口：由 FloorPlanState 确定性派生真实物理平面。 */
export function buildFloorPhysicalLayout(
  plan: FloorPlanState,
  precomputedSolution?: FloorTopologySolution,
): FloorPhysicalLayout {
  // Plan V3（clear-space-physical-v2）：物理布局来自 Topology Solver；
  // Slab 位置已经是求解后的 Clear Space 物理位置，禁止再次加墙偏移（避免墙厚×2）。
  if (plan.coordinateModel === "clear-space-physical-v2") {
    return buildFloorPhysicalLayoutFromTopology(
      plan,
      precomputedSolution ?? solveFloorTopology(plan),
    );
  }
  const issues: FloorPhysicalLayoutIssue[] = [];
  const { x, y, bands } = buildConstraintEdges(plan);
  const xMap = solveAxis("x", x, plan.slabs, issues);
  const yMap = solveAxis("y", y, plan.slabs, issues);
  const slabs = physicalSlabPositions(plan, xMap, yMap);
  const physicalBySlab = new Map(slabs.map((slab) => [slab.slabId, slab]));

  // 环/并行路径约束不一致会表现为物理板区重叠：报告约束冲突但保持 best-effort 布局。
  for (let leftIndex = 0; leftIndex < slabs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < slabs.length; rightIndex += 1) {
      const left = slabs[leftIndex];
      const right = slabs[rightIndex];
      const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      if (overlapX <= EPSILON || overlapY <= EPSILON) continue;
      issues.push({
        level: "error",
        code: "physical-layout-constraint-conflict",
        message: `物理布局约束冲突：板区 ${left.slabId} 与 ${right.slabId} 展开墙体后发生 ${formatConflictMm(Math.min(overlapX, overlapY))}mm 物理重叠，已保留确定性的 best-effort 布局。`,
        slabIds: [left.slabId, right.slabId],
      });
    }
  }

  bands.forEach((band) => {
    if (!band.hasInner || !band.hasContinuous) return;
    issues.push({
      level: "warning",
      code: "mixed-shared-boundary-band",
      message: `${band.orientation === "vertical" ? "东西" : "南北"}相邻板区 ${band.lowId} 与 ${band.highId} 的共享边同时包含内墙与连续段：按内墙建立 ${formatConflictMm(band.gap)}mm 墙带，连续段显示为墙带中的开口。`,
      slabIds: [band.lowId, band.highId],
    });
  });

  const inner = buildInnerWalls(plan, physicalBySlab);
  const walls = [...inner.walls, ...buildOuterWalls(plan, physicalBySlab)];
  const openings = buildPhysicalOpenings(plan, physicalBySlab, issues);

  const floorBounds = finalizeBounds(slabs.reduce(
    (bounds, slab) => unionBounds(bounds, slab),
    emptyBounds(),
  ));
  walls.forEach((wall) => unionBounds(floorBounds, wall));
  const bounds = finalizeBounds(
    openings.reduce((current, opening) => unionBounds(current, opening), { ...floorBounds }),
  );

  issues.sort((left, right) => left.level.localeCompare(right.level) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));

  return {
    slabs,
    openings,
    walls,
    bounds,
    floorBounds,
    issues,
  };
}

/**
 * Plan V3 物理布局 Adapter：直接消费 Topology Solver 的 Solved Clear Slabs 与 Wall Bands。
 * 禁止二次加 240 偏移（墙厚只由 Solver 插入一次）。
 */
function buildFloorPhysicalLayoutFromTopology(
  plan: FloorPlanState,
  solution: FloorTopologySolution,
): FloorPhysicalLayout {
  const issues: FloorPhysicalLayoutIssue[] = solution.issues.map((issue) => ({
    level: issue.level,
    code: issue.code,
    message: issue.message,
    slabIds: issue.slabIds,
    atomicIds: issue.connectionIds,
  }));
  const slabs: FloorPhysicalSlab[] = solution.slabs.map((item) => ({
    slabId: item.slabId,
    netX: item.sourceX,
    netY: item.sourceY,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    offsetX: item.offsetX,
    offsetY: item.offsetY,
  }));
  const walls: FloorPhysicalWall[] = solution.walls.map((wall) => ({
    id: wall.id,
    kind: "inner-wall",
    orientation: wall.orientation,
    x: wall.x,
    y: wall.y,
    width: wall.width,
    height: wall.height,
    lengthMm: wall.lengthMm,
    thicknessMm: wall.thicknessMm,
    slabIds: wall.slabIds,
    sourceAtomicIds: [`atomic:v3:${wall.connectionId}`],
  }));
  // 外墙：与 Atomic V3 共用同一区间减法结果（Partial Side 可生成多段 outer-wall）。
  const thicknessMm = Math.max(plan.outerWallThickness, 0);
  const slabsByPhysicalId = new Map(slabs.map((slab) => [slab.slabId, slab]));
  if (thicknessMm > EPSILON) {
    const exteriorIndex = new Map<string, number>();
    buildFloorTopologyExteriorRanges(plan, solution).forEach((range) => {
      const slab = slabsByPhysicalId.get(range.slabId);
      if (!slab) return;
      const key = `${range.slabId}:${range.side}`;
      const index = exteriorIndex.get(key) ?? 0;
      exteriorIndex.set(key, index + 1);
      if (range.orientation === "vertical") {
        const x = range.side === "west" ? slab.x - thicknessMm : slab.x + slab.width;
        walls.push({
          id: `outer-v3:${range.slabId}:${range.side}:${index}`,
          kind: "outer-wall",
          orientation: "vertical",
          x,
          y: slab.y + range.startMm,
          width: thicknessMm,
          height: range.endMm - range.startMm,
          lengthMm: range.endMm - range.startMm,
          thicknessMm,
          slabIds: [range.slabId],
          sourceAtomicIds: [`atomic:v3:exterior:${range.slabId}:${range.side}:${index}`],
          side: range.side,
        });
        return;
      }
      const y = range.side === "south" ? slab.y - thicknessMm : slab.y + slab.height;
      walls.push({
        id: `outer-v3:${range.slabId}:${range.side}:${index}`,
        kind: "outer-wall",
        orientation: "horizontal",
        x: slab.x + range.startMm,
        y,
        width: range.endMm - range.startMm,
        height: thicknessMm,
        lengthMm: range.endMm - range.startMm,
        thicknessMm,
        slabIds: [range.slabId],
        sourceAtomicIds: [`atomic:v3:exterior:${range.slabId}:${range.side}:${index}`],
        side: range.side,
      });
    });
  }
  walls.sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id));
  const openings: FloorPhysicalOpening[] = plan.openings.map((opening) => ({
    openingId: opening.id,
    netX: opening.x,
    netY: opening.y,
    x: opening.x,
    y: opening.y,
    width: opening.width,
    height: opening.height,
    offsetX: 0,
    offsetY: 0,
  }));
  const floorBounds = finalizeBounds(slabs.reduce((bounds, slab) => unionBounds(bounds, slab), emptyBounds()));
  walls.forEach((wall) => unionBounds(floorBounds, wall));
  const bounds = finalizeBounds(
    openings.reduce((current, opening) => unionBounds(current, opening), { ...floorBounds }),
  );
  issues.sort((left, right) => left.level.localeCompare(right.level) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  return { slabs, openings, walls, bounds, floorBounds, issues };
}

/**
 * 单轴净坐标 → 物理坐标映射（Piece / Boundary 显示适配用）：
 * - 点在某个板区净范围内：该板区 offset + 局部 1:1；
 * - 共享边（多板区同时包含）：优先使用 preferSlabIds 中的板区；
 * - 建筑外侧（锚固延伸区）：相对最外板区 1:1 延伸。
 */
export function mapFloorNetAxisPoint(
  axis: "x" | "y",
  net: number,
  plan: Pick<FloorPlanState, "slabs">,
  layout: Pick<FloorPhysicalLayout, "slabs">,
  preferSlabIds?: readonly string[],
): number {
  const axisKey = axis === "x" ? "x" : "y";
  const sizeKey = axis === "x" ? "width" : "height";
  const ordered = [...plan.slabs].sort((left, right) => left[axisKey] - right[axisKey] || left.id.localeCompare(right.id));
  const physical = new Map(layout.slabs.map((slab) => [slab.slabId, slab]));
  const containing = ordered.filter((slab) => net >= slab[axisKey] - EPSILON && net <= slab[axisKey] + slab[sizeKey] + EPSILON);
  const prefer = preferSlabIds?.length ? containing.filter((slab) => preferSlabIds.includes(slab.id)) : [];
  const pool = prefer.length > 0 ? prefer : containing;
  if (pool.length > 0) {
    const pick = pool.sort((left, right) => left[axisKey] - right[axisKey] || left.id.localeCompare(right.id))[0];
    const phys = physical.get(pick.id);
    if (phys) return phys[axisKey] + (net - pick[axisKey]);
  }
  if (ordered.length === 0) return net;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstPhys = physical.get(first.id);
  const lastPhys = physical.get(last.id);
  if (firstPhys && net < first[axisKey]) return firstPhys[axisKey] - (first[axisKey] - net);
  if (lastPhys && net > last[axisKey] + last[sizeKey]) return lastPhys[axisKey] + last[sizeKey] + (net - (last[axisKey] + last[sizeKey]));
  // 板区之间的空区（无墙）：以左侧最近板区 1:1 延伸。
  let nearest: FloorSlab | undefined;
  ordered.forEach((slab) => {
    if (slab[axisKey] <= net + EPSILON) nearest = slab;
  });
  if (!nearest) return net;
  const nearestPhys = physical.get(nearest.id);
  if (!nearestPhys) return net;
  return nearestPhys[axisKey] + nearest[sizeKey] + (net - (nearest[axisKey] + nearest[sizeKey]));
}

/** 两个板区之间当前解析出的共享带：物理 gap、是否含内墙/连续段。 */
export function floorPhysicalSharedBand(
  plan: FloorPlanState,
  slabIdA: string,
  slabIdB: string,
): { gapMm: number; hasInner: boolean; hasContinuous: boolean; atomicIds: string[] } {
  const atomicIds: string[] = [];
  let hasInner = false;
  let hasContinuous = false;
  buildFloorAtomicBoundarySegments(plan)
    .filter((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.includes(slabIdA) && segment.slabIds.includes(slabIdB))
    .forEach((segment) => {
      const kinds = segmentSupportKinds(segment, plan);
      if (kinds.has("inner-wall")) hasInner = true;
      if (kinds.has("continuous")) hasContinuous = true;
      atomicIds.push(segment.id);
    });
  const gapMm = hasInner ? Math.max(plan.innerWallThickness, 0) : 0;
  return { gapMm, hasInner, hasContinuous, atomicIds: atomicIds.sort() };
}
