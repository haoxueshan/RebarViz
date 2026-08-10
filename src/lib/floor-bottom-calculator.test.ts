import { describe, expect, it } from "vitest";
import {
  buildFloorBottomBomGroups,
  buildFloorBottomRebarDomains,
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
  mergeFloorLineIntervalsBySupport,
  pointBelongsToAtomicSegment,
  resolveFloorEndpointBoundary,
  type FloorBottomState,
} from "./floor-bottom-calculator";
import {
  buildFloorAtomicBoundarySegments,
  validateFloorPlanV2,
  type FloorOpening,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
  type FloorSlab,
  type FloorSupportRule,
} from "./floor-plan";
import type { FloorBarPiece } from "./floor-rebar-types";
import { countBars, theoreticalUnitWeight, type CountMode } from "./slab-calculator";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
}

function opening(id: string, x: number, y: number, width: number, height: number): FloorOpening {
  return { id, name: "楼梯间", type: "stair", x, y, width, height };
}

function plan(slabs: FloorSlab[], openings: FloorOpening[] = [], supportRules: FloorSupportRule[] = []): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings,
    supportRules,
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
  };
}

function bottom(patch: Partial<FloorBottomState> = {}): FloorBottomState {
  return { ...structuredClone(DEFAULT_FLOOR_BOTTOM_STATE), ...patch };
}

function continuousRule(slabId: string, side: "west" | "east" | "south" | "north", id = "continuous"): FloorSupportRule {
  return { id, target: { kind: "slab-edge", slabId, side, range: { mode: "whole" } }, support: "continuous" };
}

describe("Floor Bottom单板与根数算法", () => {
  it("4200×3600单矩形生成准确的X/Y根数、长度和重量", () => {
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 4200, 3600)]), bottom());
    expect(calculation.isValid).toBe(true);
    expect(calculation.domains).toHaveLength(1);
    const x = calculation.groups.find((group) => group.direction === "x");
    const y = calculation.groups.find((group) => group.direction === "y");
    expect(x).toMatchObject({ count: 24, role: "secondary", diameter: 10, spacing: 150, singleLengthMm: 4940 });
    expect(y).toMatchObject({ count: 21, role: "main", diameter: 12, spacing: 200, singleLengthMm: 4340 });
    expect(calculation.totalBarLines).toBe(45);
    expect(calculation.totalPieces).toBe(45);
    expect(calculation.lines.every((line) => line.layer === "bottom")).toBe(true);
    expect(calculation.pieces.every((piece) =>
      piece.layer === "bottom" &&
      !piece.startExtraApplied &&
      !piece.endExtraApplied &&
      piece.topExtraValueMm === 0)).toBe(true);
    const pieceWeight = calculation.pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000 * theoreticalUnitWeight(piece.diameter), 0);
    expect(calculation.totalWeightKg).toBeCloseTo(pieceWeight, 10);
    expect(calculation.groups.reduce((sum, group) => sum + group.weightKg, 0)).toBeCloseTo(pieceWeight, 10);
  });

  it.each(["project", "round", "floor"] as const)("%s根数与快速计算器countBars完全一致", (countMode: CountMode) => {
    const state = bottom({ countMode, defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 220, ySpacing: 260 } });
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 3350, 3300)]), state);
    expect(calculation.lines.filter((line) => line.direction === "x")).toHaveLength(countBars(3300, 220, countMode));
    expect(calculation.lines.filter((line) => line.direction === "y")).toHaveLength(countBars(3350, 260, countMode));
  });

  it("非法直径或间距不会回退默认值生成正式料单", () => {
    const state = bottom();
    state.defaults.xSpacing = Number.NaN;
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 4200, 3600)]), state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.errors.map((issue) => issue.code)).toContain("bottom-spacing-invalid");
    expect(calculation.groups).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });
});

