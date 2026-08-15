import { describe, expect, it } from "vitest";
import {
  addFloorCanvasGesturePointer,
  createFloorCanvasGesture,
  floorCanvasPanDeltaWorld,
  floorPointerCenter,
  floorPointerDistance,
  removeFloorCanvasGesturePointer,
  updateFloorCanvasGesture,
  type FloorCanvasGestureContext,
} from "./floor-canvas-gesture";
import type { FloorCanvasViewport } from "./floor-canvas-viewport";

const CONTEXT: FloorCanvasGestureContext = {
  rectLeft: 0,
  rectTop: 0,
  rectWidth: 1000,
  rectHeight: 650,
  svgWidth: 1000,
  svgHeight: 650,
  plotCenterX: 500,
  plotCenterY: 314,
  effectiveScale: 1,
};

const VIEWPORT: FloorCanvasViewport = { zoom: 1, centerX: 0, centerY: 0 };

describe("floor-canvas-gesture 指针数学", () => {
  it("计算两指距离与中心", () => {
    expect(floorPointerDistance({ clientX: 0, clientY: 0 }, { clientX: 30, clientY: 40 })).toBeCloseTo(50);
    expect(floorPointerCenter({ clientX: 0, clientY: 0 }, { clientX: 30, clientY: 40 })).toEqual({ x: 15, y: 20 });
  });

  it("屏幕增量换算为世界增量（依赖视口缩放）", () => {
    const delta = floorCanvasPanDeltaWorld(CONTEXT, 10, 10);
    expect(delta.worldDx).toBeCloseTo(10);
    expect(delta.worldDy).toBeCloseTo(10);
    const zoomed = floorCanvasPanDeltaWorld({ ...CONTEXT, effectiveScale: 2 }, 10, 10);
    expect(zoomed.worldDx).toBeCloseTo(5);
    expect(zoomed.worldDy).toBeCloseTo(5);
  });
});

