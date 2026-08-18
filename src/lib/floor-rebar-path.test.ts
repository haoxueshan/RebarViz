import { describe, expect, it } from "vitest";
import type { FloorPlanState } from "./floor-plan";
import {
  buildFloorRebarPathContextV3,
  buildFloorRebarScanlineV3,
} from "./floor-rebar-path";
import { incompleteMengPlan3 } from "./__fixtures__/floor-topology-plan3-incomplete-meng";
import { stableFloorConnectionId, type FloorConnectionRange, type FloorEdgeConnection } from "./floor-topology";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
} from "./floor-topology-repair";
import type { FloorSolvedConnection } from "./floor-topology-solver";

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

function horizontalPairPlan(
  support: "inner-wall" | "continuous",
  range: FloorConnectionRange = { mode: "auto-overlap" },
): FloorPlanState {
  const gapMm = support === "inner-wall" ? 20 : 0;
  const connection: FloorEdgeConnection = {
    id: stableFloorConnectionId("a", "east", "b", "west"),
    a: { slabId: "a", side: "east", range },
    b: { slabId: "b", side: "west", range },
    source: "manual",
    confidence: "confirmed",
    tangentConstraint: { mode: "none" },
  };
  return simplePlan({
    slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 100 + gapMm, y: 0, width: 100, height: 100 },
    ],
    connections: [connection],
    supportRules: support === "continuous" ? [
      { id: "a-cont", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" },
      { id: "b-cont", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "continuous" },
    ] : [],
  });
}

function fakeVerticalConnection(
  connectionId: string,
  leftSlabId: string,
  rightSlabId: string,
  gapMm: number,
): FloorSolvedConnection {
  return {
    connectionId,
    slabIds: [leftSlabId, rightSlabId],
    orientation: "vertical",
    sideA: "east",
    sideB: "west",
    rangeStartMm: 0,
    rangeEndMm: 100,
    lengthMm: 100,
    aOffsetStartMm: 0,
    aOffsetEndMm: 100,
    bOffsetStartMm: 0,
    bOffsetEndMm: 100,
    support: "continuous",
    gapMm,
    valid: true,
  };
}

