import { describe, expect, it } from "vitest";
import {
  clampViewportZoom,
  expandViewportBounds,
  FLOOR_CANVAS_MAX_ZOOM,
  FLOOR_CANVAS_MIN_ZOOM,
  panViewportByWorld,
  viewportForBounds,
  zoomViewportAt,
} from "./floor-canvas-viewport";
import {
  createFloorHistory,
  FLOOR_HISTORY_LIMIT,
  pushFloorHistory,
  redoFloorHistory,
  undoFloorHistory,
} from "./floor-history";

describe("Floor Canvas Viewport", () => {
  it("fit把zoom重置为1并居中", () => {
    expect(viewportForBounds({ minX: 0, minY: 0, maxX: 4200, maxY: 3600 }))
      .toEqual({ zoom: 1, centerX: 2100, centerY: 1800 });
  });

  it("锚点缩放保持锚点世界坐标不动", () => {
    const viewport = { zoom: 1, centerX: 2000, centerY: 1500 };
    const next = zoomViewportAt(viewport, 2, 2600, 1800);
    // 缩放后锚点仍在视口同一相对位置：center 应按比例远离锚点。
    expect((2600 - next.centerX) / (2600 - viewport.centerX)).toBeCloseTo(0.5, 9);
    expect((1800 - next.centerY) / (1800 - viewport.centerY)).toBeCloseTo(0.5, 9);
    expect(next.zoom).toBe(2);
  });

  it("zoom被限制在0.25~6", () => {
    const viewport = { zoom: 1, centerX: 0, centerY: 0 };
    expect(clampViewportZoom(0.01)).toBe(FLOOR_CANVAS_MIN_ZOOM);
    expect(clampViewportZoom(99)).toBe(FLOOR_CANVAS_MAX_ZOOM);
    expect(zoomViewportAt(viewport, 100, 0, 0).zoom).toBe(FLOOR_CANVAS_MAX_ZOOM);
    expect(zoomViewportAt(viewport, 0.0001, 0, 0).zoom).toBe(FLOOR_CANVAS_MIN_ZOOM);
  });

  it("pan只改变中心世界坐标", () => {
    const next = panViewportByWorld({ zoom: 2, centerX: 100, centerY: 200 }, 30, -40);
    expect(next).toEqual({ zoom: 2, centerX: 70, centerY: 240 });
  });

  it("上下文适配扩展范围保留相邻板区", () => {
    const expanded = expandViewportBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 800 }, 1.6);
    expect(expanded.minX).toBeCloseTo(-300, 9);
    expect(expanded.minY).toBeCloseTo(-240, 9);
    expect(expanded.maxX).toBeCloseTo(1300, 9);
    expect(expanded.maxY).toBeCloseTo(1040, 9);
  });
});

describe("Floor History", () => {
  it("push把present入past并清空future", () => {
    let history = createFloorHistory("a");
    history = pushFloorHistory(history, "b");
    history = pushFloorHistory(history, "c");
    expect(history).toEqual({ past: ["a", "b"], present: "c", future: [] });
  });

  it("undo/redo往返恢复且粒度精确", () => {
    let history = createFloorHistory("a");
    history = pushFloorHistory(history, "b");
    const undone = undoFloorHistory(history);
    expect(undone.value).toBe("a");
    expect(undone.history.present).toBe("a");
    const redone = redoFloorHistory(undone.history);
    expect(redone.value).toBe("b");
    expect(redone.history).toEqual({ past: ["a"], present: "b", future: [] });
  });

  it("undo到底部保持present", () => {
    const history = createFloorHistory("a");
    const result = undoFloorHistory(history);
    expect(result.value).toBe("a");
    expect(result.history.past).toEqual([]);
  });

  it("超过上限丢弃最旧", () => {
    let history = createFloorHistory(0);
    for (let index = 1; index <= FLOOR_HISTORY_LIMIT + 10; index += 1) {
      history = pushFloorHistory(history, index);
    }
    expect(history.past.length).toBe(FLOOR_HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
  });

  it("相同状态不产生历史条目", () => {
    const history = createFloorHistory({ x: 1 });
    expect(pushFloorHistory(history, history.present).past).toEqual([]);
  });
});
