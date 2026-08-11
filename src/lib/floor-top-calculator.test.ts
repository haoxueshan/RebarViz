import { describe, expect, it } from "vitest";
import type { FloorOpening, FloorPlanState, FloorSlab, FloorSupportRule } from "./floor-plan";
import type { FloorBarPiece } from "./floor-rebar-types";
import {
  floorRoleDomainKey,
  type FloorRebarRoleState,
} from "./floor-rebar-role";
import {
  buildFloorTopBomGroups,
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
  resolveFloorTopEndpointAnchor,
  type FloorTopBarSettings,
  type FloorTopState,
} from "./floor-top-calculator";
import { countBars, theoreticalUnitWeight, type CountMode, type TopExtraMode } from "./slab-calculator";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
}

function opening(id: string, x: number, y: number, width: number, height: number): FloorOpening {
  return { id, name: "楼梯间", type: "stair", x, y, width, height };
}

function plan(
  slabs: FloorSlab[],
  openings: FloorOpening[] = [],
  supportRules: FloorSupportRule[] = [],
): FloorPlanState {
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

function top(patch: Partial<FloorTopState> = {}): FloorTopState {
  return { ...structuredClone(DEFAULT_FLOOR_TOP_STATE), ...patch };
}

function roleState(
  entries: Array<[string[], "x" | "y"]> = [],
): FloorRebarRoleState {
  return {
    mainDirectionOverrides: Object.fromEntries(entries.map(([slabIds, direction]) => [
      floorRoleDomainKey(slabIds),
      direction,
    ])),
  };
}

function continuousRule(slabId: string, side: "west" | "east" | "south" | "north"): FloorSupportRule {
  return {
    id: `${slabId}-${side}-continuous`,
    target: { kind: "slab-edge", slabId, side, range: { mode: "whole" } },
    support: "continuous",
  };
}

function piecesFor(
  state: ReturnType<typeof calculateFloorTopRebar>,
  slabId: string,
  direction: "x" | "y",
): FloorBarPiece[] {
  return state.pieces.filter((piece) =>
    piece.direction === direction && piece.slabIds.includes(slabId));
}

describe("Floor Top端部增加规则", () => {
  it.each(["start", "end", "both"] as const)("单矩形外墙在%s模式下均不增加", (extraMode) => {
    const settings = top();
    settings.defaults.xExtraMode = extraMode;
    const calculation = calculateFloorTopRebar(
      plan([slab("a", 0, 0, 4200, 3600)]),
      settings,
    );
    const xPieces = piecesFor(calculation, "a", "x");
    expect(calculation.isValid).toBe(true);
    expect(xPieces).toHaveLength(18);
    expect(calculation.lines.every((line) => line.layer === "top")).toBe(true);
    expect(calculation.pieces.every((piece) =>
      piece.layer === "top" && piece.topExtraValueMm === 250)).toBe(true);
    expect(xPieces.every((piece) =>
      piece.singleLengthMm === 4940 &&
      !piece.startExtraApplied &&
      !piece.endExtraApplied)).toBe(true);
  });

  it("X向start固定为西、end固定为东，只有被启用的内墙端增加", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 4200, 0, 3600, 3600),
    ]);
    const startSettings = top();
    startSettings.defaults.xExtraMode = "start";
    const startPiece = piecesFor(
      calculateFloorTopRebar(state, startSettings, roleState([[["b"], "x"]])),
      "a",
      "x",
    )[0];
    expect(startPiece).toMatchObject({
      startSupport: "outer-wall",
      endSupport: "inner-wall",
      startAnchorMm: 370,
      endAnchorMm: 240,
      startExtraApplied: false,
      endExtraApplied: false,
      singleLengthMm: 4810,
    });

    const endSettings = top();
    endSettings.defaults.xExtraMode = "end";
    const endPiece = piecesFor(
      calculateFloorTopRebar(state, endSettings, roleState([[["b"], "x"]])),
      "a",
      "x",
    )[0];
    expect(endPiece).toMatchObject({
      startAnchorMm: 370,
      endAnchorMm: 490,
      startExtraApplied: false,
      endExtraApplied: true,
      singleLengthMm: 5060,
    });
  });

  it.each([
    ["both", 4980, true, true],
    ["start", 4730, true, false],
    ["end", 4730, false, true],
  ] as const)("两端内墙的中间板在%s模式下长度正确", (extraMode, length, startExtra, endExtra) => {
    const state = plan([
      slab("a", 0, 0, 3000, 3600),
      slab("b", 3000, 0, 4000, 3600),
      slab("c", 7000, 0, 3000, 3600),
    ]);
    const settings = top();
    settings.defaults.xExtraMode = extraMode;
    const piece = piecesFor(calculateFloorTopRebar(state, settings), "b", "x")[0];
    expect(piece).toMatchObject({
      startSupport: "inner-wall",
      endSupport: "inner-wall",
      startExtraApplied: startExtra,
      endExtraApplied: endExtra,
      singleLengthMm: length,
    });
  });

  it("Y向start固定为南、end固定为北", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 4200),
      slab("b", 0, 4200, 3600, 3600),
    ]);
    const settings = top();
    settings.defaults.yExtraMode = "end";
    const piece = piecesFor(
      calculateFloorTopRebar(state, settings, roleState([[["b"], "x"]])),
      "a",
      "y",
    )[0];
    expect(piece).toMatchObject({
      startSupport: "outer-wall",
      endSupport: "inner-wall",
      startAnchorMm: 370,
      endAnchorMm: 490,
      startExtraApplied: false,
      endExtraApplied: true,
      singleLengthMm: 5060,
    });
  });

  it("outer-wall与opening-cut永远不增加，inner-wall才按端点增加", () => {
    expect(resolveFloorTopEndpointAnchor(
      { support: "outer-wall", thicknessMm: 370 },
      "start",
      "both",
      250,
    )).toEqual({ anchorMm: 370, extraApplied: false });
    expect(resolveFloorTopEndpointAnchor(
      { support: "opening-cut", thicknessMm: 0 },
      "end",
      "both",
      250,
    )).toEqual({ anchorMm: 0, extraApplied: false });
    expect(resolveFloorTopEndpointAnchor(
      { support: "inner-wall", thicknessMm: 240 },
      "end",
      "end",
      250,
    )).toEqual({ anchorMm: 490, extraApplied: true });
  });
});

