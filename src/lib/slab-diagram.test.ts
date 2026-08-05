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
  allocateRoomRepresentativeCounts,
  allocateVariantRepresentativeCounts,
  buildWorldLayout,
  buildSlabDiagramScene,
  collectWorldBounds,
  formatDiagramExtraLabel,
  getDiagramMarkerRect,
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
    const north = scene.walls.find(
      (wall) => wall.kind === "outer" && wall.orientation === "horizontal",
    )!;

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
    expect(scene.walls.some((wall) => wall.label.includes("待完善"))).toBe(true);
    expect(scene.rooms[0].label).toContain("待完善");
  });

  it("固定画布高度不随正式结果数量变化", () => {
    const single = cloneDefaultSlabCalculatorState();
    const many = roomsState(
      "x",
      Array.from({ length: 5 }, () => [3000, 3600]),
    );
    const singleCalculation = calculateSlabResults(single);
    const manyCalculation = calculateSlabResults(many);
    const oneResult = singleCalculation.results[0];

    const oneScene = buildSlabDiagramScene(single, singleCalculation, {
      visibleResultIds: new Set([oneResult.id]),
    });
    const manyScene = buildSlabDiagramScene(many, manyCalculation);

    expect(oneScene.width).toBe(1000);
    expect(oneScene.height).toBe(560);
    expect(manyScene.width).toBe(oneScene.width);
    expect(manyScene.height).toBe(oneScene.height);
    expect(manyScene.plotRect).toEqual(oneScene.plotRect);
  });
});

describe("阶梯墙体世界拓扑", () => {
  it("X向不等高房间的内墙只覆盖重叠区且高房间西侧上部为外墙", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    const layout = buildWorldLayout(state);
    const inner = layout.walls.find((wall) => wall.kind === "inner")!;
    const highRoom = layout.rooms[1];
    const exposedWest = layout.walls.find(
      (wall) =>
        wall.kind === "outer" &&
        wall.outward === "west" &&
        wall.adjacentRoomIds.includes(highRoom.id) &&
        wall.rect.y >= 3000 - 1e-8,
    );

    expect(inner.rect).toMatchObject({ x: 3000, y: 0, width: 240, height: 3000 });
    expect(exposedWest).toBeDefined();
    expect(exposedWest!.rect.y).toBeCloseTo(3000, 8);
    expect(exposedWest!.rect.height).toBeCloseTo(3000, 8);
    expect(
      layout.walls.some(
        (wall) => wall.kind === "inner" && wall.rect.y + wall.rect.height > 3000 + 1e-8,
      ),
    ).toBe(false);
  });

  it("Y向不等宽房间按镜像规则形成局部内墙和阶梯外轮廓", () => {
    const state = roomsState("y", [
      [3000, 3000],
      [6000, 3000],
    ]);
    const layout = buildWorldLayout(state);
    const inner = layout.walls.find((wall) => wall.kind === "inner")!;
    const wideRoom = layout.rooms[1];
    const exposedSouth = layout.walls.find(
      (wall) =>
        wall.kind === "outer" &&
        wall.outward === "south" &&
        wall.adjacentRoomIds.includes(wideRoom.id) &&
        wall.rect.x >= 3000 - 1e-8,
    );

    expect(inner.rect).toMatchObject({ x: 0, y: 3000, width: 3000, height: 240 });
    expect(exposedSouth).toBeDefined();
    expect(exposedSouth!.rect.x).toBeCloseTo(3000, 8);
    expect(exposedSouth!.rect.width).toBeCloseTo(3000, 8);
  });

  it("三间不等高房间的墙段坐标均有限且内墙互不贯穿空白区", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
      [3000, 4500],
    ]);
    const layout = buildWorldLayout(state);
    const inner = layout.walls.filter((wall) => wall.kind === "inner");

    expect(inner).toHaveLength(2);
    expect(inner.map((wall) => wall.rect.height)).toEqual([3000, 4500]);
    expect(layout.walls.every((wall) =>
      [wall.rect.x, wall.rect.y, wall.rect.width, wall.rect.height].every(Number.isFinite),
    )).toBe(true);
  });
});

