import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  countBars,
  createDefaultRoomAnchorRules,
  resolveBottomAnchor,
  resolveTopAnchor,
  restoreRoomAnchorToAuto,
  shouldApplyTopExtra,
  synchronizeRoomAnchors,
  type AnchorOrigin,
  type AnchorRule,
  type AnchorSource,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
  type TopExtraMode,
} from "./slab-calculator";

function anchor(
  source: AnchorSource,
  manualValue = 0,
  origin: AnchorOrigin = "user",
): AnchorRule {
  return { source, manualValue, origin };
}

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

function xThroughState(): SlabCalculatorState {
  const state = stateWithRooms("x", [
    [4200, 3600],
    [3600, 3600],
  ]);
  state.through.enabled = true;
  state.through.direction = "x";
  state.through.startAnchor = anchor("outer-wall");
  state.through.endAnchor = anchor("outer-wall");
  return state;
}

function yThroughState(): SlabCalculatorState {
  const state = stateWithRooms("y", [
    [4200, 3600],
    [4200, 3000],
  ]);
  state.through.enabled = true;
  state.through.direction = "y";
  state.through.startAnchor = anchor("outer-wall");
  state.through.endAnchor = anchor("outer-wall");
  return state;
}

describe("锚固解析", () => {
  it("地筋内墙锚固等于内墙厚度", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor(anchor("inner-wall"), slab)).toBe(240);
  });

  it("地筋外墙锚固等于外墙厚度", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor(anchor("outer-wall"), slab)).toBe(370);
  });

  it("地筋手动锚固直接作为最终值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveBottomAnchor(anchor("manual", 300), slab)).toBe(300);
  });

  it("面筋内墙锚固等于内墙厚度加增加值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor(anchor("inner-wall"), slab)).toBe(490);
  });

  it("面筋外墙锚固等于外墙厚度加增加值", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor(anchor("outer-wall"), slab)).toBe(620);
  });

  it("面筋手动锚固不增加250mm", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor(anchor("manual", 550), slab)).toBe(550);
  });

  it("增加值只影响墙体模式面筋", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    slab.topAnchorExtra = 300;
    expect(resolveTopAnchor(anchor("inner-wall"), slab)).toBe(540);
    expect(resolveTopAnchor(anchor("outer-wall"), slab)).toBe(670);
    expect(resolveTopAnchor(anchor("manual", 550), slab)).toBe(550);
  });

  it("墙厚变化不影响手动锚固", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    slab.innerWallThickness = 300;
    slab.outerWallThickness = 420;
    slab.topAnchorExtra = 280;
    expect(resolveBottomAnchor(anchor("manual", 315), slab)).toBe(315);
    expect(resolveTopAnchor(anchor("manual", 565), slab)).toBe(565);
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
    state.slab.rooms[1].anchors.bottom.x.start = anchor("manual", 333);
    const reordered = synchronizeRoomAnchors(
      [state.slab.rooms[1], state.slab.rooms[0], state.slab.rooms[2]],
      "x",
    );
    expect(reordered[0].anchors.bottom.x.start).toEqual(anchor("manual", 333));
    expect(reordered[1].anchors.bottom.x.start.source).toBe("inner-wall");
    expect(reordered[2].anchors.bottom.x.end.source).toBe("outer-wall");
  });
});

describe("面筋通墙回归", () => {
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
    expect(calculation.errors).toContain(
      "通墙组合区垂直方向尺寸或锚固不一致，请统一设置或拆分连续区。",
    );
  });

  it("普通多房间允许垂直尺寸不一致", () => {
    const state = xThroughState();
    state.through.enabled = false;
    state.through.direction = "none";
    state.slab.rooms[1].spanY = 3300;

    const calculation = calculateSlabResults(state);

    expect(calculation.isValid).toBe(true);
    expect(calculation.results).toHaveLength(8);
    expect(calculation.totalWeightKg).not.toBeNull();
  });
});

