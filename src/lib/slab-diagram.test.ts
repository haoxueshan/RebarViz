import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  createDefaultRoomAnchorRules,
  synchronizeRoomAnchors,
  type AnchorRule,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
} from "./slab-calculator";
import {
  buildSlabDiagramScene,
  formatDiagramExtraLabel,
  getRepresentativeCount,
} from "./slab-diagram";

function roomsState(
  arrangement: RoomArrangement,
  dimensions: Array<[number, number]>,
): SlabCalculatorState {
  const state = cloneDefaultSlabCalculatorState();
  const rooms: SlabRoom[] = dimensions.map(([spanX, spanY], index) => ({
    id: `room-${index}`,
    name: `房间${index + 1}`,
    spanX,
    spanY,
    anchors: createDefaultRoomAnchorRules(
      arrangement,
      index,
      dimensions.length,
    ),
  }));
  state.slab.arrangement = arrangement;
  state.slab.rooms = synchronizeRoomAnchors(rooms, arrangement);
  return state;
}

function manualAnchor(value: number): AnchorRule {
  return { source: "manual", manualValue: value, origin: "user" };
}

function xThroughState(
  dimensions: Array<[number, number]> = [
    [4200, 3600],
    [3600, 3600],
  ],
): SlabCalculatorState {
  const state = roomsState("x", dimensions);
  state.through.enabled = true;
  state.through.direction = "x";
  return state;
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

describe("楼板二维场景坐标", () => {
  it("Y向排列第一间房位于最南侧且最后一间位于最北侧", () => {
    const state = roomsState("y", [
      [4200, 3000],
      [4200, 3600],
      [4200, 4800],
    ]);
    const scene = buildSlabDiagramScene(state);

    expect(scene.rooms[0].worldRect.y).toBeLessThan(
      scene.rooms.at(-1)!.worldRect.y,
    );
    expect(scene.rooms[0].rect.y).toBeGreaterThan(scene.rooms.at(-1)!.rect.y);
  });

  it("X向排列保持第一间在西、最后一间在东", () => {
    const scene = buildSlabDiagramScene(
      roomsState("x", [
        [3000, 3600],
        [4200, 3600],
        [5000, 3600],
      ]),
    );

    expect(scene.rooms[0].rect.x).toBeLessThan(scene.rooms[1].rect.x);
    expect(scene.rooms[1].rect.x).toBeLessThan(scene.rooms[2].rect.x);
  });

  it("3000mm与6000mm房间按1比2绘制净宽", () => {
    const scene = buildSlabDiagramScene(
      roomsState("x", [
        [3000, 3600],
        [6000, 3600],
      ]),
    );

    expect(scene.rooms[1].rect.width / scene.rooms[0].rect.width).toBeCloseTo(
      2,
      10,
    );
  });

  it("内外墙厚度进入几何比例", () => {
    const state = roomsState("x", [
      [3000, 3600],
      [6000, 3600],
    ]);
    state.slab.innerWallThickness = 240;
    state.slab.outerWallThickness = 370;
    const scene = buildSlabDiagramScene(state);
    const inner = scene.walls.find((wall) => wall.kind === "inner")!;
    const north = scene.walls.find((wall) => wall.id === "outer-north")!;

    expect(inner.rect.width / scene.scale).toBeCloseTo(240, 8);
    expect(north.rect.height / scene.scale).toBeCloseTo(370, 8);
  });

  it("非法或空尺寸只触发安全绘图回退且不产生无效SVG坐标", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanX = 0;
    state.slab.rooms[0].spanY = Number.NaN;
    state.slab.innerWallThickness = Number.POSITIVE_INFINITY;
    state.slab.outerWallThickness = -10;
    const scene = buildSlabDiagramScene(state);
    const rectangles = [
      scene.plotRect,
      ...scene.rooms.map((room) => room.rect),
      ...scene.walls.map((wall) => wall.rect),
    ];

    expect(Number.isFinite(scene.width)).toBe(true);
    expect(Number.isFinite(scene.height)).toBe(true);
    expect(Number.isFinite(scene.scale)).toBe(true);
    expect(rectangles.every((rect) =>
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
    )).toBe(true);
    expect(finitePoint(scene.xAxis.start)).toBe(true);
    expect(finitePoint(scene.yAxis.end)).toBe(true);
    expect(scene.notes.some((note) => note.includes("安全绘图回退值"))).toBe(true);
  });
});

