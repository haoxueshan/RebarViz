import { describe, expect, it, vi } from "vitest";
import {
  buildFloorBottomBomGroups,
  buildFloorBottomRebarDomains,
  calculateFloorBottomRebar,
  type FloorBottomBomGroup,
} from "./floor-bottom-calculator";
import {
  createFloorProductionGoldenBottomState,
  createFloorProductionGoldenPlan,
  createFloorProductionGoldenRoleState,
  createFloorProductionGoldenTopState,
} from "./__fixtures__/floor-production-golden-v3";
import {
  buildFloorPrintContent,
  buildFloorPrintSnapshot,
  DEFAULT_FLOOR_PRINT_OPTIONS,
  getFloorPrintEligibility,
  validateFloorPrintBomConsistency,
} from "./floor-print";
import {
  buildFloorRebarCalculationContextV3,
} from "./floor-rebar-calculation-context-v3";
import {
  buildFloorRebarRoleDomains,
  resolveFloorRebarRoleContext,
  resolveFloorRoleDomainMainDirection,
} from "./floor-rebar-role";
import {
  createFloorProjectFile,
  parseFloorProjectFile,
  serializeFloorProjectFile,
} from "./floor-project-file";
import {
  calculateFloorTopRebar,
  calculateFloorTopNormalRebar,
  calculateFloorTopRebarV3FromContext,
  type FloorTopBomGroup,
} from "./floor-top-calculator";
import { resolveFloorTopThroughPathGeometryV3 } from "./floor-top-through-v3";
import { containsHalfOpen } from "./floor-rebar-path";
import { solveFloorTopology } from "./floor-topology-solver";
import { validateFloorPlanState } from "./floor-topology-adapter";
import * as floorTopologySolver from "./floor-topology-solver";
import type { FloorBarPiece } from "./floor-rebar-types";
import { theoreticalUnitWeight } from "./slab-calculator";

// IMPORTANT: expected values below are hand-derived from geometry, not copied
// from calculator output: Bottom 61.04 m, Top 63.30 m, Through 6970 mm.

function lengthMultiset(pieces: readonly FloorBarPiece[]) {
  const counts = new Map<number, number>();
  pieces.forEach((piece) => counts.set(piece.singleLengthMm, (counts.get(piece.singleLengthMm) ?? 0) + 1));
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([lengthMm, count]) => ({ lengthMm, count }));
}

function pieceSignature(piece: FloorBarPiece) {
  return {
    direction: piece.direction,
    role: piece.role,
    diameter: piece.diameter,
    source: piece.source,
    slabIds: piece.slabIds,
    singleLengthMm: piece.singleLengthMm,
    lineId: piece.lineId,
    startBoundaryId: piece.startBoundaryId,
    endBoundaryId: piece.endBoundaryId,
    intermediateBoundaryIds: piece.intermediateBoundaryIds,
    startAnchorMm: piece.startAnchorMm,
    endAnchorMm: piece.endAnchorMm,
    intermediateWallMm: piece.intermediateWallMm,
  };
}

function assertFiniteNonNegative(value: number, label: string) {
  expect(Number.isFinite(value), label).toBe(true);
  expect(value, label).toBeGreaterThanOrEqual(0);
}

function assertBomRecomposes(
  pieces: readonly FloorBarPiece[],
  groups: ReadonlyArray<FloorBottomBomGroup | FloorTopBomGroup>,
  totalLengthM: number,
  totalWeightKg: number | null,
) {
  expect(new Set(pieces.map((piece) => piece.id)).size).toBe(pieces.length);
  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const membership = new Map<string, number>();
  groups.forEach((group) => {
    expect(group.count).toBe(group.pieceIds.length);
    let length = 0;
    let weight = 0;
    group.pieceIds.forEach((pieceId) => {
      const piece = pieceById.get(pieceId);
      expect(piece).toBeDefined();
      membership.set(pieceId, (membership.get(pieceId) ?? 0) + 1);
      length += piece!.singleLengthMm / 1000;
      weight += piece!.singleLengthMm / 1000 * theoreticalUnitWeight(piece!.diameter);
      expect(piece).toMatchObject({
        direction: group.direction,
        role: group.role,
        diameter: group.diameter,
        spacing: group.spacing,
        singleLengthMm: group.singleLengthMm,
      });
      expect(piece!.source).toBe("source" in group ? group.source : "normal");
      expect(piece!.throughPathId).toBe("throughPathId" in group ? group.throughPathId : undefined);
    });
    expect(group.totalLengthM).toBeCloseTo(length, 10);
    expect(group.weightKg).toBeCloseTo(weight, 10);
  });
  pieces.forEach((piece) => expect(membership.get(piece.id)).toBe(1));
  expect(groups.reduce((sum, group) => sum + group.totalLengthM, 0)).toBeCloseTo(totalLengthM, 10);
  expect(groups.reduce((sum, group) => sum + group.weightKg, 0)).toBeCloseTo(totalWeightKg ?? Number.NaN, 10);
}

