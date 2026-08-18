import type { FloorPlanState } from "../floor-plan";
import { stableFloorConnectionId, type FloorEdgeConnection } from "../floor-topology";

type MengSlabId = "meng-a" | "meng-b" | "meng-c" | "meng-d" | "meng-e" | "meng-f" | "meng-k" | "meng-l";

function connection(
  slabIdA: MengSlabId,
  sideA: FloorEdgeConnection["a"]["side"],
  slabIdB: MengSlabId,
  sideB: FloorEdgeConnection["b"]["side"],
  lockStart: boolean,
): FloorEdgeConnection {
  return {
    id: stableFloorConnectionId(slabIdA, sideA, slabIdB, sideB),
    a: { slabId: slabIdA, side: sideA, range: { mode: "auto-overlap" } },
    b: { slabId: slabIdB, side: sideB, range: { mode: "auto-overlap" } },
    source: "legacy-shared-edge",
    confidence: "confirmed",
    tangentConstraint: lockStart ? { mode: "lock-start", offsetMm: 0 } : { mode: "none" },
  };
}

/** User-exported saved Plan3 before the four missing connections are repaired. */
export function incompleteMengPlan3(): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: [
      { id: "meng-a", name: "板区A", type: "room", x: -5696, y: 13130, width: 4020, height: 3270 },
      { id: "meng-b", name: "板区B", type: "room", x: -1436, y: 13130, width: 3500, height: 3270 },
      { id: "meng-c", name: "板区C", type: "room", x: 5834, y: 10720, width: 4020, height: 5680 },
      { id: "meng-d", name: "板区D", type: "room", x: 2304, y: 13130, width: 3530, height: 3270 },
      { id: "meng-e", name: "板区E", type: "room", x: -5696, y: 10730, width: 4020, height: 2160 },
      { id: "meng-f", name: "板区F", type: "room", x: -5696, y: 6810, width: 4020, height: 3680 },
      { id: "meng-k", name: "板区K", type: "room", x: -1436, y: 6800, width: 7270, height: 6090 },
      { id: "meng-l", name: "板区L", type: "room", x: 5834, y: 7040, width: 4020, height: 3680 },
    ],
    openings: [],
    supportRules: [
      {
        id: "support:slab:meng-b:south:whole",
        target: { kind: "slab-edge", slabId: "meng-b", side: "south", range: { mode: "whole" } },
        support: "inner-wall",
      },
    ],
    innerWallThickness: 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
    connections: [
      connection("meng-e", "south", "meng-f", "north", true),
      connection("meng-a", "south", "meng-e", "north", true),
      connection("meng-b", "south", "meng-k", "north", false),
      connection("meng-d", "south", "meng-k", "north", false),
      connection("meng-f", "east", "meng-k", "west", false),
      connection("meng-e", "east", "meng-k", "west", false),
      connection("meng-a", "east", "meng-b", "west", true),
      connection("meng-b", "east", "meng-d", "west", true),
    ],
  };
}

export const INCOMPLETE_MENG_EXISTING_PAIRS: ReadonlyArray<readonly [MengSlabId, MengSlabId]> = [
  ["meng-a", "meng-b"],
  ["meng-b", "meng-d"],
  ["meng-a", "meng-e"],
  ["meng-e", "meng-f"],
  ["meng-e", "meng-k"],
  ["meng-f", "meng-k"],
  ["meng-b", "meng-k"],
  ["meng-d", "meng-k"],
];

export const INCOMPLETE_MENG_MISSING_PAIRS: ReadonlyArray<readonly [MengSlabId, MengSlabId]> = [
  ["meng-d", "meng-c"],
  ["meng-k", "meng-c"],
  ["meng-k", "meng-l"],
  ["meng-c", "meng-l"],
];
