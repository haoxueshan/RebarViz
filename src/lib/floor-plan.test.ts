import { describe, expect, it } from "vitest";
import {
  buildFloorAtomicBoundarySegments,
  buildFloorBoundarySegments,
  buildFloorDisplayBoundarySegments,
  buildFloorSlabAdjacency,
  buildFloorTopologyCells,
  findFloorComponents,
  floorOpeningCoverage,
  floorOpeningsOverlap,
  floorSlabsOverlap,
  nextAvailableFloorName,
  normalizeFloorPlanState,
  snapFloorOpening,
  snapFloorSlab,
  validateFloorPlan,
  validateFloorPlanV2,
  type FloorOpening,
  type FloorPlanState,
  type FloorSlab,
} from "./floor-plan";

function slab(partial: Partial<FloorSlab> & Pick<FloorSlab, "id" | "x" | "y" | "width" | "height">): FloorSlab {
  return { name: partial.id, type: "room", ...partial };
}

function opening(partial: Partial<FloorOpening> & Pick<FloorOpening, "id" | "x" | "y" | "width" | "height">): FloorOpening {
  return { name: partial.id, type: "stair", ...partial };
}

function plan(slabs: FloorSlab[], openings: FloorOpening[] = []): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings,
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
  };
}

describe("Floor Geometry V2 数据迁移", () => {
  it("把V1直接state迁移为净跨坐标、板区类型、空洞口和空规则", () => {
    const restored = normalizeFloorPlanState({
      slabs: [{ id: "a", name: "A", x: 0, y: 0, width: 4200, height: 3600 }],
      innerWallThickness: 240,
      outerWallThickness: 370,
      snapDistanceMm: 150,
    });
    expect(restored).toMatchObject({ coordinateModel: "net-layout-v1", openings: [], supportRules: [] });
    expect(restored.slabs[0].type).toBe("room");
  });

  it("合法空板区数组保持为空，不偷偷恢复默认两板", () => {
    const restored = normalizeFloorPlanState({ slabs: [], openings: [] });
    expect(restored.slabs).toEqual([]);
    expect(validateFloorPlan(restored)).toContain("至少需要一个板区。");
  });

  it("非法类型回退到安全默认类型且损坏数值不产生NaN", () => {
    const restored = normalizeFloorPlanState({
      slabs: [{ id: "a", name: "A", type: "bad", x: Number.NaN, y: 0, width: Infinity, height: 3600 }],
      openings: [{ id: "o", name: "O", type: "bad", x: 10, y: 10, width: 20, height: 20 }],
    });
    expect(restored.slabs[0]).toMatchObject({ type: "room", x: 0, width: 3600 });
    expect(restored.openings[0].type).toBe("other");
  });
});

describe("Opening扣洞", () => {
  it("板内洞口合法并生成四侧opening-edge，洞内没有有效板cell", () => {
    const state = plan(
      [slab({ id: "a", x: 0, y: 0, width: 6000, height: 6000 })],
      [opening({ id: "stair", x: 2000, y: 2000, width: 2000, height: 2000 })],
    );
    const issues = validateFloorPlanV2(state);
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
    const openingEdges = buildFloorAtomicBoundarySegments(state).filter((segment) => segment.geometryKind === "opening-edge");
    expect(openingEdges).toHaveLength(4);
    expect(openingEdges.every((segment) => segment.support === "opening-cut")).toBe(true);
    expect(buildFloorTopologyCells(state).find((cell) => cell.x === 2000 && cell.y === 2000)).toMatchObject({ baseSlabId: "a", effectiveSlabId: null, openingIds: ["stair"] });
  });

  it("洞口跨两个板区时从两边分别扣除", () => {
    const state = plan(
      [slab({ id: "a", x: 0, y: 0, width: 4000, height: 4000 }), slab({ id: "b", x: 4000, y: 0, width: 4000, height: 4000 })],
      [opening({ id: "stair", x: 3000, y: 1000, width: 2000, height: 2000 })],
    );
    const cutSlabs = new Set(buildFloorAtomicBoundarySegments(state).filter((segment) => segment.openingId === "stair").flatMap((segment) => segment.slabIds));
    expect(cutSlabs).toEqual(new Set(["a", "b"]));
    expect(floorOpeningCoverage(state.openings[0], state.slabs).coverageRatio).toBe(1);
  });

  it("洞口完全离板和部分越界分别返回warning，不抛异常", () => {
    const base = slab({ id: "a", x: 0, y: 0, width: 4000, height: 4000 });
    const outside = plan([base], [opening({ id: "outside", x: 5000, y: 0, width: 1000, height: 1000 })]);
    const partial = plan([base], [opening({ id: "partial", x: 3500, y: 1000, width: 1000, height: 1000 })]);
    expect(validateFloorPlanV2(outside).map((issue) => issue.code)).toContain("opening-uncovered");
    expect(validateFloorPlanV2(partial).map((issue) => issue.code)).toContain("opening-partial-outside");
    expect(floorOpeningCoverage(partial.openings[0], partial.slabs).coveredAreaMm2).toBe(500_000);
  });

  it("洞口面积重叠报错，只有边界接触允许", () => {
    const first = opening({ id: "a", x: 1000, y: 1000, width: 1000, height: 1000 });
    const touching = opening({ id: "b", x: 2000, y: 1000, width: 1000, height: 1000 });
    const overlap = { ...touching, x: 1900 };
    expect(floorOpeningsOverlap(first, touching)).toBe(false);
    expect(floorOpeningsOverlap(first, overlap)).toBe(true);
    expect(validateFloorPlanV2(plan([slab({ id: "s", x: 0, y: 0, width: 5000, height: 5000 })], [first, overlap])).map((issue) => issue.code)).toContain("opening-overlap");
  });
});