function calculateProduction() {
  const plan = createFloorProductionGoldenPlan();
  const bottomState = createFloorProductionGoldenBottomState();
  const topState = createFloorProductionGoldenTopState();
  const roleState = createFloorProductionGoldenRoleState();
  const bottom = calculateFloorBottomRebar(plan, bottomState, roleState);
  const top = calculateFloorTopRebar(plan, topState, roleState);
  return { plan, bottomState, topState, roleState, bottom, top };
}

describe("Floor Rebar V1.4D.0 Production Golden House", () => {
  it("locks formal topology, role mapping and manually derived line positions", () => {
    const plan = createFloorProductionGoldenPlan();
    const solution = solveFloorTopology(plan);
    expect(solution.slabs.map((slab) => [slab.slabId, slab.x, slab.width])).toEqual([
      ["production-a", 0, 3000],
      ["production-b", 3240, 3000],
      ["production-c", 6480, 3000],
    ]);
    const connections = solution.solvedConnections.filter((connection) => connection.valid);
    expect(connections).toHaveLength(2);
    expect(connections.map((connection) => ({
      slabs: connection.slabIds,
      support: connection.support,
      gapMm: connection.gapMm,
      range: [connection.rangeStartMm, connection.rangeEndMm],
    }))).toEqual([
      { slabs: ["production-a", "production-b"], support: "inner-wall", gapMm: 240, range: [0, 3000] },
      { slabs: ["production-b", "production-c"], support: "inner-wall", gapMm: 240, range: [0, 3000] },
    ]);
    expect(solution.walls.filter((wall) => wall.kind === "inner-wall")).toHaveLength(2);

    const roleDomains = buildFloorRebarRoleDomains(plan, solution);
    expect(roleDomains).toHaveLength(3);
    expect(roleDomains.every((domain) => domain.shape === "square")).toBe(true);
    expect(roleDomains.map((domain) =>
      resolveFloorRoleDomainMainDirection(domain, createFloorProductionGoldenRoleState()).source))
      .toEqual(["manual", "manual", "manual"]);
    const physicalDomains = buildFloorBottomRebarDomains(plan, solution);
    const roleContext = resolveFloorRebarRoleContext(plan, physicalDomains, createFloorProductionGoldenRoleState(), solution);
    expect(roleContext.errors).toEqual([]);
    expect([...roleContext.mainDirectionByPhysicalDomain.values()]).toEqual(["x", "x", "x"]);

    const validation = validateFloorPlanState(plan, solution);
    expect(validation.filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("matches the independently derived Bottom golden and recomposes BOM from pieces", () => {
    const { plan, bottomState, roleState, bottom } = calculateProduction();
    expect(bottom.isValid).toBe(true);
    expect(bottom.totalBarLines).toBe(18);
    expect(bottom.totalPieces).toBe(20);
    expect(bottom.totalLengthM).toBeCloseTo(61.04, 10);
    expect(bottom.totalWeightKg).toBeCloseTo(
      30.32 * theoreticalUnitWeight(12) + 30.72 * theoreticalUnitWeight(8),
      10,
    );
    expect(bottom.domains.map((domain) => bottom.lines
      .filter((line) => line.domainId === domain.id && line.direction === "x")
      .map((line) => line.positionMm))).toEqual([[500, 1500, 2500], [500, 1500, 2500], [500, 1500, 2500]]);
    expect(bottom.domains.map((domain) => bottom.lines
      .filter((line) => line.domainId === domain.id && line.direction === "y")
      .map((line) => line.positionMm - domain.minX))).toEqual([[500, 1500, 2500], [500, 1500, 2500], [500, 1500, 2500]]);
    expect(lengthMultiset(bottom.pieces.filter((piece) => piece.direction === "x"))).toEqual([
      { lengthMm: 1240, count: 2 },
      { lengthMm: 3480, count: 8 },
    ]);
    expect(lengthMultiset(bottom.pieces.filter((piece) => piece.direction === "y"))).toEqual([
      { lengthMm: 440, count: 1 },
      { lengthMm: 2440, count: 1 },
      { lengthMm: 3480, count: 8 },
    ]);
    expect(bottom.pieces.filter((piece) => piece.direction === "x").every((piece) => piece.diameter === 12 && piece.role === "main")).toBe(true);
    expect(bottom.pieces.filter((piece) => piece.direction === "y").every((piece) => piece.diameter === 8 && piece.role === "secondary")).toBe(true);
    const openingX = bottom.pieces.filter((piece) => piece.direction === "x" && piece.slabIds.includes("production-a") && piece.singleLengthMm < 2000);
    expect(lengthMultiset(openingX)).toEqual([{ lengthMm: 1240, count: 2 }]);
    expect(openingX.map((piece) => [piece.startSupport, piece.endSupport])).toEqual([
      ["outer-wall", "opening-cut"],
      ["opening-cut", "inner-wall"],
    ]);
    expect(openingX.map((piece) => [piece.startAnchorMm, piece.endAnchorMm])).toEqual([[240, 0], [0, 240]]);
    const openingY = bottom.pieces.filter((piece) => piece.direction === "y" && piece.slabIds.includes("production-a") && piece.singleLengthMm < 3000);
    expect(lengthMultiset(openingY)).toEqual([{ lengthMm: 440, count: 1 }, { lengthMm: 2440, count: 1 }]);
    expect(bottom.groups).toEqual(buildFloorBottomBomGroups(bottom.pieces));
    assertBomRecomposes(bottom.pieces, bottom.groups, bottom.totalLengthM, bottom.totalWeightKg);
    expect(plan).toEqual(createFloorProductionGoldenPlan());
    expect(bottomState).toEqual(createFloorProductionGoldenBottomState());
    expect(roleState).toEqual(createFloorProductionGoldenRoleState());
  });

  it("matches Top Normal, Through replacement and final Top golden", () => {
    const { plan, topState, roleState, top } = calculateProduction();
    const normalBeforeThrough = calculateFloorTopNormalRebar(plan, topState, roleState);
    expect(normalBeforeThrough.isValid).toBe(true);
    expect(normalBeforeThrough.totalBarLines).toBe(18);
    expect(normalBeforeThrough.pieces).toHaveLength(20);
    const normalXLinesBySlab = ["production-a", "production-b", "production-c"].map((slabId) =>
      normalBeforeThrough.lines.filter((line) => line.direction === "x" && line.slabIds.includes(slabId)));
    expect(normalXLinesBySlab.map((lines) => lines.map((line) => line.positionMm))).toEqual([
      [500, 1500, 2500],
      [500, 1500, 2500],
      [500, 1500, 2500],
    ]);
    expect(normalXLinesBySlab[0].every((line) =>
      line.alignmentMode === "domain-centered" && line.alignmentGroupId === undefined)).toBe(true);
    expect(normalXLinesBySlab[1].every((line) => line.alignmentMode === "inherited")).toBe(true);
    expect(normalXLinesBySlab[2].every((line) => line.alignmentMode === "inherited")).toBe(true);
    const inheritedAlignmentGroupIds = new Set([
      ...normalXLinesBySlab[1],
      ...normalXLinesBySlab[2],
    ].map((line) => line.alignmentGroupId));
    expect(inheritedAlignmentGroupIds.size).toBe(1);
    expect(inheritedAlignmentGroupIds.has(undefined)).toBe(false);
    expect(containsHalfOpen(1500, topState.throughPaths[0].bandStartMm, topState.throughPaths[0].bandEndMm)).toBe(true);
    expect(containsHalfOpen(2000, topState.throughPaths[0].bandStartMm, topState.throughPaths[0].bandEndMm)).toBe(false);
    const normalXBySlab = ["production-a", "production-b", "production-c"].map((slabId) =>
      lengthMultiset(normalBeforeThrough.pieces.filter((piece) => piece.direction === "x" && piece.slabIds.includes(slabId))));
    expect(normalXBySlab).toEqual([
      [{ lengthMm: 1240, count: 1 }, { lengthMm: 1490, count: 1 }, { lengthMm: 3730, count: 2 }],
      [{ lengthMm: 3980, count: 3 }],
      [{ lengthMm: 3730, count: 3 }],
    ]);
    expect(top.isValid).toBe(true);
    expect(top.totalBarLines).toBe(17);
    expect(top.normalPieceCount).toBe(18);
    expect(top.throughPieceCount).toBe(1);
    expect(top.totalPieces).toBe(19);
    expect(top.totalLengthM).toBeCloseTo(63.30, 10);
    expect(top.totalWeightKg).toBeCloseTo(
      32.58 * theoreticalUnitWeight(12) + 30.72 * theoreticalUnitWeight(8),
      10,
    );
    expect(lengthMultiset(top.pieces.filter((piece) => piece.source === "normal" && piece.direction === "x"))).toEqual([
      { lengthMm: 1240, count: 1 },
      { lengthMm: 1490, count: 1 },
      { lengthMm: 3730, count: 4 },
      { lengthMm: 3980, count: 2 },
    ]);
    expect(lengthMultiset(top.pieces.filter((piece) => piece.source === "normal" && piece.direction === "y"))).toEqual([
      { lengthMm: 440, count: 1 },
      { lengthMm: 2440, count: 1 },
      { lengthMm: 3480, count: 8 },
    ]);
    const through = top.pieces.filter((piece) => piece.source === "through");
    expect(through).toHaveLength(1);
    expect(through[0]).toMatchObject({
      slabIds: ["production-b", "production-c"],
      direction: "x",
      role: "main",
      diameter: 12,
      spacing: 1000,
      netLengthMm: 6000,
      intermediateWallMm: 240,
      startAnchorMm: 490,
      endAnchorMm: 240,
      singleLengthMm: 6970,
      intermediateBoundaryIds: ["connection:production-b:east:production-c:west"],
      startBoundaryId: "connection:production-a:east:production-b:west",
    });
    expect(through[0].endBoundaryId).toMatch(/^v3-exterior:production-c:east:/);
    expect(top.resolvedThroughPaths).toMatchObject([{
      id: "golden-through-b-c",
      orderedSlabIds: ["production-b", "production-c"],
      linePositionsMm: [1500],
    }]);
    expect(top.groups.find((group) => group.source === "through")).toMatchObject({
      throughPathId: "golden-through-b-c",
      direction: "x",
      role: "main",
      diameter: 12,
      spacing: 1000,
      extraMode: "both",
      singleLengthMm: 6970,
      count: 1,
    });
    expect(top.lines.some((line) => line.source === "normal" && line.slabIds.includes("production-a") && line.direction === "x" && line.positionMm === 1500)).toBe(true);
    expect(top.lines.some((line) => line.source === "normal" && line.slabIds.includes("production-b") && line.direction === "x" && line.positionMm === 1500)).toBe(false);
    expect(top.lines.some((line) => line.source === "normal" && line.slabIds.includes("production-c") && line.direction === "x" && line.positionMm === 1500)).toBe(false);
    const claimedLineIds = normalBeforeThrough.lines
      .filter((line) => line.direction === "x" && line.positionMm === 1500 && line.slabIds.some((slabId) => slabId === "production-b" || slabId === "production-c"))
      .map((line) => line.id);
    const claimedPieceIds = normalBeforeThrough.pieces
      .filter((piece) => claimedLineIds.includes(piece.lineId))
      .map((piece) => piece.id);
    expect(claimedPieceIds).toHaveLength(2);
    expect(top.pieces.some((piece) => claimedPieceIds.includes(piece.id))).toBe(false);
    expect(lengthMultiset(top.pieces.filter((piece) => piece.source === "normal" && piece.slabIds.includes("production-a") && piece.direction === "x"))).toEqual([
      { lengthMm: 1240, count: 1 },
      { lengthMm: 1490, count: 1 },
      { lengthMm: 3730, count: 2 },
    ]);
    const openingX = top.pieces
      .filter((piece) => piece.source === "normal" && piece.slabIds.includes("production-a") && piece.direction === "x" && piece.singleLengthMm < 2000)
      .sort((left, right) => left.runStartMm - right.runStartMm);
    expect(openingX.map((piece) => ({
      length: piece.singleLengthMm,
      startSupport: piece.startSupport,
      endSupport: piece.endSupport,
      startAnchor: piece.startAnchorMm,
      endAnchor: piece.endAnchorMm,
      startExtra: piece.startExtraApplied,
      endExtra: piece.endExtraApplied,
    }))).toEqual([
      { length: 1240, startSupport: "outer-wall", endSupport: "opening-cut", startAnchor: 240, endAnchor: 0, startExtra: false, endExtra: false },
      { length: 1490, startSupport: "opening-cut", endSupport: "inner-wall", startAnchor: 0, endAnchor: 490, startExtra: false, endExtra: true },
    ]);
    assertBomRecomposes(top.pieces, top.groups, top.totalLengthM, top.totalWeightKg);
    top.pieces.forEach((piece) => {
      assertFiniteNonNegative(piece.singleLengthMm, `${piece.id}:singleLengthMm`);
      assertFiniteNonNegative(piece.netLengthMm, `${piece.id}:netLengthMm`);
      assertFiniteNonNegative(piece.startAnchorMm, `${piece.id}:startAnchorMm`);
      assertFiniteNonNegative(piece.endAnchorMm, `${piece.id}:endAnchorMm`);
      assertFiniteNonNegative(piece.intermediateWallMm, `${piece.id}:intermediateWallMm`);
      expect(Number.isInteger(piece.singleLengthMm)).toBe(true);
    });
    expect(plan.openings[0]).toMatchObject({ x: 1000, y: 2200, width: 1000, height: 600 });
  });

  it("reuses a prebuilt V3 context and keeps calculation deterministic and immutable", () => {
    const plan = createFloorProductionGoldenPlan();
    const topState = createFloorProductionGoldenTopState();
    const roleState = createFloorProductionGoldenRoleState();
    const context = buildFloorRebarCalculationContextV3(plan);
    const before = structuredClone({ plan, topState, roleState });
    const first = calculateFloorTopRebarV3FromContext(context, topState, roleState);
    const second = calculateFloorTopRebarV3FromContext(context, topState, roleState);
    expect(second).toEqual(first);
    expect(calculateFloorTopRebar(plan, topState, roleState)).toEqual(calculateFloorTopRebar(plan, topState, roleState));
    const bottomState = createFloorProductionGoldenBottomState();
    expect(calculateFloorBottomRebar(plan, bottomState, roleState)).toEqual(calculateFloorBottomRebar(plan, bottomState, roleState));
    expect({ plan, topState, roleState }).toEqual(before);
    expect(resolveFloorTopThroughPathGeometryV3(context, topState.throughPaths[0])).toMatchObject({
      orderedSlabIds: ["production-b", "production-c"],
      validBandIntervals: [{ start: 0, end: 3000 }],
      maxBandStartMm: 0,
      maxBandEndMm: 3000,
    });
    const solve = vi.spyOn(floorTopologySolver, "solveFloorTopology");
    solve.mockClear();
    calculateFloorTopRebarV3FromContext(context, topState, roleState);
    expect(solve).toHaveBeenCalledTimes(0);
    calculateFloorTopRebar(plan, topState, roleState);
    expect(solve).toHaveBeenCalledTimes(1);
    solve.mockRestore();
  });

  it("round-trips the official project payload and recalculates identical business results", () => {
    const original = calculateProduction();
    const file = createFloorProjectFile({
      projectName: "Production Golden House V1",
      plan: original.plan,
      bottom: original.bottomState,
      top: original.topState,
      role: original.roleState,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
    });
    expect(file.schemaVersion).toBe(1);
    expect({
      plan: file.data.plan.schemaVersion,
      bottom: file.data.bottom.schemaVersion,
      top: file.data.top.schemaVersion,
      role: file.data.role.schemaVersion,
    }).toEqual({ plan: 3, bottom: 3, top: 4, role: 1 });
    expect(file.meta).toMatchObject({ projectName: "Production Golden House V1", app: "RebarViz" });
    expect(file.data.plan.state).toEqual(original.plan);
    expect(file.data.bottom.state).toEqual(original.bottomState);
    expect(file.data.top.state).toEqual(original.topState);
    expect(file.data.role.state).toEqual(original.roleState);
    const serialized = serializeFloorProjectFile(file);
    expect(serializeFloorProjectFile(file)).toBe(serialized);
    const parsed = parseFloorProjectFile(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.roleState).toEqual(original.roleState);
    expect(parsed.project.planState).toEqual(original.plan);
    expect(parsed.project.planState.openings).toEqual(original.plan.openings);
    expect(parsed.project.planState.connections).toEqual(original.plan.connections);
    const bottom = calculateFloorBottomRebar(parsed.project.planState, parsed.project.bottomState, parsed.project.roleState);
    const top = calculateFloorTopRebar(parsed.project.planState, parsed.project.topState, parsed.project.roleState);
    expect(bottom.pieces.map(pieceSignature)).toEqual(original.bottom.pieces.map(pieceSignature));
    expect(top.pieces.map(pieceSignature)).toEqual(original.top.pieces.map(pieceSignature));
    expect(bottom).toEqual(original.bottom);
    expect(top).toEqual(original.top);
  });

  it("passes the official Print gate and exposes BOM values without recalculating geometry", () => {
    const { plan, bottom, top } = calculateProduction();
    const context = buildFloorRebarCalculationContextV3(plan);
    const input = {
      plan,
      bottom,
      top,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    };
    const solve = vi.spyOn(floorTopologySolver, "solveFloorTopology");
    solve.mockClear();
    expect(getFloorPrintEligibility(input, context.solution)).toMatchObject({ eligible: true, errors: [] });
    expect(validateFloorPrintBomConsistency(bottom, top)).toEqual([]);
    const content = buildFloorPrintContent(plan, bottom, top, context.solution);
    expect(content.parameters.coordinateModel).toBe("clear-space-physical-v2");
    expect(content.summary).toMatchObject({
      bottomPieceCount: 20,
      topPieceCount: 19,
      topNormalPieceCount: 18,
      topThroughPieceCount: 1,
    });
    expect(content.summary.bottomLengthM).toBeCloseTo(61.04, 10);
    expect(content.summary.topLengthM).toBeCloseTo(63.30, 10);
    expect(content.summary.totalLengthM).toBeCloseTo(124.34, 10);
    expect(content.summary.bottomWeightKg).toBeCloseTo(bottom.totalWeightKg ?? Number.NaN, 10);
    expect(content.summary.topWeightKg).toBeCloseTo(top.totalWeightKg ?? Number.NaN, 10);
    expect(content.summary.totalWeightKg).toBeCloseTo(
      (bottom.totalWeightKg ?? Number.NaN) + (top.totalWeightKg ?? Number.NaN),
      10,
    );
    expect(content.top.rows.some((row) => row.source === "through" && row.throughPathId === "golden-through-b-c" && row.singleLengthMm === 6970 && row.count === 1)).toBe(true);
    expect(content.top.rows.reduce((sum, row) => sum + row.count, 0)).toBe(19);
    expect(content.top.pieces.find((piece) => piece.source === "through")).toMatchObject({
      throughPathId: "golden-through-b-c",
      positionMm: 1500,
      runStartMm: 3240,
      runEndMm: 9480,
      singleLengthMm: 6970,
    });
    const physical = content.geometry.physical!;
    expect(physical.slabs.map((slab) => [slab.slabId, slab.x, slab.width])).toEqual([
      ["production-a", 0, 3000],
      ["production-b", 3240, 3000],
      ["production-c", 6480, 3000],
    ]);
    expect(physical.openings).toContainEqual(expect.objectContaining({
      openingId: "golden-opening",
      x: 1000,
      y: 2200,
      width: 1000,
      height: 600,
      offsetX: 0,
      offsetY: 0,
    }));
    const innerWalls = physical.walls.filter((wall) => wall.kind === "inner-wall");
    expect(innerWalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 3000, y: 0, width: 240, height: 3000, sourceAtomicIds: ["atomic:v3:connection:production-a:east:production-b:west"] }),
      expect.objectContaining({ x: 6240, y: 0, width: 240, height: 3000, sourceAtomicIds: ["atomic:v3:connection:production-b:east:production-c:west"] }),
    ]));
    expect(physical.walls).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "outer-wall", slabIds: ["production-a"], side: "west", thicknessMm: 240 }),
      expect.objectContaining({ kind: "outer-wall", slabIds: ["production-c"], side: "east", thicknessMm: 240 }),
      expect.objectContaining({ kind: "outer-wall", side: "south", thicknessMm: 240 }),
      expect.objectContaining({ kind: "outer-wall", side: "north", thicknessMm: 240 }),
    ]));
    expect(content.geometry.boundaries.filter((boundary) => boundary.support === "inner-wall")).toEqual([
      { orientation: "vertical", startX: 3120, startY: 0, endX: 3120, endY: 3000, support: "inner-wall" },
      { orientation: "vertical", startX: 6360, startY: 0, endX: 6360, endY: 3000, support: "inner-wall" },
    ]);
    const snapshot = buildFloorPrintSnapshot({
      ...input,
      project: { projectName: "Production Golden House V1", floorName: "Level 2", remark: "Production gate" },
      options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
      createdAt: "2026-08-19T00:00:00.000Z",
      snapshotId: "production-golden-snapshot",
    }, context.solution);
    expect(snapshot.status).toBe("official");
    expect(snapshot.parameters.coordinateModel).toBe("clear-space-physical-v2");
    expect(snapshot.source.coordinateModel).toBe("clear-space-physical-v2");
    expect(snapshot.source.coordinateModel).toBe(snapshot.parameters.coordinateModel);
    expect(snapshot.project).toEqual({
      projectName: "Production Golden House V1",
      floorName: "Level 2",
      remark: "Production gate",
    });
    expect(snapshot.summary).toEqual(content.summary);
    expect(solve).toHaveBeenCalledTimes(0);
    solve.mockRestore();

    const fallbackSnapshot = buildFloorPrintSnapshot({
      ...input,
      project: { projectName: "Production Golden House V1", floorName: "Level 2", remark: "Production gate" },
      options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
      createdAt: "2026-08-19T00:00:00.000Z",
      snapshotId: "production-golden-snapshot",
    });
    expect(fallbackSnapshot).toEqual(snapshot);
  });

  it("blocks print for invalid role, topology, Through and settings", () => {
    const valid = calculateProduction();
    expect(getFloorPrintEligibility({
      plan: valid.plan,
      bottom: calculateFloorBottomRebar(valid.plan, valid.bottomState, { mainDirectionOverrides: {} }),
      top: valid.top,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    }).eligible).toBe(false);

    const invalidTopState = structuredClone(valid.topState);
    invalidTopState.throughPaths[0].bandEndMm = 500;
    const invalidTop = calculateFloorTopRebar(valid.plan, invalidTopState, valid.roleState);
    expect(invalidTop.isValid).toBe(false);
    expect(getFloorPrintEligibility({
      plan: valid.plan,
      bottom: valid.bottom,
      top: invalidTop,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    }).eligible).toBe(false);

    const invalidBottomState = structuredClone(valid.bottomState);
    invalidBottomState.defaults.xSpacing = 0;
    const invalidBottom = calculateFloorBottomRebar(valid.plan, invalidBottomState, valid.roleState);
    expect(invalidBottom.isValid).toBe(false);
    expect(getFloorPrintEligibility({
      plan: valid.plan,
      bottom: invalidBottom,
      top: valid.top,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    }).eligible).toBe(false);

    const invalidTopSettingsState = structuredClone(valid.topState);
    invalidTopSettingsState.defaults.xSpacing = 0;
    const invalidTopSettings = calculateFloorTopRebar(valid.plan, invalidTopSettingsState, valid.roleState);
    expect(invalidTopSettings.isValid).toBe(false);
    expect(getFloorPrintEligibility({
      plan: valid.plan,
      bottom: valid.bottom,
      top: invalidTopSettings,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    }).eligible).toBe(false);

    const invalidTopologyPlan = structuredClone(valid.plan);
    invalidTopologyPlan.slabs[1].x = 3250;
    const invalidTopologyBottom = calculateFloorBottomRebar(invalidTopologyPlan, valid.bottomState, valid.roleState);
    const invalidTopologyTop = calculateFloorTopRebar(invalidTopologyPlan, valid.topState, valid.roleState);
    expect(getFloorPrintEligibility({
      plan: invalidTopologyPlan,
      bottom: invalidTopologyBottom,
      top: invalidTopologyTop,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    }).eligible).toBe(false);
  });

  it("aggregates synthetic pieces from their stored length without re-deriving geometry", () => {
    const { bottom } = calculateProduction();
    const synthetic = bottom.pieces.slice(0, 2).map((piece, index) => ({
      ...piece,
      id: `synthetic-bottom-${index}`,
      singleLengthMm: 1234,
    }));
    const groups = buildFloorBottomBomGroups(synthetic);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ singleLengthMm: 1234, count: 2, totalLengthM: 2.468 });
  });
});