describe("Floor Top主副筋角色", () => {
  it("X短与Y短Domain分别把主筋直径映射到对应方向", () => {
    const xShort = calculateFloorTopRebar(plan([slab("a", 0, 0, 4000, 6000)]), top());
    expect(xShort.groups.find((group) => group.direction === "x")).toMatchObject({ role: "main", diameter: 10 });
    expect(xShort.groups.find((group) => group.direction === "y")).toMatchObject({ role: "secondary", diameter: 10 });
    const settings = top();
    settings.defaults.mainDiameter = 12;
    settings.defaults.secondaryDiameter = 8;
    const yShort = calculateFloorTopRebar(plan([slab("a", 0, 0, 6000, 4000)]), settings);
    expect(yShort.groups.find((group) => group.direction === "x")).toMatchObject({ role: "secondary", diameter: 8 });
    expect(yShort.groups.find((group) => group.direction === "y")).toMatchObject({ role: "main", diameter: 12 });
  });

  it("贯穿Opening只拆Physical Domain，不改变Role Domain与角色", () => {
    const state = plan(
      [slab("a", 0, 0, 6000, 4000)],
      [opening("o", 2500, 0, 1000, 4000)],
    );
    const settings = top();
    settings.defaults.mainDiameter = 12;
    settings.defaults.secondaryDiameter = 8;
    const calculation = calculateFloorTopRebar(state, settings);
    expect(calculation.domains).toHaveLength(2);
    expect(calculation.roleDomains).toHaveLength(1);
    expect(calculation.roleDomains[0]).toMatchObject({
      minX: 0,
      maxX: 6000,
      minY: 0,
      maxY: 4000,
    });
    expect(calculation.pieces.filter((piece) => piece.direction === "x").every((piece) => piece.role === "secondary")).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.direction === "y").every((piece) => piece.role === "main")).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.direction === "x").every((piece) => piece.diameter === 8)).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.direction === "y").every((piece) => piece.diameter === 12)).toBe(true);
  });

  it("正方形Domain必须人工指定，且地筋面筋共用同一方向语义", () => {
    const state = plan([slab("a", 0, 0, 4000, 4000)]);
    const required = calculateFloorTopRebar(state, top());
    expect(required.isValid).toBe(false);
    expect(required.errors.map((issue) => issue.code)).toContain("rebar-main-direction-required");
    expect(required.lines).toHaveLength(0);

    const xMain = calculateFloorTopRebar(state, top(), roleState([[["a"], "x"]]));
    expect(xMain.lines.filter((line) => line.direction === "x").every((line) => line.role === "main")).toBe(true);
    expect(xMain.lines.filter((line) => line.direction === "y").every((line) => line.role === "secondary")).toBe(true);

    const yMain = calculateFloorTopRebar(state, top(), roleState([[["a"], "y"]]));
    expect(yMain.lines.filter((line) => line.direction === "y").every((line) => line.role === "main")).toBe(true);
    expect(yMain.lines.filter((line) => line.direction === "x").every((line) => line.role === "secondary")).toBe(true);
  });

  it("L型continuous参考域不按外包框猜测，人工方向统一作用于所有面筋线", () => {
    const state = plan(
      [slab("a", 0, 0, 6000, 3000), slab("b", 0, 3000, 3000, 3000)],
      [],
      [continuousRule("a", "north")],
    );
    const required = calculateFloorTopRebar(state, top());
    expect(required.errors.map((issue) => issue.code)).toContain("rebar-main-direction-required");
    expect(required.lines).toEqual([]);

    const manual = calculateFloorTopRebar(
      state,
      top(),
      roleState([[["a", "b"], "y"]]),
    );
    expect(manual.isValid).toBe(true);
    expect(manual.lines.filter((line) => line.direction === "y").every((line) => line.role === "main")).toBe(true);
    expect(manual.lines.filter((line) => line.direction === "x").every((line) => line.role === "secondary")).toBe(true);
  });
});