describe("Floor Rebar V1.4C.1 path engine", () => {
  it("builds a reusable context and single-slab X/Y paths", () => {
    const plan = simplePlan();
    const context = buildFloorRebarPathContextV3(plan);
    expect(context.plan).toBe(plan);
    expect(context.isValid).toBe(true);
    expect(context.solvedConnectionsById.size).toBe(0);
    expect(context.wallsByConnectionId.size).toBe(0);
    const x = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50 });
    const y = buildFloorRebarScanlineV3(context, { direction: "y", positionMm: 50 });
    expect(x.chains[0].spans).toEqual([{ kind: "clear-slab", slabId: "a", startMm: 0, endMm: 100, lengthMm: 100 }]);
    expect(y.chains[0].spans[0].startMm).toBe(0);
    expect(x.chains[0].startEndpoint).toMatchObject({ kind: "exterior", slabId: "a", side: "west", runMm: 0, support: "outer-wall" });
    expect(x.chains[0].endEndpoint).toMatchObject({ kind: "exterior", slabId: "a", side: "east", runMm: 100 });
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

  it("resolves filtered inner-wall domains to bidirectional connection-boundary endpoints", () => {
    const plan = horizontalPairPlan("inner-wall");
    const before = structuredClone(plan);
    const context = buildFloorRebarPathContextV3(plan);
    const a = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["a"] });
    const b = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["b"] });
    expect(a.isValid).toBe(true);
    expect(a.chains).toHaveLength(1);
    expect(a.chains[0]).toMatchObject({ slabIds: ["a"], startMm: 0, endMm: 100 });
    expect(a.chains[0].startEndpoint).toMatchObject({ kind: "exterior", slabId: "a", side: "west", runMm: 0, support: "outer-wall" });
    expect(a.chains[0].endEndpoint).toMatchObject({
      kind: "connection-boundary",
      slabId: "a",
      otherSlabId: "b",
      side: "east",
      runMm: 100,
      support: "inner-wall",
      gapMm: 20,
      wallThicknessMm: 20,
      connectionId: stableFloorConnectionId("a", "east", "b", "west"),
    });
    expect(b.isValid).toBe(true);
    expect(b.chains[0].startEndpoint).toMatchObject({
      kind: "connection-boundary",
      slabId: "b",
      otherSlabId: "a",
      side: "west",
      runMm: 120,
      support: "inner-wall",
      gapMm: 20,
      wallThicknessMm: 20,
    });
    expect(b.chains[0].endEndpoint).toMatchObject({ kind: "exterior", slabId: "b", side: "east", runMm: 220 });
    expect(plan).toEqual(before);
  });

  it("describes a filtered continuous boundary but keeps full continuous domains internal", () => {
    const plan = horizontalPairPlan("continuous");
    const context = buildFloorRebarPathContextV3(plan);
    const filtered = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["a"] });
    const full = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["a", "b"] });
    expect(filtered.isValid).toBe(true);
    expect(filtered.chains[0].endEndpoint).toMatchObject({
      kind: "connection-boundary",
      slabId: "a",
      otherSlabId: "b",
      side: "east",
      support: "continuous",
      runMm: 100,
      gapMm: 0,
      wallThicknessMm: 0,
    });
    expect(full.isValid).toBe(true);
    expect(full.chains[0].slabIds).toEqual(["a", "b"]);
    expect(full.chains[0].transitions).toHaveLength(1);
    expect(full.chains[0].transitions[0]).toMatchObject({ support: "continuous", runStartMm: 100, runEndMm: 100 });
    expect(full.chains[0].startEndpoint.kind).toBe("exterior");
    expect(full.chains[0].endEndpoint.kind).toBe("exterior");
  });

  it("resolves partial filtered connections only inside their half-open range", () => {
    const plan = horizontalPairPlan("inner-wall", { mode: "offset", startMm: 0, endMm: 50 });
    const context = buildFloorRebarPathContextV3(plan);
    const inside = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 25, slabIds: ["a"] });
    const outside = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 75, slabIds: ["a"] });
    const exactEnd = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["a"] });
    expect(inside.chains[0].endEndpoint).toMatchObject({ kind: "connection-boundary", side: "east", support: "inner-wall" });
    expect(outside.chains[0].endEndpoint).toMatchObject({ kind: "exterior", side: "east", support: "outer-wall" });
    expect(exactEnd.chains[0].endEndpoint).toMatchObject({ kind: "exterior", side: "east", support: "outer-wall" });
  });

  it("detects third-party clear spans inside a wall even when the slab is filtered out", () => {
    const base = horizontalPairPlan("inner-wall");
    const plan = {
      ...base,
      slabs: [...base.slabs, { id: "c", name: "C", type: "room" as const, x: 105, y: 0, width: 10, height: 100 }],
    };
    const derived = buildFloorRebarPathContextV3(plan);
    // The C.2 global guard blocks the context before scanning. Force only the
    // derived path state for this C.1 defensive overlap regression.
    const context = { ...derived, isValid: true, topologyIssues: [], solution: { ...derived.solution, issues: [] } };
    const full = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50 });
    const filtered = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: 50, slabIds: ["a", "b"] });
    for (const result of [full, filtered]) {
      expect(result.isValid).toBe(false);
      expect(result.chains).toEqual([]);
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "rebar-path-transition-clear-overlap",
        connectionIds: [stableFloorConnectionId("a", "east", "b", "west")],
        slabIds: ["a", "b", "c"],
      }));
    }
  });

  it("supports an internal continuous edge and an excluded inner-wall boundary on one chain", () => {
    const ab = {
      id: stableFloorConnectionId("a", "east", "b", "west"),
      a: { slabId: "a", side: "east" as const, range: { mode: "auto-overlap" as const } },
      b: { slabId: "b", side: "west" as const, range: { mode: "auto-overlap" as const } },
      source: "manual" as const,
      confidence: "confirmed" as const,
      tangentConstraint: { mode: "none" as const },
    };
    const bc = {
      id: stableFloorConnectionId("b", "east", "c", "west"),
      a: { slabId: "b", side: "east" as const, range: { mode: "auto-overlap" as const } },
      b: { slabId: "c", side: "west" as const, range: { mode: "auto-overlap" as const } },
      source: "manual" as const,
      confidence: "confirmed" as const,
      tangentConstraint: { mode: "none" as const },
    };
    const plan = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
        { id: "c", name: "C", type: "room", x: 220, y: 0, width: 100, height: 100 },
      ],
      connections: [ab, bc],
      supportRules: [
        { id: "b-c-cont-b", target: { kind: "slab-edge", slabId: "b", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "b-c-cont-c", target: { kind: "slab-edge", slabId: "c", side: "west", range: { mode: "whole" } }, support: "continuous" },
      ],
    });
    const result = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 50, slabIds: ["b", "c"] });
    expect(result.isValid).toBe(true);
    expect(result.chains[0].slabIds).toEqual(["b", "c"]);
    expect(result.chains[0].startEndpoint).toMatchObject({
      kind: "connection-boundary", slabId: "b", otherSlabId: "a", side: "west", support: "inner-wall", runMm: 120,
    });
    expect(result.chains[0].transitions).toEqual([expect.objectContaining({ support: "continuous", beforeSlabId: "b", afterSlabId: "c" })]);
    expect(result.chains[0].endEndpoint).toMatchObject({ kind: "exterior", slabId: "c", side: "east", runMm: 320 });
  });

  it("rejects multiple boundary candidates and exterior/connection boundary conflicts", () => {
    const plan = simplePlan({ slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 100, y: 0, width: 100, height: 100 },
      { id: "c", name: "C", type: "room", x: 200, y: 0, width: 100, height: 100 },
    ] });
    const context = buildFloorRebarPathContextV3(plan);
    const ab = fakeVerticalConnection("ab", "a", "b", 0);
    const ac = fakeVerticalConnection("ac", "a", "c", 100);
    const solution = { ...context.solution, solvedConnections: [ab, ac] };
    const multipleContext = {
      ...context,
      solution,
      exteriorRanges: context.exteriorRanges.filter((range) => !(range.slabId === "a" && range.side === "east")),
    };
    const multiple = buildFloorRebarScanlineV3(multipleContext, { direction: "x", positionMm: 50, slabIds: ["a"] });
    expect(multiple.isValid).toBe(false);
    expect(multiple.issues).toContainEqual(expect.objectContaining({
      code: "rebar-path-endpoint-ambiguous", slabIds: ["a"], connectionIds: ["ab", "ac"],
    }));

    const exteriorConflict = buildFloorRebarScanlineV3({ ...context, solution: { ...context.solution, solvedConnections: [ab] } }, {
      direction: "x", positionMm: 50, slabIds: ["a"],
    });
    expect(exteriorConflict.isValid).toBe(false);
    expect(exteriorConflict.issues).toContainEqual(expect.objectContaining({
      code: "rebar-path-endpoint-ambiguous", slabIds: ["a"], connectionIds: ["ab"],
    }));
  });

  it("validates linear, cyclic, and skip-edge graph components", () => {
    const plan = simplePlan({ slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "B", type: "room", x: 100, y: 0, width: 100, height: 100 },
      { id: "c", name: "C", type: "room", x: 200, y: 0, width: 100, height: 100 },
    ] });
    const context = buildFloorRebarPathContextV3(plan);
    const ab = fakeVerticalConnection("ab", "a", "b", 0);
    const bc = fakeVerticalConnection("bc", "b", "c", 0);
    const ac = fakeVerticalConnection("ac", "a", "c", 100);
    const scan = (connections: FloorSolvedConnection[]) => buildFloorRebarScanlineV3({
      ...context,
      solution: { ...context.solution, solvedConnections: connections },
    }, { direction: "x", positionMm: 50 });
    const linear = scan([ab, bc]);
    expect(linear.isValid).toBe(true);
    expect(linear.chains[0].slabIds).toEqual(["a", "b", "c"]);
    expect(linear.chains[0].transitions.map((transition) => transition.connectionId)).toEqual(["ab", "bc"]);
    const cycle = scan([ab, bc, ac]);
    expect(cycle.isValid).toBe(false);
    expect(cycle.chains).toEqual([]);
    expect(cycle.issues).toContainEqual(expect.objectContaining({ code: "rebar-path-chain-nonlinear" }));
    const skip = scan([ac, bc]);
    expect(skip.isValid).toBe(false);
    expect(skip.chains).toEqual([]);
    expect(skip.issues).toContainEqual(expect.objectContaining({ code: "rebar-path-chain-nonlinear" }));
  });

  it("assigns EPSILON-near slab and opening boundaries to at most one half-open interval", () => {
    const plan = simplePlan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 0, y: 100, width: 100, height: 100 },
        { id: "c", name: "C", type: "room", x: 0, y: 200, width: 100, height: 100 },
      ],
      openings: [{ id: "o", name: "Opening", type: "void", x: 20, y: 100, width: 20, height: 50 }],
    });
    const nearFirstBoundary = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 99.99999995 });
    const exactFirstBoundary = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 100 });
    const nearSecondBoundary = buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 199.99999995 });
    expect(nearFirstBoundary.chains.map((chain) => chain.slabIds)).toEqual([["b"]]);
    expect(exactFirstBoundary.chains.map((chain) => chain.slabIds)).toEqual([["b"]]);
    expect(nearSecondBoundary.chains.map((chain) => chain.slabIds)).toEqual([["c"]]);
    expect(buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 149.99999995 }).openingIntersections).toEqual([]);
    expect(buildFloorRebarScanlineV3(plan, { direction: "x", positionMm: 100 }).openingIntersections).toHaveLength(1);
  });

  it("resolves Meng B and K single-domain boundaries from the active T ranges", () => {
    const plan = repairedMengPlan();
    const context = buildFloorRebarPathContextV3(plan);
    const midpoint = (ids: string[]) => {
      const slabs = ids.map((id) => context.slabsById.get(id)!);
      return (Math.max(...slabs.map((slab) => slab.y)) + Math.min(...slabs.map((slab) => slab.y + slab.height))) / 2;
    };
    const b = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: midpoint(["meng-a", "meng-b", "meng-d"]), slabIds: ["meng-b"] });
    expect(b.isValid).toBe(true);
    expect(b.chains[0].slabIds).toEqual(["meng-b"]);
    expect(b.chains[0].startEndpoint).toMatchObject({
      kind: "connection-boundary", slabId: "meng-b", otherSlabId: "meng-a", side: "west", support: "inner-wall", wallThicknessMm: 240,
    });
    expect(b.chains[0].endEndpoint).toMatchObject({
      kind: "connection-boundary", slabId: "meng-b", otherSlabId: "meng-d", side: "east", support: "inner-wall", wallThicknessMm: 240,
    });
    const upperK = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: midpoint(["meng-e", "meng-k", "meng-c"]), slabIds: ["meng-k"] });
    const lowerK = buildFloorRebarScanlineV3(context, { direction: "x", positionMm: midpoint(["meng-f", "meng-k", "meng-l"]), slabIds: ["meng-k"] });
    expect(upperK.isValid).toBe(true);
    expect(upperK.chains[0].startEndpoint).toMatchObject({ kind: "connection-boundary", otherSlabId: "meng-e", side: "west" });
    expect(upperK.chains[0].endEndpoint).toMatchObject({ kind: "connection-boundary", otherSlabId: "meng-c", side: "east" });
    expect(lowerK.isValid).toBe(true);
    expect(lowerK.chains[0].startEndpoint).toMatchObject({ kind: "connection-boundary", otherSlabId: "meng-f", side: "west" });
    expect(lowerK.chains[0].endEndpoint).toMatchObject({ kind: "connection-boundary", otherSlabId: "meng-l", side: "east" });
  });

  it("keeps endpoint-only transition contact legal and reports a truly unresolved endpoint", () => {
    const pair = horizontalPairPlan("inner-wall");
    const touchingPlan = {
      ...pair,
      slabs: [...pair.slabs, { id: "c", name: "C", type: "room" as const, x: 90, y: 0, width: 10, height: 100 }],
    };
    const touchingContext = buildFloorRebarPathContextV3(touchingPlan);
    const forcedDerivedContext = {
      ...touchingContext,
      isValid: true,
      topologyIssues: [],
      solution: { ...touchingContext.solution, issues: [] },
    };
    const touching = buildFloorRebarScanlineV3(forcedDerivedContext, { direction: "x", positionMm: 50, slabIds: ["a", "b"] });
    expect(touching.isValid).toBe(true);
    expect(touching.chains[0].transitions[0]).toMatchObject({ runStartMm: 100, runEndMm: 120 });
    expect(touching.issues.some((issue) => issue.code === "rebar-path-transition-clear-overlap")).toBe(false);

    const single = buildFloorRebarPathContextV3(simplePlan());
    const unresolved = buildFloorRebarScanlineV3({
      ...single,
      exteriorRanges: single.exteriorRanges.filter((range) => !(range.slabId === "a" && range.side === "east")),
    }, { direction: "x", positionMm: 50 });
    expect(unresolved.isValid).toBe(false);
    expect(unresolved.chains).toEqual([]);
    expect(unresolved.issues).toContainEqual(expect.objectContaining({ code: "rebar-path-endpoint-unresolved", slabIds: ["a"] }));
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

  it("does not substitute connection gap when a solved inner wall is missing", () => {
    const context = buildFloorRebarPathContextV3(horizontalPairPlan("inner-wall"));
    const malformed = { ...context, wallsByConnectionId: new Map() };
    const result = buildFloorRebarScanlineV3(malformed, { direction: "x", positionMm: 50, slabIds: ["a"] });
    expect(result.isValid).toBe(false);
    expect(result.chains).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "rebar-path-connection-geometry-mismatch" }));
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
