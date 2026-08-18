import { describe, expect, it } from "vitest";
import {
  INCOMPLETE_MENG_MISSING_PAIRS,
  incompleteMengPlan3,
} from "./__fixtures__/floor-topology-plan3-incomplete-meng";
import { buildFloorAssembly } from "./floor-assembly";
import { DEFAULT_FLOOR_BOTTOM_STATE } from "./floor-bottom-calculator";
import type { FloorPlanState } from "./floor-plan";
import { validateFloorTopologyMaterialized } from "./floor-topology-editor";
import {
  createFloorProjectFile,
  parseFloorProjectFile,
  serializeFloorProjectFile,
} from "./floor-project-file";
import { DEFAULT_FLOOR_REBAR_ROLE_STATE } from "./floor-rebar-role";
import { DEFAULT_FLOOR_TOP_STATE } from "./floor-top-calculator";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
  type FloorTopologyRepairCandidate,
  type FloorTopologyRepairDecision,
} from "./floor-topology-repair";
import { solveFloorTopology } from "./floor-topology-solver";
import { stableFloorConnectionId, type FloorEdgeConnection } from "./floor-topology";

function logicalPair(candidate: FloorTopologyRepairCandidate): string {
  return [candidate.a.slabId, candidate.b.slabId].sort().join("-");
}

function missingPairSet(): string[] {
  return INCOMPLETE_MENG_MISSING_PAIRS.map((pair) => [...pair].sort().join("-")).sort();
}

function planWithSlabs(
  slabs: FloorPlanState["slabs"],
  connections: FloorEdgeConnection[] = [],
  overrides: Partial<Pick<FloorPlanState, "innerWallThickness" | "snapDistanceMm" | "supportRules">> = {},
): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs,
    openings: [],
    connections,
    supportRules: overrides.supportRules ?? [],
    innerWallThickness: overrides.innerWallThickness ?? 240,
    outerWallThickness: 240,
    snapDistanceMm: overrides.snapDistanceMm ?? 150,
    overlapToleranceMm: 10,
  };
}

function allDecisions(
  candidates: readonly FloorTopologyRepairCandidate[],
  action: "inner-wall" | "continuous" | "ignore",
): FloorTopologyRepairDecision[] {
  return candidates.map((candidate) => ({ candidateId: candidate.id, action }));
}

function pairOfConnection(connection: FloorEdgeConnection): string {
  return [connection.a.slabId, connection.b.slabId].sort().join("-");
}