describe("diagram geometry audit regressions", () => {
  it("fills the four convex outer-wall corners of a single room", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.outerWallThickness = 370;
    const layout = buildWorldLayout(state);
    const corners = layout.walls.filter(
      (wall) => wall.kind === "outer" && wall.orientation === "corner",
    );

    expect(corners).toHaveLength(4);
    expect(corners.map((wall) => wall.rect)).toEqual(
      expect.arrayContaining([
        { x: -370, y: -370, width: 370, height: 370 },
        { x: 4200, y: -370, width: 370, height: 370 },
        { x: -370, y: 3600, width: 370, height: 370 },
        { x: 4200, y: 3600, width: 370, height: 370 },
      ]),
    );
  });

  it("does not fill the concave notch of unequal X-arranged rooms", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    state.slab.innerWallThickness = 240;
    state.slab.outerWallThickness = 370;
    const layout = buildWorldLayout(state);
    const concavePatch = layout.walls.find(
      (wall) =>
        wall.orientation === "corner" &&
        Math.abs(wall.rect.x - (3240 - 370)) < 1e-8 &&
        Math.abs(wall.rect.y - 3000) < 1e-8,
    );

    expect(concavePatch).toBeUndefined();
  });

  it("maps formal variant coordinates into safely normalized room geometry", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].spanY = 2_000_000_000;
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "bottom" && item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });
    const room = scene.rooms[0].rect;

    expect(scene.barGroups[0].netSegments).not.toHaveLength(0);
    expect(scene.barGroups[0].netSegments.every((segment) =>
      segment.start.y >= room.y - 1e-8 &&
      segment.start.y <= room.y + room.height + 1e-8,
    )).toBe(true);
  });

  it("uses report-compatible result number width above 99 results", () => {
    const state = roomsState(
      "x",
      Array.from({ length: 25 }, () => [3000, 3600]),
    );
    const calculation = calculateSlabResults(state);
    const scene = buildSlabDiagramScene(state, calculation);

    expect(calculation.results).toHaveLength(100);
    expect(scene.barGroups[0].resultNumber).toBe("R001");
    expect(scene.barGroups.at(-1)!.resultNumber).toBe("R100");
  });

  it("creates stable per-variant diagram markers away from the room center", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) =>
        item.roomId === "room-1" &&
        item.layer === "bottom" &&
        item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });
    const group = scene.barGroups[0];
    const room = scene.rooms.find((item) => item.id === "room-1")!.rect;
    const roomCenterX = room.x + room.width / 2;

    expect(group.lengthMode).toBe("zoned");
    expect(group.markers.map((marker) => marker.label)).toEqual([
      `${group.resultNumber}-A`,
      `${group.resultNumber}-B`,
    ]);
    expect(group.markers.every((marker) => finitePoint(marker.point))).toBe(true);
    expect(group.markers.every((marker) => Math.abs(marker.point.x - roomCenterX) > 1)).toBe(true);
  });

  it("uses wall tangent length when deciding whether a wall label fits", () => {
    const state = roomsState("x", [
      [1000, 50],
      [1000, 50],
    ]);
    state.slab.innerWallThickness = 5000;
    state.slab.outerWallThickness = 100;
    const scene = buildSlabDiagramScene(state);
    const inner = scene.walls.find(
      (wall) => wall.kind === "inner" && wall.orientation === "vertical",
    )!;

    expect(inner.rect.width).toBeGreaterThan(72);
    expect(inner.rect.height).toBeLessThan(72);
    expect(inner.showLabel).toBe(false);
  });

  it("keeps narrow-room label boxes strictly inside their rooms", () => {
    const scene = buildSlabDiagramScene(
      roomsState("x", [
        [100, 3600],
        [10_000, 3600],
      ]),
    );

    expect(scene.rooms[0].labelRect.width).toBeLessThan(52);
    expect(scene.rooms.every((room) =>
      room.labelRect.x >= room.rect.x - 1e-8 &&
      room.labelRect.y >= room.rect.y - 1e-8 &&
      room.labelRect.x + room.labelRect.width <= room.rect.x + room.rect.width + 1e-8 &&
      room.labelRect.y + room.labelRect.height <= room.rect.y + room.rect.height + 1e-8,
    )).toBe(true);
  });

  it("lays out four single-room result badges without collisions", () => {
    const state = cloneDefaultSlabCalculatorState();
    const calculation = calculateSlabResults(state);
    const scene = buildSlabDiagramScene(state, calculation);
    const markers = scene.barGroups.flatMap((group) => group.markers);
    const markerRects = markers.map(getDiagramMarkerRect);
    const overlaps = (
      left: { x: number; y: number; width: number; height: number },
      right: { x: number; y: number; width: number; height: number },
    ) =>
      left.x < right.x + right.width &&
      left.x + left.width > right.x &&
      left.y < right.y + right.height &&
      left.y + left.height > right.y;

    expect(markers.map((marker) => marker.label)).toEqual([
      "R01",
      "R02",
      "R03",
      "R04",
    ]);
    for (let left = 0; left < markerRects.length; left += 1) {
      const rect = markerRects[left];
      expect([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)).toBe(true);
      expect(rect.x).toBeGreaterThanOrEqual(scene.plotRect.x);
      expect(rect.y).toBeGreaterThanOrEqual(scene.plotRect.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(scene.plotRect.x + scene.plotRect.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(scene.plotRect.y + scene.plotRect.height);
      expect(scene.rooms.every((room) => !overlaps(rect, room.labelRect))).toBe(true);
      expect(scene.walls.every((wall) => !overlaps(rect, wall.rect))).toBe(true);
      for (let right = left + 1; right < markerRects.length; right += 1) {
        expect(overlaps(rect, markerRects[right])).toBe(false);
      }
    }
  });
});

