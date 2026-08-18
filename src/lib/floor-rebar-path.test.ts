import { describe, expect, it } from "vitest";
import type { FloorPlanState } from "./floor-plan";
import {
  buildFloorRebarPathContextV3,
  buildFloorRebarScanlineV3,
} from "./floor-rebar-path";
import { incompleteMengPlan3 } from "./__fixtures__/floor-topology-plan3-incomplete-meng";
import { stableFloorConnectionId } from "./floor-topology";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
} from "./floor-topology-repair";

function repairedMengPlan(): FloorPlanState {
  const plan = incompleteMengPlan3();
  const candidates = detectFloorTopologyRepairCandidates(plan).candidates;
  const repaired = applyFloorTopologyRepairs(plan, candidates.map((candidate) => ({
    candidateId: candidate.id,
    action: "inner-wall" as const,
  })));
  if (!repaired.ok) throw new Error(repaired.message);
  return repaired.plan;
}

function simplePlan(overrides: Partial<FloorPlanState> = {}): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: [{ id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 }],
    openings: [],
    supportRules: [],
    connections: [],
    innerWallThickness: 20,
    outerWallThickness: 20,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
    ...overrides,
  };
}

describe("Floor Rebar V1.4C.1 path engine", () => {
  it("builds a reusable context and single-slab X/Y paths", () => {
    const plan = simplePlan();
    const context = buildFloorRebarPathContextV3(plan);
    expect(context.plan).toBe(plan);
    expect(context.isValid).toBe(true);
    const x = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50 });
    const y = buildFloorRebarScanlineV3(context, { direction: "y", positionMm: 50 });
    expect(x.chains[0].spans).toEqual([{ kind: "clear-slab", slabId: "a", startMm: 0, endMm: 100, lengthMm: 100 }]);
    expect(y.chains[0].spans[0].startMm).toBe(0);
    expect(x.chains[0].startEndpoint).toMatchObject({ slabId: "a", side: "west", runMm: 0, support: "outer-wall" });
    expect(x.chains[0].endEndpoint).toMatchObject({ slabId: "a", side: "east", runMm: 100 });
    expect(x.isValid).toBe(true);
    expect(y.isValid).toBe(true);
  });

  it("does not infer a connection from touching or wall-gap geometry", () => {
    const touching = simplePlan({ slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 100, y: 0, width: 100, height: 100 },
    ] });
    const wallGap = simplePlan({ slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
    ] });
    expect(buildFloorRebarScanlineV3(touching, { direction: "x", positionMm: 50 }).chains).toHaveLength(2);
    expect(buildFloorRebarScanlineV3(wallGap, { direction: "x", positionMm: 50 }).chains).toHaveLength(2);
  });

  it("produces the Meng top-row A-B-D-C decomposition from solved connections", () => {
    const plan = repairedMengPlan();
    const context = buildFloorRebarPathContextV3(plan);
    const solution = context.solution;
    const ids = ["meng-a", "meng-b", "meng-d", "meng-c"];
    const slabs = ids.map((id) => solution.slabs.find((slab) => slab.slabId === id)!);
    const lower = Math.max(...slabs.map((slab) => slab.y));
    const upper = Math.min(...slabs.map((slab) => slab.y + slab.height));
    const result = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: (lower + upper) / 2 });
    expect(result.isValid).toBe(true);
    expect(result.chains).toHaveLength(1);
    const chain = result.chains[0];
    expect(chain.slabIds).toEqual(ids);
    expect(chain.spans.map((span) => span.lengthMm)).toEqual([4020, 3500, 3530, 4020]);
    expect(chain.transitions.map((transition) => [transition.support, transition.gapMm, transition.wallThicknessMm]))
      .toEqual([["inner-wall", 240, 240], ["inner-wall", 240, 240], ["inner-wall", 240, 240]]);
    expect(chain.startMm).toBe(-5696);
    expect(chain.endMm).toBe(10094);
    expect(chain.endMm - chain.startMm).toBe(15790);
  });

  it("follows the Meng mid/lower T routes and the C-L Y route", () => {
    const plan = repairedMengPlan();
    const context = buildFloorRebarPathContextV3(plan);
    const commonPosition = (ids: string[], direction: "x" | "y") => {
      const slabs = ids.map((id) => context.slabsById.get(id)!);
      const starts = slabs.map((slab) => direction === "x" ? slab.y : slab.x);
      const ends = slabs.map((slab) => direction === "x" ? slab.y + slab.height : slab.x + slab.width);
      return (Math.max(...starts) + Math.min(...ends)) / 2;
    };
    const mid = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: commonPosition(["meng-e", "meng-k", "meng-c"], "x") });
    const lower = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: commonPosition(["meng-f", "meng-k", "meng-l"], "x") });
    const cL = buildFloorRebarScanlineV3(context, { direction: "y", positionMm: commonPosition(["meng-c", "meng-l"], "y") });
    expect(mid.isValid).toBe(true);
    expect(mid.chains[0].slabIds).toEqual(["meng-e", "meng-k", "meng-c"]);
    expect(mid.chains[0].spans.map((span) => span.lengthMm)).toEqual([4020, 7270, 4020]);
    expect(mid.chains[0].transitions.map((transition) => transition.gapMm)).toEqual([240, 240]);
    expect(lower.isValid).toBe(true);
    expect(lower.chains[0].slabIds).toEqual(["meng-f", "meng-k", "meng-l"]);
    expect(lower.chains[0].transitions.map((transition) => transition.connectionId)).toEqual([
      "connection:meng-f:east:meng-k:west",
      "connection:meng-k:east:meng-l:west",
    ]);
    expect(cL.isValid).toBe(true);
    expect(cL.chains[0].slabIds).toEqual(["meng-l", "meng-c"]);
    expect(cL.chains[0].transitions[0]).toMatchObject({ support: "inner-wall", gapMm: 240, wallThicknessMm: 240 });
  });

  it("reports formal opening intersections and respects slab filters", () => {
    const plan = simplePlan({ openings: [{ id: "o", name: "Opening", type: "void", x: 25, y: 25, width: 120, height: 20 }] });
    const result = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 35, slabIds: ["a"] });
    expect(result.openingIntersections).toEqual([{ openingId: "o", startMm: 25, endMm: 100, lengthMm: 75, slabIds: ["a"] }]);
  });

  it("preserves continuous zero-gap transitions and inner-wall transitions", () => {
    const connection = {
      id: stableFloorConnectionId("a", "east", "b", "west"),
      a: { slabId: "a", side: "east" as const, range: { mode: "auto-overlap" as const } },
      b: { slabId: "b", side: "west" as const, range: { mode: "auto-overlap" as const } },
      source: "manual" as const,
      confidence: "confirmed" as const,
      tangentConstraint: { mode: "none" as const },
    };
    const continuous = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 100, y: 0, width: 100, height: 100 },
      ],
      connections: [connection],
      supportRules: [
        { id: "a-cont", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "b-cont", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "continuous" },
      ],
    });
    const continuousResult = buildFloorRebarScanlineV3(continuous, { direction: "x", positionMm: 50 });
    expect(continuousResult.isValid).toBe(true);
    expect(continuousResult.chains[0].transitions[0]).toMatchObject({ support: "continuous", gapMm: 0, runStartMm: 100, runEndMm: 100, wallThicknessMm: 0 });

    const inner = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
      ],
      connections: [connection],
    });
    const innerResult = buildFloorRebarScanlineV3(inner, { direction: "x", positionMm: 50 });
    expect(innerResult.chains[0].transitions[0]).toMatchObject({ support: "inner-wall", gapMm: 20, runStartMm: 100, runEndMm: 120, wallThicknessMm: 20 });
  });

  it("uses connection ranges as half-open and supports partial paths", () => {
    const connection = {
      id: stableFloorConnectionId("a", "east", "b", "west"),
      a: { slabId: "a", side: "east" as const, range: { mode: "offset" as const, startMm: 0, endMm: 50 } },
      b: { slabId: "b", side: "west" as const, range: { mode: "offset" as const, startMm: 0, endMm: 50 } },
      source: "manual" as const,
      confidence: "confirmed" as const,
      tangentConstraint: { mode: "none" as const },
    };
    const plan = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
      ],
      connections: [connection],
    });
    const inside = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 25 });
    const outside = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 75 });
    const end = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 50 });
    expect(inside.chains[0].transitions).toHaveLength(1);
    expect(outside.chains).toHaveLength(2);
    expect(end.chains).toHaveLength(2);
  });

  it("rejects a solved connection whose physical gap disagrees with its slabs", () => {
    const plan = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
      ],
      connections: [{
        id: stableFloorConnectionId("a", "east", "b", "west"),
        a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        source: "manual", confidence: "confirmed", tangentConstraint: { mode: "none" },
      }],
    });
    const context = buildFloorRebarPathContextV3(plan);
    const malformed = {
      ...context,
      solution: {
        ...context.solution,
        solvedConnections: context.solution.solvedConnections.map((connection) => ({ ...connection, gapMm: 999 })),
      },
    };
    const result = buildFloorRebarScanlineV3(malformed, { direction: "x", positionMm: 50 });
    expect(result.isValid).toBe(false);
    expect(result.issues[0].code).toBe("rebar-path-connection-geometry-mismatch");
  });

  it("rejects branch and duplicate-connection ambiguity instead of choosing an edge", () => {
    const plan = simplePlan({ slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 100, y: 0, width: 100, height: 100 },
      { id: "c", name: "C", type: "room", x: 200, y: 0, width: 100, height: 100 },
      { id: "d", name: "D", type: "room", x: 300, y: 0, width: 100, height: 100 },
    ] });
    const context = buildFloorRebarPathContextV3(plan);
    const fakeConnection = (id: string, other: string, gapMm: number) => ({
      connectionId: id,
      slabIds: ["a", other] as [string, string],
      orientation: "vertical" as const,
      sideA: "east" as const,
      sideB: "west" as const,
      rangeStartMm: 0,
      rangeEndMm: 100,
      lengthMm: 100,
      aOffsetStartMm: 0,
      aOffsetEndMm: 100,
      bOffsetStartMm: 0,
      bOffsetEndMm: 100,
      support: "continuous" as const,
      gapMm,
      valid: true,
    });
    const branchContext = {
      ...context,
      solution: { ...context.solution, solvedConnections: [
        fakeConnection("ab", "b", 0), fakeConnection("ac", "c", 100), fakeConnection("ad", "d", 200),
      ] },
    };
    const branch = buildFloorRebarScanlineV3(branchContext, { direction: "x", positionMm: 50 });
    expect(branch.isValid).toBe(false);
    expect(branch.chains).toEqual([]);
    expect(branch.issues[0]).toMatchObject({ code: "rebar-path-branch-ambiguous", slabIds: ["a"] });

    const duplicateContext = {
      ...context,
      solution: { ...context.solution, solvedConnections: [fakeConnection("ab-1", "b", 0), fakeConnection("ab-2", "b", 0)] },
    };
    const duplicate = buildFloorRebarScanlineV3(duplicateContext, { direction: "x", positionMm: 50 });
    expect(duplicate.isValid).toBe(false);
    expect(duplicate.issues[0]).toMatchObject({ code: "rebar-path-connection-ambiguous" });
  });

  it("returns a stable result for repeated scans", () => {
    const plan = repairedMengPlan();
    const context = buildFloorRebarPathContextV3(plan);
    const positionMm = 14500;
    const first = buildFloorRebarScanlineV3(context, { direction: "x", positionMm });
    const second = buildFloorRebarScanlineV3(context, { direction: "x", positionMm });
    expect(second).toEqual(first);
  });

  it("blocks a scanline when the topology solver reports an error and leaves the plan unchanged", () => {
    const plan = simplePlan({ connections: [{
      id: "bad", a: { slabId: "a", side: "west", range: { mode: "auto-overlap" } },
      b: { slabId: "missing", side: "east", range: { mode: "auto-overlap" } },
      source: "manual", confidence: "confirmed", tangentConstraint: { mode: "none" },
    }] });
    const before = structuredClone(plan);
    const context = buildFloorRebarPathContextV3(plan);
    const result = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50 });
    expect(result.isValid).toBe(false);
    expect(result.chains).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "rebar-path-topology-invalid", sourceIssueCode: "connection-invalid-side-pair" });
    expect(plan).toEqual(before);
  });
});
