import { describe, expect, it } from "vitest";
import {
  describeSlabOverlap,
  resolveFloorGeometryTolerance,
} from "./floor-geometry-tolerance";
import type { FloorPlanState, FloorSlab } from "./floor-plan";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
}

function plan(slabs: FloorSlab[], overlapToleranceMm = 10): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm,
  };
}

describe("Floor Geometry Tolerance（几何容差）", () => {
  it("5mm短轴重叠自动纠偏为精确共边", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4195, 0, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([{
      slabId: "b",
      axis: "x",
      previousValue: 4195,
      correctedValue: 4200,
      correctionMm: 5,
      reason: "tolerable-overlap",
    }]);
    expect(result.plan.slabs.find((item) => item.id === "b")?.x).toBe(4200);
    expect(result.unresolvedIssues).toEqual([]);
  });

  it("重叠恰好等于容差10mm仍自动纠偏", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4190, 0, 3600, 3600),
    ]));
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]).toMatchObject({ slabId: "b", axis: "x", correctedValue: 4200, correctionMm: 10 });
  });

  it("10.1mm重叠超过容差不纠偏并保留重叠错误", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4189.9, 0, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([]);
    expect(result.plan.slabs.find((item) => item.id === "b")?.x).toBe(4189.9);
    expect(result.unresolvedIssues.some((issue) => issue.code === "slab-overlap")).toBe(true);
  });

  it("5mm间隙自动贴合为精确共边", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4205, 0, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([{
      slabId: "b",
      axis: "x",
      previousValue: 4205,
      correctedValue: 4200,
      correctionMm: 5,
      reason: "tolerable-gap",
    }]);
    expect(result.unresolvedIssues).toEqual([]);
  });

  it("15mm间隙超过容差不贴合并保持原坐标", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4215, 0, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([]);
    expect(result.plan.slabs.find((item) => item.id === "b")?.x).toBe(4215);
  });

  it("1000×5重叠只修短轴（南北向5mm）", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 0, 3595, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([{
      slabId: "b",
      axis: "y",
      previousValue: 3595,
      correctedValue: 3600,
      correctionMm: 5,
      reason: "tolerable-overlap",
    }]);
  });

  it("5×3000重叠只修短轴（东西向5mm）", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4195, 0, 3000, 3600),
    ]));
    expect(result.corrections).toEqual([{
      slabId: "b",
      axis: "x",
      previousValue: 4195,
      correctedValue: 4200,
      correctionMm: 5,
      reason: "tolerable-overlap",
    }]);
  });

  it("500×500大面积重叠不纠偏并保留错误", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 3700, 3100, 3000, 3000),
    ]));
    expect(result.corrections).toEqual([]);
    expect(result.unresolvedIssues.some((issue) => issue.code === "slab-overlap")).toBe(true);
  });

  it("容差为0时严格模式不做任何自动纠偏", () => {
    const input = plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4195, 0, 3600, 3600),
    ], 0);
    const result = resolveFloorGeometryTolerance(input);
    expect(result.corrections).toEqual([]);
    expect(result.plan).toBe(input);
    expect(result.unresolvedIssues.some((issue) => issue.code === "slab-overlap")).toBe(true);
  });

  it("纠偏移动不与第三方板区产生新重叠", () => {
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4195, 0, 3600, 3600),
      slab("c", 7800, 0, 3600, 3600),
    ]));
    expect(result.corrections).toEqual([{
      slabId: "b",
      axis: "x",
      previousValue: 4195,
      correctedValue: 4200,
      correctionMm: 5,
      reason: "tolerable-overlap",
    }]);
    expect(result.unresolvedIssues).toEqual([]);
  });

  it("间隙贴合若与第三方重叠则跳过该修正", () => {
    // b 向西贴合会与 c 重叠（c 占据 4195 起），因此跳过，保留 near-miss 与重叠错误。
    const result = resolveFloorGeometryTolerance(plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4205, 0, 3600, 3600),
      slab("c", 4100, 0, 500, 3600),
    ]));
    expect(result.corrections).toEqual([]);
    expect(result.plan.slabs.find((item) => item.id === "b")?.x).toBe(4205);
    expect(result.unresolvedIssues.length).toBeGreaterThan(0);
  });

  it("describeSlabOverlap给出重叠信息", () => {
    const info = describeSlabOverlap(
      slab("a", 0, 0, 4200, 3600),
      slab("b", 3000, 0, 1240, 3600),
    );
    expect(info).toMatchObject({
      leftSlabId: "a",
      rightSlabId: "b",
      overlapWidthMm: 1200,
      overlapHeightMm: 3600,
      overlapAreaMm2: 1200 * 3600,
      shortAxisOverlapMm: 1200,
    });
    expect(describeSlabOverlap(slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600))).toBeNull();
  });
});