describe("正式结果代表线", () => {
  it("正式二维图例使用东西向和南北向且不显示X/Y方向旧称", () => {
    const state = cloneDefaultSlabCalculatorState();
    const scene = buildSlabDiagramScene(state, calculateSlabResults(state));
    const labels = scene.barGroups
      .map((group) => group.specificationLabel)
      .join(" ");

    expect(labels).toContain("东西向地筋");
    expect(labels).toContain("南北向地筋");
    expect(labels).toContain("东西向面筋");
    expect(labels).toContain("南北向面筋");
    expect(labels).not.toMatch(/X向|Y向|X方向|Y方向/);
  });

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

  it("分区代表线按正式分区根数分配且总数保持父级上限", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
    ]);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.roomId === "room-1" && item.layer === "bottom" && item.direction === "x",
    )!;
    const allocated = allocateVariantRepresentativeCounts(result, 5);
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
      maxLinesPerResult: 5,
    });

    expect(result.lengthMode).toBe("zoned");
    expect(allocated.reduce((sum, item) => sum + item.count, 0)).toBe(5);
    expect(scene.barGroups[0].representativeCount).toBe(5);
    expect(scene.barGroups[0].variants.map((variant) => variant.representativeCount)).toEqual(
      allocated.map((item) => item.count),
    );
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

  it("一端手动一端内墙时只显示内墙端的实际增加", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    state.slab.rooms[0].anchors.top.x.start = manualAnchor(550);
    state.slab.rooms[0].anchors.top.x.end = {
      source: "inner-wall",
      manualValue: 0,
      origin: "user",
    };
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

  it("两端外墙即使选择两端增加也不绘制橙色增加段", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "both";
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "top" && item.direction === "x",
    )!;
    const group = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    }).barGroups[0];

    expect([group.startExtraApplied, group.endExtraApplied]).toEqual([false, false]);
    expect(group.extraSegments).toHaveLength(0);
    expect(group.extraLabel).toBe("未实际叠加面筋增加值");
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
    expect(xCoordinates.filter((x) => x < innerWall.rect.x).length).toBe(2);
    expect(xCoordinates.filter((x) => x > innerWall.rect.x + innerWall.rect.width).length).toBe(3);
    const layout = buildWorldLayout(state);
    expect(allocateRoomRepresentativeCounts(layout.rooms, "x", 5)).toEqual([2, 3]);
  });

  it("长手动锚固和增加段进入完整边界且投影后都留在画布内", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.rooms[0].anchors.top.x.start = manualAnchor(50_000);
    state.slab.rooms[0].anchors.top.x.end = manualAnchor(75_000);
    const calculation = calculateSlabResults(state);
    const result = calculation.results.find(
      (item) => item.layer === "top" && item.direction === "x",
    )!;
    const scene = buildSlabDiagramScene(state, calculation, {
      visibleResultIds: new Set([result.id]),
    });
    const group = scene.barGroups[0];
    const allSegments = [
      ...group.netSegments,
      ...group.startAnchorSegments,
      ...group.endAnchorSegments,
      ...group.extraSegments,
    ];

    expect(group.startAnchorSegments.some((segment) => segment.compressed)).toBe(true);
    expect(group.endAnchorSegments.some((segment) => segment.compressed)).toBe(true);
    expect(allSegments.every((segment) =>
      [segment.start, segment.end].every((point) =>
        point.x >= scene.plotRect.x - 1e-6 &&
        point.x <= scene.plotRect.x + scene.plotRect.width + 1e-6 &&
        point.y >= scene.plotRect.y - 1e-6 &&
        point.y <= scene.plotRect.y + scene.plotRect.height + 1e-6,
      ),
    )).toBe(true);
    expect(scene.worldBounds.minX).toBeLessThan(0);
  });

  it("完整世界边界包含全部房间、墙体和钢筋端点", () => {
    const state = roomsState("x", [
      [3000, 3000],
      [3000, 6000],
      [3000, 4500],
    ]);
    const calculation = calculateSlabResults(state);
    const layout = buildWorldLayout(state);
    const scene = buildSlabDiagramScene(state, calculation);
    const bounds = collectWorldBounds(layout.rooms, layout.walls, []);

    expect([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)).toBe(true);
    expect(scene.rooms.every((room) =>
      room.rect.x >= scene.plotRect.x - 1e-6 &&
      room.rect.y >= scene.plotRect.y - 1e-6 &&
      room.rect.x + room.rect.width <= scene.plotRect.x + scene.plotRect.width + 1e-6 &&
      room.rect.y + room.rect.height <= scene.plotRect.y + scene.plotRect.height + 1e-6,
    )).toBe(true);
  });
});