describe("Floor Top连续关系与洞口裁断", () => {
  it("非法support offset与完全覆盖板区均阻止正式面筋", () => {
    const invalidRange = plan([
      slab("a", 0, 0, 3000, 3000),
      slab("b", 3000, 0, 3000, 3000),
    ], [], [{
      id: "reverse-range",
      target: {
        kind: "slab-edge",
        slabId: "a",
        side: "east",
        range: { mode: "offset", startMm: 2500, endMm: 500 },
      },
      support: "continuous",
    }]);
    const invalidCalculation = calculateFloorTopRebar(invalidRange, top());
    expect(invalidCalculation.errors.map((issue) => issue.code)).toContain("support-range-invalid");
    expect(invalidCalculation).toMatchObject({ isValid: false, lines: [], pieces: [], groups: [], totalWeightKg: null });

    const covered = plan(
      [slab("a", 0, 0, 6000, 6000)],
      [opening("o", 0, 0, 6000, 6000)],
    );
    const coveredCalculation = calculateFloorTopRebar(covered, top());
    expect(coveredCalculation.errors.map((issue) => issue.code)).toContain("slab-fully-covered");
    expect(coveredCalculation).toMatchObject({ isValid: false, lines: [], pieces: [], groups: [], totalWeightKg: null });
  });

  it("continuous板区形成一套贯穿普通面筋且中间不增加墙厚或增加值", () => {
    const state = plan(
      [slab("a", 0, 0, 4200, 3600), slab("b", 4200, 0, 3600, 3600)],
      [],
      [continuousRule("a", "east")],
    );
    const calculation = calculateFloorTopRebar(state, top());
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(calculation.domains).toHaveLength(1);
    expect(xPieces).toHaveLength(18);
    expect(xPieces.every((piece) =>
      piece.singleLengthMm === 8540 &&
      !piece.startExtraApplied &&
      !piece.endExtraApplied)).toBe(true);
  });

  it("局部continuous贯穿、局部inner-wall裁断并仅在内墙端增加", () => {
    const state = plan(
      [slab("a", 0, 0, 4000, 4000), slab("b", 4000, 0, 4000, 4000)],
      [],
      [{
        id: "partial-continuous",
        target: {
          kind: "slab-edge",
          slabId: "a",
          side: "east",
          range: { mode: "offset", startMm: 0, endMm: 2000 },
        },
        support: "continuous",
      }],
    );
    const settings = top({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000, xExtraMode: "both", yExtraMode: "both" },
    });
    const calculation = calculateFloorTopRebar(state, settings, roleState([[["a"], "x"]]));
    const xLines = calculation.lines.filter((line) => line.direction === "x");
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(calculation.isValid).toBe(true);
    expect(calculation.domains).toHaveLength(1);
    expect(xLines).toHaveLength(4);
    expect(xPieces).toHaveLength(6);
    expect(xPieces.filter((piece) => piece.singleLengthMm === 8740)).toHaveLength(2);
    const split = xPieces.filter((piece) => piece.singleLengthMm === 4860);
    expect(split).toHaveLength(4);
    expect(split.every((piece) =>
      piece.startExtraApplied || piece.endExtraApplied)).toBe(true);
  });

  it("continuous Domain的规格或extraMode不同均阻止正式面筋", () => {
    const state = plan(
      [slab("a", 0, 0, 3000, 3000), slab("b", 3000, 0, 3000, 3000)],
      [],
      [continuousRule("a", "east")],
    );
    const specificationConflict = top();
    specificationConflict.slabOverrides.b = { secondaryDiameter: 12, xSpacing: 150 };
    expect(calculateFloorTopRebar(state, specificationConflict).errors.map((issue) => issue.code))
      .toContain("top-continuous-settings-conflict");

    const modeConflict = top();
    modeConflict.slabOverrides.b = { xExtraMode: "start" };
    expect(calculateFloorTopRebar(state, modeConflict).errors.map((issue) => issue.code))
      .toContain("top-continuous-settings-conflict");
  });

  it("Opening裁断使理论线产生多个Piece，opening-cut为0且不增加", () => {
    const state = plan(
      [slab("a", 0, 0, 6000, 6000)],
      [opening("o", 2000, 2000, 2000, 2000)],
    );
    const settings = top({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000, xExtraMode: "both", yExtraMode: "both" },
    });
    const calculation = calculateFloorTopRebar(state, settings, roleState([[["a"], "x"]]));
    const xLines = calculation.lines.filter((line) => line.direction === "x");
    const xPieces = calculation.pieces.filter((piece) => piece.direction === "x");
    expect(xLines).toHaveLength(6);
    expect(xPieces).toHaveLength(8);
    expect(xPieces.length).toBeGreaterThan(xLines.length);
    const cut = xPieces.filter((piece) => piece.singleLengthMm === 2370);
    expect(cut).toHaveLength(4);
    expect(cut.every((piece) =>
      !piece.startExtraApplied && !piece.endExtraApplied)).toBe(true);
  });

  it("Opening西边按内墙且位于Piece终点时按end增加", () => {
    const state = plan(
      [slab("a", 0, 0, 6000, 6000)],
      [opening("o", 2000, 2000, 2000, 2000)],
      [{
        id: "opening-west-inner",
        target: {
          kind: "opening-edge",
          openingId: "o",
          side: "west",
          range: { mode: "whole" },
        },
        support: "inner-wall",
      }],
    );
    const settings = top({
      defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 1000, ySpacing: 1000, xExtraMode: "end", yExtraMode: "end" },
    });
    const calculation = calculateFloorTopRebar(
      state,
      settings,
      roleState([[["a"], "x"]]),
    );
    const leftPieces = calculation.pieces.filter((piece) =>
      piece.direction === "x" && piece.runEndMm === 2000);
    expect(leftPieces).toHaveLength(2);
    expect(leftPieces.every((piece) =>
      piece.singleLengthMm === 2860 &&
      piece.endAnchorMm === 490 &&
      piece.endExtraApplied)).toBe(true);
  });
});