describe("正式结果代表线", () => {
  it("找不到正式结果时代表线数量为0", () => {
    expect(getRepresentativeCount(undefined)).toBe(0);
    expect(getRepresentativeCount(null)).toBe(0);
  });

  it("普通面筋正式结果为1根时只生成1条代表线", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanY = 100;
    state.top.x.spacing = 200;
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "top" && item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });

    expect(result.count).toBe(1);
    expect(scene.barGroups).toHaveLength(1);
    expect(scene.barGroups[0].representativeCount).toBe(1);
    expect(scene.barGroups[0].netSegments).toHaveLength(1);
  });

  it("通墙正式结果为1根时只生成1条连续代表线", () => {
    const state = xThroughState([
      [4200, 100],
      [3600, 100],
    ]);
    state.top.x.spacing = 200;
    const calculation = calculateSlabResults(state);
    const result = calculation.throughWall!.throughBar;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });

    expect(result.count).toBe(1);
    expect(scene.barGroups[0].netSegments).toHaveLength(1);
    const line = scene.barGroups[0].netSegments[0];
    expect(line.start.x).toBeLessThan(scene.rooms[0].rect.x + 1);
    expect(line.end.x).toBeGreaterThan(
      scene.rooms.at(-1)!.rect.x + scene.rooms.at(-1)!.rect.width - 1,
    );
  });

  it("计算记录缺少某项BarResult时不回退绘制不存在的钢筋", () => {
    const state = cloneDefaultSlabCalculatorState();
    const calculation = calculateSlabResults(state);
    const removedId = "room-a-top-x";
    const partialCalculation = {
      ...calculation,
      results: calculation.results.filter((result) => result.id !== removedId),
    };
    const scene = buildSlabDiagramScene(state, partialCalculation);

    expect(scene.barGroups.some((group) => group.resultId === removedId)).toBe(false);
    expect(scene.barGroups).toHaveLength(3);
  });

  it("五间房每个正式结果至少保留一条且不受全局60条截断", () => {
    const state = roomsState(
      "x",
      Array.from({ length: 5 }, (_, index) => [
        3000 + index * 200,
        3600,
      ]),
    );
    const calculation = calculateSlabResults(state);
    const scene = buildSlabDiagramScene(state, calculation);
    const lastRoomGroups = scene.barGroups.filter(
      (group) => group.roomId === "room-4",
    );
    const totalNetLines = scene.barGroups.reduce(
      (sum, group) => sum + group.netSegments.length,
      0,
    );

    expect(scene.barGroups).toHaveLength(calculation.results.length);
    expect(scene.barGroups.every((group) => group.representativeCount >= 1)).toBe(true);
    expect(lastRoomGroups).toHaveLength(4);
    expect(totalNetLines).toBeGreaterThan(60);
  });

  it("空visibleResultIds不绘制任何钢筋", () => {
    const state = cloneDefaultSlabCalculatorState();
    const calculation = calculateSlabResults(state);
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set(),
    });

    expect(scene.barGroups).toEqual([]);
  });
});

describe("锚固、增加段与通墙选择", () => {
  it("两端手动且选择两端增加时不显示实际增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = manualAnchor(550);
    state.slab.rooms[0].anchors.top.x.end = manualAnchor(600);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "top" && item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });
    const group = scene.barGroups[0];

    expect(result.startExtraApplied).toBe(false);
    expect(result.endExtraApplied).toBe(false);
    expect(group.extraSegments).toHaveLength(0);
    expect(formatDiagramExtraLabel(result)).toContain("手动锚固为最终值");
    expect(group.extraLabel).not.toContain("两端实际增加");
  });

  it("一端手动一端自动时只显示自动端的实际增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = manualAnchor(550);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "top" && item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });
    const group = scene.barGroups[0];

    expect(group.startExtraApplied).toBe(false);
    expect(group.endExtraApplied).toBe(true);
    expect(group.extraSegments).toHaveLength(group.representativeCount);
    expect(group.extraSegments.every((segment) => segment.kind === "extra-end")).toBe(true);
    expect(group.extraLabel).toBe("东端实际增加250mm");
  });

  it("修改起点锚固后几何端点和真实标注同步变化", () => {
    const state100 = cloneDefaultSlabCalculatorState();
    state100.slab.rooms[0].anchors.bottom.x.start = manualAnchor(100);
    const calculation100 = calculateSlabResults(state100);
    const result100 = calculation100.results.find(
      (item) => item.layer === "bottom" && item.direction === "x",
    )!;
    const group100 = buildSlabDiagramScene(state100, calculation100, {
      visibleResultIds: new Set([result100.id]),
    }).barGroups[0];

    const state200 = structuredClone(state100);
    state200.slab.rooms[0].anchors.bottom.x.start.manualValue = 200;
    const calculation200 = calculateSlabResults(state200);
    const result200 = calculation200.results.find(
      (item) => item.layer === "bottom" && item.direction === "x",
    )!;
    const group200 = buildSlabDiagramScene(state200, calculation200, {
      visibleResultIds: new Set([result200.id]),
    }).barGroups[0];

    expect(group200.startAnchorSegments[0].start.x).toBeLessThan(
      group100.startAnchorSegments[0].start.x,
    );
    expect(group100.anchorLabel).toContain("100mm");
    expect(group200.anchorLabel).toContain("200mm");
  });

  it("通墙方向筋和垂直组合筋可通过ID分别显示", () => {
    const state = xThroughState();
    const calculation = calculateSlabResults(state);
    const through = calculation.throughWall!;
    const throughOnly = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([through.throughBar.id]),
    });
    const perpendicularOnly = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([through.perpendicularBar.id]),
    });

    expect(throughOnly.barGroups.map((group) => group.resultId)).toEqual([
      through.throughBar.id,
    ]);
    expect(perpendicularOnly.barGroups.map((group) => group.resultId)).toEqual([
      through.perpendicularBar.id,
    ]);
  });

  it("组合区垂直筋按各房间净跨分布且避开中间墙", () => {
    const state = xThroughState([
      [3000, 3600],
      [6000, 3600],
    ]);
    const calculation = calculateSlabResults(state);
    const perpendicular = calculation.throughWall!.perpendicularBar;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([perpendicular.id]),
      maxLinesPerResult: 5,
    });
    const innerWall = scene.walls.find((wall) => wall.kind === "inner")!;
    const xCoordinates = scene.barGroups[0].netSegments.map(
      (segment) => segment.start.x,
    );

    expect(xCoordinates).toHaveLength(5);
    expect(
      xCoordinates.every(
        (x) => x < innerWall.rect.x || x > innerWall.rect.x + innerWall.rect.width,
      ),
    ).toBe(true);
    expect(xCoordinates.filter((x) => x > innerWall.rect.x).length).toBeGreaterThan(
      xCoordinates.filter((x) => x < innerWall.rect.x).length,
    );
  });
});
