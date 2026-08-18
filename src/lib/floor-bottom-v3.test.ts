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
import { theoreticalUnitWeight } from "./slab-calculator";
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

function linePieces(
  plan: FloorPlanState,
  direction: "x" | "y",
  positionMm: number,
  slabIds = plan.slabs.map((item) => item.id),
) {
  const context = buildFloorRebarPathContextV3(plan);
  const solved = slabIds.flatMap((id) => {
    const item = context.slabsById.get(id);
    return item ? [item] : [];
  });
  const domain = {
    id: `test-domain:${slabIds.join("|")}`,
    slabIds: [...slabIds],
    cellIds: [],
    minX: Math.min(...solved.map((item) => item.x)),
    minY: Math.min(...solved.map((item) => item.y)),
    maxX: Math.max(...solved.map((item) => item.x + item.width)),
    maxY: Math.max(...solved.map((item) => item.y + item.height)),
  };
  return buildFloorBottomV3LinePieces({
    context,
    domain,
    line: {
      id: `test-line:${direction}:${positionMm}:${slabIds.join("|")}`,
      domainId: domain.id,
      slabIds: [...slabIds],
      layer: "bottom",
      direction,
      role: "main",
      source: "normal",
      positionMm,
    },
    diameter: 10,
    spacing: 200,
    outerWallThicknessMm: plan.outerWallThickness,
  });
}