describe("Floor Bottom主副筋角色", () => {
  it("按Domain短跨映射主筋直径，旋转后的独立板区分别判断", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 6000),
      slab("b", 5000, 0, 6000, 4000),
    ]);
    const calculation = calculateFloorBottomRebar(state, bottom());
    const domainA = calculation.domains.find((domain) => domain.slabIds.includes("a"))!;
    const domainB = calculation.domains.find((domain) => domain.slabIds.includes("b"))!;
    const group = (domainId: string, direction: "x" | "y") => calculation.groups.find((item) => item.domainId === domainId && item.direction === direction);
    expect(group(domainA.id, "x")).toMatchObject({ role: "main", diameter: 12 });
    expect(group(domainA.id, "y")).toMatchObject({ role: "secondary", diameter: 10 });
    expect(group(domainB.id, "x")).toMatchObject({ role: "secondary", diameter: 10 });
    expect(group(domainB.id, "y")).toMatchObject({ role: "main", diameter: 12 });
  });

  it("continuous合并后统一按Domain跨度判断，Opening裁断不改变Piece角色", () => {
    const continuous = plan(
      [slab("a", 0, 0, 3000, 4000), slab("b", 3000, 0, 3000, 4000)],
      [],
      [continuousRule("a", "east")],
    );
    const merged = calculateFloorBottomRebar(continuous, bottom());
    expect(merged.domains).toHaveLength(1);
    expect(merged.lines.filter((line) => line.direction === "x").every((line) => line.role === "secondary")).toBe(true);
    expect(merged.lines.filter((line) => line.direction === "y").every((line) => line.role === "main")).toBe(true);

    const clipped = calculateFloorBottomRebar(
      plan([slab("a", 0, 0, 6000, 4000)], [opening("o", 2000, 1000, 2000, 2000)]),
      bottom(),
    );
    expect(clipped.pieces.filter((piece) => piece.direction === "x").every((piece) => piece.role === "secondary")).toBe(true);
    expect(clipped.pieces.filter((piece) => piece.direction === "y").every((piece) => piece.role === "main")).toBe(true);
  });

  it("正方形Domain确定为X主筋、Y副筋并给出提示", () => {
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 4000, 4000)]), bottom());
    expect(calculation.lines.filter((line) => line.direction === "x").every((line) => line.role === "main")).toBe(true);
    expect(calculation.lines.filter((line) => line.direction === "y").every((line) => line.role === "secondary")).toBe(true);
    expect(calculation.warnings.map((issue) => issue.code)).toContain("square-domain-main-direction-defaulted");
  });
});

