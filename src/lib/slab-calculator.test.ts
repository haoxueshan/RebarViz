import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  allocateBarCountsByPosition,
  cloneDefaultSlabCalculatorState,
  countBars,
  createDefaultRoomAnchorRules,
  resolveBottomAnchor,
  resolveTopAnchor,
  sameAnchorRule,
  restoreRoomAnchorToAuto,
  shouldApplyTopExtra,
  synchronizeRoomAnchors,
  type AnchorOrigin,
  type AnchorRule,
  type AnchorSource,
  type CountMode,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
  type TopExtraMode,
} from "./slab-calculator";
import { allocateLargestRemainder } from "./slab-room-topology";

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

describe("根数算法", () => {
  it("四舍五入算法按比例取整且至少返回1根", () => {
    expect(countBars(3350, 200, "round")).toBe(17);
    expect(countBars(3300, 200, "round")).toBe(17);
    expect(countBars(100, 200, "round")).toBe(1);
  });

  it("向下取整算法按比例取整且至少返回1根", () => {
    expect(countBars(3350, 200, "floor")).toBe(16);
    expect(countBars(3300, 200, "floor")).toBe(16);
    expect(countBars(100, 200, "floor")).toBe(1);
  });

  it("项目算法保持向上取整公式", () => {
    expect(countBars(3350, 200, "project")).toBe(17);
  });

  it("普通房间使用所选算法并据此重新计算重量", () => {
    const roundState = cloneDefaultSlabCalculatorState();
    roundState.slab.rooms[0].spanY = 3350;
    roundState.slab.countMode = "round";
    const roundResult = calculateSlabResults(roundState).results.find(
      (result) => result.roomId === "room-a" && result.layer === "top" && result.direction === "x",
    );

    const floorState = structuredClone(roundState);
    floorState.slab.countMode = "floor";
    const floorResult = calculateSlabResults(floorState).results.find(
      (result) => result.roomId === "room-a" && result.layer === "top" && result.direction === "x",
    );

    expect(roundResult?.count).toBe(17);
    expect(floorResult?.count).toBe(16);
    expect(roundResult?.weightKg).toBeCloseTo(
      17 * (roundResult?.singleLengthM ?? 0) * (roundResult?.unitWeightKgM ?? 0),
      10,
    );
    expect(floorResult?.weightKg).toBeCloseTo(
      16 * (floorResult?.singleLengthM ?? 0) * (floorResult?.unitWeightKgM ?? 0),
      10,
    );
    expect(roundResult!.weightKg).toBeGreaterThan(floorResult!.weightKg);
  });

  it("通墙方向和各房间垂直普通筋分别使用所选根数算法", () => {
    const roundState = stateWithRooms("x", [
      [4200, 3350],
      [3500, 3350],
    ]);
    roundState.through.enabled = true;
    roundState.through.direction = "x";
    roundState.slab.countMode = "round";
    const roundCalculation = calculateSlabResults(roundState);

    const floorState = structuredClone(roundState);
    floorState.slab.countMode = "floor";
    const floorCalculation = calculateSlabResults(floorState);

    expect(roundCalculation.throughWall?.throughBar.count).toBe(17);
    expect(
      roundCalculation.results
        .filter((result) => result.layer === "top" && result.direction === "y")
        .map((result) => result.count),
    ).toEqual([21, 18]);
    expect(floorCalculation.throughWall?.throughBar.count).toBe(16);
    expect(
      floorCalculation.results
        .filter((result) => result.layer === "top" && result.direction === "y")
        .map((result) => result.count),
    ).toEqual([21, 17]);
  });

  it("非法根数算法继续使正式结果无效", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.countMode = "truncate" as CountMode;

    const calculation = calculateSlabResults(state);

    expect(calculation.errors).toContain("根数算法无效");
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });
});

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

  it("面筋外墙锚固始终等于外墙厚度", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor(anchor("outer-wall"), slab)).toBe(370);
    expect(resolveTopAnchor(anchor("outer-wall"), slab, false)).toBe(370);
  });

  it("面筋手动锚固不增加250mm", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    expect(resolveTopAnchor(anchor("manual", 550), slab)).toBe(550);
  });

  it("增加值只影响启用增加的内墙面筋", () => {
    const slab = cloneDefaultSlabCalculatorState().slab;
    slab.topAnchorExtra = 300;
    expect(resolveTopAnchor(anchor("inner-wall"), slab)).toBe(540);
    expect(resolveTopAnchor(anchor("inner-wall"), slab, false)).toBe(240);
    expect(resolveTopAnchor(anchor("outer-wall"), slab)).toBe(370);
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
      [370, 490],
      [490, 490],
      [490, 370],
    ]);
    expect(topX.map((result) => Number(result.singleLengthM.toFixed(2)))).toEqual([5.06, 4.58, 3.86]);
    expect(topX.reduce((sum, result) => sum + result.totalLengthM, 0)).toBeCloseTo(243, 6);
    expect(topX.reduce((sum, result) => sum + result.weightKg, 0)).toBeCloseTo(149.82, 2);
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
  it("中间墙只进入X向通墙长度，Y向面筋按房间分别计算", () => {
    const calculation = calculateSlabResults(xThroughState());
    expect(calculation.errors).toEqual([]);
    expect(calculation.throughWall?.intermediateWallTotal).toBe(240);
    expect(calculation.throughWall?.throughBar.count).toBe(18);
    expect(calculation.throughWall?.throughBar.singleLengthM).toBeCloseTo(8.78, 6);
    expect(calculation.throughWall?.throughBar.totalLengthM).toBeCloseTo(158.04, 6);
    expect(calculation.throughWall?.throughBar.weightKg).toBeCloseTo(97.44, 2);
    const roomTopY = calculation.results.filter(
      (result) => result.layer === "top" && result.direction === "y",
    );
    expect(roomTopY.map((result) => result.count)).toEqual([21, 18]);
    expect(roomTopY.every((result) => result.scopeType === "room")).toBe(true);
    expect(roomTopY.every((result) => result.intermediateWallMm === 0)).toBe(true);
  });

  it("通墙面筋替换普通面筋而不重复累计", () => {
    const calculation = calculateSlabResults(xThroughState());
    const topResults = calculation.results.filter((result) => result.layer === "top");
    expect(topResults).toHaveLength(3);
    expect(topResults.filter((result) => result.throughWall)).toHaveLength(1);
    expect(topResults.some((result) => result.id.startsWith("room-") && result.direction === "x")).toBe(false);
    expect(topResults.filter((result) => result.direction === "y")).toHaveLength(2);
    expect(calculation.results).toHaveLength(7);
    expect(
      calculation.results.every(
        (result) =>
          (result.scopeType === "through" && result.throughWall) ||
          (result.scopeType === "room" && !result.throughWall),
      ),
    ).toBe(true);
  });

  it.each([
    ["project", 21, 18],
    ["round", 21, 18],
    ["floor", 20, 17],
  ] as const)(
    "%s算法对4100与3500宽度分别取整，不合并计算垂直普通筋",
    (countMode, firstCount, secondCount) => {
      const state = stateWithRooms("x", [
        [4100, 3600],
        [3500, 3600],
      ]);
      state.slab.countMode = countMode;
      state.through.enabled = true;
      state.through.direction = "x";

      const roomTopY = calculateSlabResults(state).results.filter(
        (result) => result.layer === "top" && result.direction === "y",
      );
      expect(roomTopY.map((result) => result.count)).toEqual([
        firstCount,
        secondCount,
      ]);
      expect(roomTopY.reduce((sum, result) => sum + result.count, 0)).toBe(
        firstCount + secondCount,
      );
    },
  );

  it("排列方向或垂直尺寸校验失败时取消通墙结果", () => {
    const wrongDirection = xThroughState();
    wrongDirection.through.direction = "y";
    expect(calculateSlabResults(wrongDirection).throughWall).toBeNull();

    const inconsistent = xThroughState();
    inconsistent.slab.rooms[1].spanY = 3500;
    const calculation = calculateSlabResults(inconsistent);
    expect(calculation.throughWall).toBeNull();
    expect(calculation.errors).toContain(
      "通墙组合区垂直净尺寸不一致，当前整体通墙模式不可形成。",
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

  it("普通X向面筋只在被选中的西端内墙增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "start";
    state.slab.rooms[0].anchors.top.x.start = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(490);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(5.06, 6);
    expect(result?.startExtraApplied).toBe(true);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("普通X向面筋只在被选中的东端内墙增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "end";
    state.slab.rooms[0].anchors.top.x.end = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(490);
    expect(result?.singleLengthM).toBeCloseTo(5.06, 6);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endExtraApplied).toBe(true);
  });

  it("内墙端未被增加位置选中时只采用内墙厚度", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "end";
    state.slab.rooms[0].anchors.top.x.start = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(240);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endAnchor).toBe(370);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("普通X向面筋两端均为内墙时在两端增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = anchor("inner-wall");
    state.slab.rooms[0].anchors.top.x.end = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(490);
    expect(result?.endAnchor).toBe(490);
    expect(result?.singleLengthM).toBeCloseTo(5.18, 6);
    expect(result?.startExtraApplied).toBe(true);
    expect(result?.endExtraApplied).toBe(true);
  });

  it("普通Y向面筋只在被选中的南端内墙增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.y.extraMode = "start";
    state.slab.rooms[0].anchors.top.y.start = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "y",
    );
    expect(result?.startAnchor).toBe(490);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(4.46, 6);
    expect(result?.startExtraApplied).toBe(true);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("普通Y向面筋只在被选中的北端内墙增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.y.extraMode = "end";
    state.slab.rooms[0].anchors.top.y.end = anchor("inner-wall");
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "y",
    );
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(490);
    expect(result?.singleLengthM).toBeCloseTo(4.46, 6);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endExtraApplied).toBe(true);
  });

  it("X向通墙只在被选中的最西端内墙增加", () => {
    const state = xThroughState();
    state.through.extraMode = "start";
    state.through.startAnchor = anchor("inner-wall");
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(490);
    expect(result?.endAnchor).toBe(370);
    expect(result?.singleLengthM).toBeCloseTo(8.9, 6);
    expect(result?.totalLengthM).toBeCloseTo(160.2, 6);
    expect(result?.startExtraApplied).toBe(true);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("X向通墙只在被选中的最东端内墙增加", () => {
    const state = xThroughState();
    state.through.extraMode = "end";
    state.through.endAnchor = anchor("inner-wall");
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(370);
    expect(result?.endAnchor).toBe(490);
    expect(result?.singleLengthM).toBeCloseTo(8.9, 6);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endExtraApplied).toBe(true);
  });

  it("X向通墙两端均为内墙时在两端增加", () => {
    const state = xThroughState();
    state.through.extraMode = "both";
    state.through.startAnchor = anchor("inner-wall");
    state.through.endAnchor = anchor("inner-wall");
    const result = calculateSlabResults(state).throughWall?.throughBar;
    expect(result?.startAnchor).toBe(490);
    expect(result?.endAnchor).toBe(490);
    expect(result?.singleLengthM).toBeCloseTo(9.02, 6);
    expect(result?.count).toBe(18);
  });

  it("默认单房间和通墙最外侧为外墙时即使选择两端也不增加", () => {
    const single = calculateSlabResults(cloneDefaultSlabCalculatorState()).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    )!;
    expect([single.startAnchor, single.endAnchor]).toEqual([370, 370]);
    expect([single.startExtraApplied, single.endExtraApplied]).toEqual([false, false]);

    const through = calculateSlabResults(xThroughState()).throughWall?.throughBar;
    expect([through?.startAnchor, through?.endAnchor]).toEqual([370, 370]);
    expect([through?.startExtraApplied, through?.endExtraApplied]).toEqual([false, false]);
  });

  it("通墙模式下垂直普通面筋各自使用普通方向extraMode", () => {
    const state = xThroughState();
    state.through.extraMode = "start";
    state.top.y.extraMode = "end";
    state.slab.rooms.forEach((room) => {
      room.anchors.top.y.end = anchor("inner-wall");
    });
    const perpendicular = calculateSlabResults(state).results.filter(
      (result) => result.layer === "top" && result.direction === "y",
    );
    expect(perpendicular).toHaveLength(2);
    expect(perpendicular.every((result) => result.topExtraMode === "end")).toBe(true);
    expect(perpendicular.every((result) => result.startAnchor === 370)).toBe(true);
    expect(perpendicular.every((result) => result.endAnchor === 490)).toBe(true);
  });

  it("手动端无论模式如何都不增加topAnchorExtra", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = anchor("manual", 550);
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(550);
    expect(result?.endAnchor).toBe(370);
    expect(result?.startExtraApplied).toBe(false);
    expect(result?.endExtraApplied).toBe(false);
  });

  it("修改增加值后只有启用增加的内墙端变化", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "start";
    state.slab.rooms[0].anchors.top.x.start = anchor("inner-wall");
    state.slab.topAnchorExtra = 300;
    const result = calculateSlabResults(state).results.find(
      (bar) => bar.layer === "top" && bar.direction === "x",
    );
    expect(result?.startAnchor).toBe(540);
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
    expect(result?.singleLengthM).toBeCloseTo(4.94, 6);

    const legacyThrough = xThroughState();
    delete (legacyThrough.through as { extraMode?: TopExtraMode }).extraMode;
    const throughResult = calculateSlabResults(legacyThrough).throughWall?.throughBar;
    expect(throughResult?.topExtraMode).toBe("both");
    expect(throughResult?.singleLengthM).toBeCloseTo(8.78, 6);
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
  it("通墙垂直方向锚固不一致时仍按各房间独立计算", () => {
    const state = xThroughState();
    state.slab.rooms[1].anchors.top.y.start = anchor("inner-wall");
    const calculation = calculateSlabResults(state);
    expect(calculation.isValid).toBe(true);
    expect(calculation.throughWall).not.toBeNull();
    const roomTopY = calculation.results.filter(
      (result) => result.layer === "top" && result.direction === "y",
    );
    expect(roomTopY).toHaveLength(2);
    expect(roomTopY[0].startAnchor).toBe(370);
    expect(roomTopY[1].startAnchor).toBe(490);
  });

  it("墙体锚固隐藏manualValue不参与业务比较", () => {
    expect(
      sameAnchorRule(
        { source: "outer-wall", manualValue: 0, origin: "auto" },
        { source: "outer-wall", manualValue: 550, origin: "user" },
      ),
    ).toBe(true);
    expect(
      sameAnchorRule(
        { source: "manual", manualValue: 0, origin: "user" },
        { source: "manual", manualValue: 550, origin: "user" },
      ),
    ).toBe(false);
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

  it("固定X向通墙样例保留各房间Y向根数且墙厚不进入根数", () => {
    const calculation = calculateSlabResults(xThroughState());
    const through = calculation.throughWall;
    expect(through?.netSpanTotal).toBe(7800);
    expect(through?.intermediateWallTotal).toBe(240);
    expect(through?.throughBar.singleLengthM).toBeCloseTo(8.78, 6);
    expect(through?.throughBar.count).toBe(18);
    expect(through?.throughBar.totalLengthM).toBeCloseTo(158.04, 6);
    expect(through?.throughBar.weightKg).toBeCloseTo(97.44, 2);
    const roomTopY = calculation.results.filter(
      (result) => result.layer === "top" && result.direction === "y",
    );
    expect(roomTopY.map((result) => result.count)).toEqual([21, 18]);
    expect(roomTopY.reduce((sum, result) => sum + result.count, 0)).toBe(39);
    expect(roomTopY.every((result) => result.intermediateWallMm === 0)).toBe(true);
  });

  it("Y向通墙按对称规则保留各房间X向普通面筋", () => {
    const calculation = calculateSlabResults(yThroughState());
    const through = calculation.throughWall;
    expect(through?.direction).toBe("y");
    expect(through?.netSpanTotal).toBe(6600);
    expect(through?.intermediateWallTotal).toBe(240);
    expect(through?.throughBar.singleLengthM).toBeCloseTo(7.58, 6);
    expect(through?.throughBar.count).toBe(21);
    const roomTopX = calculation.results.filter(
      (result) => result.layer === "top" && result.direction === "x",
    );
    expect(roomTopX.map((result) => result.count)).toEqual([18, 15]);
    expect(roomTopX.every((result) => result.singleLengthM === 4.94)).toBe(true);
  });
});

describe("无效输入安全性", () => {
  it("无效数字、负数和0不会产生NaN或Infinity", () => {
    const state = stateWithRooms("x", [
      [Number.NaN, 3600],
      [3600, 3600],
    ]);
    state.slab.innerWallThickness = -240;
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

describe("不等尺寸普通多房间分区", () => {
  it("X向排列为较高房间生成内墙与外墙混合锚固分区", () => {
    const state = stateWithRooms("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "x",
    )!;

    expect(result.lengthMode).toBe("zoned");
    expect(result.count).toBe(40);
    expect(result.lengthVariants).toHaveLength(2);
    expect(result.lengthVariants.map((variant) => ({
      range: [variant.perpendicularStartMm, variant.perpendicularEndMm],
      count: variant.count,
      sources: [variant.startAnchorSource, variant.endAnchorSource],
      singleLengthM: variant.singleLengthM,
    }))).toEqual([
      {
        range: [0, 3000],
        count: 20,
        sources: ["inner-wall", "outer-wall"],
        singleLengthM: 3.61,
      },
      {
        range: [3000, 6000],
        count: 20,
        sources: ["outer-wall", "outer-wall"],
        singleLengthM: 3.74,
      },
    ]);
    expect(result.totalLengthM).toBeCloseTo(147, 10);
    expect(result.singleLengthM).toBeCloseTo(147 / 40, 10);
  });

  it("不等尺寸面筋分区只给实际内墙区段叠加增加值", () => {
    const state = stateWithRooms("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    state.top.x.extraMode = "both";
    const result = calculateSlabResults(state).results.find(
      (item) => item.roomId === "room-1" && item.layer === "top" && item.direction === "x",
    )!;

    expect(result.lengthMode).toBe("zoned");
    expect(result.lengthVariants.map((variant) => ({
      range: [variant.perpendicularStartMm, variant.perpendicularEndMm],
      anchors: [variant.startAnchor, variant.endAnchor],
      extraApplied: [variant.startExtraApplied, variant.endExtraApplied],
      singleLengthM: variant.singleLengthM,
    }))).toEqual([
      {
        range: [0, 3000],
        anchors: [490, 370],
        extraApplied: [true, false],
        singleLengthM: 3.86,
      },
      {
        range: [3000, 6000],
        anchors: [370, 370],
        extraApplied: [false, false],
        singleLengthM: 3.74,
      },
    ]);
  });

  it("Y向排列按镜像规则为较宽房间生成分区", () => {
    const state = stateWithRooms("y", [
      [3000, 3000],
      [6000, 3000],
    ]);
    const result = calculateSlabResults(state).results.find(
      (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "y",
    )!;

    expect(result.lengthMode).toBe("zoned");
    expect(result.lengthVariants.map((variant) => [
      variant.perpendicularStartMm,
      variant.perpendicularEndMm,
      variant.startAnchorSource,
      variant.endAnchorSource,
    ])).toEqual([
      [0, 3000, "inner-wall", "outer-wall"],
      [3000, 6000, "outer-wall", "outer-wall"],
    ]);
  });

  it("中间房间两侧高度不同形成稳定的多边界组合ID", () => {
    const state = stateWithRooms("x", [
      [3000, 3000],
      [3000, 6000],
      [3000, 4500],
    ]);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "x",
    )!;
    const recalculated = calculateSlabResults(structuredClone(state)).results.find(
      (item) => item.id === result.id,
    )!;

    expect(result.lengthVariants.map((variant) => [
      variant.perpendicularStartMm,
      variant.perpendicularEndMm,
      variant.startAnchorSource,
      variant.endAnchorSource,
    ])).toEqual([
      [0, 3000, "inner-wall", "inner-wall"],
      [3000, 4500, "outer-wall", "inner-wall"],
      [4500, 6000, "outer-wall", "outer-wall"],
    ]);
    expect(result.lengthVariants.map((variant) => variant.id)).toEqual(
      recalculated.lengthVariants.map((variant) => variant.id),
    );
    expect(new Set(result.lengthVariants.map((variant) => variant.id)).size).toBe(3);
  });

  it("分区排筋位置分配严格保持父级根数、长度和重量不变量", () => {
    const state = stateWithRooms("x", [
      [3100, 3350],
      [4200, 6100],
      [2800, 4700],
    ]);
    state.slab.countMode = "round";
    const calculation = calculateSlabResults(state);
    const zoned = calculation.results.filter((result) => result.lengthMode === "zoned");

    expect(zoned.length).toBeGreaterThan(0);
    zoned.forEach((result) => {
      expect(result.lengthVariants.reduce((sum, variant) => sum + variant.count, 0)).toBe(result.count);
      expect(result.lengthVariants.reduce((sum, variant) => sum + variant.totalLengthM, 0)).toBe(result.totalLengthM);
      expect(result.lengthVariants.reduce((sum, variant) => sum + variant.weightKg, 0)).toBe(result.weightKg);
    });
    expect(calculation.results.reduce((sum, result) => sum + result.weightKg, 0)).toBe(calculation.totalWeightKg);
  });

  it("确定性排筋位置按区段统计且总数精确不变", () => {
    const positioned = allocateBarCountsByPosition(
      5,
      [
        { perpendicularStartMm: 0, perpendicularEndMm: 3000 },
        { perpendicularStartMm: 3000, perpendicularEndMm: 9000 },
      ],
      9000,
    );
    expect(positioned).toEqual([2, 3]);
    expect(positioned.reduce((sum, count) => sum + count, 0)).toBe(5);

    const allocated = allocateLargestRemainder(5, [3000, 6000]);
    expect(allocated).toEqual([2, 3]);
    expect(allocated.reduce((sum, count) => sum + count, 0)).toBe(5);
  });

  it.each(["project", "round", "floor"] as const)(
    "%s算法分区前后父级根数保持不变",
    (countMode) => {
      const state = stateWithRooms("x", [
        [3100, 3350],
        [4200, 6100],
        [2800, 4700],
      ]);
      state.slab.countMode = countMode;
      const result = calculateSlabResults(state).results.find(
        (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "x",
      )!;

      expect(result.count).toBe(countBars(6100, state.bottom.x.spacing, countMode));
      expect(result.lengthVariants.reduce((sum, variant) => sum + variant.count, 0))
        .toBe(result.count);
    },
  );

  it("手动锚固覆盖对应端全部分区且不叠加面筋增加值", () => {
    const state = stateWithRooms("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    state.slab.rooms[1].anchors.top.x.start = anchor("manual", 550);
    const result = calculateSlabResults(state).results.find(
      (item) => item.roomId === "room-1" && item.layer === "top" && item.direction === "x",
    )!;

    expect(result.lengthMode).toBe("uniform");
    expect(result.lengthVariants).toHaveLength(1);
    expect(result.lengthVariants[0].startAnchorSource).toBe("manual");
    expect(result.lengthVariants[0].startAnchor).toBe(550);
    expect(result.lengthVariants[0].startExtraApplied).toBe(false);
    expect(result.lengthVariants[0].endAnchor).toBe(370);
    expect(result.lengthVariants[0].endExtraApplied).toBe(false);
  });

  it("相同尺寸多房间保持原统一锚固和长度结果", () => {
    const state = stateWithRooms("x", [
      [4200, 3600],
      [3600, 3600],
      [3000, 3600],
    ]);
    const result = calculateSlabResults(state).results.find(
      (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "x",
    )!;

    expect(result.lengthMode).toBe("uniform");
    expect(result.lengthVariants).toHaveLength(1);
    expect(result.singleLengthM).toBeCloseTo(4.08, 12);
    expect(result.totalLengthM).toBeCloseTo(97.92, 12);
  });
});

describe("正式结果数值安全", () => {
  it("有限但会令宽度除以间距溢出的输入不会生成正式结果", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanY = 1e300;
    state.bottom.x.spacing = 1e-300;
    state.top.x.spacing = 1e-300;

    const calculation = calculateSlabResults(state);

    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
    expect(calculation.throughWall).toBeNull();
    expect(calculation.errors).toContain(
      "钢筋计算结果超出安全数值范围，请检查尺寸、间距、直径和锚固输入。",
    );
  });

  it("超过安全整数范围的有限根数被拒绝", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanY = Number.MAX_SAFE_INTEGER + 1;
    state.bottom.x.spacing = 1;
    state.top.x.spacing = 1;

    const calculation = calculateSlabResults(state);

    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });

  it("有限输入造成非有限总长度或重量时整个计算无效", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanX = Number.MAX_VALUE;
    state.slab.rooms[0].spanY = 1e9;
    state.bottom.x.spacing = 1;
    state.top.x.spacing = 1;
    state.bottom.y.spacing = Number.MAX_VALUE;
    state.top.y.spacing = Number.MAX_VALUE;

    const calculation = calculateSlabResults(state);

    expect(calculation.isValid).toBe(false);
    expect(calculation.results).toEqual([]);
    expect(calculation.totalWeightKg).toBeNull();
  });
});
