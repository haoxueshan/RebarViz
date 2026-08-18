import { describe, expect, it } from "vitest";
import type { FloorPlanState, FloorSlab } from "./floor-plan";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
  type FloorBottomState,
} from "./floor-bottom-calculator";
import {
  buildFloorBottomV3LinePieces,
  resolveFloorBottomEndpointExtensionV3,
} from "./floor-bottom-v3";
import { buildFloorRebarPathContextV3 } from "./floor-rebar-path";
import { floorRoleDomainKey, type FloorRebarRoleState } from "./floor-rebar-role";
import { stableFloorConnectionId, type FloorEdgeConnection } from "./floor-topology";
import {
  applyFloorTopologyRepairs,
  detectFloorTopologyRepairCandidates,
} from "./floor-topology-repair";
import { incompleteMengPlan3 } from "./__fixtures__/floor-topology-plan3-incomplete-meng";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: id.toUpperCase(), type: "room", x, y, width, height };
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
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function connection(
  aSlabId: string,
  aSide: FloorEdgeConnection["a"]["side"],
  bSlabId: string,
  bSide: FloorEdgeConnection["b"]["side"],
  range: FloorEdgeConnection["a"]["range"] = { mode: "auto-overlap" },
): FloorEdgeConnection {
  return {
    id: stableFloorConnectionId(aSlabId, aSide, bSlabId, bSide),
    a: { slabId: aSlabId, side: aSide, range },
    b: { slabId: bSlabId, side: bSide, range: { ...range } },
    source: "manual",
    confidence: "confirmed",
    tangentConstraint: { mode: "none" },
  };
}

function bottom(patch: Partial<FloorBottomState> = {}): FloorBottomState {
  return {
    ...structuredClone(DEFAULT_FLOOR_BOTTOM_STATE),
    ...patch,
  };
}

function roleState(entries: Array<[string[], "x" | "y"]>): FloorRebarRoleState {
  return { mainDirectionOverrides: Object.fromEntries(entries.map(([ids, direction]) => [floorRoleDomainKey(ids), direction])) };
}