describe("面筋增加值作用端", () => {
  it("start模式在起点应用增加值", () => {
    expect(shouldApplyTopExtra("start", "start")).toBe(true);
  });

  it("start模式不在终点应用增加值", () => {
    expect(shouldApplyTopExtra("start", "end")).toBe(false);
  });

  it("end模式不在起点应用增加值", () => {
    expect(shouldApplyTopExtra("end", "start")).toBe(false);
  });

  it("end模式在终点应用增加值", () => {
    expect(shouldApplyTopExtra("end", "end")).toBe(true);
  });

  it("both模式在两端应用增加值", () => {
    expect(shouldApplyTopExtra("both", "start")).toBe(true);
    expect(shouldApplyTopExtra("both", "end")).toBe(true);
  });

  it("普通X向面筋只在西端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "start";
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(620);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(5.19, 6);
    expect(result?.startExtraApplied).toBe(true);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("普通X向面筋只在东端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "end";
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(620);
    expect(result?.singleLengthM).toBeCloseTo(5.19, 6);
  });

  it("普通X向面筋在两端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(620);
    expect(result?.endAnchor).toBe(620);
    expect(result?.singleLengthM).toBeCloseTo(5.44, 6);
  });

  it("普通Y向面筋只在南端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.y.extraMode = "start";
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "y",
    );
    expect(result?.startAnchor).toBe(620);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(4.59, 6);
  });

  it("普通Y向面筋只在北端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.y.extraMode = "end";
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "y",
    );
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(620);
    expect(result?.singleLengthM).toBeCloseTo(4.59, 6);
  });

  it("X向通墙只在最西端增加", () => {
    const state = xThroughState();
    state.through.extraMode = "start";
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(620);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(9.03, 6);
    expect(result?.totalLengthM).toBeCloseTo(162.54, 6);
    expect(result?.weightKg).toBeCloseTo(100.21, 2);
  });

  it("X向通墙只在最东端增加", () => {
    const state = xThroughState();
    state.through.extraMode = "end";
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(620);
    expect(result?.singleLengthM).toBeCloseTo(9.03, 6);
  });

  it("X向通墙在两端增加", () => {
    const state = xThroughState();
    state.through.extraMode = "both";
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(620);
    expect(result?.endAnchor).toBe(620);
    expect(result?.singleLengthM).toBeCloseTo(9.28, 6);
    expect(result?.count).toBe(18);
  });

  it("通墙组合区垂直面筋使用普通方向自己的extraMode", () => {
    const state = xThroughState();
    state.through.extraMode = "start";
    state.top.y.extraMode = "end";
    const perpendicular = calculateSlabResults(state).throughWall?.perpendicularBar;
    expect(perpendicular?.topExtraMode).toBe("end");
    expect(perpendicular?.startAnchor).toBe(370);
    expect(perpendicular?.endAnchor).toBe(620);
    expect(perpendicular?.singleLengthM).toBeCloseTo(4.59, 6);
    expect(perpendicular?.count).toBe(39);
  });

  it("手动端无论模式如何都不增加topAnchorExtra", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = anchor("manual", 550);
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(550);
    expect(result?.endAnchor).toBe(620);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endExtraApplied).toBe(true);
  });

  it("修改增加值后只有启用增加的墙体端变化", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "start";
    state.slab.topAnchorExtra = 300;
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(670);
    expect(result?.endAnchor).toBe(370);
  });

  it("地筋结果完全不受TopExtraMode影响", () => {
    const state = cloneDefaultSlabCalculatorState();
    const before = calculateSlabResults(state).results.filter((bar) => bar.layer === "bottom");
    state.top.x.extraMode = "start";
    state.top.y.extraMode = "end";
    state.through.extraMode = "start";
    state.slab.topAnchorExtra = 500;
    const after = calculateSlabResults(state).results.filter((bar) => bar.layer === "bottom");
    expect(after).toEqual(before);
  });

  it("默认状态和缺少旧字段的状态都按两端增加", () => {
    const defaults = cloneDefaultSlabCalculatorState();
    expect(defaults.top.x.extraMode).toBe("both");
    expect(defaults.top.y.extraMode).toBe("both");
    expect(defaults.through.extraMode).toBe("both");

    const legacy = cloneDefaultSlabCalculatorState();
    delete (legacy.top.x as { extraMode?: TopExtraMode }).extraMode;
    const result = calculateSlabResults(legacy).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.topExtraMode).toBe("both");
    expect(result?.singleLengthM).toBeCloseTo(5.44, 6);

    const legacyThrough = xThroughState();
    delete (legacyThrough.through as { extraMode?: TopExtraMode }).extraMode;
    const throughResult = calculateSlabResults(legacyThrough).throughWall?.throughBar;
    expect(throughResult?.topExtraMode).toBe("both");
    expect(throughResult?.singleLengthM).toBeCloseTo(9.28, 6);
  });
});

