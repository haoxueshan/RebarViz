import { describe, expect, it, vi } from "vitest";
import { incompleteMengPlan3 } from "./__fixtures__/floor-topology-plan3-incomplete-meng";
import { buildFloorRebarCalculationContextV3 } from "./floor-rebar-calculation-context-v3";
import type { FloorPlanState, FloorSlab } from "./floor-plan";
import { floorRoleDomainKey, type FloorRebarRoleState } from "./floor-rebar-role";
import {
  calculateFloorTopNormalRebar,
  calculateFloorTopRebar,
  calculateFloorTopRebarV3FromContext,
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopState,
  type FloorTopThroughPath,
} from "./floor-top-calculator";
import {
  applyFloorTopThroughPathsV3,
  resolveFloorTopThroughPathGeometryV3,
} from "./floor-top-through-v3";
import { stableFloorConnectionId, type FloorEdgeConnection } from "./floor-topology";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
} from "./floor-topology-repair";
import * as floorTopologySolver from "./floor-topology-solver";

function repairedMeng() {
  const source = incompleteMengPlan3();
  const candidates = detectFloorTopologyRepairCandidates(source).candidates;
  const repaired = applyFloorTopologyRepairs(source, candidates.map((candidate) => ({
    candidateId: candidate.id,
    action: "inner-wall" as const,
  })));
  if (!repaired.ok) throw new Error(repaired.message);
  return repaired.plan;
}

function uniformTop(path: FloorTopThroughPath): FloorTopState {
  return {
    ...structuredClone(DEFAULT_FLOOR_TOP_STATE),
    countMode: "project",
    defaults: {
      mainDiameter: 10,
      secondaryDiameter: 10,
      xSpacing: 200,
      ySpacing: 200,
      xExtraMode: "both",
      yExtraMode: "both",
    },
    throughPaths: [path],
  };
}

function mengRoles(): FloorRebarRoleState {
  return {
    mainDirectionOverrides: Object.fromEntries([
      "meng-b",
      "meng-d",
      "meng-c",
    ].map((slabId) => [floorRoleDomainKey([slabId]), "x"])),
  };
}

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: id.toUpperCase(), type: "room", x, y, width, height };
}

function connection(
  aSlabId: string,
  aSide: FloorEdgeConnection["a"]["side"],
  bSlabId: string,
  bSide: FloorEdgeConnection["b"]["side"],
  range?: { startMm: number; endMm: number },
): FloorEdgeConnection {
  return {
    id: stableFloorConnectionId(aSlabId, aSide, bSlabId, bSide),
    a: {
      slabId: aSlabId,
      side: aSide,
      range: range ? { mode: "offset", ...range } : { mode: "auto-overlap" },
    },
    b: {
      slabId: bSlabId,
      side: bSide,
      range: range ? { mode: "offset", ...range } : { mode: "auto-overlap" },
    },
    source: "manual",
    confidence: "confirmed",
    tangentConstraint: { mode: "none" },
  };
}

function v3Plan(
  slabs: FloorSlab[],
  connections: FloorEdgeConnection[],
  supportRules: FloorPlanState["supportRules"] = [],
  openings: FloorPlanState["openings"] = [],
): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs,
    connections,
    supportRules,
    openings,
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function continuousRule(slabId: string, side: "east" | "north") {
  return {
    id: `${slabId}:${side}:continuous`,
    target: { kind: "slab-edge" as const, slabId, side, range: { mode: "whole" as const } },
    support: "continuous" as const,
  };
}

function throughPath(
  id: string,
  slabIds: string[],
  bandStartMm: number,
  bandEndMm: number,
  direction: "x" | "y" = "x",
): FloorTopThroughPath {
  return { id, name: id, direction, slabIds, bandStartMm, bandEndMm, enabled: true };
}

function topForPaths(paths: FloorTopThroughPath[], spacing = 500): FloorTopState {
  const state = structuredClone(DEFAULT_FLOOR_TOP_STATE);
  state.defaults.xSpacing = spacing;
  state.defaults.ySpacing = spacing;
  state.throughPaths = paths;
  return state;
}

