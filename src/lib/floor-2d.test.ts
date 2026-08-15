import { describe, expect, it } from "vitest";
import {
  buildFloorPrintMarkClusters,
  calculateFloorCanvasBounds,
  chooseFloorGridStep,
  floorOpeningTouchesFloor,
  type FloorSpatialMarkPiece,
} from "./floor-2d";
import type { FloorPlanState } from "./floor-plan";

function plan(): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs: [{ id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 6000, height: 4000 }],
    openings: [
      { id: "inside", name: "楼梯间", type: "stair", x: 2000, y: 1000, width: 1000, height: 1000 },
      { id: "far", name: "远端洞口", type: "void", x: 50000, y: 50000, width: 2000, height: 2000 },
    ],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

describe("Floor 2D世界网格与取景", () => {
  it("选择可读的真实mm网格，屏幕间距保持在合理范围", () => {
    [0.005, 0.02, 0.08, 0.2].forEach((scale) => {
      const step = chooseFloorGridStep(scale);
      expect([100, 200, 500, 1000, 2000, 5000, 10000]).toContain(step.minorMm);
      expect(step.majorMm).toBe(step.minorMm * 4);
      expect(step.minorMm * scale).toBeGreaterThanOrEqual(20);
      expect(step.minorMm * scale).toBeLessThanOrEqual(100);
    });
  });

  it("默认取景忽略远端未覆盖洞口，查看全部对象时才纳入", () => {
    const state = plan();
    expect(floorOpeningTouchesFloor(state.openings[0], state)).toBe(true);
    expect(floorOpeningTouchesFloor(state.openings[1], state)).toBe(false);
    expect(calculateFloorCanvasBounds(state, "floor")).toEqual({ minX: 0, minY: 0, maxX: 6000, maxY: 4000 });
    expect(calculateFloorCanvasBounds(state, "all")).toEqual({ minX: 0, minY: 0, maxX: 52000, maxY: 52000 });
  });

  it("异常洞口仅少量与楼板相交且伸出很远时，floor模式仍以楼板主体取景", () => {
    const state: FloorPlanState = {
      ...plan(),
      slabs: [{ id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 6000, height: 4000 }],
      openings: [{ id: "far", name: "异常洞口", type: "void", x: 5500, y: 3500, width: 50000, height: 50000 }],
    };
    expect(floorOpeningTouchesFloor(state.openings[0], state)).toBe(true);
    expect(calculateFloorCanvasBounds(state, "floor")).toEqual({ minX: 0, minY: 0, maxX: 6000, maxY: 4000 });
    expect(calculateFloorCanvasBounds(state, "all")).toEqual({ minX: 0, minY: 0, maxX: 55500, maxY: 53500 });
  });
});

describe("Floor Print Mark空间聚类", () => {
  const piece = (id: string, positionMm: number, runStartMm: number, runEndMm: number): FloorSpatialMarkPiece => ({
    id,
    mark: "D01",
    direction: "x",
    positionMm,
    runStartMm,
    runEndMm,
    spacing: 200,
  });

  it("同一钢筋带只标一次，明显分离区域各标一次且与输入顺序无关", () => {
    const input = [
      piece("left-1", 100, 0, 2000),
      piece("left-2", 300, 0, 2000),
      piece("right-1", 100, 6000, 8000),
      piece("right-2", 300, 6000, 8000),
    ];
    const first = buildFloorPrintMarkClusters(input);
    const second = buildFloorPrintMarkClusters([...input].reverse());
    expect(first).toHaveLength(2);
    expect(first).toEqual(second);
    expect(first.map((cluster) => cluster.pieceIds)).toEqual([
      ["left-1", "left-2"],
      ["right-1", "right-2"],
    ]);
    expect(first.map((cluster) => cluster.centerX)).toEqual([1000, 7000]);
  });
});