describe("锚固来源状态与拓扑同步", () => {
  it("用户选择outer-wall后添加房间不会被覆盖", () => {
    const state = stateWithRooms("x", [[4200, 3600]]);
    state.slab.rooms[0].anchors.bottom.x.end = anchor("outer-wall");
    const added: SlabRoom = {
      id: "room-1",
      name: "房间B",
      spanX: 3600,
      spanY: 3600,
      anchors: createDefaultRoomAnchorRules("x", 1, 2),
    };
    const rooms = synchronizeRoomAnchors([...state.slab.rooms, added], "x");
    expect(rooms[0].anchors.bottom.x.end).toEqual(anchor("outer-wall"));
    expect(rooms[1].anchors.bottom.x.end).toEqual(
      anchor("outer-wall", 0, "auto"),
    );
  });

  it("用户选择inner-wall后调整顺序仍完整保留", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    state.slab.rooms[0].anchors.top.x.start = anchor("inner-wall");
    const rooms = synchronizeRoomAnchors(
      [state.slab.rooms[1], state.slab.rooms[2], state.slab.rooms[0]],
      "x",
    );
    expect(rooms[2].anchors.top.x.start).toEqual(anchor("inner-wall"));
  });

  it("manual值在排序、删除和添加后保持不变", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    state.slab.rooms[1].anchors.bottom.x.end = anchor("manual", 333);
    const added: SlabRoom = {
      id: "room-3",
      name: "房间D",
      spanX: 2800,
      spanY: 3600,
      anchors: createDefaultRoomAnchorRules("x", 3, 4),
    };
    const rooms = synchronizeRoomAnchors(
      [state.slab.rooms[1], state.slab.rooms[2], added],
      "x",
    );
    expect(rooms[0].anchors.bottom.x.end).toEqual(anchor("manual", 333));
  });

  it("auto端点在房间位置改变后按首中末拓扑更新", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    const rooms = synchronizeRoomAnchors(
      [state.slab.rooms[2], state.slab.rooms[0], state.slab.rooms[1]],
      "x",
    );
    expect(rooms[0].anchors.bottom.x.start.source).toBe("outer-wall");
    expect(rooms[0].anchors.bottom.x.end.source).toBe("inner-wall");
    expect(rooms[1].anchors.bottom.x.start.source).toBe("inner-wall");
    expect(rooms[1].anchors.bottom.x.end.source).toBe("inner-wall");
    expect(rooms[2].anchors.bottom.x.end.source).toBe("outer-wall");
    expect(rooms.flatMap((room) => [
      room.anchors.bottom.x.start.origin,
      room.anchors.bottom.x.end.origin,
    ])).toEqual(["auto", "auto", "auto", "auto", "auto", "auto"]);
  });

  it("恢复自动后重新使用当前位置拓扑默认值", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
    ]);
    state.slab.rooms[0].anchors.top.x.end = anchor("outer-wall");
    const rooms = restoreRoomAnchorToAuto(
      state.slab.rooms,
      "x",
      state.slab.rooms[0].id,
      "top",
      "x",
      "end",
    );
    expect(rooms[0].anchors.top.x.end).toEqual(
      anchor("inner-wall", 0, "auto"),
    );
  });

  it("旧数据缺少origin时按拓扑和手动规则推断", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
    ]);
    delete (state.slab.rooms[0].anchors.bottom.x.start as { origin?: AnchorOrigin }).origin;
    state.slab.rooms[0].anchors.bottom.x.end = {
      source: "outer-wall",
      manualValue: 0,
    } as AnchorRule;
    state.slab.rooms[1].anchors.bottom.x.start = {
      source: "manual",
      manualValue: 321,
    } as AnchorRule;
    const rooms = synchronizeRoomAnchors(state.slab.rooms, "x");
    expect(rooms[0].anchors.bottom.x.start.origin).toBe("auto");
    expect(rooms[0].anchors.bottom.x.end.origin).toBe("user");
    expect(rooms[1].anchors.bottom.x.start).toEqual(anchor("manual", 321));
  });
});

