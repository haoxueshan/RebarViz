import { describe, expect, it } from "vitest";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "./floor-bottom-calculator";
import {
  createFloorProductionGoldenBottomState,
  createFloorProductionGoldenPlan,
  createFloorProductionGoldenRoleState,
  createFloorProductionGoldenTopState,
} from "./__fixtures__/floor-production-golden-v3";
import { goldenMengLegacyV2Plan } from "./__fixtures__/floor-topology-golden-meng";
import type { FloorPlanState } from "./floor-plan";
import {
  buildFloorPrintContent,
  buildFloorPrintSnapshot,
  DEFAULT_FLOOR_PRINT_OPTIONS,
  FloorPrintBuildError,
  getFloorPrintEligibility,
} from "./floor-print";
import { buildFloorPhysicalLayout } from "./floor-physical-layout";
import { calculateFloorTopRebar, DEFAULT_FLOOR_TOP_STATE } from "./floor-top-calculator";
import { createFloorConnection, type FloorConnectionRange } from "./floor-topology";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";
import {
  buildFloorTopologyBoundarySegmentsV3,
  solveFloorTopology,
} from "./floor-topology-solver";

function productionInput() {
  const plan = createFloorProductionGoldenPlan();
  const role = createFloorProductionGoldenRoleState();
  return {
    plan,
    bottom: calculateFloorBottomRebar(plan, createFloorProductionGoldenBottomState(), role),
    top: calculateFloorTopRebar(plan, createFloorProductionGoldenTopState(), role),
    bottomRoleReviewRequired: false,
    topRoleReviewRequired: false,
    invalidDraftCount: 0,
  };
}

function pairPlan(input: {
  gapMm: 0 | 240;
  range?: FloorConnectionRange;
}): FloorPlanState {
  const connection = createFloorConnection({
    slabIdA: "a",
    sideA: "east",
    slabIdB: "b",
    sideB: "west",
  });
  if (!connection) throw new Error("Pair fixture connection was not created.");
  if (input.range) {
    connection.a.range = structuredClone(input.range);
    connection.b.range = structuredClone(input.range);
  }
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: [
      { id: "a", name: "A", type: "room", x: 0, y: 0, width: 3000, height: 2000 },
      { id: "b", name: "B", type: "room", x: 3000 + input.gapMm, y: 0, width: 3000, height: 2000 },
    ],
    openings: [],
    supportRules: input.gapMm === 0 ? [{
      id: "continuous-a-east",
      target: {
        kind: "slab-edge",
        slabId: "a",
        side: "east",
        range: input.range?.mode === "offset" ? structuredClone(input.range) : { mode: "whole" },
      },
      support: "continuous",
    }] : [],
    connections: [connection],
    innerWallThickness: 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function printContentFor(plan: FloorPlanState) {
  const bottom = calculateFloorBottomRebar(plan, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE));
  const top = calculateFloorTopRebar(plan, structuredClone(DEFAULT_FLOOR_TOP_STATE));
  expect(bottom.isValid).toBe(true);
  expect(top.isValid).toBe(true);
  return buildFloorPrintContent(plan, bottom, top);
}

