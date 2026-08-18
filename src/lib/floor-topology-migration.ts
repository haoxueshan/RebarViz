import {
  buildFloorAtomicBoundarySegments,
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import {
  stableFloorConnectionId,
  type FloorEdgeConnection,
  type FloorTangentConstraint,
} from "./floor-topology";
import { solveFloorTopology } from "./floor-topology-solver";

/**
 * Floor Topology V1.4A Legacy Migration：Plan V2（net-layout-v1）→ Plan V3（clear-space-physical-v2）。
 *
 * - Step 1：Legacy Exact Shared Edge（geometryKind=shared-slab）→ FloorEdgeConnection。
 *   Full-Full 连接自动锁切向（lock-start 0）；Partial 连接切向保持自由（mode=none）。
 * - Step 2：Wall Band Candidate：Gap ≈ innerWallThickness 且不被第三板占据 →
 *   legacy-wall-gap 连接；加入前必须通过 Solver 验证（无 constraint conflict 才确认）。
 * - 迁移使用 wall gap 推断（Gap ≈ 墙厚），绝不使用 snapDistanceMm（可能被用户设为 1500）。
 * - Slab IDs / 净尺寸 / supportRules / 全局设置全部原样保留。
 */
const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
const MIN_WALL_GAP_OVERLAP_MM = 50;

type RectLike = { x: number; y: number; width: number; height: number };

function rectsOverlap(left: RectLike, right: RectLike): boolean {
  return left.x < right.x + right.width - EPSILON
    && left.x + left.width > right.x + EPSILON
    && left.y < right.y + right.height - EPSILON
    && left.y + left.height > right.y + EPSILON;
}

export type FloorTopologyMigrationReport = {
  exactSharedConnections: number;
  wallGapConnections: number;
  warnings: string[];
};

type LegacySharedGroup = {
  slabIdA: string;
  slabIdB: string;
  sideA: FloorEdgeSide;
  sideB: FloorEdgeSide;
  /** 该 Side Pair 的共享段在 A 边上的累计覆盖长度。 */
  coverageOnA: number;
  coverageOnB: number;
};

function slabById(plan: FloorPlanState): Map<string, FloorSlab> {
  return new Map(plan.slabs.map((slab) => [slab.id, slab]));
}

function edgeSideOfSharedSegment(
  plan: FloorPlanState,
  segment: { slabIds: string[]; startX: number; startY: number; endX: number; endY: number },
): { sideA: FloorEdgeSide; sideB: FloorEdgeSide; tangentialStart: number; tangentialEnd: number } | null {
  const [leftId, rightId] = segment.slabIds;
  const slabs = slabById(plan);
  const left = slabs.get(leftId);
  const right = slabs.get(rightId);
  if (!left || !right) return null;
  const vertical = segment.startX === segment.endX;
  if (vertical) {
    const leftOfRight = left.x + left.width <= right.x + EPSILON;
    const westSlab = leftOfRight ? left : right;
    const eastSlab = leftOfRight ? right : left;
    return {
      sideA: westSlab.id === leftId ? "east" : "west",
      sideB: eastSlab.id === leftId ? "east" : "west",
      tangentialStart: Math.min(segment.startY, segment.endY),
      tangentialEnd: Math.max(segment.startY, segment.endY),
    };
  }
  const southOfNorth = left.y + left.height <= right.y + EPSILON;
  const southSlab = southOfNorth ? left : right;
  const northSlab = southOfNorth ? right : left;
  return {
    sideA: southSlab.id === leftId ? "north" : "south",
    sideB: northSlab.id === leftId ? "north" : "south",
    tangentialStart: Math.min(segment.startX, segment.endX),
    tangentialEnd: Math.max(segment.startX, segment.endX),
  };
}

function groupExactSharedEdges(plan: FloorPlanState): LegacySharedGroup[] {
  const groups = new Map<string, LegacySharedGroup>();
  buildFloorAtomicBoundarySegments(plan)
    .filter((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.length === 2)
    .forEach((segment) => {
      const side = edgeSideOfSharedSegment(plan, segment);
      if (!side) return;
      const [leftId, rightId] = [...segment.slabIds].sort();
      const key = `${leftId}|${leftId === segment.slabIds[0] ? side.sideA : side.sideB}|${rightId}|${rightId === segment.slabIds[1] ? side.sideB : side.sideA}`;
      const current = groups.get(key) ?? {
        slabIdA: leftId,
        slabIdB: rightId,
        sideA: leftId === segment.slabIds[0] ? side.sideA : side.sideB,
        sideB: rightId === segment.slabIds[0] ? side.sideA : side.sideB,
        coverageOnA: 0,
        coverageOnB: 0,
      };
      current.coverageOnA += side.tangentialEnd - side.tangentialStart;
      current.coverageOnB += side.tangentialEnd - side.tangentialStart;
      groups.set(key, current);
    });
  return [...groups.values()];
}

function sideLength(slab: FloorSlab, side: FloorEdgeSide): number {
  return side === "west" || side === "east" ? slab.height : slab.width;
}

/** Full-Full：共享边覆盖两侧完整 Side 且两边长度一致 → 锁切向。 */
function tangentForLegacyShared(
  plan: FloorPlanState,
  group: LegacySharedGroup,
): FloorTangentConstraint {
  const slabs = slabById(plan);
  const a = slabs.get(group.slabIdA);
  const b = slabs.get(group.slabIdB);
  if (!a || !b) return { mode: "none" };
  const lengthA = sideLength(a, group.sideA);
  const lengthB = sideLength(b, group.sideB);
  const fullOnA = group.coverageOnA >= lengthA - EPSILON;
  const fullOnB = group.coverageOnB >= lengthB - EPSILON;
  if (fullOnA && fullOnB && Math.abs(lengthA - lengthB) <= EPSILON) {
    return { mode: "lock-start", offsetMm: 0 };
  }
  return { mode: "none" };
}

function exactSharedConnections(plan: FloorPlanState): FloorEdgeConnection[] {
  return groupExactSharedEdges(plan).map((group) => ({
    id: stableFloorConnectionId(group.slabIdA, group.sideA, group.slabIdB, group.sideB),
    a: { slabId: group.slabIdA, side: group.sideA, range: { mode: "auto-overlap" } },
    b: { slabId: group.slabIdB, side: group.sideB, range: { mode: "auto-overlap" } },
    source: "legacy-shared-edge",
    confidence: "confirmed",
    tangentConstraint: tangentForLegacyShared(plan, group),
  }));
}

type WallGapCandidate = {
  slabIdA: string;
  slabIdB: string;
  sideA: FloorEdgeSide;
  sideB: FloorEdgeSide;
  gapMm: number;
  gapErrorMm: number;
  overlapStartMm: number;
  overlapEndMm: number;
};

function edgeCoordinate(slab: FloorSlab, side: FloorEdgeSide): number {
  if (side === "west") return slab.x;
  if (side === "east") return slab.x + slab.width;
  if (side === "south") return slab.y;
  return slab.y + slab.height;
}

function wallGapCandidates(plan: FloorPlanState, connectedPairs: Set<string>): WallGapCandidate[] {
  const candidates: WallGapCandidate[] = [];
  const tolerance = Math.max(plan.overlapToleranceMm, 5);
  const pairKeys: Array<[FloorEdgeSide, FloorEdgeSide]> = [
    ["west", "east"],
    ["east", "west"],
    ["south", "north"],
    ["north", "south"],
  ];
  for (let leftIndex = 0; leftIndex < plan.slabs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plan.slabs.length; rightIndex += 1) {
      const a = plan.slabs[leftIndex];
      const b = plan.slabs[rightIndex];
      if (connectedPairs.has(`${a.id}|${b.id}`)) continue;
      for (const [sideA, sideB] of pairKeys) {
        const coordinateA = edgeCoordinate(a, sideA);
        const coordinateB = edgeCoordinate(b, sideB);
        const gapMm = Math.abs(coordinateA - coordinateB);
        if (gapMm <= EPSILON || Math.abs(gapMm - plan.innerWallThickness) > tolerance) continue;
        const vertical = sideA === "west" || sideA === "east";
        const overlapStart = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
        const overlapEnd = vertical ? Math.min(a.y + a.height, b.y + b.height) : Math.min(a.x + a.width, b.x + b.width);
        const overlapLength = overlapEnd - overlapStart;
        if (overlapLength < MIN_WALL_GAP_OVERLAP_MM) continue;
        // 墙带区域不得被第三个 Clear Slab 占据。
        const wallRect = vertical
          ? { x: Math.min(coordinateA, coordinateB), y: overlapStart, width: gapMm, height: overlapLength }
          : { x: overlapStart, y: Math.min(coordinateA, coordinateB), width: overlapLength, height: gapMm };
        const blocked = plan.slabs.some((other) =>
          other.id !== a.id && other.id !== b.id && rectsOverlap(wallRect, other));
        if (blocked) continue;
        candidates.push({
          slabIdA: a.id,
          slabIdB: b.id,
          sideA,
          sideB,
          gapMm,
          gapErrorMm: Math.abs(gapMm - plan.innerWallThickness),
          overlapStartMm: overlapStart,
          overlapEndMm: overlapEnd,
        });
      }
    }
  }
  return candidates.sort((left, right) =>
    left.gapErrorMm - right.gapErrorMm
    || (right.overlapEndMm - right.overlapStartMm) - (left.overlapEndMm - left.overlapStartMm));
}

function migrationWarning(plan: FloorPlanState, report: FloorTopologyMigrationReport): void {
  if (plan.snapDistanceMm > 400) {
    report.warnings.push(`snapDistanceMm=${plan.snapDistanceMm} 仅作为交互设置保留，迁移未使用它推断正式墙带。`);
  }
}

/**
 * Plan V2 → V3 迁移：Legacy Exact Shared Edge + Wall Gap 推断。
 * 输出 coordinateModel="clear-space-physical-v2" 与正式 connections；
 * slabs 坐标/尺寸、supportRules、全局设置、ID 全部保留。
 */
export function migrateFloorPlanV2ToV3(legacy: FloorPlanState): {
  plan: FloorPlanState;
  report: FloorTopologyMigrationReport;
} {
  const report: FloorTopologyMigrationReport = {
    exactSharedConnections: 0,
    wallGapConnections: 0,
    warnings: [],
  };
  const exact = exactSharedConnections(legacy);
  report.exactSharedConnections = exact.length;
  const connectedPairs = new Set<string>();
  exact.forEach((connection) => {
    connectedPairs.add(`${connection.a.slabId}|${connection.b.slabId}`);
    connectedPairs.add(`${connection.b.slabId}|${connection.a.slabId}`);
  });
  const confirmed: FloorEdgeConnection[] = [...exact];
  for (const candidate of wallGapCandidates(legacy, connectedPairs)) {
    const connection: FloorEdgeConnection = {
      id: stableFloorConnectionId(candidate.slabIdA, candidate.sideA, candidate.slabIdB, candidate.sideB),
      a: { slabId: candidate.slabIdA, side: candidate.sideA, range: { mode: "auto-overlap" } },
      b: { slabId: candidate.slabIdB, side: candidate.sideB, range: { mode: "auto-overlap" } },
      source: "legacy-wall-gap",
      confidence: "high",
      tangentConstraint: { mode: "none" },
    };
    // 同一侧边可以连接多个 Slab（PRD 14），重复冲突交给 Solver 的 overlap 检测；
    // 临时加入后必须通过 Solver 验证：存在 constraint conflict 则不自动确认。
    const trial: FloorPlanState = { ...legacy, coordinateModel: "clear-space-physical-v2", connections: [...confirmed, connection] };
    const trialSolution = solveFloorTopology(trial);
    const hasConflict = trialSolution.issues.some((issue) => issue.level === "error");
    if (hasConflict) continue;
    confirmed.push(connection);
    connectedPairs.add(`${connection.a.slabId}|${connection.b.slabId}`);
    connectedPairs.add(`${connection.b.slabId}|${connection.a.slabId}`);
    report.wallGapConnections += 1;
  }
  migrationWarning(legacy, report);
  return {
    plan: {
      ...legacy,
      coordinateModel: "clear-space-physical-v2",
      connections: confirmed,
    },
    report,
  };
}
