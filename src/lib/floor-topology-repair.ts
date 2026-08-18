import { buildFloorAssembly } from "./floor-assembly";
import {
  FLOOR_GEOMETRY_EPSILON_MM,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import {
  stableFloorConnectionId,
  subtractFloorRanges,
  type FloorConnectionRange,
  type FloorEdgeConnection,
  type FloorRange,
} from "./floor-topology";
import { finalizeFloorTopologyMutation } from "./floor-topology-editor";
import { solveFloorTopology, type FloorTopologyConstraintIssue } from "./floor-topology-solver";
import { rewriteFloorSupportRulesForConnectionSupport } from "./floor-topology-support";

const EPSILON = FLOOR_GEOMETRY_EPSILON_MM;
export const FLOOR_TOPOLOGY_REPAIR_EXACT_TOUCH_TOLERANCE_MM = FLOOR_GEOMETRY_EPSILON_MM;
export const FLOOR_TOPOLOGY_REPAIR_WALL_GAP_TOLERANCE_MM = 5;

export type FloorTopologyRepairSupport = "inner-wall" | "continuous";

export type FloorTopologyRepairCandidate = {
  id: string;
  a: { slabId: string; side: FloorEdgeSide; range: FloorConnectionRange };
  b: { slabId: string; side: FloorEdgeSide; range: FloorConnectionRange };
  orientation: "vertical" | "horizontal";
  currentGapMm: number;
  overlapLengthMm: number;
  worldRange: { startMm: number; endMm: number };
  componentIds: [string, string];
  allowedSupports: FloorTopologyRepairSupport[];
  suggestedSupport: FloorTopologyRepairSupport | null;
  confidence: "high" | "medium";
  reason: "exact-touch-between-components" | "wall-gap-between-components";
};

export type FloorTopologyRepairDetectionResult = {
  componentCount: number;
  candidates: FloorTopologyRepairCandidate[];
};

export type FloorTopologyRepairDecision = {
  candidateId: string;
  action: FloorTopologyRepairSupport | "ignore";
};

export type FloorTopologyRepairApplyResult =
  | {
      ok: true;
      plan: FloorPlanState;
      addedConnectionIds: string[];
      ignoredCandidateIds: string[];
      componentCountBefore: number;
      componentCountAfter: number;
    }
  | {
      ok: false;
      plan: FloorPlanState;
      code: "repair-topology-conflict" | "repair-invalid-candidate" | "repair-stale-candidate";
      message: string;
      issues: FloorTopologyConstraintIssue[];
    };

type CandidateSeed = Omit<FloorTopologyRepairCandidate, "allowedSupports">;

function sideOffsetRange(slab: FloorSlab, side: FloorEdgeSide, worldRange: FloorRange): FloorConnectionRange {
  const base = side === "west" || side === "east" ? slab.y : slab.x;
  const length = side === "west" || side === "east" ? slab.height : slab.width;
  return {
    mode: "offset",
    startMm: Math.max(0, Math.min(length, worldRange.start - base)),
    endMm: Math.max(0, Math.min(length, worldRange.end - base)),
  };
}

function stableNumber(value: number): string {
  return Number(value.toFixed(7)).toString();
}

function candidateId(seed: Pick<CandidateSeed, "a" | "b" | "worldRange">): string {
  return [
    "repair",
    seed.a.slabId,
    seed.a.side,
    seed.b.slabId,
    seed.b.side,
    stableNumber(seed.worldRange.startMm),
    stableNumber(seed.worldRange.endMm),
  ].join(":");
}

function connectionForCandidate(candidate: FloorTopologyRepairCandidate): FloorEdgeConnection {
  return {
    id: stableFloorConnectionId(candidate.a.slabId, candidate.a.side, candidate.b.slabId, candidate.b.side),
    a: { ...candidate.a, range: { ...candidate.a.range } },
    b: { ...candidate.b, range: { ...candidate.b.range } },
    source: "auto-detected",
    confidence: candidate.confidence,
    tangentConstraint: { mode: "none" },
  };
}

function existingCoverageBySide(plan: FloorPlanState): Map<string, FloorRange[]> {
  const result = new Map<string, FloorRange[]>();
  const solution = solveFloorTopology(plan);
  solution.solvedConnections.forEach((connection) => {
    if (!connection.valid) return;
    for (const [slabId, side] of [
      [connection.slabIds[0], connection.sideA],
      [connection.slabIds[1], connection.sideB],
    ] as Array<[string, FloorEdgeSide]>) {
      const key = `${slabId}:${side}`;
      const ranges = result.get(key) ?? [];
      ranges.push({ start: connection.rangeStartMm, end: connection.rangeEndMm });
      result.set(key, ranges);
    }
  });
  return result;
}

function addCandidateWithSupport(
  plan: FloorPlanState,
  candidate: FloorTopologyRepairCandidate,
  support: FloorTopologyRepairSupport,
): { ok: true; plan: FloorPlanState; connectionId: string } | { ok: false; issues: FloorTopologyConstraintIssue[] } {
  const connection = connectionForCandidate(candidate);
  if ((plan.connections ?? []).some((item) => item.id === connection.id)) return { ok: false, issues: [] };
  let mutated: FloorPlanState = { ...plan, connections: [...(plan.connections ?? []), connection] };
  const initialSolution = solveFloorTopology(mutated);
  const solved = initialSolution.solvedConnections.find((item) => item.connectionId === connection.id && item.valid);
  if (!solved) return { ok: false, issues: initialSolution.issues.filter((issue) => issue.level === "error") };

  const supportConflict = initialSolution.issues.some((issue) =>
    issue.level === "error"
    && issue.code === "support-rule-conflict"
    && issue.connectionIds?.includes(connection.id));
  const mustWriteExactRule = support === "continuous" || solved.support !== support || supportConflict;
  if (mustWriteExactRule) {
    if (candidate.a.range.mode !== "offset" || candidate.b.range.mode !== "offset") return { ok: false, issues: [] };
    const rangeA = candidate.a.range;
    const rangeB = candidate.b.range;
    const ruleId = `connection-support:${connection.id}:${support}`;
    const rewrite = rewriteFloorSupportRulesForConnectionSupport(
      mutated,
      [
        { slabId: candidate.a.slabId, side: candidate.a.side, startMm: rangeA.startMm, endMm: rangeA.endMm },
        { slabId: candidate.b.slabId, side: candidate.b.side, startMm: rangeB.startMm, endMm: rangeB.endMm },
      ],
      {
        kind: "slab-edge",
        slabId: candidate.a.slabId,
        side: candidate.a.side,
        range: { mode: "offset", startMm: rangeA.startMm, endMm: rangeA.endMm },
      },
      ruleId,
      support,
    );
    mutated = {
      ...mutated,
      supportRules: rewrite.supportRules.map((rule) => rule.id === ruleId ? {
        ...rule,
        target: {
          kind: "slab-edge" as const,
          slabId: candidate.a.slabId,
          side: candidate.a.side,
          range: { mode: "offset" as const, startMm: rangeA.startMm, endMm: rangeA.endMm },
        },
      } : rule),
    };
  }
  return { ok: true, plan: mutated, connectionId: connection.id };
}

function supportIsValid(plan: FloorPlanState, candidate: FloorTopologyRepairCandidate, support: FloorTopologyRepairSupport): boolean {
  const mutation = addCandidateWithSupport(plan, candidate, support);
  if (!mutation.ok) return false;
  const finalized = finalizeFloorTopologyMutation(plan, mutation.plan);
  if (!finalized.ok) return false;
  const solution = solveFloorTopology(finalized.plan);
  const solved = solution.solvedConnections.find((item) => item.connectionId === mutation.connectionId);
  return Boolean(
    solved?.valid
    && solved.support === support
    && !solution.issues.some((issue) => issue.level === "error"),
  );
}

function candidateSeeds(plan: FloorPlanState): { componentCount: number; seeds: CandidateSeed[] } {
  const assembly = buildFloorAssembly(plan);
  if (plan.coordinateModel !== "clear-space-physical-v2" || assembly.connectedComponentCount <= 1) {
    return { componentCount: assembly.connectedComponentCount, seeds: [] };
  }
  const componentBySlab = new Map<string, string>();
  assembly.components.forEach((component) => component.slabIds.forEach((slabId) => componentBySlab.set(slabId, component.id)));
  const coverage = existingCoverageBySide(plan);
  const seeds: CandidateSeed[] = [];

  const append = (input: {
    a: FloorSlab;
    sideA: FloorEdgeSide;
    b: FloorSlab;
    sideB: FloorEdgeSide;
    orientation: "vertical" | "horizontal";
    gapMm: number;
    worldRange: FloorRange;
  }) => {
    const componentA = componentBySlab.get(input.a.id);
    const componentB = componentBySlab.get(input.b.id);
    if (!componentA || !componentB || componentA === componentB) return;
    const exactTouch = Math.abs(input.gapMm) <= FLOOR_TOPOLOGY_REPAIR_EXACT_TOUCH_TOLERANCE_MM;
    const wallGap = input.gapMm > EPSILON
      && Math.abs(input.gapMm - plan.innerWallThickness) <= FLOOR_TOPOLOGY_REPAIR_WALL_GAP_TOLERANCE_MM;
    if (!exactTouch && !wallGap) return;
    const covered = [
      ...(coverage.get(`${input.a.id}:${input.sideA}`) ?? []),
      ...(coverage.get(`${input.b.id}:${input.sideB}`) ?? []),
    ];
    subtractFloorRanges(input.worldRange, covered).forEach((remaining) => {
      if (remaining.end - remaining.start <= EPSILON) return;
      const worldRange = { startMm: remaining.start, endMm: remaining.end };
      const seedWithoutId = {
        a: { slabId: input.a.id, side: input.sideA, range: sideOffsetRange(input.a, input.sideA, remaining) },
        b: { slabId: input.b.id, side: input.sideB, range: sideOffsetRange(input.b, input.sideB, remaining) },
        orientation: input.orientation,
        currentGapMm: Math.max(0, input.gapMm),
        overlapLengthMm: remaining.end - remaining.start,
        worldRange,
        componentIds: [componentA, componentB] as [string, string],
        suggestedSupport: wallGap ? "inner-wall" as const : null,
        confidence: wallGap ? "high" as const : "medium" as const,
        reason: wallGap ? "wall-gap-between-components" as const : "exact-touch-between-components" as const,
      };
      seeds.push({ ...seedWithoutId, id: candidateId(seedWithoutId) });
    });
  };

  for (let leftIndex = 0; leftIndex < plan.slabs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plan.slabs.length; rightIndex += 1) {
      const first = plan.slabs[leftIndex];
      const second = plan.slabs[rightIndex];
      if (componentBySlab.get(first.id) === componentBySlab.get(second.id)) continue;

      const west = first.x < second.x || (first.x === second.x && first.id < second.id) ? first : second;
      const east = west.id === first.id ? second : first;
      append({
        a: west,
        sideA: "east",
        b: east,
        sideB: "west",
        orientation: "vertical",
        gapMm: east.x - (west.x + west.width),
        worldRange: { start: Math.max(west.y, east.y), end: Math.min(west.y + west.height, east.y + east.height) },
      });

      const south = first.y < second.y || (first.y === second.y && first.id < second.id) ? first : second;
      const north = south.id === first.id ? second : first;
      append({
        a: north,
        sideA: "south",
        b: south,
        sideB: "north",
        orientation: "horizontal",
        gapMm: north.y - (south.y + south.height),
        worldRange: { start: Math.max(south.x, north.x), end: Math.min(south.x + south.width, north.x + north.width) },
      });
    }
  }
  return { componentCount: assembly.connectedComponentCount, seeds };
}