describe("Geometry与Support分离", () => {
  it("共享边默认是shared-slab几何和inner-wall支承", () => {
    const state = plan([slab({ id: "a", x: 0, y: 0, width: 3000, height: 3000 }), slab({ id: "b", x: 3000, y: 0, width: 3000, height: 3000 })]);
    expect(buildFloorAtomicBoundarySegments(state)).toContainEqual(expect.objectContaining({ geometryKind: "shared-slab", support: "inner-wall", slabIds: ["a", "b"] }));
  });

  it("稳定slab edge规则把共享边改成continuous且不改变geometryKind", () => {
    const state = plan([slab({ id: "a", x: 0, y: 0, width: 3000, height: 3000 }), slab({ id: "b", x: 3000, y: 0, width: 3000, height: 3000 })]);
    state.supportRules = [{ id: "r1", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" }];
    const shared = buildFloorAtomicBoundarySegments(state).find((segment) => segment.geometryKind === "shared-slab");
    expect(shared).toMatchObject({ geometryKind: "shared-slab", support: "continuous", thicknessMm: 0 });
    state.slabs.push(slab({ id: "unrelated", x: 10000, y: 0, width: 500, height: 500 }));
    expect(buildFloorAtomicBoundarySegments(state).find((segment) => segment.slabIds.includes("a") && segment.slabIds.includes("b"))?.support).toBe("continuous");
  });

  it("洞口边默认opening-cut，可通过稳定opening edge规则改为inner-wall", () => {
    const state = plan([slab({ id: "s", x: 0, y: 0, width: 5000, height: 5000 })], [opening({ id: "o", x: 1000, y: 1000, width: 1000, height: 1000 })]);
    expect(buildFloorAtomicBoundarySegments(state).filter((segment) => segment.geometryKind === "opening-edge").every((segment) => segment.support === "opening-cut")).toBe(true);
    state.supportRules = [{ id: "r", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "inner-wall" }];
    expect(buildFloorAtomicBoundarySegments(state).find((segment) => segment.openingId === "o" && segment.targets.some((target) => target.kind === "opening-edge" && target.side === "west")))?.toMatchObject({ geometryKind: "opening-edge", support: "inner-wall", thicknessMm: 240 });
  });

  it("不存在对象的规则返回error而不抛异常", () => {
    const state = plan([slab({ id: "s", x: 0, y: 0, width: 1000, height: 1000 })]);
    state.supportRules = [{ id: "bad", target: { kind: "slab-edge", slabId: "missing", side: "east", range: { mode: "whole" } }, support: "continuous" }];
    expect(validateFloorPlanV2(state).map((issue) => issue.code)).toContain("support-target-missing");
    expect(() => buildFloorAtomicBoundarySegments(state)).not.toThrow();
  });
});

describe("复杂板区拓扑", () => {
  it("可表达房间、内走廊、客厅和楼梯洞口验收组合", () => {
    const state = plan([
      slab({ id: "hall", name: "客厅", type: "hall", x: 0, y: 0, width: 8000, height: 4000 }),
      slab({ id: "corridor", name: "内走廊", type: "corridor", x: 0, y: 4000, width: 8000, height: 1800 }),
      slab({ id: "room-a", name: "房间A", x: 0, y: 5800, width: 4200, height: 3600 }),
      slab({ id: "room-b", name: "房间B", x: 4200, y: 5800, width: 3800, height: 3600 }),
    ], [opening({ id: "stair", name: "楼梯间", type: "stair", x: 5800, y: 800, width: 1800, height: 2400 })]);
    const atomic = buildFloorAtomicBoundarySegments(state);
    expect(state.slabs.map((item) => item.type)).toEqual(["hall", "corridor", "room", "room"]);
    expect(atomic.some((segment) => segment.geometryKind === "building-exterior")).toBe(true);
    expect(atomic.some((segment) => segment.geometryKind === "shared-slab")).toBe(true);
    expect(atomic.some((segment) => segment.geometryKind === "opening-edge" && segment.openingId === "stair")).toBe(true);
    expect(validateFloorPlanV2(state).filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("T型板区把局部共享边和暴露外边分开", () => {
    const state = plan([
      slab({ id: "a", x: 0, y: 0, width: 6000, height: 3000 }),
      slab({ id: "b", x: 2000, y: 3000, width: 2000, height: 2000 }),
    ]);
    const atomic = buildFloorAtomicBoundarySegments(state);
    expect(atomic.filter((segment) => segment.geometryKind === "shared-slab").reduce((sum, segment) => sum + Math.abs(segment.endX - segment.startX), 0)).toBe(2000);
    expect(atomic.some((segment) => segment.geometryKind === "building-exterior" && segment.startY === 3000 && segment.slabIds.includes("a"))).toBe(true);
  });

  it("L型与田字型的共享关系、外边和Atomic段无重复", () => {
    const l = plan([
      slab({ id: "a", x: 0, y: 0, width: 4000, height: 2000 }),
      slab({ id: "b", x: 0, y: 2000, width: 2000, height: 2000 }),
    ]);
    expect(buildFloorSlabAdjacency(l)).toHaveLength(1);
    const grid = plan([
      slab({ id: "a", x: 0, y: 2000, width: 2000, height: 2000 }), slab({ id: "b", x: 2000, y: 2000, width: 2000, height: 2000 }),
      slab({ id: "c", x: 0, y: 0, width: 2000, height: 2000 }), slab({ id: "d", x: 2000, y: 0, width: 2000, height: 2000 }),
    ]);
    expect(buildFloorSlabAdjacency(grid)).toHaveLength(4);
    const ids = buildFloorAtomicBoundarySegments(grid).map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("corridor是有效楼板，角点接触不相邻也不属于同一组件", () => {
    const state = plan([
      slab({ id: "corridor", type: "corridor", x: 0, y: 0, width: 4000, height: 1000 }),
      slab({ id: "corner", x: 4000, y: 1000, width: 1000, height: 1000 }),
    ]);
    expect(buildFloorSlabAdjacency(state)).toEqual([]);
    expect(findFloorComponents(state)).toHaveLength(2);
    expect(buildFloorTopologyCells(state).some((cell) => cell.effectiveSlabId === "corridor")).toBe(true);
  });

  it("Atomic保留两板来源段，Display可合并连续同视觉外边", () => {
    const state = plan([slab({ id: "a", x: 0, y: 0, width: 4000, height: 3000 }), slab({ id: "b", x: 4000, y: 0, width: 4000, height: 3000 })]);
    const atomicSouth = buildFloorAtomicBoundarySegments(state).filter((segment) => segment.geometryKind === "building-exterior" && segment.startY === 0 && segment.endY === 0);
    const displaySouth = buildFloorDisplayBoundarySegments(state).filter((segment) => segment.geometryKind === "building-exterior" && segment.startY === 0 && segment.endY === 0);
    expect(atomicSouth).toHaveLength(2);
    expect(displaySouth).toHaveLength(1);
    expect(displaySouth[0]).toMatchObject({ startX: 0, endX: 8000 });
    expect(displaySouth[0].atomicIds).toHaveLength(2);
    expect(buildFloorBoundarySegments(state)).toEqual(buildFloorDisplayBoundarySegments(state));
  });
});

describe("编辑、校验与名称", () => {
  it("板区只接触不重叠，真实交叉报错；Slab和Opening重叠合法", () => {
    const a = slab({ id: "a", x: 0, y: 0, width: 3000, height: 3000 });
    const touching = slab({ id: "b", x: 3000, y: 0, width: 3000, height: 3000 });
    expect(floorSlabsOverlap(a, touching)).toBe(false);
    expect(validateFloorPlanV2(plan([a, touching], [opening({ id: "o", x: 100, y: 100, width: 500, height: 500 })])).filter((issue) => issue.level === "error")).toEqual([]);
    expect(validateFloorPlanV2(plan([a, { ...touching, x: 2900 }])).map((issue) => issue.code)).toContain("slab-overlap");
  });

  it("板区和洞口吸附到相邻边与原点", () => {
    const fixed = slab({ id: "a", x: 0, y: 0, width: 4200, height: 3600 });
    const moving = slab({ id: "b", x: 4260, y: 40, width: 3600, height: 3600 });
    expect(snapFloorSlab(moving, [fixed], 150)).toMatchObject({ x: 4200, y: 0 });
    const movingOpening = opening({ id: "o", x: 90, y: 80, width: 1000, height: 1000 });
    expect(snapFloorOpening(movingOpening, [fixed], [], 150)).toMatchObject({ x: 0, y: 0 });
  });

  it("默认名称使用第一个空缺，不因删除中间项而重复", () => {
    expect(nextAvailableFloorName(["板区A", "板区C"], "板区")).toBe("板区B");
    expect(nextAvailableFloorName(["洞口A", "洞口B"], "洞口")).toBe("洞口C");
  });

  it("跨Slab与Opening的ID必须全局唯一", () => {
    const state = plan([slab({ id: "same", x: 0, y: 0, width: 3000, height: 3000 })], [opening({ id: "same", x: 100, y: 100, width: 500, height: 500 })]);
    expect(validateFloorPlanV2(state).map((issue) => issue.code)).toContain("object-id-duplicate");
  });
});
