import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  countBars,
  createDefaultRoomAnchorRules,
  resolveBottomAnchor,
  resolveTopAnchor,
  synchronizeRoomAnchors,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
} from "./slab-calculator";

function stateWithRooms(
  arrangement: RoomArrangement,
  dimensions: Array<[number, number]>,
): SlabCalculatorState {
  const state = cloneDefaultSlabCalculatorState();
  const rooms: SlabRoom[] = dimensions.map(([spanX, spanY], index) => ({
    id: `room-${index}`,
    name: `房间${String.fromCharCode(65 + index)}`,
    spanX,
    spanY,
    anchors: createDefaultRoomAnchorRules(arrangement, index, dimensions.length),
  }));
  state.slab.arrangement = arrangement;
  state.slab.rooms = synchronizeRoomAnchors(rooms, arrangement);
  return state;
}

describe("锚固解析", () => {
  it("地筋内墙锚固等于内墙厚度", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor({ source: "inner-wall", manualValue: 0 }, slab)).toBe(240);
  });

  it("地筋外墙锚固等于外墙厚度", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor({ source: "outer-wall", manualValue: 0 }, slab)).toBe(370);
  });

  it("地筋手动锚固直接作为最终值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor({ source: "manual", manualValue: 300 }, slab)).toBe(300);
  });

  it("面筋内墙锚固等于内墙厚度加增加值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor({ source: "inner-wall", manualValue: 0 }, slab)).toBe(490);
  });

  it("面筋外墙锚固等于外墙厚度加增加值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor({ source: "outer-wall", manualValue: 0 }, slab)).toBe(620);
  });

  it("面筋手动锚固不增加250mm", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor({ source: "manual", manualValue: 550 }, slab)).toBe(550);
  });

  it("增加值只影响墙体模式面筋", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    slab.topAnchorExtra = 300;
    expect(resolveTopAnchor({ source: "inner-wall", manualValue: 0 }, slab)).toBe(540);
    expect(resolveTopAnchor({ source: "outer-wall", manualValue: 0 }, slab)).toBe(670);
    expect(resolveTopAnchor({ source: "manual", manualValue: 550 }, slab)).toBe(550);
  });

  it("墙厚变化不影响手动锚固", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    slab.innerWallThickness = 300;
    slab.outerWallThickness = 420;
    slab.topAnchorExtra = 280;
    expect(resolveBottomAnchor({ source: "manual", manualValue: 315 }, slab)).toBe(315);
    expect(resolveTopAnchor({ source: "manual", manualValue: 565 }, slab)).toBe(565);
  });
});

describe("房间级端部规则", () => {
  it("三个X向房间生成外墙→内墙、内墙→内墙、内墙→外墙", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    const xRules = state.slab.rooms.map((room) => room.anchors.bottom.x);
    expect(xRules.map((rule) => [rule.start.source, rule.end.source])).toEqual([
      ["outer-wall", "inner-wall"],
      ["inner-wall", "inner-wall"],
      ["inner-wall", "outer-wall"],
    ]);

    const calculation = calculateSlabResults(state);
    const bottomX = calculation.results.filter(
      (result) => result.layer === "bottom" && result.direction === "x",
    );
    expect(bottomX.map((result) => result.singleLengthM)).toEqual([4.81, 4.08, 3.61]);
    expect(bottomX.reduce((sum, result) => sum + result.totalLengthM, 0)).toBeCloseTo(300, 6);
    expect(bottomX.reduce((sum, result) => sum + result.weightKg, 0)).toBeCloseTo(266.34, 2);

    const topX = calculation.results.filter(
      (result) => result.layer === "top" && result.direction === "x",
    );
    expect(topX.map((result) => [result.startAnchor, result.endAnchor])).toEqual([
      [620, 490],
      [490, 490],
      [490, 620],
    ]);
    expect(topX.map((result) => result.singleLengthM)).toEqual([5.31, 4.58, 4.11]);
    expect(topX.reduce((sum, result) => sum + result.totalLengthM, 0)).toBeCloseTo(252, 6);
    expect(topX.reduce((sum, result) => sum + result.weightKg, 0)).toBeCloseTo(155.37, 2);
  });

  it("三个Y向房间生成对称端点且不会共享可变对象", () => {
    const state = stateWithRooms("y", [
      [4200, 3600],
      [4200, 3000],
      [4200, 2800],
    ]);
    const yRules = state.slab.rooms.map((room) => room.anchors.top.y);
    expect(yRules.map((rule) => [rule.start.source, rule.end.source])).toEqual([
      ["outer-wall", "inner-wall"],
      ["inner-wall", "inner-wall"],
      ["inner-wall", "outer-wall"],
    ]);
    expect(yRules[0].start).not.toBe(yRules[1].start);
    expect(yRules[1].end).not.toBe(yRules[2].end);
  });

  it("重新排序时保留手动值并重新生成墙体边界", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    state.slab.rooms[1].anchors.bottom.x.start = { source: "manual", manualValue: 333 };
    const reordered = synchronizeRoomAnchors(
      [state.slab.rooms[1], state.slab.rooms[0], state.slab.rooms[2]],
      "x",
    );
    expect(reordered[0].anchors.bottom.x.start).toEqual({ source: "manual", manualValue: 333 });
    expect(reordered[1].anchors.bottom.x.start.source).toBe("inner-wall");
    expect(reordered[2].anchors.bottom.x.end.source).toBe("outer-wall");
  });
});