describe("Bottom Domain与continuous", () => {
  it("默认内墙把相邻板区分成两个Domain并在各侧增加240mm", () => {
    const state = plan([slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)]);
    const calculation = calculateFloorBottomRebar(state, bottom());
    expect(calculation.domains).toHaveLength(2);
    const touching = calculation.pieces.filter((piece) =>
      piece.direction === "x" && (piece.runStartMm === 4200 || piece.runEndMm === 4200),
    );
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.every((piece) => piece.startSupport === "inner-wall" || piece.endSupport === "inner-wall")).toBe(true);
    expect(touching.every((piece) => piece.startAnchorMm === 240 || piece.endAnchorMm === 240)).toBe(true);
  });

  it("continuous把两板合成一个Domain，X筋连续8540mm且中间不增加240", () => {
    const state = plan(
      [slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)],
      [],
      [continuousRule("a", "east")],
    );
    const calculation = calculateFloorBottomRebar(state, bottom());
    expect(calculation.isValid).toBe(true);
    expect(calculation.domains).toHaveLength(1);
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(xPieces).toHaveLength(24);
    expect(new Set(xPieces.map((piece) => piece.singleLengthMm))).toEqual(new Set([8540]));
    expect(xPieces.every((piece) => piece.runStartMm === 0 && piece.runEndMm === 7800)).toBe(true);
  });

  it("continuous Domain规格冲突时不选择任一板区并阻止正式结果", () => {
    const state = plan(
      [slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)],
      [],
      [continuousRule("a", "east")],
    );
    const settings = bottom();
    settings.slabOverrides.b = { secondaryDiameter: 14 };
    const calculation = calculateFloorBottomRebar(state, settings);
    expect(calculation.isValid).toBe(false);
    expect(calculation.errors.map((issue) => issue.code)).toContain("bottom-continuous-settings-conflict");
    expect(calculation.lines).toEqual([]);
    expect(calculation.pieces).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("L/T型continuous区域不在人工分界断筋或增加内墙厚度", () => {
    const lPlan = plan(
      [slab("a", 0, 0, 6000, 3000), slab("b", 0, 3000, 3000, 3000)],
      [],
      [continuousRule("a", "north")],
    );
    const domains = buildFloorBottomRebarDomains(lPlan);
    expect(domains).toHaveLength(1);
    const calculation = calculateFloorBottomRebar(lPlan, bottom());
    expect(calculation.isValid).toBe(true);
    expect(calculation.pieces.every((piece) => piece.startSupport !== "continuous" && piece.endSupport !== "continuous")).toBe(true);
    expect(calculation.pieces.every((piece) => Number.isFinite(piece.singleLengthMm) && piece.singleLengthMm > 0)).toBe(true);

    const tPlan = plan(
      [slab("base", 0, 0, 6000, 3000), slab("stem", 2000, 3000, 2000, 3000)],
      [],
      [continuousRule("base", "north")],
    );
    const tCalculation = calculateFloorBottomRebar(tPlan, bottom());
    expect(tCalculation.domains).toHaveLength(1);
    expect(tCalculation.isValid).toBe(true);
    expect(tCalculation.pieces.every((piece) => piece.startSupport !== "continuous" && piece.endSupport !== "continuous")).toBe(true);
  });

  it.each([
    { name: "下段continuous、上段inner-wall", range: { startMm: 0, endMm: 2000 }, fullPositions: [500, 1500] },
    { name: "下段inner-wall、上段continuous", range: { startMm: 2000, endMm: 4000 }, fullPositions: [2500, 3500] },
  ])("局部支承按每根BarLine实际穿越位置合并：$name", ({ range, fullPositions }) => {
    const state = plan(
      [slab("a", 0, 0, 4000, 4000), slab("b", 4000, 0, 4000, 4000)],
      [],
      [{
        id: "partial-continuous",
        target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "offset", ...range } },
        support: "continuous",
      }],
    );
    const settings = bottom({ defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000 } });
    const calculation = calculateFloorBottomRebar(state, settings);
    const xLines = calculation.lines.filter((line) => line.direction === "x");
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(calculation.isValid).toBe(true);
    expect(calculation.domains).toHaveLength(1);
    expect(xLines).toHaveLength(4);
    expect(xPieces).toHaveLength(6);
    const lineById = new Map(xLines.map((line) => [line.id, line]));
    const full = xPieces.filter((piece) => piece.singleLengthMm === 8740);
    const split = xPieces.filter((piece) => piece.singleLengthMm === 4610);
    expect(full).toHaveLength(2);
    expect(split).toHaveLength(4);
    expect(full.map((piece) => lineById.get(piece.lineId)?.positionMm).sort((a, b) => Number(a) - Number(b))).toEqual(fullPositions);
    expect(split.every((piece) => piece.startSupport === "inner-wall" || piece.endSupport === "inner-wall")).toBe(true);
    expect(xPieces.filter((piece) => !fullPositions.includes(lineById.get(piece.lineId)?.positionMm ?? -1)).every((piece) => piece.singleLengthMm !== 8740)).toBe(true);
  });

  it("局部分段交点使用[lower, upper)归属，Y=2000属于上段inner-wall", () => {
    const state = plan(
      [slab("a", 0, 0, 4000, 4000), slab("b", 4000, 0, 4000, 4000)],
      [],
      [{ id: "lower-continuous", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" }],
    );
    const settings = bottom({ defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 4000, ySpacing: 1000 } });
    const calculation = calculateFloorBottomRebar(state, settings);
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(calculation.lines.find((line) => line.direction === "x")?.positionMm).toBe(2000);
    expect(xPieces).toHaveLength(2);
    expect(xPieces.every((piece) => piece.singleLengthMm === 4610)).toBe(true);
  });
});

