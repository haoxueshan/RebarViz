import { describe, expect, it } from "vitest";
import type {
  FloorOpening,
  FloorPlanState,
  FloorSlab,
  FloorSupportRule,
} from "./floor-plan";
import {
  calculateFloorTopNormalRebar,
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopState,
  type FloorTopThroughPath,
} from "./floor-top-calculator";
import { resolveFloorTopThroughPathGeometry } from "./floor-top-through";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
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

function path(patch: Partial<FloorTopThroughPath> = {}): FloorTopThroughPath {
  return {
    id: "path-01",
    name: "通墙01",
    direction: "x",
    slabIds: ["a", "b"],
    bandStartMm: 0,
    bandEndMm: 3600,
    enabled: true,
    ...patch,
  };
}

function continuousRule(
  slabId: string,
  side: "west" | "east" | "south" | "north",
): FloorSupportRule {
  return {
    id: `${slabId}-${side}-continuous`,
    target: { kind: "slab-edge", slabId, side, range: { mode: "whole" } },
    support: "continuous",
  };
}

function top(
  throughPaths: FloorTopThroughPath[],
  patch: Partial<FloorTopState> = {},
): FloorTopState {
  return {
    ...structuredClone(DEFAULT_FLOOR_TOP_STATE),
    ...patch,
    throughPaths,
  };
}