describe("Floor Top根数、BOM与重量", () => {
  it.each(["project", "round", "floor"] as const)("%s根数复用countBars", (countMode: CountMode) => {
    const settings = top({ countMode });
    settings.defaults.xSpacing = 220;
    settings.defaults.ySpacing = 260;
    const calculation = calculateFloorTopRebar(
      plan([slab("a", 0, 0, 3350, 3300)]),
      settings,
    );
    expect(calculation.lines.filter((line) => line.direction === "x"))
      .toHaveLength(countBars(3300, 220, countMode));
    expect(calculation.lines.filter((line) => line.direction === "y"))
      .toHaveLength(countBars(3350, 260, countMode));
  });

  it("Piece、Group和总重量使用同一理论单位重量且不重复", () => {
    const calculation = calculateFloorTopRebar(
      plan([slab("a", 0, 0, 4200, 3600)]),
      top(),
    );
    const pieceWeight = calculation.pieces.reduce(
      (sum, piece) => sum +
        (piece.singleLengthMm / 1000) * theoreticalUnitWeight(piece.diameter),
      0,
    );
    expect(calculation.totalWeightKg).toBeCloseTo(pieceWeight, 10);
    expect(calculation.groups.reduce((sum, group) => sum + group.weightKg, 0))
      .toBeCloseTo(pieceWeight, 10);
  });

  it("Top BOM复用稳定长度key且extraMode参与分组", () => {
    const piece = (id: string, length: number): FloorBarPiece => ({
      id,
      lineId: `line-${id}`,
      domainId: "domain-a",
      slabIds: ["a"],
      layer: "top",
      direction: "x",
      role: "secondary",
      diameter: 10,
      spacing: 200,
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
      topExtraValueMm: 250,
      intermediateWallMm: 0,
      intermediateBoundaryIds: [],
      singleLengthMm: length,
      source: "normal",
    });
    const settings: FloorTopBarSettings = {
      diameter: 10,
      spacing: 200,
      extraMode: "both",
    };
    const groups = buildFloorTopBomGroups(
      [piece("a", 4940.1), piece("b", 4940.100000000001)],
      new Map([["domain-a:x", settings]]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, extraMode: "both" });
  });

  it("非法数字、增加值和extraMode阻止正式结果，增加值0合法", () => {
    const state = plan([slab("a", 0, 0, 4200, 3600)]);
    const invalid = top();
    invalid.topAnchorExtra = -1;
    invalid.defaults.xSpacing = Number.NaN;
    invalid.defaults.yExtraMode = "bad" as TopExtraMode;
    const calculation = calculateFloorTopRebar(state, invalid);
    expect(calculation.isValid).toBe(false);
    expect(calculation.totalWeightKg).toBeNull();
    expect(calculation.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "top-anchor-extra-invalid",
      "top-spacing-invalid",
      "top-extra-mode-invalid",
    ]));
    const zero = top({ topAnchorExtra: 0 });
    expect(calculateFloorTopRebar(state, zero).isValid).toBe(true);
  });

  it("旧规格语义未确认时阻止正式面筋料单", () => {
    const calculation = calculateFloorTopRebar(
      plan([slab("a", 0, 0, 4200, 3600)]),
      top(),
      roleState(),
      true,
    );
    expect(calculation).toMatchObject({
      isValid: false,
      lines: [],
      pieces: [],
      groups: [],
      totalWeightKg: null,
    });
    expect(calculation.errors.map((issue) => issue.code)).toContain("top-role-review-required");
  });
});