describe("Opening裁断与实物Piece", () => {
  const basePlan = () => plan(
    [slab("a", 0, 0, 6000, 6000)],
    [opening("o", 2000, 2000, 2000, 2000)],
  );
  const settings = () => bottom({
    defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000 },
  });

  it("内部洞口使6条X理论线生成8个X实物Piece并保留真实下料长度", () => {
    const calculation = calculateFloorBottomRebar(basePlan(), settings());
    const xLines = calculation.lines.filter((line) => line.direction === "x");
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(xLines).toHaveLength(6);
    expect(xPieces).toHaveLength(8);
    expect(xPieces.length).toBeGreaterThan(xLines.length);
    expect(xPieces.filter((piece) => piece.singleLengthMm === 6740)).toHaveLength(4);
    expect(xPieces.filter((piece) => piece.singleLengthMm === 2370)).toHaveLength(4);
    expect(xPieces.filter((piece) => piece.singleLengthMm === 2370).every((piece) =>
      piece.startSupport === "opening-cut" || piece.endSupport === "opening-cut",
    )).toBe(true);
  });

  it("理论线恰好落在topology分界时按确定性半开区间归属，不丢失整条线", () => {
    const state = basePlan();
    state.openings[0] = { ...state.openings[0], y: 3000, height: 1000 };
    const custom = settings();
    custom.defaults.xSpacing = 2000;
    const calculation = calculateFloorBottomRebar(state, custom);
    const xLines = calculation.lines.filter((line) => line.direction === "x");
    const pieceLineIds = new Set(calculation.pieces.filter((piece) => piece.direction === "x").map((piece) => piece.lineId));
    expect(xLines).toHaveLength(3);
    expect(xLines.every((line) => pieceLineIds.has(line.id))).toBe(true);
  });

  it("洞口西边改内墙后，对应裁断Piece增加240而不是0", () => {
    const state = basePlan();
    state.supportRules = [{
      id: "opening-west-inner",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "inner-wall",
    }];
    const calculation = calculateFloorBottomRebar(state, settings());
    const leftPieces = calculation.pieces.filter((piece) => piece.direction === "x" && piece.runEndMm === 2000);
    expect(leftPieces).toHaveLength(2);
    expect(leftPieces.every((piece) => piece.singleLengthMm === 2610 && piece.endAnchorMm === 240)).toBe(true);
  });

  it("贯穿洞口把同一slab拆成两个Domain，完全覆盖slab不产生钢筋", () => {
    const split = plan([slab("a", 0, 0, 6000, 6000)], [opening("o", 2500, 0, 1000, 6000)]);
    expect(buildFloorBottomRebarDomains(split)).toHaveLength(2);
    const covered = plan([slab("a", 0, 0, 6000, 6000)], [opening("o", 0, 0, 6000, 6000)]);
    expect(validateFloorPlanV2(covered).map((issue) => issue.code)).toContain("slab-fully-covered");
    const calculation = calculateFloorBottomRebar(covered, bottom());
    expect(calculation).toMatchObject({ isValid: true, totalBarLines: 0, totalPieces: 0, totalLengthM: 0, totalWeightKg: 0 });
    expect(calculation.domains).toEqual([]);
  });
});

describe("Geometry V2.1支承硬化", () => {
  it("共享边冲突与规则数组顺序无关，安全解析为inner-wall并阻止Bottom", () => {
    const rules: FloorSupportRule[] = [
      continuousRule("a", "east", "a-continuous"),
      { id: "b-inner", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "inner-wall" },
    ];
    const first = plan([slab("a", 0, 0, 3000, 3000), slab("b", 3000, 0, 3000, 3000)], [], rules);
    const reversed = { ...first, supportRules: [...rules].reverse() };
    for (const state of [first, reversed]) {
      expect(validateFloorPlanV2(state).map((issue) => issue.code)).toContain("support-rule-conflict");
      expect(buildFloorAtomicBoundarySegments(state).find((segment) => segment.geometryKind === "shared-slab")?.support).toBe("inner-wall");
      expect(calculateFloorBottomRebar(state, bottom())).toMatchObject({ isValid: false, totalWeightKg: null });
    }
  });

  it("板区移动后仍存在但不再作用的旧规则产生no-effect warning", () => {
    const state = plan(
      [slab("a", 0, 0, 3000, 3000), slab("b", 5000, 0, 3000, 3000)],
      [],
      [continuousRule("a", "east", "stale")],
    );
    expect(validateFloorPlanV2(state).map((issue) => issue.code)).toContain("support-rule-no-effect");
  });
});

