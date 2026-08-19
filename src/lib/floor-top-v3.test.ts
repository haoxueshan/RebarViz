import { describe, expect, it, vi } from "vitest";
import type { FloorPlanState, FloorSlab } from "./floor-plan";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "./floor-bottom-calculator";
import {
  buildFloorBottomV3PieceFromDraft,
} from "./floor-bottom-v3";
import { buildFloorRebarCalculationContextV3 } from "./floor-rebar-calculation-context-v3";
import {
  isFloorNormalV3PieceDraftGeometryValid,
  type FloorNormalV3PieceDraft,
} from "./floor-rebar-normal-v3";
import { floorRoleDomainKey, type FloorRebarRoleState } from "./floor-rebar-role";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopState,
} from "./floor-top-calculator";
import * as floorTopAlignment from "./floor-top-alignment";
import {
  resolveFloorTopEndpointExtensionV3,
} from "./floor-top-policy";
import * as floorTopThrough from "./floor-top-through";
import { buildFloorTopV3PieceFromDraft } from "./floor-top-v3";
import { stableFloorConnectionId, type FloorEdgeConnection } from "./floor-topology";
import * as floorTopologySolver from "./floor-topology-solver";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
} from "./floor-topology-repair";
import { theoreticalUnitWeight } from "./slab-calculator";
import { incompleteMengPlan3 } from "./__fixtures__/floor-topology-plan3-incomplete-meng";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: id.toUpperCase(), type: "room", x, y, width, height };
}

function connection(
  aSlabId: string,
  aSide: FloorEdgeConnection["a"]["side"],
  bSlabId: string,
  bSide: FloorEdgeConnection["b"]["side"],
): FloorEdgeConnection {
  return {
    id: stableFloorConnectionId(aSlabId, aSide, bSlabId, bSide),
    a: { slabId: aSlabId, side: aSide, range: { mode: "auto-overlap" } },
    b: { slabId: bSlabId, side: bSide, range: { mode: "auto-overlap" } },
    source: "manual",
    confidence: "confirmed",
    tangentConstraint: { mode: "none" },
  };
}