describe("Floor Rebar V1.4C.3 Bottom Opening Clipping", () => {
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
    expect(result.totalWeightKg).toBeCloseTo(136.8 * theoreticalUnitWeight(10), 10);
    expect(result.groups.reduce((sum, group) => sum + group.weightKg, 0)).toBeCloseTo(result.totalWeightKg!, 10);
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

  it("clips a cloned Meng B opening without changing remote pieces", () => {
    const source = incompleteMengPlan3();
    const candidates = detectFloorTopologyRepairCandidates(source).candidates;
    const repaired = applyFloorTopologyRepairs(source, candidates.map((candidate) => ({ candidateId: candidate.id, action: "inner-wall" as const })));
    if (!repaired.ok) throw new Error(repaired.message);
    const settings = bottom({
      countMode: "round",
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 160, ySpacing: 160 },
    });
    const plain = calculateFloorBottomRebar(repaired.plan, settings);
    const openedPlan = structuredClone(repaired.plan);
    const context = buildFloorRebarPathContextV3(openedPlan);
    const b = context.slabsById.get("meng-b")!;
    openedPlan.openings.push({
      id: "meng-b-test-opening",
      name: "Meng B Test Opening",
      type: "void",
      x: b.x + b.width * 0.35,
      y: b.y + b.height * 0.35,
      width: b.width * 0.3,
      height: b.height * 0.3,
    });
    const opened = calculateFloorBottomRebar(openedPlan, settings);
    expect(opened.isValid).toBe(true);
    expect(opened.lines).toEqual(plain.lines);
    expect(opened.pieces.filter((piece) => piece.slabIds.includes("meng-b")).length)
      .toBeGreaterThan(plain.pieces.filter((piece) => piece.slabIds.includes("meng-b")).length);
    expect(opened.pieces.some((piece) => piece.startBoundaryId.startsWith("v3-opening:meng-b-test-opening:")
      || piece.endBoundaryId.startsWith("v3-opening:meng-b-test-opening:"))).toBe(true);
    expect(opened.pieces.filter((piece) => !piece.slabIds.includes("meng-b")))
      .toEqual(plain.pieces.filter((piece) => !piece.slabIds.includes("meng-b")));
  });

  it("supports V3 openings, rejects invalid endpoints, and remains deterministic", () => {
    const plan = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [], [{ id: "o", name: "O", type: "void", x: 100, y: 100, width: 200, height: 200 }]);
    const result = calculateFloorBottomRebar(plan, bottom());
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.lines.length).toBeGreaterThan(0);
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

  it("clips the single-room golden without changing theoretical lines", () => {
    const opening = { id: "center", name: "Center", type: "void" as const, x: 1500, y: 1000, width: 1000, height: 1000 };
    const plainPlan = v3Plan([slab("a", 0, 0, 4000, 3000)]);
    const plan = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [], [opening]);
    const settings = bottom({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 4000, ySpacing: 5000 },
    });
    const beforeInput = structuredClone({ plan, settings });
    const plain = calculateFloorBottomRebar(plainPlan, settings);
    const result = calculateFloorBottomRebar(plan, settings);
    expect(result.isValid).toBe(true);
    expect(result.lines).toEqual(plain.lines);
    expect(result).toMatchObject({ totalBarLines: 2, totalPieces: 4 });
    expect(result.pieces.filter((piece) => piece.direction === "x").map((piece) => piece.singleLengthMm)).toEqual([1740, 1740]);
    expect(result.pieces.filter((piece) => piece.direction === "y").map((piece) => piece.singleLengthMm)).toEqual([1240, 1240]);
    expect(result.pieces.filter((piece) => piece.startSupport === "opening-cut" || piece.endSupport === "opening-cut")
      .every((piece) => piece.startSupport !== "opening-cut" || piece.startAnchorMm === 0)
      && result.pieces.filter((piece) => piece.startSupport === "opening-cut" || piece.endSupport === "opening-cut")
        .every((piece) => piece.endSupport !== "opening-cut" || piece.endAnchorMm === 0)).toBe(true);
    expect(result.pieces.flatMap((piece) => [piece.startBoundaryId, piece.endBoundaryId])
      .filter((id) => id.startsWith("v3-opening:"))).toHaveLength(4);
    expect(result.totalLengthM).toBeCloseTo(5.96, 10);
    expect(result.totalWeightKg).toBeCloseTo(5.96 * theoreticalUnitWeight(10), 10);
    expect(result.pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000, 0)).toBeCloseTo(result.totalLengthM, 10);
    expect(result.groups.reduce((sum, group) => sum + group.totalLengthM, 0)).toBeCloseTo(result.totalLengthM, 10);
    expect(result.groups.reduce((sum, group) => sum + group.weightKg, 0)).toBeCloseTo(result.totalWeightKg!, 10);
    expect(calculateFloorBottomRebar(plan, settings)).toEqual(result);
    expect({ plan, settings }).toEqual(beforeInput);
  });

  it("applies whole and partial opening-edge inner-wall anchors", () => {
    const opening = { id: "o", name: "O", type: "void" as const, x: 1500, y: 1000, width: 1000, height: 1000 };
    const whole = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [{
      id: "west-wall",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "inner-wall",
    }], [opening]);
    const wholePieces = linePieces(whole, "x", 1500).pieces;
    expect(wholePieces.map((piece) => piece.singleLengthMm)).toEqual([1980, 1740]);
    expect(wholePieces[0]).toMatchObject({ endSupport: "inner-wall", endAnchorMm: 240 });
    expect(wholePieces[1]).toMatchObject({ startSupport: "opening-cut", startAnchorMm: 0 });

    const partial = v3Plan([slab("a", 0, 0, 4000, 3000)], [], [{
      id: "west-lower-wall",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "offset", startMm: 0, endMm: 500 } },
      support: "inner-wall",
    }], [opening]);
    expect(linePieces(partial, "x", 1250).pieces[0]).toMatchObject({ endSupport: "inner-wall", endAnchorMm: 240 });
    expect(linePieces(partial, "x", 1750).pieces[0]).toMatchObject({ endSupport: "opening-cut", endAnchorMm: 0 });
    expect(linePieces(partial, "x", 1500).pieces[0]).toMatchObject({ endSupport: "opening-cut", endAnchorMm: 0 });
  });

  it("normalizes multiple and adjacent cuts and permits complete piece removal", () => {
    const base = slab("a", 0, 0, 5000, 1000);
    const multiple = v3Plan([base], [], [], [
      { id: "o1", name: "O1", type: "void", x: 1000, y: 0, width: 500, height: 1000 },
      { id: "o2", name: "O2", type: "void", x: 3000, y: 0, width: 500, height: 1000 },
    ]);
    const multipleResult = linePieces(multiple, "x", 500);
    expect(multipleResult.issues).toEqual([]);
    expect(multipleResult.pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([
      [0, 1000],
      [1500, 3000],
      [3500, 5000],
    ]);

    const adjacent = v3Plan([base], [], [], [
      { id: "o1", name: "O1", type: "void", x: 1000, y: 0, width: 500, height: 1000 },
      { id: "o2", name: "O2", type: "void", x: 1500, y: 0, width: 500, height: 1000 },
    ]);
    const adjacentResult = linePieces(adjacent, "x", 500);
    expect(adjacentResult.issues).toEqual([]);
    expect(adjacentResult.pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 1000], [2000, 5000]]);
    expect(adjacentResult.pieces.every((piece) => piece.netLengthMm > 0)).toBe(true);
    expect(adjacentResult.pieces[0].endBoundaryId).toContain("v3-opening:o1:west:");
    expect(adjacentResult.pieces[1].startBoundaryId).toContain("v3-opening:o2:east:");

    const removed = v3Plan([base], [], [], [
      { id: "all", name: "All", type: "void", x: 0, y: 0, width: 5000, height: 1000 },
    ]);
    expect(linePieces(removed, "x", 500)).toEqual({ pieces: [], issues: [] });
    const calculation = calculateFloorBottomRebar(removed, bottom({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 2000, ySpacing: 6000 },
    }));
    expect(calculation.isValid).toBe(true);
    expect(calculation.totalBarLines).toBeGreaterThan(calculation.totalPieces);
  });

  it("clips continuous slabs once and rebuilds residual slab traceability", () => {
    const plan = v3Plan(
      [slab("a", 0, 0, 2000, 1000), slab("b", 2000, 0, 2000, 1000)],
      [connection("a", "east", "b", "west")],
      [
        { id: "a-cont", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "b-cont", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "continuous" },
      ],
      [{ id: "o", name: "O", type: "void", x: 1500, y: 0, width: 1000, height: 1000 }],
    );
    const result = linePieces(plan, "x", 500);
    expect(result.issues).toEqual([]);
    expect(result.pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 1500], [2500, 4000]]);
    expect(result.pieces.map((piece) => piece.slabIds)).toEqual([["a"], ["b"]]);
    expect(result.pieces.some((piece) => piece.runStartMm === 2000 || piece.runEndMm === 2000)).toBe(false);
  });

  it("clips after inner-wall splitting and only changes the matching spatial chain", () => {
    const wallPlan = v3Plan(
      [slab("a", 0, 0, 2000, 1000), slab("b", 2240, 0, 2000, 1000)],
      [connection("a", "east", "b", "west")],
      [],
      [{ id: "wall-cross", name: "Wall Cross", type: "void", x: 1500, y: 0, width: 1240, height: 1000 }],
    );
    expect(linePieces(wallPlan, "x", 500, ["a"]).pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 1500]]);
    expect(linePieces(wallPlan, "x", 500, ["b"]).pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[2740, 4240]]);

    const slabs = [
      slab("left", 0, 0, 100, 300),
      slab("bottom", 100, 0, 100, 100),
      slab("right", 200, 0, 100, 300),
    ];
    const connections = [
      connection("left", "east", "bottom", "west"),
      connection("bottom", "east", "right", "west"),
    ];
    const rules: FloorPlanState["supportRules"] = [
      { id: "left-bottom", target: { kind: "slab-edge", slabId: "left", side: "east", range: { mode: "whole" } }, support: "continuous" },
      { id: "bottom-right", target: { kind: "slab-edge", slabId: "bottom", side: "east", range: { mode: "whole" } }, support: "continuous" },
    ];
    const plain = v3Plan(slabs, connections, rules);
    const opened = v3Plan(slabs, connections, rules, [
      { id: "right-only", name: "Right", type: "void", x: 210, y: 100, width: 50, height: 100 },
    ]);
    plain.innerWallThickness = opened.innerWallThickness = 20;
    plain.outerWallThickness = opened.outerWallThickness = 20;
    const plainResult = linePieces(plain, "x", 150);
    const openedResult = linePieces(opened, "x", 150);
    expect(plainResult.pieces[0]).toEqual(openedResult.pieces[0]);
    expect(openedResult.pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[0, 100], [200, 210], [260, 300]]);
  });

  it("keeps partial/outside openings non-blocking and overlap/conflict blocking", () => {
    const base = slab("a", 0, 0, 4000, 3000);
    const partial = v3Plan([base], [], [], [
      { id: "partial", name: "Partial", type: "void", x: -500, y: 0, width: 1500, height: 3000 },
    ]);
    const partialLine = linePieces(partial, "x", 1500);
    expect(partialLine.issues).toEqual([]);
    expect(partialLine.pieces.map((piece) => [piece.runStartMm, piece.runEndMm])).toEqual([[1000, 4000]]);
    expect(partialLine.pieces[0]).toMatchObject({ startSupport: "opening-cut", startAnchorMm: 0 });
    const partialCalculation = calculateFloorBottomRebar(partial, bottom());
    expect(partialCalculation.isValid).toBe(true);
    expect(partialCalculation.warnings.map((issue) => issue.code)).toContain("opening-partial-outside");

    const plain = calculateFloorBottomRebar(v3Plan([base]), bottom());
    const outsidePlan = v3Plan([base], [], [], [
      { id: "outside", name: "Outside", type: "void", x: 5000, y: 0, width: 1000, height: 1000 },
    ]);
    const outside = calculateFloorBottomRebar(outsidePlan, bottom());
    expect(outside.warnings.map((issue) => issue.code)).toContain("opening-uncovered");
    expect({ lines: outside.lines, pieces: outside.pieces, groups: outside.groups, totalLengthM: outside.totalLengthM, totalWeightKg: outside.totalWeightKg })
      .toEqual({ lines: plain.lines, pieces: plain.pieces, groups: plain.groups, totalLengthM: plain.totalLengthM, totalWeightKg: plain.totalWeightKg });

    const overlapPlan = v3Plan([base], [], [], [
      { id: "o1", name: "O1", type: "void", x: 1000, y: 1000, width: 1000, height: 1000 },
      { id: "o2", name: "O2", type: "void", x: 1500, y: 1000, width: 1000, height: 1000 },
    ]);
    const overlap = calculateFloorBottomRebar(overlapPlan, bottom());
    expect(overlap.errors.map((issue) => issue.code)).toContain("opening-overlap");
    expect(overlap).toMatchObject({ isValid: false, lines: [], pieces: [], groups: [], totalWeightKg: null });

    const conflictPlan = v3Plan([base], [], [
      { id: "cut", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "opening-cut" },
      { id: "wall", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "inner-wall" },
    ], [{ id: "o", name: "O", type: "void", x: 1500, y: 1000, width: 1000, height: 1000 }]);
    const conflict = calculateFloorBottomRebar(conflictPlan, bottom());
    expect(conflict.errors.map((issue) => issue.code)).toContain("support-rule-conflict");
    expect(conflict).toMatchObject({ isValid: false, lines: [], pieces: [], groups: [], totalWeightKg: null });
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
