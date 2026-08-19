import { describe, expect, it } from "vitest";
import type { FloorPrintBomCandidate, FloorPrintGeometry } from "./floor-print";
import { assignFloorPrintMarks } from "./floor-print";
import {
  buildFloorPrintAreaGroups,
  buildFloorPrintSlabRefs,
} from "./floor-print-layout";

function geometry(slabs: FloorPrintGeometry["slabs"]): FloorPrintGeometry {
  return {
    bounds: { minX: 0, minY: 0, maxX: 10000, maxY: 10000 },
    slabs,
    openings: [],
    boundaries: [],
    physical: null,
  };
}

function candidate(
  id: string,
  role: "main" | "secondary",
  slabIds: string[],
): FloorPrintBomCandidate {
  return {
    id,
    layer: "bottom",
    source: "normal",
    role,
    direction: role === "main" ? "x" : "y",
    diameter: role === "main" ? 12 : 10,
    spacing: 200,
    singleLengthMm: 4000,
    count: 2,
    totalLengthM: 8,
    unitWeightKgM: 1,
    weightKg: 8,
    slabIds,
    slabNames: slabIds,
    pieceIds: [`${id}:1`, `${id}:2`],
    sortPositionMm: 100,
    sortRunStartMm: 0,
  };
}

describe("Floor Print V4 layout derivation", () => {
  it("keeps semantic S numbers for standard numeric slab names", () => {
    const refs = buildFloorPrintSlabRefs(geometry([
      { id: "one", name: "板区1", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "two", name: "板区2", type: "room", x: 100, y: 0, width: 100, height: 100 },
      { id: "ten", name: "板区10", type: "room", x: 200, y: 0, width: 100, height: 100 },
      { id: "three", name: "板区 3", type: "room", x: 300, y: 0, width: 100, height: 100 },
    ]));

    expect(refs.map((ref) => [ref.name, ref.printId])).toEqual([
      ["板区1", "S01"],
      ["板区2", "S02"],
      ["板区 3", "S03"],
      ["板区10", "S10"],
    ]);
  });

  it("assigns custom names by stable physical reading order", () => {
    const source = geometry([
      { id: "hall", name: "客厅", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "bedroom", name: "卧室", type: "room", x: 0, y: 200, width: 100, height: 100 },
      { id: "kitchen", name: "厨房", type: "room", x: 200, y: 200, width: 100, height: 100 },
    ]);

    const first = buildFloorPrintSlabRefs(source);
    const second = buildFloorPrintSlabRefs(source);
    expect(first).toEqual(second);
    expect(first.map((ref) => [ref.name, ref.printId])).toEqual([
      ["卧室", "S01"],
      ["厨房", "S02"],
      ["客厅", "S03"],
    ]);
  });

  it("numbers Bottom rows Area -> Main -> Secondary and groups each row once", () => {
    const refs = buildFloorPrintSlabRefs(geometry([
      { id: "a", name: "板区1", type: "room", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", name: "板区2", type: "room", x: 100, y: 0, width: 100, height: 100 },
    ]));
    const rows = assignFloorPrintMarks([
      candidate("b-secondary", "secondary", ["b"]),
      candidate("a-secondary-2", "secondary", ["a"]),
      candidate("joint-main", "main", ["a", "b"]),
      candidate("a-main-2", "main", ["a"]),
      candidate("b-main", "main", ["b"]),
      candidate("a-main-1", "main", ["a"]),
      candidate("a-secondary-1", "secondary", ["a"]),
    ], "bottom", refs);

    expect(rows.map((row) => [row.pieceIds[0].replace(/:1$/, ""), row.mark])).toEqual([
      ["a-main-1", "D01"],
      ["a-main-2", "D02"],
      ["a-secondary-1", "D03"],
      ["a-secondary-2", "D04"],
      ["joint-main", "D05"],
      ["b-main", "D06"],
      ["b-secondary", "D07"],
    ]);

    const groups = buildFloorPrintAreaGroups(rows, refs);
    expect(groups.flatMap((group) => [...group.mainRows, ...group.secondaryRows]).map((row) => row.pieceIds[0]).sort())
      .toEqual(rows.map((row) => row.pieceIds[0]).sort());
    const joint = groups.find((group) => group.slabIds.length === 2)!;
    expect(joint.mainRows.map((row) => row.pieceIds[0])).toEqual(["joint-main:1"]);
    expect(groups.find((group) => group.slabIds.join("|") === "a")?.mainRows).toHaveLength(2);
    expect(groups.find((group) => group.slabIds.join("|") === "a")?.secondaryRows).toHaveLength(2);
  });
});