describe("严格校验和结果关联", () => {
  it("通墙垂直方向锚固不一致时不读取第一间房代替", () => {
    const state = xThroughState();
    state.slab.rooms[1].anchors.top.y.start = anchor("inner-wall");
    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.errors).toContain(
      "通墙组合区垂直方向尺寸或锚固不一致，请统一设置或拆分连续区。",
    );
    expect(calculation.throughWall).toBeNull();
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("通墙垂直锚固签名比较墙体端保留的手动值", () => {
    const state = xThroughState();
    state.slab.rooms[1].anchors.top.y.start = {
      source: "outer-wall",
      manualValue: 550,
      origin: "user",
    };

    const calculation = calculateSlabResults(state);

    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("通墙方向错误时不退回普通面筋结果", () => {
    const state = xThroughState();
    state.through.direction = "y";
    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("房间重名仍使用roomId和scopeId关联结果", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
    ]);
    state.slab.rooms[0].name = "同名房间";
    state.slab.rooms[1].name = "同名房间";
    const results = calculateSlabResults(state).results;
    const roomResults = results.filter((result) => result.roomId);
    expect(new Set(roomResults.map((result) => result.roomId))).toEqual(
      new Set(["room-0", "room-1"]),
    );
    expect(roomResults.every((result) => result.scopeId === result.roomId)).toBe(true);
  });

  it("房间ID重复时结果和重量均为空", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
    ]);
    state.slab.rooms[1].id = state.slab.rooms[0].id;
    const calculation = calculateSlabResults(state);
    expect(calculation.errors).toContain("房间ID必须唯一");
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("保护层占满计算宽度时结果无效", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.countMode = "cover";
    state.slab.cover = 1800;
    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.errors.some((error) => error.includes("必须大于两倍保护层"))).toBe(true);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("手动锚固为0时不生成工程结果", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].anchors.bottom.x.start = anchor("manual", 0);
    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("非法排列、锚固来源和增加模式均被拒绝", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.arrangement = "diagonal" as RoomArrangement;
    state.top.x.extraMode = "none" as TopExtraMode;
    state.slab.rooms[0].anchors.bottom.x.start = {
      ...anchor("outer-wall"),
      source: "beam" as AnchorSource,
    };
    const calculation = calculateSlabResults(state);
    expect(calculation.errors).toContain("房间排列方向无效");
    expect(calculation.errors).toContain("面筋X向增加位置无效");
    expect(calculation.errors.some((error) => error.includes("锚固来源无效"))).toBe(true);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("固定X向通墙样例保留39根且墙厚不进入根数", () => {
    const calculation = calculateSlabResults(xThroughState());
    const through = calculation.throughWall;
    expect(through?.netSpanTotal).toBe(7800);
    expect(through?.intermediateWallTotal).toBe(240);
    expect(through?.throughBar.singleLengthM).toBeCloseTo(9.28, 6);
    expect(through?.throughBar.count).toBe(18);
    expect(through?.throughBar.totalLengthM).toBeCloseTo(167.04, 6);
    expect(through?.throughBar.weightKg).toBeCloseTo(102.99, 2);
    expect(through?.perpendicularBar.count).toBe(39);
    expect(through?.perpendicularBar.count).not.toBe(41);
    expect(through?.perpendicularBar.singleLengthM).toBeCloseTo(4.84, 6);
    expect(through?.perpendicularBar.totalLengthM).toBeCloseTo(188.76, 6);
    expect(through?.perpendicularBar.weightKg).toBeCloseTo(116.38, 2);
  });

  it("Y向通墙按对称规则使用净尺寸计算垂直筋根数", () => {
    const through = calculateSlabResults(yThroughState()).throughWall;
    expect(through?.direction).toBe("y");
    expect(through?.netSpanTotal).toBe(6600);
    expect(through?.intermediateWallTotal).toBe(240);
    expect(through?.throughBar.singleLengthM).toBeCloseTo(8.08, 6);
    expect(through?.throughBar.count).toBe(21);
    expect(through?.perpendicularBar.count).toBe(33);
    expect(through?.perpendicularBar.singleLengthM).toBeCloseTo(5.44, 6);
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
    state.slab.rooms[0].anchors.top.x.start = anchor("manual", -1);
    state.through.enabled = true;
    state.through.direction = "x";

    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(false);
    expect(calculation.throughWall).toBeNull();
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });
});