export function detectFloorTopologyRepairCandidates(plan: FloorPlanState): FloorTopologyRepairDetectionResult {
  const detection = candidateSeeds(plan);
  const candidates = detection.seeds
    .map((seed): FloorTopologyRepairCandidate | null => {
      const candidate: FloorTopologyRepairCandidate = { ...seed, allowedSupports: [] };
      const allowedSupports = (["inner-wall", "continuous"] as const)
        .filter((support) => supportIsValid(plan, candidate, support));
      return allowedSupports.length > 0 ? { ...candidate, allowedSupports } : null;
    })
    .filter((candidate): candidate is FloorTopologyRepairCandidate => candidate !== null)
    .sort((left, right) =>
      left.orientation.localeCompare(right.orientation)
      || left.a.slabId.localeCompare(right.a.slabId)
      || left.a.side.localeCompare(right.a.side)
      || left.b.slabId.localeCompare(right.b.slabId)
      || left.b.side.localeCompare(right.b.side)
      || left.worldRange.startMm - right.worldRange.startMm
      || left.worldRange.endMm - right.worldRange.endMm);
  return { componentCount: detection.componentCount, candidates };
}

export function applyFloorTopologyRepairs(
  plan: FloorPlanState,
  decisions: readonly FloorTopologyRepairDecision[],
): FloorTopologyRepairApplyResult {
  const beforeAssembly = buildFloorAssembly(plan);
  if (plan.coordinateModel !== "clear-space-physical-v2") {
    return { ok: false, plan, code: "repair-invalid-candidate", message: "拓扑修复只适用于 Plan3 物理净空坐标模型。", issues: [] };
  }
  const detected = detectFloorTopologyRepairCandidates(plan);
  const candidatesById = new Map(detected.candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  let mutated = plan;
  const addedConnectionIds: string[] = [];
  const ignoredCandidateIds: string[] = [];

  for (const decision of decisions) {
    if (seen.has(decision.candidateId) || !["inner-wall", "continuous", "ignore"].includes(decision.action)) {
      return { ok: false, plan, code: "repair-invalid-candidate", message: "修复决策重复或类型无效，未执行修复。", issues: [] };
    }
    seen.add(decision.candidateId);
    const candidate = candidatesById.get(decision.candidateId);
    if (!candidate) {
      return { ok: false, plan, code: "repair-stale-candidate", message: "修复候选已失效，请重新检查当前连接。", issues: [] };
    }
    if (decision.action === "ignore") {
      ignoredCandidateIds.push(candidate.id);
      continue;
    }
    if (!candidate.allowedSupports.includes(decision.action)) {
      return { ok: false, plan, code: "repair-invalid-candidate", message: "所选支承类型不适用于当前候选，未执行修复。", issues: [] };
    }
    const addition = addCandidateWithSupport(mutated, candidate, decision.action);
    if (!addition.ok) {
      return { ok: false, plan, code: "repair-topology-conflict", message: "这些连接组合会导致楼板重叠或尺寸约束冲突，未执行修复。", issues: addition.issues };
    }
    mutated = addition.plan;
    addedConnectionIds.push(addition.connectionId);
  }

  if (addedConnectionIds.length === 0) {
    return {
      ok: true,
      plan,
      addedConnectionIds: [],
      ignoredCandidateIds: ignoredCandidateIds.sort(),
      componentCountBefore: beforeAssembly.connectedComponentCount,
      componentCountAfter: beforeAssembly.connectedComponentCount,
    };
  }
  const finalized = finalizeFloorTopologyMutation(plan, mutated);
  if (!finalized.ok) {
    return {
      ok: false,
      plan,
      code: "repair-topology-conflict",
      message: "这些连接组合会导致楼板重叠或尺寸约束冲突，未执行修复。",
      issues: finalized.issues,
    };
  }
  return {
    ok: true,
    plan: finalized.plan,
    addedConnectionIds: addedConnectionIds.sort(),
    ignoredCandidateIds: ignoredCandidateIds.sort(),
    componentCountBefore: beforeAssembly.connectedComponentCount,
    componentCountAfter: buildFloorAssembly(finalized.plan).connectedComponentCount,
  };
}
