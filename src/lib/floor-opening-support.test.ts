import { describe, expect, it } from "vitest";
import type { FloorPlanState } from "./floor-plan";
import {
  findFloorOpeningSupportConflicts,
  resolveFloorOpeningEdgeAtPosition,
} from "./floor-opening-support";
import { validateFloorPlanState } from "./floor-topology-adapter";

function plan(supportRules: FloorPlanState["supportRules"] = []): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: [{ id: "a", name: "A", type: "room", x: 0, y: 0, width: 4000, height: 3000 }],
    openings: [{ id: "o", name: "O", type: "void", x: 1500, y: 1000, width: 1000, height: 1000 }],
    connections: [],
    supportRules,
    innerWallThickness: 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

describe("V3 opening edge formal support", () => {
  it("defaults to opening-cut with a stable whole-edge boundary", () => {
    const resolution = resolveFloorOpeningEdgeAtPosition(plan(), {
      openingId: "o",
      side: "west",
      worldTangentMm: 1250,
    });
    expect(resolution).toMatchObject({
      support: "opening-cut",
      thicknessMm: 0,
      rangeStartMm: 0,
      rangeEndMm: 1000,
      matchingRuleIds: [],
      boundaryId: "v3-opening:o:west:0:1000:opening-cut",
    });
  });

  it("uses global inner-wall thickness only on the configured opening side", () => {
    const state = plan([{
      id: "west-wall",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "inner-wall",
    }]);
    expect(resolveFloorOpeningEdgeAtPosition(state, {
      openingId: "o",
      side: "west",
      worldTangentMm: 1250,
    })).toMatchObject({ support: "inner-wall", thicknessMm: 240, matchingRuleIds: ["west-wall"] });
    expect(resolveFloorOpeningEdgeAtPosition(state, {
      openingId: "o",
      side: "east",
      worldTangentMm: 1250,
    })).toMatchObject({ support: "opening-cut", thicknessMm: 0 });
  });

  it("resolves partial ranges with half-open boundary membership", () => {
    const state = plan([{
      id: "lower-half",
      target: {
        kind: "opening-edge",
        openingId: "o",
        side: "west",
        range: { mode: "offset", startMm: 0, endMm: 500 },
      },
      support: "inner-wall",
    }]);
    expect(resolveFloorOpeningEdgeAtPosition(state, {
      openingId: "o",
      side: "west",
      worldTangentMm: 1250,
    })).toMatchObject({ support: "inner-wall", thicknessMm: 240, rangeStartMm: 0, rangeEndMm: 500 });
    expect(resolveFloorOpeningEdgeAtPosition(state, {
      openingId: "o",
      side: "west",
      worldTangentMm: 1500,
    })).toMatchObject({ support: "opening-cut", thicknessMm: 0, rangeStartMm: 500, rangeEndMm: 1000 });
  });

  it("reports conflicts deterministically and never treats continuous as opening support", () => {
    const conflictState = plan([
      { id: "cut", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "opening-cut" },
      { id: "wall", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "inner-wall" },
    ]);
    expect(findFloorOpeningSupportConflicts(conflictState)).toEqual([{
      openingId: "o",
      side: "west",
      rangeStartMm: 0,
      rangeEndMm: 1000,
      matchingRuleIds: ["cut", "wall"],
      conflictingSupports: ["inner-wall", "opening-cut"],
    }]);

    const continuousState = plan([{
      id: "invalid-continuous",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "continuous",
    }]);
    expect(validateFloorPlanState(continuousState).map((issue) => issue.code)).toContain("support-type-invalid");
    expect(resolveFloorOpeningEdgeAtPosition(continuousState, {
      openingId: "o",
      side: "west",
      worldTangentMm: 1250,
    })).toMatchObject({ support: "opening-cut", thicknessMm: 0 });
  });
});