function v3Plan(
  slabs: FloorSlab[],
  connections: FloorEdgeConnection[] = [],
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

function top(patch: Partial<FloorTopState> = {}): FloorTopState {
  return { ...structuredClone(DEFAULT_FLOOR_TOP_STATE), ...patch };
}

function roles(entries: Array<[string[], "x" | "y"]>): FloorRebarRoleState {
  return {
    mainDirectionOverrides: Object.fromEntries(entries.map(([ids, direction]) => [
      floorRoleDomainKey(ids),
      direction,
    ])),
  };
}

function continuousRule(
  slabId: string,
  side: "west" | "east" | "south" | "north",
): FloorPlanState["supportRules"][number] {
  return {
    id: `${slabId}:${side}:continuous`,
    target: { kind: "slab-edge", slabId, side, range: { mode: "whole" } },
    support: "continuous",
  };
}

function uniformTop(spacing = 200): FloorTopState {
  return top({
    countMode: "project",
    defaults: {
      mainDiameter: 10,
      secondaryDiameter: 10,
      xSpacing: spacing,
      ySpacing: spacing,
      xExtraMode: "both",
      yExtraMode: "both",
    },
  });
}

describe("Floor Rebar V1.4C.4 shared geometry safety", () => {
  it("binds plan, solution and path context to one solve for both formal calculators", () => {
    const plan = v3Plan([slab("a", 0, 0, 4200, 3600)]);
    const context = buildFloorRebarCalculationContextV3(plan);
    expect(context.plan).toBe(plan);
    expect(context.pathContext.plan).toBe(plan);
    expect(context.pathContext.solution).toBe(context.solution);

    const solve = vi.spyOn(floorTopologySolver, "solveFloorTopology");
    solve.mockClear();
    expect(calculateFloorBottomRebar(plan, DEFAULT_FLOOR_BOTTOM_STATE).isValid).toBe(true);
    expect(solve).toHaveBeenCalledTimes(1);
    solve.mockClear();
    expect(calculateFloorTopRebar(plan, uniformTop()).isValid).toBe(true);
    expect(solve).toHaveBeenCalledTimes(1);
    solve.mockRestore();
  });

  it("blocks a gapped final fragment range in shared, Bottom and Top layers", () => {
    const plan = v3Plan([slab("a", 0, 0, 2000, 1000)]);
    const context = buildFloorRebarCalculationContextV3(plan).pathContext;
    const domain = {
      id: "test-domain",
      slabIds: ["a"],
      cellIds: [],
      minX: 0,
      minY: 0,
      maxX: 2000,
      maxY: 1000,
    };
    const line = {
      id: "test-line",
      domainId: domain.id,
      slabIds: ["a"],
      layer: "top" as const,
      direction: "x" as const,
      role: "main" as const,
      source: "normal" as const,
      positionMm: 500,
    };
    const draft: FloorNormalV3PieceDraft = {
      fragments: [
        { slabId: "a", startMm: 0, endMm: 1000, lengthMm: 1000 },
        { slabId: "a", startMm: 1200, endMm: 2000, lengthMm: 800 },
      ],
      startEndpoint: {
        kind: "exterior",
        slabId: "a",
        side: "west",
        runMm: 0,
        support: "outer-wall",
        exteriorRangeStartMm: 0,
        exteriorRangeEndMm: 1000,
      },
      endEndpoint: {
        kind: "exterior",
        slabId: "a",
        side: "east",
        runMm: 2000,
        support: "outer-wall",
        exteriorRangeStartMm: 0,
        exteriorRangeEndMm: 1000,
      },
      chainId: "chain",
      sourceOpeningIds: [],
      chainIndex: 0,
      pieceIndex: 0,
    };
    expect(isFloorNormalV3PieceDraftGeometryValid(draft)).toBe(false);
    expect(buildFloorBottomV3PieceFromDraft({
      context,
      domain,
      line: { ...line, layer: "bottom" },
      diameter: 10,
      spacing: 200,
      outerWallThicknessMm: 370,
    }, draft).issues.map((issue) => issue.code)).toEqual(["bottom-v3-piece-geometry-mismatch"]);
    expect(buildFloorTopV3PieceFromDraft({
      context,
      domain,
      line,
      diameter: 10,
      spacing: 200,
      extraMode: "both",
      topAnchorExtraMm: 250,
      outerWallThicknessMm: 370,
    }, draft).issues.map((issue) => issue.code)).toEqual(["top-v3-piece-geometry-mismatch"]);
  });
});

describe("Floor Rebar V1.4C.4 Top endpoint policy and normal golden", () => {
  it("calculates the single-room X/Y goldens and never applies extra at outer walls", () => {
    const result = calculateFloorTopRebar(
      v3Plan([slab("a", 0, 0, 4200, 3600)]),
      uniformTop(),
    );
    const x = result.pieces.filter((piece) => piece.direction === "x");
    const y = result.pieces.filter((piece) => piece.direction === "y");
    expect(result.isValid).toBe(true);
    expect(x).toHaveLength(18);
    expect(y).toHaveLength(21);
    expect(new Set(x.map((piece) => piece.singleLengthMm))).toEqual(new Set([4940]));
    expect(new Set(y.map((piece) => piece.singleLengthMm))).toEqual(new Set([4340]));
    expect(result.pieces.every((piece) =>
      !piece.startExtraApplied
      && !piece.endExtraApplied
      && piece.source === "normal"
      && piece.intermediateWallMm === 0
      && piece.intermediateBoundaryIds.length === 0
      && piece.topExtraValueMm === 250)).toBe(true);
    const bottom = calculateFloorBottomRebar(
      v3Plan([slab("a", 0, 0, 4200, 3600)]),
      DEFAULT_FLOOR_BOTTOM_STATE,
    );
    expect([x[0].startBoundaryId, x[0].endBoundaryId]).toEqual([
      bottom.pieces.find((piece) => piece.direction === "x")!.startBoundaryId,
      bottom.pieces.find((piece) => piece.direction === "x")!.endBoundaryId,
    ]);
  });

  it("applies start/end/both to each physical inner-wall endpoint", () => {
    const oneInner = v3Plan(
      [slab("a", 0, 0, 4200, 3600), slab("b", 4440, 0, 3600, 3600)],
      [connection("a", "east", "b", "west")],
    );
    const oneInnerRoles = roles([[['b'], "x"]]);
    const start = uniformTop();
    start.defaults.xExtraMode = "start";
    const startPiece = calculateFloorTopRebar(oneInner, start, oneInnerRoles).pieces
      .find((piece) => piece.direction === "x" && piece.slabIds[0] === "a")!;
    expect(startPiece).toMatchObject({
      startAnchorMm: 370,
      endAnchorMm: 240,
      startExtraApplied: false,
      endExtraApplied: false,
      singleLengthMm: 4810,
    });
    const end = uniformTop();
    end.defaults.xExtraMode = "end";
    const endPiece = calculateFloorTopRebar(oneInner, end, oneInnerRoles).pieces
      .find((piece) => piece.direction === "x" && piece.slabIds[0] === "a")!;
    expect(endPiece).toMatchObject({ endAnchorMm: 490, endExtraApplied: true, singleLengthMm: 5060 });
    expect([endPiece.startBoundaryId, endPiece.endBoundaryId]).toEqual([
      startPiece.startBoundaryId,
      startPiece.endBoundaryId,
    ]);

    const middle = v3Plan(
      [
        slab("a", 0, 0, 3000, 3600),
        slab("b", 3240, 0, 4000, 3600),
        slab("c", 7480, 0, 3000, 3600),
      ],
      [connection("a", "east", "b", "west"), connection("b", "east", "c", "west")],
    );
    const expected = [
      ["both", 4980, true, true],
      ["start", 4730, true, false],
      ["end", 4730, false, true],
    ] as const;
    expected.forEach(([mode, length, startExtra, endExtra]) => {
      const settings = uniformTop();
      settings.defaults.xExtraMode = mode;
      const piece = calculateFloorTopRebar(middle, settings).pieces
        .find((item) => item.direction === "x" && item.slabIds[0] === "b")!;
      expect(piece).toMatchObject({
        singleLengthMm: length,
        startExtraApplied: startExtra,
        endExtraApplied: endExtra,
      });
    });

    const yPlan = v3Plan(
      [slab("a", 0, 0, 3600, 4200), slab("b", 0, 4440, 3600, 3600)],
      [connection("a", "north", "b", "south")],
    );
    const ySettings = uniformTop();
    ySettings.defaults.yExtraMode = "end";
    expect(calculateFloorTopRebar(yPlan, ySettings, roles([[['b'], "x"]])).pieces
      .find((piece) => piece.direction === "y" && piece.slabIds[0] === "a"))
      .toMatchObject({ endAnchorMm: 490, endExtraApplied: true, singleLengthMm: 5060 });
  });

  it("keeps extraApplied true when a selected inner-wall extra value is zero and blocks bad inputs", () => {
    const endpoint = {
      kind: "opening-boundary" as const,
      openingId: "o",
      side: "west" as const,
      runMm: 1000,
      positionMm: 500,
      support: "inner-wall" as const,
      thicknessMm: 240,
      boundaryRangeStartMm: 0,
      boundaryRangeEndMm: 1000,
      matchingRuleIds: ["rule"],
      boundaryId: "v3-opening:o:west:0:1000:inner-wall",
    };
    const zeroExtra = resolveFloorTopEndpointExtensionV3(endpoint, "end", "end", 0, 370);
    expect(zeroExtra).toMatchObject({ extensionMm: 240, extraApplied: true });
    expect(zeroExtra.error).toBeUndefined();
    expect(resolveFloorTopEndpointExtensionV3(endpoint, "end", "end", Number.NaN, 370).error?.code)
      .toBe("top-v3-endpoint-extension-invalid");
    expect(resolveFloorTopEndpointExtensionV3({
      kind: "connection-boundary",
      slabId: "a",
      otherSlabId: "b",
      side: "east",
      runMm: 1000,
      connectionId: "continuous",
      support: "continuous",
      gapMm: 0,
      wallThicknessMm: 0,
      overlapRangeStartMm: 0,
      overlapRangeEndMm: 1000,
    }, "end", "both", 250, 370).error?.code).toBe("top-v3-continuous-domain-boundary");
    expect(resolveFloorTopEndpointExtensionV3({
      kind: "exterior",
      slabId: "a",
      side: "west",
      runMm: 0,
      support: "outer-wall",
      exteriorRangeStartMm: 0,
      exteriorRangeEndMm: 1000,
    }, "start", "both", 250, Number.POSITIVE_INFINITY).error?.code)
      .toBe("top-v3-endpoint-extension-invalid");

    const zeroState = uniformTop();
    zeroState.topAnchorExtra = 0;
    const innerPlan = v3Plan(
      [slab("a", 0, 0, 3000, 2400), slab("b", 3240, 0, 3000, 2400)],
      [connection("a", "east", "b", "west")],
    );
    const zeroResult = calculateFloorTopRebar(innerPlan, zeroState);
    expect(zeroResult.isValid).toBe(true);
    expect(zeroResult.pieces.some((piece) => piece.endExtraApplied && piece.endAnchorMm === 240))
      .toBe(true);
  });
});

describe("Floor Rebar V1.4C.4 continuous, partial support and openings", () => {
  it("merges continuous spans once and splits the mixed physical support rows", () => {
    const continuous = v3Plan(
      [slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)],
      [connection("a", "east", "b", "west")],
      [continuousRule("a", "east")],
    );
    const continuousResult = calculateFloorTopRebar(continuous, uniformTop());
    const continuousX = continuousResult.pieces.filter((piece) => piece.direction === "x");
    expect(continuousResult.domains).toHaveLength(1);
    expect(continuousX).toHaveLength(18);
    expect(continuousX.every((piece) =>
      piece.netLengthMm === 7800
      && piece.singleLengthMm === 8540
      && piece.slabIds.join("|") === "a|b")).toBe(true);

    const partial = v3Plan(
      [
        slab("a-lower", 0, 0, 4000, 2000),
        slab("b-lower", 4000, 0, 4000, 2000),
        slab("a-upper", 0, 2000, 4000, 2000),
        slab("b-upper", 4240, 2000, 4000, 2000),
      ],
      [
        connection("a-lower", "east", "b-lower", "west"),
        connection("a-upper", "east", "b-upper", "west"),
        connection("a-lower", "north", "a-upper", "south"),
        connection("b-lower", "north", "b-upper", "south"),
      ],
      [
        continuousRule("a-lower", "east"),
        continuousRule("a-lower", "north"),
        continuousRule("b-lower", "north"),
      ],
    );
    const partialResult = calculateFloorTopRebar(
      partial,
      uniformTop(1000),
      roles([[partial.slabs.map((item) => item.id), "x"]]),
    );
    const lines = partialResult.lines.filter((line) => line.direction === "x");
    const pieces = partialResult.pieces.filter((piece) => piece.direction === "x");
    expect(partialResult.isValid).toBe(true);
    expect(lines).toHaveLength(4);
    expect(pieces).toHaveLength(6);
    expect(pieces.filter((piece) => piece.singleLengthMm === 8740)).toHaveLength(2);
    expect(pieces.filter((piece) => piece.singleLengthMm === 4860)).toHaveLength(4);
  });

  it("keeps V3 count modes and continuous settings validation contracts", () => {
    const countPlan = v3Plan([slab("a", 0, 0, 3500, 3270)]);
    const counts = (["project", "round", "floor"] as const).map((countMode) => {
      const settings = uniformTop(160);
      settings.countMode = countMode;
      const result = calculateFloorTopRebar(countPlan, settings);
      return [
        result.lines.filter((line) => line.direction === "x").length,
        result.lines.filter((line) => line.direction === "y").length,
      ];
    });
    expect(counts).toEqual([[21, 22], [20, 22], [20, 21]]);

    const continuous = v3Plan(
      [slab("a", 0, 0, 3000, 2400), slab("b", 3000, 0, 3000, 2400)],
      [connection("a", "east", "b", "west")],
      [continuousRule("a", "east")],
    );
    const conflict = uniformTop();
    conflict.slabOverrides.b = { xSpacing: 150, xExtraMode: "start" };
    const blocked = calculateFloorTopRebar(continuous, conflict);
    expect(blocked.errors.map((issue) => issue.code)).toContain("top-continuous-settings-conflict");
    expect(blocked).toMatchObject({ lines: [], pieces: [], groups: [], totalWeightKg: null });
  });

  it("clips openings without changing lines and applies west/east endpoint modes physically", () => {
    const opening = { id: "o", name: "O", type: "void" as const, x: 2000, y: 2000, width: 2000, height: 2000 };
    const plainPlan = v3Plan([slab("a", 0, 0, 6000, 6000)]);
    const cutPlan = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [], [opening]);
    const settings = uniformTop(1000);
    const role = roles([[['a'], "x"]]);
    const plain = calculateFloorTopRebar(plainPlan, settings, role);
    const cut = calculateFloorTopRebar(cutPlan, settings, role);
    expect(cut.lines).toEqual(plain.lines);
    expect(cut.lines.filter((line) => line.direction === "x")).toHaveLength(6);
    expect(cut.pieces.filter((piece) =>
      piece.direction === "x" && piece.singleLengthMm === 2370)).toHaveLength(4);
    expect(cut.pieces.filter((piece) =>
      piece.startSupport === "opening-cut" || piece.endSupport === "opening-cut")
      .every((piece) => !piece.startExtraApplied && !piece.endExtraApplied)).toBe(true);

    const westInner = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [{
      id: "west-inner",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "inner-wall",
    }], [opening]);
    const end = uniformTop(1000);
    end.defaults.xExtraMode = "end";
    const endPieces = calculateFloorTopRebar(westInner, end, role).pieces
      .filter((piece) => piece.direction === "x" && piece.runEndMm === 2000);
    expect(endPieces).toHaveLength(2);
    expect(endPieces.every((piece) =>
      piece.endAnchorMm === 490
      && piece.endExtraApplied
      && piece.singleLengthMm === 2860)).toBe(true);
    const start = uniformTop(1000);
    start.defaults.xExtraMode = "start";
    expect(calculateFloorTopRebar(westInner, start, role).pieces
      .filter((piece) => piece.direction === "x" && piece.runEndMm === 2000)
      .every((piece) =>
        piece.endAnchorMm === 240
        && !piece.endExtraApplied
        && piece.singleLengthMm === 2610)).toBe(true);

    const eastInner = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [{
      id: "east-inner",
      target: { kind: "opening-edge", openingId: "o", side: "east", range: { mode: "whole" } },
      support: "inner-wall",
    }], [opening]);
    expect(calculateFloorTopRebar(eastInner, start, role).pieces
      .filter((piece) => piece.direction === "x" && piece.runStartMm === 4000)
      .every((piece) => piece.startAnchorMm === 490 && piece.startExtraApplied)).toBe(true);
  });

  it("resolves partial opening support, multiple cuts, complete removal and outside warnings", () => {
    const opening = { id: "o", name: "O", type: "void" as const, x: 2000, y: 2000, width: 2000, height: 1000 };
    const partial = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [{
      id: "west-partial",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "offset", startMm: 0, endMm: 500 } },
      support: "inner-wall",
    }], [opening]);
    const result = calculateFloorTopRebar(partial, uniformTop(500), roles([[['a'], "x"]]));
    const lineById = new Map(result.lines.map((line) => [line.id, line]));
    const west = result.pieces.filter((piece) => piece.direction === "x" && piece.runEndMm === 2000);
    expect(west.find((piece) => lineById.get(piece.lineId)?.positionMm === 2250)?.endSupport)
      .toBe("inner-wall");
    expect(west.find((piece) => lineById.get(piece.lineId)?.positionMm === 2750)?.endSupport)
      .toBe("opening-cut");

    const base = slab("a", 0, 0, 5000, 1000);
    const multiple = calculateFloorTopRebar(v3Plan([base], [], [], [
      { id: "o1", name: "O1", type: "void", x: 1000, y: 0, width: 500, height: 1000 },
      { id: "o2", name: "O2", type: "void", x: 3000, y: 0, width: 500, height: 1000 },
    ]), uniformTop(6000));
    expect(multiple.pieces.filter((piece) => piece.direction === "x")
      .map((piece) => [piece.runStartMm, piece.runEndMm]))
      .toEqual([[0, 1000], [1500, 3000], [3500, 5000]]);

    const removed = calculateFloorTopRebar(v3Plan([base], [], [], [{
      id: "all", name: "All", type: "void", x: 0, y: 0, width: 5000, height: 1000,
    }]), uniformTop(6000));
    expect(removed.isValid).toBe(true);
    expect(removed.pieces.filter((piece) => piece.direction === "x")).toEqual([]);

    const plain = calculateFloorTopRebar(v3Plan([base]), uniformTop(6000));
    const outside = calculateFloorTopRebar(v3Plan([base], [], [], [{
      id: "outside", name: "Outside", type: "void", x: 6000, y: 0, width: 500, height: 500,
    }]), uniformTop(6000));
    expect(outside.warnings.map((issue) => issue.code)).toContain("opening-uncovered");
    expect(outside.pieces).toEqual(plain.pieces);

    const invalidSupport = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [{
      id: "opening-continuous",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "continuous",
    }], [opening]);
    expect(calculateFloorTopRebar(invalidSupport, uniformTop(), roles([[['a'], "x"]])).errors
      .map((issue) => issue.code)).toContain("support-type-invalid");

    const conflict = v3Plan([slab("a", 0, 0, 6000, 6000)], [], [
      {
        id: "cut",
        target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
        support: "opening-cut",
      },
      {
        id: "wall",
        target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
        support: "inner-wall",
      },
    ], [opening]);
    const conflictResult = calculateFloorTopRebar(conflict, uniformTop(), roles([[['a'], "x"]]));
    expect(conflictResult.errors.map((issue) => issue.code)).toContain("support-rule-conflict");
    expect(conflictResult.pieces).toEqual([]);

    const partialOutside = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [], [{
      id: "partial-outside",
      name: "Partial Outside",
      type: "void",
      x: -500,
      y: 0,
      width: 1500,
      height: 3000,
    }]);
    const partialOutsideResult = calculateFloorTopRebar(partialOutside, uniformTop());
    expect(partialOutsideResult.isValid).toBe(true);
    expect(partialOutsideResult.warnings.map((issue) => issue.code)).toContain("opening-partial-outside");
    expect(partialOutsideResult.pieces.some((piece) => piece.startSupport === "opening-cut"))
      .toBe(true);
  });

  it("keeps multiple spatial chains and fragment slab traceability", () => {
    const plan = v3Plan(
      [
        slab("left", 0, 0, 100, 300),
        slab("bottom", 100, 0, 100, 100),
        slab("right", 200, 0, 100, 300),
      ],
      [
        connection("left", "east", "bottom", "west"),
        connection("bottom", "east", "right", "west"),
      ],
      [continuousRule("left", "east"), continuousRule("bottom", "east")],
    );
    plan.innerWallThickness = 20;
    plan.outerWallThickness = 20;
    const result = calculateFloorTopRebar(
      plan,
      uniformTop(200),
      roles([[plan.slabs.map((item) => item.id), "x"]]),
    );
    const line = result.lines.find((item) => item.direction === "x" && item.positionMm > 100)!;
    const pieces = result.pieces.filter((piece) => piece.lineId === line.id);
    expect(pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 100], [200, 300]]);
    expect(pieces.map((piece) => piece.slabIds)).toEqual([["left"], ["right"]]);
  });
});

