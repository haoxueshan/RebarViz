import { describe, expect, it } from "vitest";
import { buildFloorAssembly } from "./floor-assembly";
import type { FloorPlanState, FloorSlab } from "./floor-plan";

function slab(id: string, x: number, y: number, width = 4000, height = 3000): FloorSlab {
  return { id, name: id, type: "room", x, y, width, height };
}

function makePlan(slabs: FloorSlab[], overrides: Partial<FloorPlanState> = {}): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
    ...overrides,
  };
}

describe("buildFloorAssembly", () => {
  it("单板工程：fully connected，无孤立警告", () => {
    const assembly = buildFloorAssembly(makePlan([slab("a", 0, 0)]));
    expect(assembly.slabCount).toBe(1);
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.isFullyConnected).toBe(true);
    expect(assembly.disconnectedSlabIds).toEqual([]);
    expect(assembly.issues).toEqual([]);
    expect(assembly.primarySlabIds).toEqual(["a"]);
  });

  it("2×2全部共边：单个组件，isFullyConnected", () => {
    const assembly = buildFloorAssembly(makePlan([
      slab("a", 0, 0), slab("b", 4000, 0), slab("c", 0, 3000), slab("d", 4000, 3000),
    ]));
    expect(assembly.connectedComponentCount).toBe(1);
    expect(new Set(assembly.primarySlabIds)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(assembly.disconnectedSlabIds).toEqual([]);
    expect(assembly.isFullyConnected).toBe(true);
    expect(assembly.issues).toEqual([]);
  });

  it("10+2：主组件10板，2板未连接", () => {
    // 4×3 网格的前10块共边，后2块远离。
    const connected = Array.from({ length: 10 }, (_, index) => slab(
      `s${String(index + 1).padStart(2, "0")}`,
      (index % 4) * 3000,
      Math.floor(index / 4) * 2400,
      3000,
      2400,
    ));
    const plan = makePlan([
      ...connected,
      slab("s11", 20000, 0, 3000, 2400),
      slab("s12", 23000, 0, 3000, 2400),
    ]);
    const assembly = buildFloorAssembly(plan);
    expect(assembly.slabCount).toBe(12);
    expect(assembly.connectedComponentCount).toBe(2);
    expect(assembly.primarySlabIds).toHaveLength(10);
    expect(assembly.disconnectedSlabIds).toEqual(["s11", "s12"]);
    expect(assembly.isFullyConnected).toBe(false);
    expect(assembly.issues.some((issue) => issue.code === "disconnected-floor-component")).toBe(true);
  });

  it("两个同规模组件：面积大者为Primary，tie-break确定性", () => {
    const groupA = [slab("a1", 0, 0, 3000, 2000), slab("a2", 3000, 0, 3000, 2000), slab("a3", 6000, 0, 3000, 2000)];
    const groupB = [slab("b1", 0, 6000, 4000, 3000), slab("b2", 4000, 6000, 4000, 3000), slab("b3", 8000, 6000, 4000, 3000)];
    const assembly = buildFloorAssembly(makePlan([...groupA, ...groupB]));
    expect(assembly.connectedComponentCount).toBe(2);
    // 板数相同（3 vs 3），B 面积更大 → Primary = b 组。
    expect(assembly.primarySlabIds).toEqual(["b1", "b2", "b3"]);
    expect(assembly.disconnectedSlabIds).toEqual(["a1", "a2", "a3"]);
    // 同规模同面积 tie-break：minX 小者优先且结果稳定。
    const sameArea = buildFloorAssembly(makePlan([
      slab("x1", 0, 0, 3000, 3000), slab("x2", 3000, 0, 3000, 3000),
      slab("y1", 0, 8000, 3000, 3000), slab("y2", 3000, 8000, 3000, 3000),
    ]));
    expect(sameArea.primarySlabIds).toEqual(["x1", "x2"]);
  });

  it("Inner Wall共享边属于同一Assembly", () => {
    const assembly = buildFloorAssembly(makePlan([slab("a", 0, 0), slab("b", 4000, 0)]));
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.isFullyConnected).toBe(true);
  });

  it("Continuous共享边同样属于同一Assembly", () => {
    const plan = makePlan([slab("a", 0, 0), slab("b", 4000, 0)], {
      supportRules: [{
        id: "r1",
        target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } },
        support: "continuous",
      }],
    });
    const assembly = buildFloorAssembly(plan);
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.isFullyConnected).toBe(true);
  });

  it("Near Miss（5mm/20mm）不算连接", () => {
    const plan = makePlan([slab("a", 0, 0), slab("b", 4005, 0)]);
    const assembly = buildFloorAssembly(plan);
    expect(assembly.connectedComponentCount).toBe(2);
    expect(assembly.isFullyConnected).toBe(false);
    expect(assembly.issues.some((issue) => issue.code === "isolated-slab")).toBe(true);
  });

  it("错误重叠不算连接（按真实Atomic Topology）", () => {
    // 完全重叠的两板不产生 shared-slab 边，Assembly 仍为两个组件。
    const plan = makePlan([slab("a", 0, 0), slab("b", 500, 500, 1000, 1000)]);
    const assembly = buildFloorAssembly(plan);
    expect(assembly.slabCount).toBe(2);
    expect(assembly.connectedComponentCount).toBe(2);
  });

  it("Opening不参与Assembly节点", () => {
    const plan = makePlan([slab("a", 0, 0), slab("b", 4000, 0)], {
      openings: [{ id: "o1", name: "井道", type: "shaft", x: 1000, y: 500, width: 800, height: 800 }],
    });
    const assembly = buildFloorAssembly(plan);
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.components.every((component) => component.slabIds.every((id) => id !== "o1"))).toBe(true);
  });
});
