import type { FloorBottomState } from "../floor-bottom-calculator";
import type { FloorPlanState } from "../floor-plan";
import { createFloorConnection } from "../floor-topology";
import type { FloorTopState } from "../floor-top-calculator";
import {
  floorRoleDomainKey,
  type FloorRebarRoleState,
} from "../floor-rebar-role";

/**
 * Production Golden House V1 is intentionally small enough to audit by hand.
 * It contains two explicit inner-wall connections and one opening-cut region.
 */
export function createFloorProductionGoldenPlan(): FloorPlanState {
  const connections = [
    createFloorConnection({
      slabIdA: "production-a",
      sideA: "east",
      slabIdB: "production-b",
      sideB: "west",
    }),
    createFloorConnection({
      slabIdA: "production-b",
      sideA: "east",
      slabIdB: "production-c",
      sideB: "west",
    }),
  ];
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: [
      { id: "production-a", name: "A", type: "room", x: 0, y: 0, width: 3000, height: 3000 },
      { id: "production-b", name: "B", type: "room", x: 3240, y: 0, width: 3000, height: 3000 },
      { id: "production-c", name: "C", type: "room", x: 6480, y: 0, width: 3000, height: 3000 },
    ],
    openings: [{
      id: "golden-opening",
      name: "Golden Opening",
      type: "stair",
      x: 1000,
      y: 2200,
      width: 1000,
      height: 600,
    }],
    supportRules: [],
    connections: connections.flatMap((connection) => connection ? [connection] : []),
    innerWallThickness: 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

export function createFloorProductionGoldenBottomState(): FloorBottomState {
  return {
    countMode: "project",
    defaults: {
      mainDiameter: 12,
      secondaryDiameter: 8,
      xSpacing: 1000,
      ySpacing: 1000,
    },
    slabOverrides: {},
  };
}

export function createFloorProductionGoldenTopState(): FloorTopState {
  return {
    countMode: "project",
    defaults: {
      mainDiameter: 12,
      secondaryDiameter: 8,
      xSpacing: 1000,
      ySpacing: 1000,
      xExtraMode: "both",
      yExtraMode: "both",
    },
    slabOverrides: {},
    topAnchorExtra: 250,
    throughPaths: [{
      id: "golden-through-b-c",
      name: "B-C Through",
      direction: "x",
      slabIds: ["production-c", "production-b"],
      bandStartMm: 1000,
      bandEndMm: 2000,
      enabled: true,
    }],
  };
}

export function createFloorProductionGoldenRoleState(): FloorRebarRoleState {
  return {
    mainDirectionOverrides: {
      [floorRoleDomainKey(["production-a"])]: "x",
      [floorRoleDomainKey(["production-b"])]: "x",
      [floorRoleDomainKey(["production-c"])]: "x",
    },
  };
}