describe("面筋通墙回归", () => {
  function xThroughState(): SlabCalculatorState {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
    ]);
    state.through.enabled = true;
    state.through.direction = "x";
    state.through.startAnchor = { source: "outer-wall", manualValue: 0 };
    state.through.endAnchor = { source: "outer-wall", manualValue: 0 };
    return state;
  }

  it("中间墙只进入X向单根长度，Y向根数为39", () => {
    const calculation = calculateSlabResults(xThroughState());
    expect(calculation.errors).toEqual([]);
    expect(calculation.throughWall?.intermediateWallTotal).toBe(240);
    expect(calculation.throughWall?.throughBar.count).toBe(18);
    expect(calculation.throughWall?.throughBar.singleLengthM).toBeCloseTo(9.28, 6);
    expect(calculation.throughWall?.throughBar.totalLengthM).toBeCloseTo(167.04, 6);
    expect(calculation.throughWall?.throughBar.weightKg).toBeCloseTo(102.99, 2);
    expect(calculation.throughWall?.perpendicularBar.count).toBe(39);
    expect(calculation.throughWall?.perpendicularBar.singleLengthM).toBeCloseTo(4.84, 6);
    expect(calculation.throughWall?.perpendicularBar.totalLengthM).toBeCloseTo(188.76, 6);
    expect(calculation.throughWall?.perpendicularBar.weightKg).toBeCloseTo(116.38, 2);
    expect(calculation.throughWall?.perpendicularBar.count).not.toBe(41);
  });

  it("通墙面筋替换普通面筋而不重复累计", () => {
    const calculation = calculateSlabResults(xThroughState());
    const topResults = calculation.results.filter((result) => result.layer === "top");
    expect(topResults).toHaveLength(2);
    expect(topResults.filter((result) => result.throughWall)).toHaveLength(1);
    expect(topResults.some((result) => result.id.startsWith("room-") && result.direction === "x")).toBe(false);
  });

  it("保护层算法只在组合区最外侧扣减两次", () => {
    const state = xThroughState();
    state.slab.countMode = "cover";
    const through = calculateSlabResults(state).throughWall;
    expect(through?.throughBar.count).toBe(19);
    expect(through?.perpendicularBar.count).toBe(40);
    expect(through?.perpendicularBar.count).toBe(
      countBars(4200 + 3600, 200, 15, "cover"),
    );
  });

  it("排列方向或垂直尺寸校验失败时取消通墙结果", () => {
    const wrongDirection = xThroughState();
    wrongDirection.through.direction = "y";
    expect(calculateSlabResults(wrongDirection).throughWall).toBeNull();

    const inconsistent = xThroughState();
    inconsistent.slab.rooms[1].spanY = 3500;
    const calculation = calculateSlabResults(inconsistent);
    expect(calculation.throughWall).toBeNull();
    expect(calculation.errors).toContain("房间垂直方向尺寸不一致，需要拆分钢筋连续区");
  });
});

describe("无效输入安全性", () => {
  it("无效数字、负数和0不会产生NaN或Infinity", () => {
    const state = stateWithRooms("x", [
      [Number.NaN, 3600],
      [3600, 3600],
    ]);
    state.slab.innerWallThickness = -240;
    state.slab.cover = Number.POSITIVE_INFINITY;
    state.bottom.x.diameter = 0;
    state.top.y.spacing = 0;
    state.slab.rooms[0].anchors.top.x.start = { source: "manual", manualValue: -1 };
    state.through.enabled = true;
    state.through.direction = "x";

    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.throughWall).toBeNull();
    expect(calculation.results.length).toBeGreaterThan(0);
    calculation.results.forEach((result) => {
      expect(Number.isFinite(result.count)).toBe(true);
      expect(Number.isFinite(result.singleLengthM)).toBe(true);
      expect(Number.isFinite(result.totalLengthM)).toBe(true);
      expect(Number.isFinite(result.weightKg)).toBe(true);
    });
    expect(Number.isFinite(calculation.totalWeightKg)).toBe(true);
  });
});