describe("Floor Rebar V1.4C.4 Meng, BOM and Through guard", () => {
  it("locks Meng B and K Top goldens to repaired formal topology", () => {
    const source = incompleteMengPlan3();
    const candidates = detectFloorTopologyRepairCandidates(source).candidates;
    const repaired = applyFloorTopologyRepairs(source, candidates.map((candidate) => ({
      candidateId: candidate.id,
      action: "inner-wall" as const,
    })));
    if (!repaired.ok) throw new Error(repaired.message);
    const result = calculateFloorTopRebar(repaired.plan, uniformTop());
    expect(result.isValid).toBe(true);
    const bX = result.pieces.filter((piece) =>
      piece.direction === "x" && piece.slabIds.join("|") === "meng-b");
    const bY = result.pieces.filter((piece) =>
      piece.direction === "y" && piece.slabIds.join("|") === "meng-b");
    expect(bX).toHaveLength(17);
    expect(bY).toHaveLength(18);
    expect(new Set(bX.map((piece) => piece.singleLengthMm))).toEqual(new Set([4480]));
    expect(new Set(bY.map((piece) => piece.singleLengthMm))).toEqual(new Set([4000]));
    expect(bX.every((piece) =>
      piece.startSupport === "inner-wall"
      && piece.endSupport === "inner-wall"
      && piece.startExtraApplied
      && piece.endExtraApplied)).toBe(true);
    expect(bY.every((piece) =>
      piece.startSupport === "inner-wall"
      && piece.endSupport === "outer-wall"
      && piece.startExtraApplied
      && !piece.endExtraApplied)).toBe(true);

    const context = buildFloorRebarCalculationContextV3(repaired.plan).pathContext;
    const kDomainId = result.domains.find((domain) =>
      domain.slabIds.join("|") === "meng-k")!.id;
    const upperPosition = (
      Math.max(
        context.slabsById.get("meng-e")!.y,
        context.slabsById.get("meng-k")!.y,
        context.slabsById.get("meng-c")!.y,
      )
      + Math.min(
        context.slabsById.get("meng-e")!.y + context.slabsById.get("meng-e")!.height,
        context.slabsById.get("meng-k")!.y + context.slabsById.get("meng-k")!.height,
        context.slabsById.get("meng-c")!.y + context.slabsById.get("meng-c")!.height,
      )
    ) / 2;
    const lowerPosition = (
      Math.max(
        context.slabsById.get("meng-f")!.y,
        context.slabsById.get("meng-k")!.y,
        context.slabsById.get("meng-l")!.y,
      )
      + Math.min(
        context.slabsById.get("meng-f")!.y + context.slabsById.get("meng-f")!.height,
        context.slabsById.get("meng-k")!.y + context.slabsById.get("meng-k")!.height,
        context.slabsById.get("meng-l")!.y + context.slabsById.get("meng-l")!.height,
      )
    ) / 2;
    const upperLine = result.lines.find((line) =>
      line.domainId === kDomainId
      && line.direction === "x"
      && Math.abs(line.positionMm - upperPosition) <= 100);
    const lowerLine = result.lines.find((line) =>
      line.domainId === kDomainId
      && line.direction === "x"
      && Math.abs(line.positionMm - lowerPosition) <= 100);
    const upper = result.pieces.find((piece) => piece.lineId === upperLine?.id)!;
    const lower = result.pieces.find((piece) => piece.lineId === lowerLine?.id)!;
    expect(upper).toMatchObject({
      singleLengthMm: 8250,
      startBoundaryId: "connection:meng-e:east:meng-k:west",
      endBoundaryId: "connection:meng-c:west:meng-k:east",
      startExtraApplied: true,
      endExtraApplied: true,
    });
    expect(lower).toMatchObject({
      singleLengthMm: 8250,
      startBoundaryId: "connection:meng-f:east:meng-k:west",
      endBoundaryId: "connection:meng-k:east:meng-l:west",
      startExtraApplied: true,
      endExtraApplied: true,
    });
  });

  it("keeps BOM, totals, deterministic output and inputs consistent", () => {
    const plan = v3Plan([slab("a", 0, 0, 4200, 3600)]);
    const settings = uniformTop();
    const role = roles([]);
    const before = structuredClone({ plan, settings, role });
    const first = calculateFloorTopRebar(plan, settings, role);
    const second = calculateFloorTopRebar(plan, settings, role);
    const pieceLength = first.pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000, 0);
    const groupLength = first.groups.reduce((sum, group) => sum + group.totalLengthM, 0);
    const groupWeight = first.groups.reduce((sum, group) => sum + group.weightKg, 0);
    expect(second).toEqual(first);
    expect({ plan, settings, role }).toEqual(before);
    expect(first.totalPieces).toBe(first.pieces.length);
    expect(first.totalBarLines).toBe(first.lines.length);
    expect(first.normalPieceCount).toBe(first.pieces.length);
    expect(first.throughPieceCount).toBe(0);
    expect(pieceLength).toBeCloseTo(first.totalLengthM, 10);
    expect(groupLength).toBeCloseTo(first.totalLengthM, 10);
    expect(groupWeight).toBeCloseTo(first.totalWeightKg!, 10);
    expect(first.totalWeightKg).toBeCloseTo(
      first.totalLengthM * theoreticalUnitWeight(10),
      10,
    );
  });

  it("keeps disabled Through unchanged and routes enabled V3 paths away from Legacy functions", () => {
    const plan = v3Plan([slab("a", 0, 0, 4200, 3600)]);
    const path = {
      id: "path",
      name: "Through",
      direction: "x" as const,
      slabIds: ["a"],
      bandStartMm: 0,
      bandEndMm: 1000,
      enabled: false,
    };
    const disabled = uniformTop();
    disabled.throughPaths = [path];
    const disabledResult = calculateFloorTopRebar(plan, disabled);
    expect(disabledResult.isValid).toBe(true);
    expect(disabledResult.alignmentPlan).toEqual({
      groups: [],
      phaseByDomainDirection: new Map(),
      errors: [],
      warnings: [],
    });
    expect(disabledResult.pieces.every((piece) => piece.source === "normal")).toBe(true);

    const align = vi.spyOn(floorTopAlignment, "buildFloorTopAlignmentPlan");
    const apply = vi.spyOn(floorTopThrough, "applyFloorTopThroughPaths");
    align.mockClear();
    apply.mockClear();
    const enabled = structuredClone(disabled);
    enabled.throughPaths[0].enabled = true;
    const blocked = calculateFloorTopRebar(plan, enabled);
    expect(blocked.isValid).toBe(false);
    expect(blocked.errors.map((issue) => issue.code)).toContain("through-path-chain-invalid");
    expect(blocked.errors.map((issue) => issue.code)).not.toContain("top-v3-through-not-ready");
    expect(blocked).toMatchObject({
      lines: [],
      pieces: [],
      groups: [],
      resolvedThroughPaths: [],
      totalWeightKg: null,
    });
    expect(align).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    align.mockRestore();
    apply.mockRestore();

    expect(floorTopThrough.resolveFloorTopThroughPathGeometry(plan, {
      ...path,
      enabled: true,
    }).errors.map((issue) => issue.code)).toContain("topology-v3-calculation-not-ready");
  });
});
