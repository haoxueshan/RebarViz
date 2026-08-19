import { describe, expect, it, vi } from "vitest";
import { createFloorProductionGoldenPlan } from "./__fixtures__/floor-production-golden-v3";
import {
  buildFloorPhysicalLayout,
  floorPhysicalSharedBand,
  mapFloorNetAxisPoint,
} from "./floor-physical-layout";
import {
  DEFAULT_FLOOR_PLAN_STATE,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";
import { buildFloorRebarCalculationContextV3 } from "./floor-rebar-calculation-context-v3";
import * as floorTopologySolver from "./floor-topology-solver";

function makePlan(
  slabs: FloorSlab[],
  overrides: Partial<FloorPlanState> = {},
): FloorPlanState {
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

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: id, type: "room", x, y, width, height };
}

describe("buildFloorPhysicalLayout", () => {
  it("V3 reuses a precomputed solution and keeps the one-solve fallback", () => {
    const plan = createFloorProductionGoldenPlan();
    const context = buildFloorRebarCalculationContextV3(plan);
    const solve = vi.spyOn(floorTopologySolver, "solveFloorTopology");
    solve.mockClear();
    const fromSolution = buildFloorPhysicalLayout(plan, context.solution);
    expect(solve).toHaveBeenCalledTimes(0);
    const fallback = buildFloorPhysicalLayout(plan);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(fallback).toEqual(fromSolution);
    solve.mockRestore();
  });

  it("默认双房间：内墙240真实占位，外墙370在净室外侧，总宽8780", () => {
    const layout = buildFloorPhysicalLayout(DEFAULT_FLOOR_PLAN_STATE);
    const a = layout.slabs.find((item) => item.slabId === "floor-slab-a");
    const b = layout.slabs.find((item) => item.slabId === "floor-slab-b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 净跨语义保持不变
    expect(a!.netX).toBe(0);
    expect(b!.netX).toBe(4200);
    expect(a!.x).toBe(0);
    expect(b!.x).toBe(4440);
    const inner = layout.walls.filter((wall) => wall.kind === "inner-wall");
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({
      x: 4200,
      width: 240,
      y: 0,
      height: 3600,
      lengthMm: 3600,
      thicknessMm: 240,
      orientation: "vertical",
    });
    expect(inner[0].slabIds).toEqual(["floor-slab-a", "floor-slab-b"]);
    const outerWest = layout.walls.find((wall) => wall.kind === "outer-wall" && wall.side === "west" && wall.slabIds[0] === "floor-slab-a");
    expect(outerWest).toBeDefined();
    expect(outerWest!.x).toBe(-370);
    expect(outerWest!.width).toBe(370);
    const outerEast = layout.walls.find((wall) => wall.kind === "outer-wall" && wall.side === "east" && wall.slabIds[0] === "floor-slab-b");
    expect(outerEast).toBeDefined();
    expect(outerEast!.x).toBe(8040);
    expect(outerEast!.width).toBe(370);
    expect(layout.bounds.minX).toBe(-370);
    expect(layout.bounds.maxX).toBe(8410);
    expect(layout.bounds.maxX - layout.bounds.minX).toBe(8780);
    expect(layout.bounds.minY).toBe(-370);
    expect(layout.bounds.maxY).toBe(3970);
    expect(layout.issues).toEqual([]);
  });

  it("Continuous共享边：物理0mm，无内墙实体", () => {
    const plan = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)], {
      supportRules: [{
        id: "r1",
        target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } },
        support: "continuous",
      }],
    });
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.slabs.find((item) => item.slabId === "b")!.x).toBe(4200);
    expect(layout.walls.filter((wall) => wall.kind === "inner-wall")).toHaveLength(0);
    const band = floorPhysicalSharedBand(plan, "a", "b");
    expect(band.gapMm).toBe(0);
    expect(band.hasContinuous).toBe(true);
  });

  it("单房间外墙：bounds = 4200+740 × 3600+740", () => {
    const layout = buildFloorPhysicalLayout(makePlan([slab("a", 0, 0, 4200, 3600)]));
    expect(layout.bounds.minX).toBe(-370);
    expect(layout.bounds.minY).toBe(-370);
    expect(layout.bounds.maxX).toBe(4570);
    expect(layout.bounds.maxY).toBe(3970);
    expect(layout.bounds.maxX - layout.bounds.minX).toBe(4940);
    expect(layout.bounds.maxY - layout.bounds.minY).toBe(4340);
    expect(layout.walls.filter((wall) => wall.kind === "outer-wall")).toHaveLength(4);
  });

  it("2×2网格：X/Y双向插入内墙", () => {
    const plan = makePlan([
      slab("a", 0, 0, 4000, 3000),
      slab("b", 4000, 0, 4000, 3000),
      slab("c", 0, 3000, 4000, 3000),
      slab("d", 4000, 3000, 4000, 3000),
    ]);
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.slabs.find((item) => item.slabId === "a")!.x).toBe(0);
    expect(layout.slabs.find((item) => item.slabId === "b")!.x).toBe(4240);
    expect(layout.slabs.find((item) => item.slabId === "c")!.x).toBe(0);
    expect(layout.slabs.find((item) => item.slabId === "d")!.x).toBe(4240);
    expect(layout.slabs.find((item) => item.slabId === "a")!.y).toBe(0);
    expect(layout.slabs.find((item) => item.slabId === "c")!.y).toBe(3240);
    expect(layout.slabs.find((item) => item.slabId === "d")!.y).toBe(3240);
    expect(layout.walls.filter((wall) => wall.kind === "inner-wall")).toHaveLength(4);
    layout.walls.filter((wall) => wall.kind === "inner-wall").forEach((wall) => {
      expect(wall.thicknessMm).toBe(240);
    });
    expect(layout.issues).toEqual([]);
  });

  it("T型组合：墙带与竖向外墙在T节点连续，无空洞", () => {
    const plan = makePlan([
      slab("a", 0, 0, 6000, 3000),
      slab("b", 2000, 3000, 2000, 3000),
    ]);
    const layout = buildFloorPhysicalLayout(plan);
    const bPhys = layout.slabs.find((item) => item.slabId === "b")!;
    expect(bPhys.y).toBe(3240);
    const inner = layout.walls.find((wall) => wall.kind === "inner-wall");
    expect(inner).toBeDefined();
    // a北边只有 2000..4000 与 b 南边共享 → 内墙带长 2000。
    expect(inner!.orientation).toBe("horizontal");
    expect(inner!.x).toBe(2000);
    expect(inner!.width).toBe(2000);
    expect(inner!.height).toBe(240);
    expect(inner!.y).toBe(3000);
    expect(inner!.thicknessMm).toBe(240);
    // b 西外墙覆盖 T 节点西侧：x ∈ [2000-370, 2000]，y ∈ [3240? no: b.y=3240..6240 + north]
    const westWall = layout.walls.find((wall) => wall.kind === "outer-wall" && wall.side === "west" && wall.slabIds[0] === "b");
    expect(westWall).toBeDefined();
    expect(westWall!.x).toBe(2000 - 370);
    expect(westWall!.width).toBe(370);
    expect(westWall!.y).toBe(3240);
    // 在 y=3100 处：内墙覆盖 [2000,4000]，西外墙覆盖 [1630,2000]，两者贴合并连续。
    const bandY = 3100;
    const covers = layout.walls.some((wall) => wall.x <= 2000 - 1e-6 && wall.x + wall.width >= 2000 + 1e-6
      && wall.y <= bandY && wall.y + wall.height >= bandY && wall.x + wall.width >= 3000 - 1e-6);
    expect(covers).toBe(false);
    const innerCovers = layout.walls.some((wall) => wall.x - 1e-6 <= 2000 && wall.x + wall.width + 1e-6 >= 4000 && wall.y - 1e-6 <= bandY && wall.y + wall.height + 1e-6 >= bandY);
    expect(innerCovers).toBe(true);
    const westCovers = layout.walls.some((wall) => wall.x - 1e-6 <= 1630 && wall.x + wall.width + 1e-6 >= 2000 && wall.y - 1e-6 <= bandY && wall.y + wall.height + 1e-6 >= bandY);
    expect(westCovers).toBe(true);
    // 净房间 b 不与墙带重叠：b.y = 3240 = 3000 + 240 ✓
    expect(bPhys.y).toBe(3000 + 240);
  });

  it("Mixed共享边：墙带240，内墙只覆盖inner段，连续段成为开口并报警", () => {
    const plan = makePlan([slab("a", 0, 0, 3000, 3000), slab("b", 3000, 0, 3000, 3000)], {
      supportRules: [{
        id: "r1",
        target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 1500 } },
        support: "continuous",
      }],
    });
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.slabs.find((item) => item.slabId === "b")!.x).toBe(3240);
    const innerWalls = layout.walls.filter((wall) => wall.kind === "inner-wall");
    expect(innerWalls).toHaveLength(1);
    expect(innerWalls[0].y).toBe(1500);
    expect(innerWalls[0].height).toBe(1500);
    expect(innerWalls[0].width).toBe(240);
    expect(layout.issues.some((issue) => issue.code === "mixed-shared-boundary-band")).toBe(true);
  });

  it("Disconnected板区：保持各自Net位置，不自动加墙距", () => {
    const layout = buildFloorPhysicalLayout(makePlan([slab("a", 0, 0, 3000, 3000), slab("b", 10000, 0, 3000, 3000)]));
    const bPhys = layout.slabs.find((item) => item.slabId === "b")!;
    expect(bPhys.netX).toBe(10000);
    expect(bPhys.x).toBe(10000);
  });

  it("内墙厚度修改：物理位置跟随，Net不变", () => {
    const plan = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)], { innerWallThickness: 300 });
    const layout = buildFloorPhysicalLayout(plan);
    const bPhys = layout.slabs.find((item) => item.slabId === "b")!;
    expect(bPhys.netX).toBe(4200);
    expect(bPhys.x).toBe(4500);
    const inner = layout.walls.find((wall) => wall.kind === "inner-wall")!;
    expect(inner.width).toBe(300);
    expect(inner.thicknessMm).toBe(300);
  });

  it("外墙厚度修改：只改变外墙与bounds，内部净房间不动", () => {
    const plan = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)], { outerWallThickness: 500 });
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.slabs.find((item) => item.slabId === "a")!.x).toBe(0);
    expect(layout.slabs.find((item) => item.slabId === "b")!.x).toBe(4440);
    expect(layout.bounds.minX).toBe(-500);
    const outer = layout.walls.find((wall) => wall.kind === "outer-wall" && wall.side === "west" && wall.slabIds[0] === "a")!;
    expect(outer.thicknessMm).toBe(500);
    expect(outer.width).toBe(500);
  });

  it("约束冲突：不一致净输入展开后物理重叠 → error issue + best effort", () => {
    // b 完全嵌入 a：四周共享边无法拉开两个净房间 → 物理重叠 → 约束冲突。
    const plan = makePlan([
      slab("a", 0, 0, 3000, 3000),
      slab("b", 500, 500, 1000, 1000),
    ]);
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.slabs).toHaveLength(2);
    const conflict = layout.issues.find((issue) => issue.code === "physical-layout-constraint-conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.level).toBe("error");
    // best-effort：布局仍然输出确定值，UI 不会白屏。
    expect(layout.slabs.find((item) => item.slabId === "a")!.x).toBe(0);
    expect(Number.isFinite(layout.bounds.maxX)).toBe(true);
  });

  it("Opening按宿主板区偏移映射", () => {
    const plan = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)], {
      openings: [{ id: "o1", name: "井道", type: "shaft", x: 100, y: 200, width: 900, height: 600 }],
    });
    const layout = buildFloorPhysicalLayout(plan);
    const opening = layout.openings.find((item) => item.openingId === "o1")!;
    expect(opening.x).toBe(100);
    expect(opening.y).toBe(200);
    const plan2 = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)], {
      openings: [{ id: "o1", name: "井道", type: "shaft", x: 4300, y: 200, width: 900, height: 600 }],
    });
    const layout2 = buildFloorPhysicalLayout(plan2);
    expect(layout2.openings.find((item) => item.openingId === "o1")!.x).toBe(4300 + 240);
  });

  it("跨多板区洞口：确定性宿主 + ambiguous warning", () => {
    const plan = makePlan([slab("a", 0, 0, 3000, 3000), slab("b", 2800, 0, 3000, 3000)], {
      openings: [{ id: "o1", name: "跨板洞口", type: "void", x: 2850, y: 100, width: 120, height: 800 }],
    });
    const layout = buildFloorPhysicalLayout(plan);
    expect(layout.openings.find((item) => item.openingId === "o1")!.x).toBe(2850);
    expect(layout.issues.some((issue) => issue.code === "physical-opening-host-ambiguous")).toBe(true);
  });
});

describe("mapFloorNetAxisPoint", () => {
  const plan = makePlan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)]);
  const layout = buildFloorPhysicalLayout(plan);

  it("板区内部按宿主偏移1:1映射", () => {
    expect(mapFloorNetAxisPoint("x", 1000, plan, layout, ["a"])).toBe(1000);
    expect(mapFloorNetAxisPoint("x", 5000, plan, layout, ["b"])).toBe(5000 + 240);
  });

  it("共享边按偏好板区解析到墙带两侧", () => {
    expect(mapFloorNetAxisPoint("x", 4200, plan, layout, ["a"])).toBe(4200);
    expect(mapFloorNetAxisPoint("x", 4200, plan, layout, ["b"])).toBe(4440);
  });

  it("建筑外侧锚固区按最外板区1:1延伸", () => {
    expect(mapFloorNetAxisPoint("x", -370, plan, layout, ["a"])).toBe(-370);
    expect(mapFloorNetAxisPoint("x", 7800 + 370, plan, layout, ["b"])).toBe(8040 + 370);
  });
});