describe("Floor Topology V1.4B.0 legacy Plan3 repair", () => {
  it("detects exactly the four missing Incomplete Meng connections without mutating import", () => {
    const plan = incompleteMengPlan3();
    const before = structuredClone(plan);
    const assembly = buildFloorAssembly(plan);
    const detection = detectFloorTopologyRepairCandidates(plan);

    expect(plan).toEqual(before);
    expect(plan.slabs).toHaveLength(8);
    expect(plan.connections).toHaveLength(8);
    expect(assembly.connectedComponentCount).toBe(3);
    expect(detection.componentCount).toBe(3);
    expect(detection.candidates).toHaveLength(4);
    expect(detection.candidates.map(logicalPair).sort()).toEqual(missingPairSet());
    detection.candidates.forEach((candidate) => {
      expect(candidate.currentGapMm).toBeCloseTo(0, 7);
      expect(candidate.overlapLengthMm).toBeGreaterThan(0);
      expect(candidate.suggestedSupport).toBeNull();
      expect(candidate.allowedSupports).toEqual(expect.arrayContaining(["inner-wall", "continuous"]));
      expect(candidate.componentIds[0]).not.toBe(candidate.componentIds[1]);
      expect(candidate.a.range.mode).toBe("offset");
      expect(candidate.b.range.mode).toBe("offset");
    });
    expect(new Set(detection.candidates.map((candidate) => candidate.id)).size).toBe(4);
    expect(detectFloorTopologyRepairCandidates(plan).candidates.map((candidate) => candidate.id))
      .toEqual(detection.candidates.map((candidate) => candidate.id));
  });

  it("repairs all four Meng connections as inner walls through one atomic result", () => {
    const plan = incompleteMengPlan3();
    const originalConnections = new Map(plan.connections?.map((connection) => [connection.id, structuredClone(connection)]));
    const originalDimensions = new Map(plan.slabs.map((slab) => [slab.id, { width: slab.width, height: slab.height }]));
    const candidates = detectFloorTopologyRepairCandidates(plan).candidates;
    const result = applyFloorTopologyRepairs(plan, allDecisions(candidates, "inner-wall"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.componentCountBefore).toBe(3);
    expect(result.componentCountAfter).toBe(1);
    expect(result.addedConnectionIds).toHaveLength(4);
    expect(result.plan.connections).toHaveLength(12);
    expect(buildFloorAssembly(result.plan)).toMatchObject({ connectedComponentCount: 1, isFullyConnected: true });
    expect(result.plan.supportRules).toEqual(plan.supportRules);

    originalConnections.forEach((connection, id) => {
      expect(result.plan.connections?.find((item) => item.id === id)).toEqual(connection);
    });
    result.plan.slabs.forEach((slab) => expect({ width: slab.width, height: slab.height }).toEqual(originalDimensions.get(slab.id)));

    const added = result.plan.connections?.filter((connection) => !originalConnections.has(connection.id)) ?? [];
    expect(added.map(pairOfConnection).sort()).toEqual(missingPairSet());
    added.forEach((connection) => {
      expect(connection).toMatchObject({ source: "auto-detected", tangentConstraint: { mode: "none" } });
    });

    const solution = solveFloorTopology(result.plan);
    expect(solution.issues.filter((issue) => issue.level === "error")).toEqual([]);
    const addedIds = new Set(added.map((connection) => connection.id));
    const solvedAdded = solution.solvedConnections.filter((connection) => addedIds.has(connection.connectionId));
    expect(solvedAdded).toHaveLength(4);
    solvedAdded.forEach((connection) => {
      expect(connection.valid).toBe(true);
      expect(connection.support).toBe("inner-wall");
      expect(connection.gapMm).toBe(240);
      expect(connection.lengthMm).toBeGreaterThan(0);
    });
    expect(validateFloorTopologyMaterialized(result.plan)).toEqual([]);
    solution.slabs.forEach((solved) => {
      const slab = result.plan.slabs.find((item) => item.id === solved.slabId)!;
      expect(slab.x).toBeCloseTo(solved.x, 7);
      expect(slab.y).toBeCloseTo(solved.y, 7);
    });

    const slabs = new Map(result.plan.slabs.map((slab) => [slab.id, slab]));
    expect(slabs.get("meng-d")!.x + slabs.get("meng-d")!.width).toBe(5834);
    expect(slabs.get("meng-k")!.x + slabs.get("meng-k")!.width).toBe(5834);
    expect(slabs.get("meng-c")!.x).toBe(6074);
    expect(slabs.get("meng-l")!.x).toBe(6074);
    expect(slabs.get("meng-c")!.y - (slabs.get("meng-l")!.y + slabs.get("meng-l")!.height)).toBe(240);
    expect(slabs.get("meng-b")!.width + result.plan.innerWallThickness + slabs.get("meng-d")!.width).toBe(slabs.get("meng-k")!.width);
    expect(detectFloorTopologyRepairCandidates(result.plan).candidates).toEqual([]);
  });

  it("supports a partial repair and leaves the remaining component warning truthful", () => {
    const plan = incompleteMengPlan3();
    const candidates = detectFloorTopologyRepairCandidates(plan).candidates;
    const dc = candidates.find((candidate) => logicalPair(candidate) === "meng-c-meng-d")!;
    const decisions = candidates.map((candidate): FloorTopologyRepairDecision => ({
      candidateId: candidate.id,
      action: candidate.id === dc.id ? "inner-wall" : "ignore",
    }));
    const result = applyFloorTopologyRepairs(plan, decisions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.connections).toHaveLength(9);
    expect(result.componentCountBefore).toBe(3);
    expect(result.componentCountAfter).toBe(2);
    expect(buildFloorAssembly(result.plan).isFullyConnected).toBe(false);
  });

  it("creates a continuous connection at exact touch without a wall", () => {
    const plan = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1000, y: 0, width: 1000, height: 1000 },
    ]);
    const candidate = detectFloorTopologyRepairCandidates(plan).candidates[0];
    expect(candidate.suggestedSupport).toBeNull();
    const result = applyFloorTopologyRepairs(plan, [{ candidateId: candidate.id, action: "continuous" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const solution = solveFloorTopology(result.plan);
    expect(solution.solvedConnections[0]).toMatchObject({ support: "continuous", gapMm: 0, valid: true });
    expect(solution.walls).toEqual([]);
    expect(result.plan.supportRules).toHaveLength(1);
    expect(result.plan.supportRules[0]).toMatchObject({ support: "continuous", target: { range: { mode: "offset", startMm: 0, endMm: 1000 } } });
  });

  it("creates an inner wall at exact touch and materializes the 240mm gap", () => {
    const plan = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1000, y: 0, width: 1000, height: 1000 },
    ]);
    const candidate = detectFloorTopologyRepairCandidates(plan).candidates[0];
    const result = applyFloorTopologyRepairs(plan, [{ candidateId: candidate.id, action: "inner-wall" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.plan.slabs.find((slab) => slab.id === "a")!;
    const b = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(b.x - (a.x + a.width)).toBe(240);
    expect(solveFloorTopology(result.plan).walls[0]).toMatchObject({ thicknessMm: 240, lengthMm: 1000 });
    expect(result.plan.supportRules).toEqual([]);
  });

  it("recognizes an existing wall gap independently of snapDistance", () => {
    const plan = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1240, y: 0, width: 1000, height: 1000 },
    ], [], { snapDistanceMm: 1500 });
    const candidate = detectFloorTopologyRepairCandidates(plan).candidates[0];
    expect(candidate).toMatchObject({ currentGapMm: 240, suggestedSupport: "inner-wall", confidence: "high", reason: "wall-gap-between-components" });
    const result = applyFloorTopologyRepairs(plan, [{ candidateId: candidate.id, action: "inner-wall" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs).toEqual(plan.slabs);
    expect(solveFloorTopology(result.plan).walls[0].thicknessMm).toBe(240);
  });

  it("rejects corner touch, distant slabs, legacy coordinates, and existing partial connections", () => {
    const corner = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1000, y: 1000, width: 1000, height: 1000 },
    ]);
    expect(detectFloorTopologyRepairCandidates(corner).candidates).toEqual([]);

    const distant = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1150, y: 0, width: 1000, height: 1000 },
    ], [], { snapDistanceMm: 1500 });
    expect(detectFloorTopologyRepairCandidates(distant).candidates).toEqual([]);

    const legacy = { ...distant, coordinateModel: "net-layout-v1" as const };
    expect(detectFloorTopologyRepairCandidates(legacy).candidates).toEqual([]);

    const partialConnection: FloorEdgeConnection = {
      id: stableFloorConnectionId("a", "east", "b", "west"),
      a: { slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 500 } },
      b: { slabId: "b", side: "west", range: { mode: "offset", startMm: 0, endMm: 500 } },
      source: "manual",
      confidence: "confirmed",
      tangentConstraint: { mode: "none" },
    };
    const partial = planWithSlabs([
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 1000, height: 1000 },
      { id: "b", name: "B", type: "room", x: 1240, y: 0, width: 1000, height: 1000 },
    ], [partialConnection]);
    expect(buildFloorAssembly(partial).connectedComponentCount).toBe(1);
    expect(detectFloorTopologyRepairCandidates(partial).candidates).toEqual([]);
  });

  it("keeps adjacent K east repair ranges isolated when only K-C is continuous", () => {
    const plan = incompleteMengPlan3();
    const candidates = detectFloorTopologyRepairCandidates(plan).candidates;
    const decisions = candidates.map((candidate): FloorTopologyRepairDecision => {
      const pair = logicalPair(candidate);
      if (pair === "meng-c-meng-k") return { candidateId: candidate.id, action: "continuous" };
      if (pair === "meng-k-meng-l") return { candidateId: candidate.id, action: "inner-wall" };
      return { candidateId: candidate.id, action: "ignore" };
    });
    const result = applyFloorTopologyRepairs(plan, decisions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const connectionByPair = new Map((result.plan.connections ?? []).map((connection) => [pairOfConnection(connection), connection]));
    const solution = solveFloorTopology(result.plan);
    const kc = solution.solvedConnections.find((connection) => connection.connectionId === connectionByPair.get("meng-c-meng-k")?.id)!;
    const kl = solution.solvedConnections.find((connection) => connection.connectionId === connectionByPair.get("meng-k-meng-l")?.id)!;
    expect(kc).toMatchObject({ support: "continuous", gapMm: 0, valid: true });
    expect(kl).toMatchObject({ support: "inner-wall", gapMm: 240, valid: true });
    expect(result.plan.supportRules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        support: "continuous",
        target: {
          kind: "slab-edge",
          slabId: "meng-k",
          side: "east",
          range: { mode: "offset", startMm: 3920, endMm: 6090 },
        },
      }),
    ]));
  });

  it("rolls back the whole batch when any decision is invalid", () => {
    const plan = incompleteMengPlan3();
    const candidate = detectFloorTopologyRepairCandidates(plan).candidates[0];
    const decisions: FloorTopologyRepairDecision[] = [
      { candidateId: candidate.id, action: "inner-wall" },
      { candidateId: candidate.id, action: "continuous" },
    ];
    const result = applyFloorTopologyRepairs(plan, decisions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("repair-invalid-candidate");
    expect(result.plan).toBe(plan);
    expect(result.plan).toEqual(plan);
    expect(result.issues).toEqual([]);
  });

  it("returns stale-candidate when geometry or connections changed after the dialog opened", () => {
    const plan = incompleteMengPlan3();
    const candidate = detectFloorTopologyRepairCandidates(plan).candidates[0];
    const connection: FloorEdgeConnection = {
      id: stableFloorConnectionId(candidate.a.slabId, candidate.a.side, candidate.b.slabId, candidate.b.side),
      a: candidate.a,
      b: candidate.b,
      source: "manual",
      confidence: "confirmed",
      tangentConstraint: { mode: "none" },
    };
    const changed = { ...plan, connections: [...(plan.connections ?? []), connection] };
    const result = applyFloorTopologyRepairs(changed, [{ candidateId: candidate.id, action: "inner-wall" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("repair-stale-candidate");
    expect(result.plan).toBe(changed);
  });

  it("preserves a repaired Plan3 through full project export/import and does not auto-repair incomplete import", () => {
    const incomplete = incompleteMengPlan3();
    const incompleteFile = createFloorProjectFile({
      projectName: "孟",
      plan: incomplete,
      bottom: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE),
      top: structuredClone(DEFAULT_FLOOR_TOP_STATE),
      role: structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE),
      bottomRoleReviewRequired: true,
      topRoleReviewRequired: true,
    });
    const incompleteImport = parseFloorProjectFile(serializeFloorProjectFile(incompleteFile));
    expect(incompleteImport.ok).toBe(true);
    if (!incompleteImport.ok) return;
    expect(incompleteImport.project.planState.connections).toHaveLength(8);
    expect(buildFloorAssembly(incompleteImport.project.planState).connectedComponentCount).toBe(3);
    expect(detectFloorTopologyRepairCandidates(incompleteImport.project.planState).candidates).toHaveLength(4);

    const candidates = detectFloorTopologyRepairCandidates(incomplete).candidates;
    const repaired = applyFloorTopologyRepairs(incomplete, allDecisions(candidates, "inner-wall"));
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    const repairedFile = createFloorProjectFile({
      projectName: "孟",
      plan: repaired.plan,
      bottom: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE),
      top: structuredClone(DEFAULT_FLOOR_TOP_STATE),
      role: structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE),
      bottomRoleReviewRequired: true,
      topRoleReviewRequired: true,
    });
    const roundTrip = parseFloorProjectFile(serializeFloorProjectFile(repairedFile));
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.project.planState.connections).toHaveLength(12);
    expect(buildFloorAssembly(roundTrip.project.planState).connectedComponentCount).toBe(1);
    expect(roundTrip.project.planState.slabs.find((slab) => slab.id === "meng-c")?.x).toBe(6074);
    expect(roundTrip.project.planState.slabs.find((slab) => slab.id === "meng-l")?.x).toBe(6074);
    expect(detectFloorTopologyRepairCandidates(roundTrip.project.planState).candidates).toEqual([]);
  });
});