describe("Floor Print V3 formal geometry", () => {
  it("prints a continuous connection without inventing an inner wall", () => {
    const plan = pairPlan({ gapMm: 0 });
    const content = printContentFor(plan);
    expect(content.parameters.coordinateModel).toBe("clear-space-physical-v2");
    expect(content.geometry.physical?.slabs.find((slab) => slab.slabId === "b")?.x).toBe(3000);
    expect(content.geometry.physical?.walls.filter((wall) => wall.kind === "inner-wall")).toEqual([]);
    expect(content.geometry.boundaries).toContainEqual({
      orientation: "vertical",
      startX: 3000,
      startY: 0,
      endX: 3000,
      endY: 2000,
      support: "continuous",
    });
  });

  it("keeps a partial formal connection and its wall limited to the solved range", () => {
    const plan = pairPlan({ gapMm: 240, range: { mode: "offset", startMm: 500, endMm: 1500 } });
    const content = printContentFor(plan);
    expect(content.geometry.physical?.walls.filter((wall) => wall.kind === "inner-wall")).toEqual([
      expect.objectContaining({ x: 3000, y: 500, width: 240, height: 1000 }),
    ]);
    expect(content.geometry.boundaries).toContainEqual({
      orientation: "vertical",
      startX: 3120,
      startY: 500,
      endX: 3120,
      endY: 1500,
      support: "inner-wall",
    });
    expect(content.geometry.boundaries.filter((boundary) =>
      boundary.support === "outer-wall" && boundary.orientation === "vertical" && boundary.startX === 3000)).toHaveLength(2);
  });

  it("keeps Meng T-junction walls on each formal connection range", () => {
    const plan = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan()).plan;
    const solution = solveFloorTopology(plan);
    const layout = buildFloorPhysicalLayout(plan, solution);
    const boundaries = buildFloorTopologyBoundarySegmentsV3(plan, solution);
    for (const pair of [["meng-k", "meng-c"], ["meng-k", "meng-l"]] as const) {
      const solved = solution.solvedConnections.find((connection) =>
        pair.every((slabId) => connection.slabIds.includes(slabId)))!;
      const wall = layout.walls.find((candidate) =>
        candidate.kind === "inner-wall" && pair.every((slabId) => candidate.slabIds.includes(slabId)))!;
      const boundary = boundaries.find((candidate) =>
        candidate.geometryKind === "shared-slab" && pair.every((slabId) => candidate.slabIds.includes(slabId)))!;
      expect(wall.lengthMm).toBe(solved.lengthMm);
      expect(boundary.orientation).toBe(solved.orientation);
      if (solved.orientation === "vertical") {
        expect([wall.y, wall.y + wall.height]).toEqual([solved.rangeStartMm, solved.rangeEndMm]);
        expect([boundary.startY, boundary.endY]).toEqual([solved.rangeStartMm, solved.rangeEndMm]);
      } else {
        expect([wall.x, wall.x + wall.width]).toEqual([solved.rangeStartMm, solved.rangeEndMm]);
        expect([boundary.startX, boundary.endX]).toEqual([solved.rangeStartMm, solved.rangeEndMm]);
      }
    }
  });
});

describe("Floor Print V3 eligibility", () => {
  it("blocks an unmaterialized formal connection independently of calculation validity", () => {
    const input = productionInput();
    input.plan.slabs[1].x = 3250;
    const eligibility = getFloorPrintEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.errors.map((issue) => issue.code)).toContain("topology-v3-not-materialized");
    expect(eligibility.errors.map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
  });

  it("blocks wall-slab overlap and refuses an official snapshot", () => {
    const input = productionInput();
    input.plan.slabs.push({ id: "wall-blocker", name: "Wall Blocker", type: "room", x: 3000, y: 1000, width: 240, height: 1000 });
    const first = getFloorPrintEligibility(input);
    const second = getFloorPrintEligibility(input);
    expect(second).toEqual(first);
    expect(first.eligible).toBe(false);
    expect(first.errors.map((issue) => issue.code)).toContain("wall-slab-overlap");
    expect(first.errors.filter((issue) => issue.code === "wall-slab-overlap")).toHaveLength(1);
    try {
      buildFloorPrintSnapshot({
        ...input,
        project: { projectName: "Invalid", floorName: "L2", remark: "" },
        options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
      });
      throw new Error("Expected the official snapshot build to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(FloorPrintBuildError);
      expect((error as FloorPrintBuildError).code).toBe("wall-slab-overlap");
    }
  });

  it("blocks conflicting connection support rules", () => {
    const input = productionInput();
    const target = { kind: "slab-edge" as const, slabId: "production-a", side: "east" as const, range: { mode: "whole" as const } };
    input.plan.supportRules = [
      { id: "inner", target: structuredClone(target), support: "inner-wall" },
      { id: "continuous", target: structuredClone(target), support: "continuous" },
    ];
    const eligibility = getFloorPrintEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.errors.map((issue) => issue.code)).toContain("support-rule-conflict");
  });

  it("blocks overlapping openings", () => {
    const input = productionInput();
    input.plan.openings.push({
      id: "overlapping-opening",
      name: "Overlapping Opening",
      type: "void",
      x: 1500,
      y: 2400,
      width: 1000,
      height: 400,
    });
    const eligibility = getFloorPrintEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.errors.map((issue) => issue.code)).toContain("opening-overlap");
  });

  it("keeps a partial-outside opening as a warning", () => {
    const input = productionInput();
    input.plan.openings[0] = { ...input.plan.openings[0], x: 2700 };
    const eligibility = getFloorPrintEligibility(input);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.errors).toEqual([]);
    expect(eligibility.warnings.map((issue) => issue.code)).toContain("opening-partial-outside");
  });
});