describe("Atomic端点归属与BOM稳定分组", () => {
  it("跨板接口只匹配实际两侧板区，找不到合法共享边时安全拆分并报错", () => {
    const unrelated: FloorAtomicBoundarySegment = {
      id: "unrelated-continuous",
      orientation: "vertical",
      startX: 4000,
      startY: 0,
      endX: 4000,
      endY: 4000,
      geometryKind: "shared-slab",
      support: "continuous",
      thicknessMm: 0,
      slabIds: ["c", "d"],
      targets: [],
    };
    const result = mergeFloorLineIntervalsBySupport(
      "x",
      1000,
      [
        { start: 0, end: 4000, slabIds: new Set(["a"]) },
        { start: 4000, end: 8000, slabIds: new Set(["b"]) },
      ],
      [unrelated],
    );

    expect(result.intervals).toHaveLength(2);
    expect(result.errors.map((issue) => issue.code)).toContain(
      "bottom-line-crossing-boundary-missing",
    );
  });

  it("相邻Atomic采用半开区间，交点归后段且最大终点仍归最后一段", () => {
    const state = plan(
      [slab("a", 0, 0, 4000, 4000), slab("b", 4000, 0, 4000, 4000)],
      [],
      [{ id: "lower-continuous", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" }],
    );
    const atomic = buildFloorAtomicBoundarySegments(state).filter((segment) => segment.geometryKind === "shared-slab");
    const lower = atomic.find((segment) => segment.startY === 0)!;
    const upper = atomic.find((segment) => segment.startY === 2000)!;
    expect(pointBelongsToAtomicSegment(lower, "x", 4000, 2000, atomic)).toBe(false);
    expect(pointBelongsToAtomicSegment(upper, "x", 4000, 2000, atomic)).toBe(true);
    expect(pointBelongsToAtomicSegment(upper, "x", 4000, 4000, atomic)).toBe(true);
  });

  it("端点同时命中不同support时返回ambiguous而不是按ID选择", () => {
    const base: FloorAtomicBoundarySegment = {
      id: "outer",
      orientation: "vertical",
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 4000,
      geometryKind: "building-exterior",
      support: "outer-wall",
      thicknessMm: 370,
      slabIds: ["a"],
      targets: [],
    };
    const result = resolveFloorEndpointBoundary(
      [base, { ...base, id: "inner", geometryKind: "shared-slab", support: "inner-wall", thicknessMm: 240 }],
      "x",
      0,
      1000,
      new Set(["a"]),
    );
    expect(result).toMatchObject({ errorCode: "bottom-endpoint-boundary-ambiguous" });
  });

  it("1e-6mm容差内的浮点长度使用同一BOM key且保留Piece真实长度", () => {
    const piece = (id: string, singleLengthMm: number): FloorBarPiece => ({
      id,
      lineId: `line-${id}`,
      domainId: "domain-a",
      slabIds: ["a"],
      layer: "bottom",
      direction: "x",
      role: "secondary",
      diameter: 12,
      spacing: 150,
      runStartMm: 0,
      runEndMm: 4200,
      netLengthMm: 4200,
      startBoundaryId: "west",
      endBoundaryId: "east",
      startSupport: "outer-wall",
      endSupport: "outer-wall",
      startAnchorMm: 370,
      endAnchorMm: 370,
      startExtraApplied: false,
      endExtraApplied: false,
      topExtraValueMm: 0,
      singleLengthMm,
      source: "normal",
    });
    const pieces = [piece("a", 4940.1), piece("b", 4940.100000000001)];
    const groups = buildFloorBottomBomGroups(pieces);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, singleLengthMm: 4940.1, pieceIds: ["a", "b"] });
    expect(pieces[1].singleLengthMm).toBe(4940.100000000001);
  });
});
