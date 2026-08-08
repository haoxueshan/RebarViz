import { describe, expect, it } from "vitest";
import {
  buildFloorBottomRebarDomains,
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
  type FloorBottomState,
} from "./floor-bottom-calculator";
import {
  buildFloorAtomicBoundarySegments,
  validateFloorPlanV2,
  type FloorOpening,
  type FloorPlanState,
  type FloorSlab,
  type FloorSupportRule,
} from "./floor-plan";
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
    expect(x).toMatchObject({ count: 24, diameter: 12, spacing: 150, singleLengthMm: 4940 });
    expect(y).toMatchObject({ count: 21, diameter: 10, spacing: 200, singleLengthMm: 4340 });
    expect(calculation.totalBarLines).toBe(45);
    expect(calculation.totalPieces).toBe(45);
    const pieceWeight = calculation.pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000 * theoreticalUnitWeight(piece.diameter), 0);
    expect(calculation.totalWeightKg).toBeCloseTo(pieceWeight, 10);
    expect(calculation.groups.reduce((sum, group) => sum + group.weightKg, 0)).toBeCloseTo(pieceWeight, 10);
  });

  it.each(["project", "round", "floor"] as const)("%s根数与快速计算器countBars完全一致", (countMode: CountMode) => {
    const state = bottom({ countMode, defaults: { x: { diameter: 12, spacing: 220 }, y: { diameter: 10, spacing: 260 } } });
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 3350, 3300)]), state);
    expect(calculation.lines.filter((line) => line.direction === "x")).toHaveLength(countBars(3300, 220, countMode));
    expect(calculation.lines.filter((line) => line.direction === "y")).toHaveLength(countBars(3350, 260, countMode));
  });

  it("非法直径或间距不会回退默认值生成正式料单", () => {
    const state = bottom();
    state.defaults.x.spacing = Number.NaN;
    const calculation = calculateFloorBottomRebar(plan([slab("a", 0, 0, 4200, 3600)]), state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.errors.map((issue) => issue.code)).toContain("bottom-spacing-invalid");
    expect(calculation.groups).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
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
    settings.slabOverrides.b = { x: { diameter: 10, spacing: 200 } };
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
});

describe("Opening裁断与实物Piece", () => {
  const basePlan = () => plan(
    [slab("a", 0, 0, 6000, 6000)],
    [opening("o", 2000, 2000, 2000, 2000)],
  );
  const settings = () => bottom({
    defaults: { x: { diameter: 12, spacing: 1000 }, y: { diameter: 10, spacing: 1000 } },
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
    custom.defaults.x.spacing = 2000;
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