describe("floor-canvas-gesture 手势生命周期（PRD 67）", () => {
  it("第一根手指创建Pan手势，第二根加入后pinch且size=2（不覆盖第一根）", () => {
    const gesture = createFloorCanvasGesture(VIEWPORT, 1, 1, 100, 100);
    expect(gesture.mode).toBe("pan");
    expect(gesture.pointers.size).toBe(1);
    const pinch = addFloorCanvasGesturePointer(gesture, VIEWPORT, 1, 2, 200, 100)!;
    expect(pinch.mode).toBe("pinch");
    expect(pinch.pointers.size).toBe(2);
    expect(pinch.pointers.has(1)).toBe(true);
    expect(pinch.startDistance).toBeCloseTo(100);
  });

  it("双指张开触发Zoom（以双指中心为锚点），pointermove先后到达不影响结果", () => {
    const gesture = addFloorCanvasGesturePointer(
      createFloorCanvasGesture(VIEWPORT, 1, 1, 200, 200),
      VIEWPORT, 1, 2, 300, 200,
    )!;
    const first = updateFloorCanvasGesture(gesture, 1, 200, 200, CONTEXT, VIEWPORT)!;
    const second = updateFloorCanvasGesture(first.gesture, 2, 400, 200, CONTEXT, first.viewport)!;
    expect(second.viewport.zoom).toBeCloseTo(2);
    // 双指中心从250→300（+50px），内容跟随手指右移。
    expect(second.viewport.centerX).toBeLessThan(0);
  });

  it("双指等距平移：只Pan不Zoom，与一次到位结果一致（PRD 7/68）", () => {
    const gesture = addFloorCanvasGesturePointer(
      createFloorCanvasGesture(VIEWPORT, 1, 1, 200, 200),
      VIEWPORT, 1, 2, 300, 200,
    )!;
    const first = updateFloorCanvasGesture(gesture, 1, 250, 200, CONTEXT, VIEWPORT)!;
    const second = updateFloorCanvasGesture(first.gesture, 2, 350, 200, CONTEXT, first.viewport)!;
    expect(second.viewport.zoom).toBeCloseTo(1);
    expect(second.viewport.centerX).toBeCloseTo(-50);
    expect(second.viewport.centerY).toBeCloseTo(0);
  });

  it("双指等距平移与缩放叠加：内容保持跟随手指", () => {
    const gesture = addFloorCanvasGesturePointer(
      createFloorCanvasGesture(VIEWPORT, 1, 1, 200, 200),
      VIEWPORT, 1, 2, 300, 200,
    )!;
    // 两指最终位置 (240,200)&(360,200)：中心+50px，距离120（×1.2）。
    const first = updateFloorCanvasGesture(gesture, 1, 240, 200, CONTEXT, VIEWPORT)!;
    const second = updateFloorCanvasGesture(first.gesture, 2, 360, 200, CONTEXT, first.viewport)!;
    expect(second.viewport.zoom).toBeCloseTo(1.2);
    // 世界点 -300 应位于屏幕 240px 处：500 + (-300 - centerX) * 1.2 = 240 → centerX = -83.333
    expect(second.viewport.centerX).toBeCloseTo(-250 / 3);
  });

  it("一根抬起后保留另一根并切回Pan，全部抬起手势结束（PRD 8）", () => {
    const gesture = addFloorCanvasGesturePointer(
      createFloorCanvasGesture(VIEWPORT, 1, 1, 200, 200),
      VIEWPORT, 1, 2, 300, 200,
    )!;
    const remaining = removeFloorCanvasGesturePointer(gesture, 2)!;
    expect(remaining.mode).toBe("pan");
    expect(remaining.pointers.size).toBe(1);
    expect(remaining.pointers.has(1)).toBe(true);
    expect(removeFloorCanvasGesturePointer(remaining, 1)).toBeNull();
  });

  it("单指增量Pan无累积漂移：20px+20px = 40px 而不是 60px（PRD 68）", () => {
    const gesture = createFloorCanvasGesture(VIEWPORT, 1, 1, 100, 100);
    const first = updateFloorCanvasGesture(gesture, 1, 120, 100, CONTEXT, VIEWPORT)!;
    expect(first.viewport.centerX).toBeCloseTo(-20);
    const second = updateFloorCanvasGesture(first.gesture, 1, 140, 100, CONTEXT, first.viewport)!;
    expect(second.viewport.centerX).toBeCloseTo(-40);
    // 与单次60px移动完全一致。
    const once = updateFloorCanvasGesture(
      createFloorCanvasGesture(VIEWPORT, 1, 1, 100, 100),
      1, 160, 100, CONTEXT, VIEWPORT,
    )!;
    expect(once.viewport.centerX).toBeCloseTo(-60);
  });

  it("单指Pan不会改变zoom，且moved阈值内视为点击", () => {
    const gesture = createFloorCanvasGesture(VIEWPORT, 1, 1, 100, 100);
    const tiny = updateFloorCanvasGesture(gesture, 1, 103, 100, CONTEXT, VIEWPORT)!;
    expect(tiny.gesture.moved).toBe(false);
    expect(tiny.viewport).toEqual(VIEWPORT);
    const moving = updateFloorCanvasGesture(tiny.gesture, 1, 107, 100, CONTEXT, tiny.viewport)!;
    expect(moving.gesture.moved).toBe(true);
    expect(moving.viewport.zoom).toBeCloseTo(1);
  });

  it("更新未知指针返回null，移除未知指针保持原手势", () => {
    const gesture = createFloorCanvasGesture(VIEWPORT, 1, 1, 100, 100);
    expect(updateFloorCanvasGesture(gesture, 99, 10, 10, CONTEXT, VIEWPORT)).toBeNull();
    expect(removeFloorCanvasGesturePointer(gesture, 99)).toBe(gesture);
  });
});