describe("Floor Top Through路径解析与替换", () => {
  it("无Through路径时普通Top结果完全保持，仅补充零计数元数据", () => {
    const state = plan([slab("a", 0, 0, 4200, 3600)]);
    const input = top([]);
    const normal = calculateFloorTopNormalRebar(state, input);
    const final = calculateFloorTopRebar(state, input);
    expect(final).toEqual(normal);
    expect(final).toMatchObject({ normalPieceCount: normal.pieces.length, throughPieceCount: 0 });
  });

  it("A-B-C按空间顺序解析，普通X Piece被Through替换且中间内墙只累计墙厚", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 3600),
      slab("b", 4000, 0, 4000, 3600),
      slab("c", 8000, 0, 4000, 3600),
    ]);
    const input = top([path({ slabIds: ["c", "a", "b"] })]);
    input.defaults.xSpacing = 900;
    const normal = calculateFloorTopNormalRebar(state, input);
    const calculation = calculateFloorTopRebar(state, input);
    expect(calculation.isValid).toBe(true);
    expect(calculation.resolvedThroughPaths[0]).toMatchObject({
      orderedSlabIds: ["a", "b", "c"],
      linePositionsMm: [450, 1350, 2250, 3150],
    });
    const through = calculation.pieces.filter((piece) => piece.source === "through");
    expect(through).toHaveLength(4);
    expect(through.every((piece) =>
      piece.singleLengthMm === 13220 &&
      piece.intermediateWallMm === 480 &&
      piece.intermediateBoundaryIds.length === 2)).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.source === "normal" && piece.direction === "x")).toHaveLength(0);
    expect(calculation.pieces.filter((piece) => piece.direction === "y")).toHaveLength(
      normal.pieces.filter((piece) => piece.direction === "y").length,
    );
    expect(calculation.totalPieces).toBe(normal.totalPieces - 12 + 4);
  });

  it("实际终点为内墙时只在终点按extraMode增加，中间墙不增加extra", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 3600),
      slab("b", 4000, 0, 4000, 3600),
      slab("c", 8000, 0, 4000, 3600),
    ]);
    const input = top([path({ slabIds: ["a", "b"] })]);
    input.defaults.xSpacing = 900;
    input.defaults.xExtraMode = "end";
    const calculation = calculateFloorTopRebar(state, input);
    expect(calculation.isValid).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.source === "through").every((piece) =>
      piece.singleLengthMm === 9100 &&
      piece.intermediateWallMm === 240 &&
      piece.startAnchorMm === 370 &&
      piece.endAnchorMm === 490 &&
      piece.endExtraApplied)).toBe(true);
  });

  it("Y Through按南到北排序并镜像替换普通Y Piece", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 4000),
      slab("b", 0, 4000, 3600, 4000),
    ]);
    const input = top([path({
      direction: "y",
      slabIds: ["b", "a"],
      bandStartMm: 0,
      bandEndMm: 3600,
    })]);
    input.defaults.ySpacing = 900;
    const normal = calculateFloorTopNormalRebar(state, input);
    const calculation = calculateFloorTopRebar(state, input);
    expect(calculation.isValid).toBe(true);
    expect(calculation.resolvedThroughPaths[0].orderedSlabIds).toEqual(["a", "b"]);
    expect(calculation.pieces.filter((piece) => piece.source === "through")).toHaveLength(4);
    expect(calculation.pieces.filter((piece) => piece.source === "through").every((piece) =>
      piece.direction === "y" && piece.singleLengthMm === 8980)).toBe(true);
    expect(calculation.pieces.filter((piece) => piece.source === "normal" && piece.direction === "y")).toHaveLength(0);
    expect(calculation.pieces.filter((piece) => piece.direction === "x")).toHaveLength(
      normal.pieces.filter((piece) => piece.direction === "x").length,
    );
  });

  it("局部inner-wall/continuous按每根线累计，生成同一路径多种真实长度", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 4000),
      slab("b", 4000, 0, 4000, 4000),
    ], [], [{
      id: "upper-continuous",
      target: {
        kind: "slab-edge",
        slabId: "a",
        side: "east",
        range: { mode: "offset", startMm: 2000, endMm: 4000 },
      },
      support: "continuous",
    }]);
    const input = top([path({ bandEndMm: 4000 })]);
    input.defaults.xSpacing = 1000;
    const calculation = calculateFloorTopRebar(state, input, {
      mainDirectionOverrides: { "role:a|b": "x" },
    });
    expect(calculation.isValid).toBe(true);
    const through = calculation.pieces.filter((piece) => piece.source === "through");
    expect(through.filter((piece) => piece.singleLengthMm === 8980)).toHaveLength(2);
    expect(through.filter((piece) => piece.singleLengthMm === 8740)).toHaveLength(2);
    expect(calculation.groups.filter((group) => group.source === "through")).toHaveLength(2);
  });

  it("最大Band使用真实共享边交集并支持窄走廊", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 4000),
      { ...slab("corridor", 4000, 1000, 2000, 2000), type: "corridor" },
      slab("b", 6000, 0, 4000, 4000),
    ]);
    const geometry = resolveFloorTopThroughPathGeometry(
      state,
      path({ slabIds: ["b", "corridor", "a"], bandStartMm: 1200, bandEndMm: 2800 }),
    );
    expect(geometry.errors).toEqual([]);
    expect(geometry.orderedSlabIds).toEqual(["a", "corridor", "b"]);
    expect(geometry).toMatchObject({ maxBandStartMm: 1000, maxBandEndMm: 3000 });
  });

  it("路径不能在continuous边人为结束，且非法链与越界Band分别报错", () => {
    const continuousState = plan([
      slab("a", 0, 0, 4000, 3600),
      slab("b", 4000, 0, 4000, 3600),
      slab("c", 8000, 0, 4000, 3600),
    ], [], [continuousRule("b", "east")]);
    const continuousEnd = calculateFloorTopRebar(
      continuousState,
      top([path({ slabIds: ["a", "b"] })]),
    );
    expect(continuousEnd.errors.map((item) => item.code)).toContain("through-path-continuous-endpoint");

    const gapState = plan([
      slab("a", 0, 0, 4000, 3600),
      slab("b", 4500, 0, 4000, 3600),
    ]);
    expect(calculateFloorTopRebar(gapState, top([path()])).errors.map((item) => item.code))
      .toContain("through-path-chain-invalid");

    const corridorState = plan([
      slab("a", 0, 0, 4000, 4000),
      { ...slab("corridor", 4000, 1000, 2000, 2000), type: "corridor" },
      slab("b", 6000, 0, 4000, 4000),
    ]);
    expect(calculateFloorTopRebar(corridorState, top([path({
      slabIds: ["a", "corridor", "b"],
      bandStartMm: 500,
      bandEndMm: 3500,
    })]), {
      mainDirectionOverrides: { "role:a": "x", "role:b": "x", "role:corridor": "x" },
    }).errors.map((item) => item.code)).toContain("through-path-band-outside");
  });

  it("Opening正面积阻断Path，缩小Band避开后恢复合法", () => {
    const state = plan(
      [slab("a", 0, 0, 4000, 3600), slab("b", 4000, 0, 4000, 3600)],
      [{ id: "o", name: "楼梯间", type: "stair", x: 3000, y: 1800, width: 2000, height: 1000 }],
    );
    const blocked = calculateFloorTopRebar(state, top([path()]));
    expect(blocked.isValid).toBe(false);
    expect(blocked.errors.map((item) => item.code)).toContain("through-path-opening-blocked");

    const clear = calculateFloorTopRebar(state, top([path({ bandStartMm: 0, bandEndMm: 1700 })]));
    expect(clear.isValid).toBe(true);
    expect(clear.throughPieceCount).toBeGreaterThan(0);
  });

  it("规格、角色和相位冲突分别fail closed", () => {
    const settingsPlan = plan([
      slab("a", 0, 0, 5000, 3600),
      slab("b", 5000, 0, 5000, 3600),
    ]);
    const settingsInput = top([path()]);
    settingsInput.slabOverrides.b = { secondaryDiameter: 12 };
    expect(calculateFloorTopRebar(settingsPlan, settingsInput).errors.map((item) => item.code))
      .toContain("through-path-settings-conflict");

    const rolePlan = plan([
      slab("a", 0, 0, 3000, 4000),
      slab("b", 3000, 0, 3000, 2000),
    ]);
    expect(calculateFloorTopRebar(rolePlan, top([path({ bandEndMm: 2000 })])).errors.map((item) => item.code))
      .toContain("through-path-role-conflict");

    const phasePlan = plan([
      slab("a", 0, 0, 5000, 4000),
      slab("b", 5000, 0, 5000, 3600),
    ]);
    const phaseInput = top([path()]);
    phaseInput.defaults.xSpacing = 1000;
    expect(calculateFloorTopRebar(phasePlan, phaseInput).errors.map((item) => item.code))
      .toContain("through-path-line-phase-conflict");
  });

  it("同方向重叠Path被拒绝，X/Y交叉Path合法", () => {
    const state = plan([
      slab("a", 0, 0, 4000, 3600),
      slab("b", 4000, 0, 4000, 3600),
    ]);
    const overlapping = calculateFloorTopRebar(state, top([
      path({ id: "p1", name: "通墙01", bandStartMm: 0, bandEndMm: 1800 }),
      path({ id: "p2", name: "通墙02", bandStartMm: 900, bandEndMm: 2700 }),
    ]));
    expect(overlapping.errors.map((item) => item.code)).toContain("through-path-overlap");

    const crossingState = plan([
      slab("a", 0, 0, 4000, 3000),
      slab("b", 4000, 0, 4000, 3000),
      slab("c", 0, 3000, 4000, 3000),
    ]);
    const crossing = calculateFloorTopRebar(crossingState, top([
      path({ id: "px", name: "东西通墙", slabIds: ["a", "b"], bandEndMm: 3000 }),
      path({ id: "py", name: "南北通墙", direction: "y", slabIds: ["a", "c"], bandStartMm: 0, bandEndMm: 4000 }),
    ]));
    expect(crossing.isValid).toBe(true);
    expect(crossing.resolvedThroughPaths.map((item) => item.direction).sort()).toEqual(["x", "y"]);
  });
});