describe("Floor Rebar V1.4C.5 connection-aware Top Through", () => {
  it("resolves unordered Meng B-D-C and locks alignment, claim and length decomposition", () => {
    const plan = repairedMeng();
    const draft: FloorTopThroughPath = {
      id: "meng-through-b-d-c",
      name: "Meng B-D-C",
      direction: "x",
      slabIds: ["meng-c", "meng-b", "meng-d"],
      bandStartMm: 0,
      bandEndMm: 0,
      enabled: true,
    };
    const context = buildFloorRebarCalculationContextV3(plan);
    const dc = context.solution.solvedConnections.find((connection) =>
      connection.slabIds.includes("meng-d") && connection.slabIds.includes("meng-c"));
    expect(dc).toMatchObject({
      valid: true,
      support: "inner-wall",
      rangeStartMm: 13370,
      rangeEndMm: 16400,
      gapMm: 240,
    });
    const draftGeometry = resolveFloorTopThroughPathGeometryV3(context, draft);
    expect(draftGeometry.orderedSlabIds).toEqual(["meng-b", "meng-d", "meng-c"]);
    expect(draftGeometry.validBandIntervals).not.toEqual([]);
    const interval = draftGeometry.validBandIntervals.sort((left, right) =>
      (right.end - right.start) - (left.end - left.start))[0];
    const path = { ...draft, bandStartMm: interval.start, bandEndMm: interval.end };
    const beforePlan = structuredClone(plan);
    const beforeTop = uniformTop(path);
    const input = structuredClone(beforeTop);
    const alignedNormal = calculateFloorTopNormalRebar(plan, input, mengRoles());
    expect(alignedNormal.errors).toEqual([]);
    const normalXBySlab = ["meng-b", "meng-d", "meng-c"].map((slabId) => {
      const domain = alignedNormal.domains.find((candidate) => candidate.slabIds.includes(slabId))!;
      return alignedNormal.lines.filter((line) =>
        line.source === "normal" && line.domainId === domain.id && line.direction === "x");
    });
    expect(normalXBySlab.map((lines) => lines.length)).toEqual([17, 17, 29]);
    const bandPositions = normalXBySlab.map((lines) => lines
      .filter((line) => line.positionMm >= path.bandStartMm && line.positionMm < path.bandEndMm)
      .map((line) => line.positionMm));
    expect(bandPositions[1]).toEqual(bandPositions[0]);
    expect(bandPositions[2]).toEqual(bandPositions[0]);

    const solve = vi.spyOn(floorTopologySolver, "solveFloorTopology");
    solve.mockClear();
    const fromContext = calculateFloorTopRebarV3FromContext(context, input, mengRoles());
    expect(fromContext.errors).toEqual([]);
    expect(solve).toHaveBeenCalledTimes(0);
    const result = calculateFloorTopRebar(plan, input, mengRoles());
    expect(solve).toHaveBeenCalledTimes(1);
    solve.mockRestore();

    expect(result.errors).toEqual([]);
    expect(result.isValid).toBe(true);
    expect(result.resolvedThroughPaths).toHaveLength(1);
    expect(result.resolvedThroughPaths[0]).toMatchObject({
      id: path.id,
      orderedSlabIds: ["meng-b", "meng-d", "meng-c"],
      diameter: 10,
      spacing: 200,
      extraMode: "both",
    });
    // The current repaired fixture's formal D-C range is [13370,16400), so
    // its maximum valid Through band contains 16 aligned positions.
    expect(result.resolvedThroughPaths[0].linePositionsMm).toHaveLength(16);

    const through = result.pieces.filter((piece) => piece.source === "through");
    expect(through).toHaveLength(16);
    expect(through.every((piece) =>
      piece.netLengthMm === 11050
      && piece.intermediateWallMm === 480
      && piece.startAnchorMm === 490
      && piece.endAnchorMm === 240
      && piece.singleLengthMm === 12260)).toBe(true);
    const connectionIds = context.solution.solvedConnections;
    const idFor = (left: string, right: string) => connectionIds.find((connection) =>
      connection.slabIds.includes(left) && connection.slabIds.includes(right))!.connectionId;
    expect(through[0].startBoundaryId).toBe(idFor("meng-a", "meng-b"));
    expect(through[0].intermediateBoundaryIds).toEqual([
      idFor("meng-b", "meng-d"),
      idFor("meng-d", "meng-c"),
    ]);
    expect(through[0].endBoundaryId).toMatch(/^v3-exterior:meng-c:east:/);

    const aligned = ["meng-b", "meng-d", "meng-c"].map((slabId) => {
      const domain = result.domains.find((candidate) => candidate.slabIds.includes(slabId))!;
      return result.lines.filter((line) =>
        line.source === "normal"
        && line.domainId === domain.id
        && line.direction === "x"
        && line.positionMm >= path.bandStartMm
        && line.positionMm < path.bandEndMm)
        .map((line) => line.positionMm);
    });
    // B/D are fully claimed; C keeps its X normal lines outside the common band.
    expect(aligned[0]).toEqual([]);
    expect(aligned[1]).toEqual([]);
    expect(result.lines.some((line) =>
      line.source === "normal"
      && line.direction === "x"
      && line.slabIds.includes("meng-c")
      && (line.positionMm < path.bandStartMm || line.positionMm >= path.bandEndMm))).toBe(true);
    expect(alignedNormal.pieces.length - result.normalPieceCount).toBe(48);
    expect(result.lines.filter((line) =>
      line.source === "normal" && line.direction === "x" && line.slabIds.includes("meng-c")))
      .toHaveLength(13);
    expect(result.lines.filter((line) => line.source === "through")).toHaveLength(16);
    expect(result.alignmentPlan?.groups).toHaveLength(1);
    expect(result.alignmentPlan?.groups[0].domainIds).toHaveLength(3);
    const throughGroups = result.groups.filter((group) => group.source === "through");
    expect(throughGroups).toHaveLength(1);
    expect(throughGroups[0]).toMatchObject({ count: 16, singleLengthMm: 12260 });
    expect(result.normalPieceCount + result.throughPieceCount).toBe(result.totalPieces);
    expect(result.groups.reduce((sum, group) => sum + group.count, 0)).toBe(result.totalPieces);
    expect(plan).toEqual(beforePlan);
    expect(input).toEqual(beforeTop);
    expect(calculateFloorTopRebar(plan, input, mengRoles())).toEqual(result);
  });

  it("uses formal partial ranges and rejects disconnected, branched and cyclic selections", () => {
    const partialPlan = v3Plan(
      [slab("a", 0, 0, 3000, 2000), slab("b", 3240, 0, 3000, 2000)],
      [connection("a", "east", "b", "west", { startMm: 1000, endMm: 2000 })],
    );
    const context = buildFloorRebarCalculationContextV3(partialPlan);
    const upper = resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("upper", ["b", "a"], 1100, 1900),
    );
    const lower = resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("lower", ["a", "b"], 0, 900),
    );
    expect(upper.errors).toEqual([]);
    expect(upper.orderedSlabIds).toEqual(["a", "b"]);
    expect(upper.validBandIntervals).toEqual([{ start: 1000, end: 2000 }]);
    expect(lower.errors.map((item) => item.code)).toContain("through-path-band-outside");

    const solved = context.solution.solvedConnections[0];
    const partialContext = {
      ...context,
      solution: {
        ...context.solution,
        solvedConnections: [
          { ...solved, connectionId: "partial-1", rangeStartMm: 0, rangeEndMm: 500 },
          { ...solved, connectionId: "partial-2", rangeStartMm: 1000, rangeEndMm: 1500 },
        ],
      },
    };
    const separated = resolveFloorTopThroughPathGeometryV3(
      partialContext,
      throughPath("separated", ["a", "b"], 100, 400),
    );
    expect(separated.errors).toEqual([]);
    expect(separated.validBandIntervals).toEqual([
      { start: 0, end: 500 },
      { start: 1000, end: 1500 },
    ]);
    const ambiguousContext = {
      ...context,
      solution: {
        ...context.solution,
        solvedConnections: [
          { ...solved, connectionId: "overlap-1", rangeStartMm: 0, rangeEndMm: 1000 },
          { ...solved, connectionId: "overlap-2", rangeStartMm: 500, rangeEndMm: 1500 },
        ],
      },
    };
    expect(resolveFloorTopThroughPathGeometryV3(
      ambiguousContext,
      throughPath("ambiguous", ["a", "b"], 600, 900),
    ).errors.map((item) => item.code)).toContain("through-path-connection-ambiguous");

    const disconnected = buildFloorRebarCalculationContextV3(v3Plan(
      [slab("a", 0, 0, 1000, 1000), slab("b", 1000, 0, 1000, 1000)],
      [],
    ));
    expect(resolveFloorTopThroughPathGeometryV3(
      disconnected,
      throughPath("disconnected", ["a", "b"], 0, 1000),
    ).errors.map((item) => item.code)).toContain("through-path-chain-invalid");

    const branchBase = buildFloorRebarCalculationContextV3(v3Plan(
      [
        slab("a", 0, 0, 1000, 2000),
        slab("b", 1240, 0, 1000, 1000),
        slab("c", 1240, 1000, 1000, 1000),
      ],
      [],
    ));
    const branchConnections = [
      ["ab", "a", "b", 0, 1000],
      ["ac", "a", "c", 1000, 2000],
    ].map(([connectionId, before, after, start, end]) => ({
      connectionId: String(connectionId),
      slabIds: [String(before), String(after)] as [string, string],
      orientation: "vertical" as const,
      sideA: "east" as const,
      sideB: "west" as const,
      rangeStartMm: Number(start),
      rangeEndMm: Number(end),
      lengthMm: Number(end) - Number(start),
      aOffsetStartMm: Number(start),
      aOffsetEndMm: Number(end),
      bOffsetStartMm: 0,
      bOffsetEndMm: 1000,
      support: "inner-wall" as const,
      gapMm: 240,
      valid: true,
    }));
    const branchContext = {
      ...branchBase,
      solution: { ...branchBase.solution, solvedConnections: branchConnections },
    };
    expect(resolveFloorTopThroughPathGeometryV3(
      branchContext,
      throughPath("branch", ["a", "b", "c"], 0, 1000),
    ).errors.map((item) => item.code)).toContain("through-path-chain-ambiguous");

    const cycleBase = buildFloorRebarCalculationContextV3(v3Plan(
      [slab("a", 0, 0, 1000, 1000), slab("b", 1240, 0, 1000, 1000), slab("c", 2480, 0, 1000, 1000)],
      [],
    ));
    const solvedCycle = [
      ["ab", "a", "b"],
      ["bc", "b", "c"],
      ["ca", "c", "a"],
    ].map(([connectionId, before, after]) => ({
      connectionId,
      slabIds: [before, after] as [string, string],
      orientation: "vertical" as const,
      sideA: "east" as const,
      sideB: "west" as const,
      rangeStartMm: 0,
      rangeEndMm: 1000,
      lengthMm: 1000,
      aOffsetStartMm: 0,
      aOffsetEndMm: 1000,
      bOffsetStartMm: 0,
      bOffsetEndMm: 1000,
      support: "continuous" as const,
      gapMm: 0,
      valid: true,
    }));
    const cycleContext = {
      ...cycleBase,
      solution: { ...cycleBase.solution, solvedConnections: solvedCycle },
    };
    expect(resolveFloorTopThroughPathGeometryV3(
      cycleContext,
      throughPath("cycle", ["a", "b", "c"], 0, 1000),
    ).errors.map((item) => item.code)).toContain("through-path-chain-invalid");
  });

  it("keeps repaired Meng K-C and K-L T-junction bands isolated", () => {
    const plan = repairedMeng();
    const context = buildFloorRebarCalculationContextV3(plan);
    const draftGeometry = (id: string, slabIds: string[]) =>
      resolveFloorTopThroughPathGeometryV3(
        context,
        throughPath(id, slabIds, 0, 0),
      );
    const kcDraft = draftGeometry("kc", ["meng-c", "meng-k"]);
    const klDraft = draftGeometry("kl", ["meng-l", "meng-k"]);
    expect(kcDraft.validBandIntervals).not.toEqual([]);
    expect(klDraft.validBandIntervals).not.toEqual([]);
    const kcBand = kcDraft.validBandIntervals[0];
    const klBand = klDraft.validBandIntervals[0];
    expect(kcBand.start).toBeGreaterThanOrEqual(klBand.end);
    expect(resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("kc-upper", ["meng-k", "meng-c"], kcBand.start, kcBand.end),
    ).errors).toEqual([]);
    expect(resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("kl-lower", ["meng-k", "meng-l"], klBand.start, klBand.end),
    ).errors).toEqual([]);
    expect(resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("kc-lower", ["meng-k", "meng-c"], klBand.start, klBand.end),
    ).errors.map((item) => item.code)).toContain("through-path-band-outside");
  });

  it("claims a continuous Normal piece once and accumulates only inner-wall transitions", () => {
    const continuousPlan = v3Plan(
      [slab("a", 0, 0, 4000, 2000), slab("b", 4000, 0, 3000, 2000)],
      [connection("a", "east", "b", "west")],
      [continuousRule("a", "east")],
    );
    const continuous = calculateFloorTopRebar(
      continuousPlan,
      topForPaths([throughPath("continuous", ["b", "a"], 0, 2000)]),
    );
    expect(continuous.errors).toEqual([]);
    const continuousPieces = continuous.pieces.filter((piece) => piece.source === "through");
    expect(continuousPieces).toHaveLength(4);
    expect(continuousPieces.every((piece) =>
      piece.netLengthMm === 7000
      && piece.intermediateWallMm === 0
      && piece.singleLengthMm === 7740
      && piece.intermediateBoundaryIds.length === 1)).toBe(true);

    const mixedPlan = v3Plan(
      [
        slab("a", 0, 0, 4000, 2000),
        slab("b", 4000, 0, 3000, 2000),
        slab("c", 7240, 0, 3000, 2000),
      ],
      [
        connection("a", "east", "b", "west"),
        connection("b", "east", "c", "west"),
      ],
      [continuousRule("a", "east")],
    );
    const mixed = calculateFloorTopRebar(
      mixedPlan,
      topForPaths([throughPath("mixed", ["c", "a", "b"], 0, 2000)]),
    );
    expect(mixed.errors).toEqual([]);
    const mixedPiece = mixed.pieces.find((piece) => piece.source === "through")!;
    expect(mixedPiece).toMatchObject({ netLengthMm: 10000, intermediateWallMm: 240 });
    expect(mixedPiece.intermediateBoundaryIds).toEqual([
      stableFloorConnectionId("a", "east", "b", "west"),
      stableFloorConnectionId("b", "east", "c", "west"),
    ]);
  });

  it("blocks external continuous overlap and opening area but allows outside-range/touch-only", () => {
    const baseConnections = [
      connection("a", "east", "b", "west"),
      connection("b", "east", "c", "west", { startMm: 1000, endMm: 2000 }),
    ];
    const plan = v3Plan(
      [
        slab("a", 0, 0, 3000, 2000),
        slab("b", 3240, 0, 3000, 2000),
        slab("c", 6240, 0, 3000, 2000),
      ],
      baseConnections,
      [{
        id: "b-east-upper-continuous",
        target: {
          kind: "slab-edge",
          slabId: "b",
          side: "east",
          range: { mode: "offset", startMm: 1000, endMm: 2000 },
        },
        support: "continuous",
      }],
    );
    const context = buildFloorRebarCalculationContextV3(plan);
    expect(resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("external-overlap", ["a", "b"], 1100, 1900),
    ).errors.map((item) => item.code)).toContain("through-path-continuous-endpoint");
    expect(resolveFloorTopThroughPathGeometryV3(
      context,
      throughPath("external-outside", ["a", "b"], 0, 900),
    ).errors.map((item) => item.code)).not.toContain("through-path-continuous-endpoint");

    const openingPlan = v3Plan(
      [slab("a", 0, 0, 3000, 2000), slab("b", 3240, 0, 3000, 2000)],
      [connection("a", "east", "b", "west")],
      [],
      [{ id: "o", name: "O", type: "stair", x: 2500, y: 1000, width: 1000, height: 500 }],
    );
    const openingContext = buildFloorRebarCalculationContextV3(openingPlan);
    expect(resolveFloorTopThroughPathGeometryV3(
      openingContext,
      throughPath("opening-overlap", ["a", "b"], 900, 1200),
    ).errors.map((item) => item.code)).toContain("through-path-opening-blocked");
    expect(resolveFloorTopThroughPathGeometryV3(
      openingContext,
      throughPath("opening-touch", ["a", "b"], 0, 1000),
    ).errors.map((item) => item.code)).not.toContain("through-path-opening-blocked");
  });

  it("blocks same-direction positive overlap, allows touching bands and cross-direction paths", () => {
    const horizontal = v3Plan(
      [slab("a", 0, 0, 4000, 3000), slab("b", 4240, 0, 4000, 3000)],
      [connection("a", "east", "b", "west")],
    );
    const overlap = calculateFloorTopRebar(horizontal, topForPaths([
      throughPath("p1", ["a", "b"], 0, 1500),
      throughPath("p2", ["a", "b"], 1000, 2500),
    ]));
    expect(overlap.errors.map((item) => item.code)).toContain("through-path-overlap");
    expect(overlap).toMatchObject({ lines: [], pieces: [], groups: [], resolvedThroughPaths: [] });

    const touching = calculateFloorTopRebar(horizontal, topForPaths([
      throughPath("p1", ["a", "b"], 0, 1500),
      throughPath("p2", ["a", "b"], 1500, 3000),
    ]));
    expect(touching.errors).toEqual([]);
    expect(touching.resolvedThroughPaths).toHaveLength(2);

    const crossPlan = v3Plan(
      [
        slab("a", 0, 0, 4000, 3000),
        slab("b", 4240, 0, 4000, 3000),
        slab("c", 0, 3240, 4000, 3000),
      ],
      [
        connection("a", "east", "b", "west"),
        connection("a", "north", "c", "south"),
      ],
    );
    const crossing = calculateFloorTopRebar(crossPlan, topForPaths([
      throughPath("px", ["a", "b"], 0, 3000, "x"),
      throughPath("py", ["a", "c"], 0, 4000, "y"),
    ]));
    expect(crossing.errors).toEqual([]);
    expect(crossing.resolvedThroughPaths.map((path) => path.direction).sort()).toEqual(["x", "y"]);
  });

  it("blocks spacing, settings, role and empty-band line conflicts precisely", () => {
    const plan = v3Plan(
      [slab("a", 0, 0, 3000, 2000), slab("b", 3240, 0, 3000, 2000)],
      [connection("a", "east", "b", "west")],
    );
    const path = throughPath("settings", ["a", "b"], 0, 2000);
    const spacing = topForPaths([path]);
    spacing.slabOverrides.b = { xSpacing: 400 };
    expect(calculateFloorTopRebar(plan, spacing).errors.map((item) => item.code))
      .toContain("through-alignment-spacing-conflict");

    const diameter = topForPaths([path]);
    diameter.slabOverrides.b = { secondaryDiameter: 12 };
    expect(calculateFloorTopRebar(plan, diameter).errors.map((item) => item.code))
      .toContain("through-path-settings-conflict");

    const extra = topForPaths([path]);
    extra.slabOverrides.b = { xExtraMode: "start" };
    expect(calculateFloorTopRebar(plan, extra).errors.map((item) => item.code))
      .toContain("through-path-settings-conflict");

    const rolePlan = v3Plan(
      [slab("a", 0, 0, 3000, 4000), slab("b", 3240, 0, 3000, 2000)],
      [connection("a", "east", "b", "west")],
    );
    expect(calculateFloorTopRebar(
      rolePlan,
      topForPaths([throughPath("role", ["a", "b"], 0, 2000)]),
    ).errors.map((item) => item.code)).toContain("through-path-role-conflict");

    expect(calculateFloorTopRebar(
      plan,
      topForPaths([throughPath("no-lines", ["a", "b"], 0, 100)]),
    ).errors.map((item) => item.code)).toContain("through-path-no-lines");
  });

  it("fails malformed Normal claim inputs atomically with precise codes", () => {
    const plan = v3Plan(
      [slab("a", 0, 0, 4000, 2000), slab("b", 4000, 0, 3000, 2000)],
      [connection("a", "east", "b", "west")],
      [continuousRule("a", "east")],
    );
    const path = throughPath("claim", ["a", "b"], 0, 2000);
    const top = topForPaths([path]);
    const normal = calculateFloorTopNormalRebar(plan, top);
    const context = buildFloorRebarCalculationContextV3(plan);
    const geometry = resolveFloorTopThroughPathGeometryV3(context, path);
    const apply = (pieces: typeof normal.pieces) => applyFloorTopThroughPathsV3({
      context,
      paths: [path],
      geometries: [geometry],
      domains: normal.domains,
      normalLines: normal.lines,
      normalPieces: pieces,
      topAnchorExtraMm: top.topAnchorExtra,
      resolveSettings: (slabId, direction) => {
        const line = normal.lines.find((candidate) =>
          candidate.direction === direction && candidate.slabIds.includes(slabId));
        return line ? { role: line.role, diameter: 10, spacing: 500, extraMode: "both" } : null;
      },
    });
    const target = normal.pieces.find((piece) => piece.direction === "x")!;
    const missing = apply(normal.pieces.filter((piece) => piece.id !== target.id));
    expect(missing.errors.map((item) => item.code)).toContain("through-path-normal-piece-missing");
    expect(missing.lines).toEqual(normal.lines);
    expect(missing.pieces).toEqual(normal.pieces.filter((piece) => piece.id !== target.id));
    expect(missing.resolvedPaths).toEqual([]);

    const ambiguous = apply([...normal.pieces, { ...target, id: `${target.id}:duplicate` }]);
    expect(ambiguous.errors.map((item) => item.code)).toContain("through-path-normal-piece-ambiguous");
    expect(ambiguous.resolvedPaths).toEqual([]);

    const crossScope = apply(normal.pieces.map((piece) =>
      piece.id === target.id ? { ...piece, runStartMm: piece.runStartMm - 1 } : piece));
    expect(crossScope.errors.map((item) => item.code)).toContain("through-path-normal-piece-crosses-scope");
    expect(crossScope.resolvedPaths).toEqual([]);
  });
});