describe("Floor Rebar V1.4C.2 Bottom Normal Piece Engine", () => {
  it("single room uses physical clear paths and the requested golden lengths", () => {
    const plan = v3Plan([slab("a", 0, 0, 4000, 3000)]);
    const result = calculateFloorBottomRebar(plan, bottom({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200 },
    }));
    expect(result.isValid).toBe(true);
    expect(result.lines).toHaveLength(35);
    expect(result.pieces).toHaveLength(35);
    expect(result.lines.filter((line) => line.direction === "x")).toHaveLength(15);
    expect(result.lines.filter((line) => line.direction === "y")).toHaveLength(20);
    expect(new Set(result.pieces.filter((piece) => piece.direction === "x").map((piece) => piece.singleLengthMm))).toEqual(new Set([4480]));
    expect(new Set(result.pieces.filter((piece) => piece.direction === "y").map((piece) => piece.singleLengthMm))).toEqual(new Set([3480]));
    expect(result.totalLengthM).toBeCloseTo(136.8, 10);
    expect(result.pieces.every((piece) =>
      piece.intermediateWallMm === 0
      && piece.intermediateBoundaryIds.length === 0
      && !piece.startExtraApplied
      && !piece.endExtraApplied
      && piece.topExtraValueMm === 0
      && piece.source === "normal")).toBe(true);
    expect(result.pieces.every((piece) => piece.startBoundaryId.startsWith("v3-exterior:") && piece.endBoundaryId.startsWith("v3-exterior:"))).toBe(true);
  });

  it("continues through a zero-gap connection but splits at an inner wall", () => {
    const continuousPlan = v3Plan(
      [slab("a", 0, 0, 4000, 3000), slab("b", 4000, 0, 3500, 3000)],
      [connection("a", "east", "b", "west")],
      [
        { id: "a-cont", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "b-cont", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "continuous" },
      ],
    );
    const continuous = calculateFloorBottomRebar(continuousPlan, bottom());
    expect(continuous.isValid).toBe(true);
    expect(continuous.domains).toHaveLength(1);
    expect(continuous.pieces.filter((piece) => piece.direction === "x")).toHaveLength(20);
    expect(new Set(continuous.pieces.filter((piece) => piece.direction === "x").map((piece) => piece.singleLengthMm))).toEqual(new Set([7980]));
    const conflicting = bottom();
    conflicting.slabOverrides.b = { secondaryDiameter: 14 };
    const settingsConflict = calculateFloorBottomRebar(continuousPlan, conflicting);
    expect(settingsConflict.errors.map((issue) => issue.code)).toContain("bottom-continuous-settings-conflict");
    expect(settingsConflict.groups).toEqual([]);

    const innerPlan = v3Plan(
      [slab("a", 0, 0, 4000, 3000), slab("b", 4240, 0, 3500, 3000)],
      [connection("a", "east", "b", "west")],
    );
    const inner = calculateFloorBottomRebar(innerPlan, bottom());
    expect(inner.isValid).toBe(true);
    expect(inner.domains).toHaveLength(2);
    expect(inner.pieces.filter((piece) => piece.direction === "x")).toHaveLength(40);
    expect(inner.pieces.filter((piece) => piece.direction === "x").every((piece) => piece.singleLengthMm === 4480 || piece.singleLengthMm === 3980)).toBe(true);
    expect(inner.pieces.some((piece) => piece.endSupport === "inner-wall")).toBe(true);
    expect(inner.pieces.some((piece) => piece.startSupport === "inner-wall")).toBe(true);
  });

  it("splits a partial continuous domain by the active scanline support", () => {
    const plan = v3Plan(
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
        { id: "lower-row", target: { kind: "slab-edge", slabId: "a-lower", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "a-column", target: { kind: "slab-edge", slabId: "a-lower", side: "north", range: { mode: "whole" } }, support: "continuous" },
        { id: "b-column", target: { kind: "slab-edge", slabId: "b-lower", side: "north", range: { mode: "whole" } }, support: "continuous" },
      ],
    );
    const result = calculateFloorBottomRebar(plan, bottom({
      defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000 },
    }), roleState([[plan.slabs.map((item) => item.id), "x"]]));
    expect(result.errors).toEqual([]);
    const xLines = result.lines.filter((line) => line.direction === "x");
    const xPieces = result.pieces.filter((piece) => piece.direction === "x");
    expect(xLines).toHaveLength(4);
    expect(xPieces).toHaveLength(6);
    const lineById = new Map(xLines.map((line) => [line.id, line]));
    expect(xPieces.filter((piece) => piece.singleLengthMm === 8480).map((piece) => lineById.get(piece.lineId)?.positionMm)).toEqual([500, 1500]);
    expect(xPieces.filter((piece) => piece.singleLengthMm === 4480).length).toBe(4);
  });

  it("splits A-inner-B-continuous-C-inner-D into A, B+C, and D", () => {
    const plan = v3Plan(
      [
        slab("a", 0, 0, 100, 100),
        slab("b", 120, 0, 200, 100),
        slab("c", 320, 0, 300, 100),
        slab("d", 640, 0, 400, 100),
        slab("bridge", 0, 100, 1040, 50),
      ],
      [
        connection("a", "east", "b", "west"),
        connection("b", "east", "c", "west"),
        connection("c", "east", "d", "west"),
        connection("a", "north", "bridge", "south"),
        connection("b", "north", "bridge", "south"),
        connection("c", "north", "bridge", "south"),
        connection("d", "north", "bridge", "south"),
      ],
      [
        { id: "bc", target: { kind: "slab-edge", slabId: "b", side: "east", range: { mode: "whole" } }, support: "continuous" },
        ...["a", "b", "c", "d"].map((slabId) => ({
          id: `${slabId}-bridge`,
          target: { kind: "slab-edge" as const, slabId, side: "north" as const, range: { mode: "whole" as const } },
          support: "continuous" as const,
        })),
      ],
    );
    plan.innerWallThickness = 20;
    plan.outerWallThickness = 20;
    const ids = plan.slabs.map((item) => item.id);
    const result = calculateFloorBottomRebar(plan, bottom({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200 },
    }), roleState([[ids, "x"]]));
    expect(result.errors).toEqual([]);
    const xPieces = result.pieces.filter((piece) => piece.direction === "x");
    expect(xPieces.map((piece) => piece.netLengthMm)).toEqual([100, 500, 400]);
    expect(xPieces.map((piece) => piece.singleLengthMm)).toEqual([140, 540, 440]);
    expect(xPieces[0].endBoundaryId).toBe(xPieces[1].startBoundaryId);
    expect(xPieces[1].endBoundaryId).toBe(xPieces[2].startBoundaryId);
    expect(xPieces[1].slabIds).toEqual(["b", "c"]);
  });

  it("keeps two spatial chains on one concave-domain line as two pieces", () => {
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
      [
        { id: "left-bottom", target: { kind: "slab-edge", slabId: "left", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "bottom-right", target: { kind: "slab-edge", slabId: "bottom", side: "east", range: { mode: "whole" } }, support: "continuous" },
      ],
    );
    plan.innerWallThickness = 20;
    plan.outerWallThickness = 20;
    const result = calculateFloorBottomRebar(plan, bottom({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 100, ySpacing: 100 },
    }), roleState([[plan.slabs.map((item) => item.id), "x"]]));
    expect(result.errors).toEqual([]);
    const line = result.lines.find((item) => item.direction === "x" && item.positionMm === 150)!;
    const pieces = result.pieces.filter((piece) => piece.lineId === line.id);
    expect(pieces).toHaveLength(2);
    expect(pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 100], [200, 300]]);
  });

  it("uses solved Meng wall thickness and stable connection boundary IDs", () => {
    const source = incompleteMengPlan3();
    const candidates = detectFloorTopologyRepairCandidates(source).candidates;
    const repaired = applyFloorTopologyRepairs(source, candidates.map((candidate) => ({ candidateId: candidate.id, action: "inner-wall" as const })));
    if (!repaired.ok) throw new Error(repaired.message);
    const before = structuredClone(repaired.plan);
    const result = calculateFloorBottomRebar(repaired.plan, bottom({
      countMode: "round",
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 160, ySpacing: 160 },
    }));
    expect(result.isValid).toBe(true);
    expect(repaired.plan).toEqual(before);
    const bX = result.pieces.filter((piece) => piece.slabIds.length === 1 && piece.slabIds[0] === "meng-b" && piece.direction === "x");
    expect(bX).toHaveLength(20);
    expect(new Set(bX.map((piece) => piece.singleLengthMm))).toEqual(new Set([3980]));
    const bY = result.pieces.filter((piece) => piece.slabIds.length === 1 && piece.slabIds[0] === "meng-b" && piece.direction === "y");
    expect(bY).toHaveLength(22);
    expect(new Set(bY.map((piece) => piece.singleLengthMm))).toEqual(new Set([3750]));

    const context = buildFloorRebarPathContextV3(repaired.plan);
    const k = result.pieces.filter((piece) => piece.slabIds.length === 1 && piece.slabIds[0] === "meng-k" && piece.direction === "x");
    const upperPosition = (Math.max(context.slabsById.get("meng-e")!.y, context.slabsById.get("meng-k")!.y, context.slabsById.get("meng-c")!.y)
      + Math.min(context.slabsById.get("meng-e")!.y + context.slabsById.get("meng-e")!.height, context.slabsById.get("meng-k")!.y + context.slabsById.get("meng-k")!.height, context.slabsById.get("meng-c")!.y + context.slabsById.get("meng-c")!.height)) / 2;
    const lowerPosition = (Math.max(context.slabsById.get("meng-f")!.y, context.slabsById.get("meng-k")!.y, context.slabsById.get("meng-l")!.y)
      + Math.min(context.slabsById.get("meng-f")!.y + context.slabsById.get("meng-f")!.height, context.slabsById.get("meng-k")!.y + context.slabsById.get("meng-k")!.height, context.slabsById.get("meng-l")!.y + context.slabsById.get("meng-l")!.height)) / 2;
    const kDomainId = result.domains.find((domain) => domain.slabIds.length === 1 && domain.slabIds[0] === "meng-k")!.id;
    const upperLine = result.lines.find((line) => line.domainId === kDomainId && line.direction === "x" && Math.abs(line.positionMm - upperPosition) < 81);
    const lowerLine = result.lines.find((line) => line.domainId === kDomainId && line.direction === "x" && Math.abs(line.positionMm - lowerPosition) < 81);
    expect(upperLine).toBeDefined();
    expect(lowerLine).toBeDefined();
    const upper = k.find((piece) => piece.lineId === upperLine?.id)!;
    const lower = k.find((piece) => piece.lineId === lowerLine?.id)!;
    expect(upper.singleLengthMm).toBe(7750);
    expect(lower.singleLengthMm).toBe(7750);
    expect([upper.startBoundaryId, upper.endBoundaryId]).toEqual(["connection:meng-e:east:meng-k:west", "connection:meng-c:west:meng-k:east"]);
    expect([lower.startBoundaryId, lower.endBoundaryId]).toEqual(["connection:meng-f:east:meng-k:west", "connection:meng-k:east:meng-l:west"]);
  });

  it("blocks V3 openings, invalid endpoints, and remains deterministic", () => {
    const plan = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [], [{ id: "o", name: "O", type: "void", x: 100, y: 100, width: 200, height: 200 }]);
    const result = calculateFloorBottomRebar(plan, bottom());
    expect(result.isValid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("bottom-v3-opening-clipping-not-ready");
    expect(result.lines).toEqual([]);
    expect(result.groups).toEqual([]);
    const stablePlan = v3Plan([slab("a", 0, 0, 4000, 3000)]);
    const stableBottom = bottom();
    const stableRole = roleState([]);
    const inputBefore = structuredClone({ plan: stablePlan, bottom: stableBottom, role: stableRole });
    const first = calculateFloorBottomRebar(stablePlan, stableBottom, stableRole);
    const second = calculateFloorBottomRebar(stablePlan, stableBottom, stableRole);
    expect(second).toEqual(first);
    expect({ plan: stablePlan, bottom: stableBottom, role: stableRole }).toEqual(inputBefore);
    const extension = resolveFloorBottomEndpointExtensionV3({
      kind: "connection-boundary",
      slabId: "a",
      otherSlabId: "b",
      side: "east",
      runMm: 100,
      connectionId: "continuous",
      support: "continuous",
      gapMm: 0,
      wallThicknessMm: 0,
      overlapRangeStartMm: 0,
      overlapRangeEndMm: 100,
    }, 240);
    expect(extension.error?.code).toBe("bottom-v3-continuous-domain-boundary");
    const continuousPlan = v3Plan(
      [slab("a", 0, 0, 100, 100), slab("b", 100, 0, 100, 100)],
      [connection("a", "east", "b", "west")],
      [{ id: "continuous", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" }],
    );
    continuousPlan.innerWallThickness = 20;
    continuousPlan.outerWallThickness = 20;
    const mismatched = buildFloorBottomV3LinePieces({
      context: buildFloorRebarPathContextV3(continuousPlan),
      domain: { id: "bad-domain", slabIds: ["a"], cellIds: [], minX: 0, minY: 0, maxX: 100, maxY: 100 },
      line: { id: "bad-line", domainId: "bad-domain", slabIds: ["a"], layer: "bottom", direction: "x", role: "main", source: "normal", positionMm: 50 },
      diameter: 10,
      spacing: 100,
      outerWallThicknessMm: 20,
    });
    expect(mismatched.pieces).toEqual([]);
    expect(mismatched.issues.map((issue) => issue.code)).toContain("bottom-v3-continuous-domain-boundary");
    const invalidOuter = resolveFloorBottomEndpointExtensionV3({
      kind: "exterior",
      slabId: "a",
      side: "west",
      runMm: 0,
      support: "outer-wall",
      exteriorRangeStartMm: 0,
      exteriorRangeEndMm: 100,
    }, Number.NaN);
    expect(invalidOuter.error?.code).toBe("bottom-v3-endpoint-extension-invalid");
    const review = calculateFloorBottomRebar(stablePlan, stableBottom, stableRole, true);
    expect(review.errors.map((issue) => issue.code)).toContain("bottom-role-review-required");
    expect(review.groups).toEqual([]);
  });

  it("blocks global wall-slab geometry errors without partial output", () => {
    const plan = v3Plan(
      [
        slab("a", 0, 0, 100, 100),
        slab("b", 120, 0, 100, 100),
        slab("c", 105, 10, 10, 80),
      ],
      [connection("a", "east", "b", "west")],
    );
    plan.innerWallThickness = 20;
    plan.outerWallThickness = 20;
    const result = calculateFloorBottomRebar(plan, bottom(), roleState([[['a'], "x"], [['b'], "x"], [['c'], "x"]]));
    expect(result.errors.map((issue) => issue.code)).toContain("wall-slab-overlap");
    expect(result).toMatchObject({ isValid: false, lines: [], pieces: [], groups: [], totalWeightKg: null });
  });

  it("retains the countBars project/round/floor contract", () => {
    const plan = v3Plan([slab("a", 0, 0, 3500, 3270)]);
    const counts = (["project", "round", "floor"] as const).map((countMode) => {
      const result = calculateFloorBottomRebar(plan, bottom({ countMode, defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 160, ySpacing: 160 } }));
      return [
        result.lines.filter((line) => line.direction === "x").length,
        result.lines.filter((line) => line.direction === "y").length,
      ];
    });
    expect(counts).toEqual([[21, 22], [20, 22], [20, 21]]);
  });
});
