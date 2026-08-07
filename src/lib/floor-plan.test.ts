import { describe, expect, it } from "vitest";
import {
  buildFloorBoundarySegments,
  floorSlabsOverlap,
  normalizeFloorPlanState,
  snapFloorSlab,
  validateFloorPlan,
  type FloorPlanState,
} from "./floor-plan";

function state(
  slabs: FloorPlanState["slabs"],
): FloorPlanState {
  return {
    slabs,
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
  };
}

describe("整层拼图墙体拓扑", () => {
  it("相同高度的相邻房间生成一段共享内墙和连续外轮廓", () => {
    const floor = state([
      { id: "a", name: "A", x: 0, y: 0, width: 4200, height: 3600 },
      { id: "b", name: "B", x: 4200, y: 0, width: 3600, height: 3600 },
    ]);
    const segments = buildFloorBoundarySegments(floor);
    const inner = segments.filter((segment) => segment.type === "inner-wall");
    const outer = segments.filter((segment) => segment.type === "outer-wall");

    expect(inner).toEqual([
      expect.objectContaining({
        orientation: "vertical",
        startX: 4200,
        startY: 0,
        endX: 4200,
        endY: 3600,
        thicknessMm: 240,
        slabIds: ["a", "b"],
      }),
    ]);
    expect(outer).toHaveLength(4);
    expect(outer.filter((segment) => segment.orientation === "horizontal").map((segment) => segment.endX - segment.startX)).toEqual([7800, 7800]);
  });

  it("不等高度房间只在重叠范围生成内墙，暴露部分识别为外墙", () => {
    const floor = state([
      { id: "a", name: "A", x: 0, y: 0, width: 3000, height: 3000 },
      { id: "b", name: "B", x: 3000, y: 0, width: 3000, height: 6000 },
    ]);
    const segments = buildFloorBoundarySegments(floor);
    expect(segments).toContainEqual(expect.objectContaining({
      type: "inner-wall",
      startX: 3000,
      startY: 0,
      endX: 3000,
      endY: 3000,
    }));
    expect(segments).toContainEqual(expect.objectContaining({
      type: "outer-wall",
      startX: 3000,
      startY: 3000,
      endX: 3000,
      endY: 6000,
      slabIds: ["b"],
    }));
  });

  it("Y向拼接对称识别水平共享墙", () => {
    const floor = state([
      { id: "south", name: "南房", x: 0, y: 0, width: 3600, height: 3000 },
      { id: "north", name: "北房", x: 0, y: 3000, width: 3600, height: 4200 },
    ]);
    expect(buildFloorBoundarySegments(floor)).toContainEqual(expect.objectContaining({
      type: "inner-wall",
      orientation: "horizontal",
      startX: 0,
      startY: 3000,
      endX: 3600,
      endY: 3000,
      slabIds: ["north", "south"],
    }));
  });

  it("墙段ID由几何和关联房间确定，不依赖调用次数", () => {
    const floor = state([
      { id: "a", name: "A", x: 0, y: 0, width: 3000, height: 3000 },
      { id: "b", name: "B", x: 3000, y: 0, width: 3000, height: 3000 },
      { id: "c", name: "C", x: 6000, y: 0, width: 2400, height: 3600 },
    ]);
    expect(buildFloorBoundarySegments(floor).map((segment) => segment.id)).toEqual(
      buildFloorBoundarySegments(structuredClone(floor)).map((segment) => segment.id),
    );
  });
});

describe("整层拼图交互辅助", () => {
  it("房间边缘在阈值内自动吸附到相邻房间", () => {
    const fixed = { id: "a", name: "A", x: 0, y: 0, width: 4200, height: 3600 };
    const moving = { id: "b", name: "B", x: 4260, y: 40, width: 3600, height: 3600 };
    expect(snapFloorSlab(moving, [fixed], 150)).toMatchObject({ x: 4200, y: 0 });
    expect(snapFloorSlab({ ...moving, x: 4500 }, [fixed], 150).x).toBe(4500);
  });

  it("接触边不算重叠，真实交叉会触发校验", () => {
    const a = { id: "a", name: "A", x: 0, y: 0, width: 3000, height: 3000 };
    const touching = { id: "b", name: "B", x: 3000, y: 0, width: 3000, height: 3000 };
    const overlap = { ...touching, x: 2900 };
    expect(floorSlabsOverlap(a, touching)).toBe(false);
    expect(floorSlabsOverlap(a, overlap)).toBe(true);
    expect(validateFloorPlan(state([a, overlap])).join(" ")).toContain("发生重叠");
  });

  it("损坏草稿使用安全值恢复且不产生NaN", () => {
    const restored = normalizeFloorPlanState({
      slabs: [{ id: "a", name: "A", x: Number.NaN, y: 0, width: Number.POSITIVE_INFINITY, height: 3600 }],
      innerWallThickness: Number.NaN,
    });
    expect(restored.slabs[0]).toMatchObject({ x: 0, width: 3600 });
    expect(restored.innerWallThickness).toBe(240);
    expect(validateFloorPlan(restored)).toEqual([]);
  });
});
