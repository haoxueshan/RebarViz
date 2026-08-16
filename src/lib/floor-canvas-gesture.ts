import {
  panViewportByWorld,
  zoomViewportAt,
  type FloorCanvasViewport,
} from "./floor-canvas-viewport";

/**
 * Floor Canvas V2.1 手势纯函数层（PRD 86）：
 * 把 Pan / Pinch 的指针管理与数学计算从 FloorCanvas 中抽出，便于单元测试。
 *
 * 核心原则：
 * 1. PointerDown 不覆盖已存在的其他 Pointer（PRD 3-5）；
 * 2. 单指 Pan 采用增量位移，避免起点累计漂移（PRD 14-15 方案A）；
 * 3. 双指 Pinch 采用“绝对基准”方案（PRD 15 方案B）：每帧都从双指落下时的
 *    baseline 重新推导 视口 = Pan(总中心位移) → Zoom(总距离比例)，
 *    避免两根手指的 pointermove 先后到达时产生中间态缩放误差。
 */

export type FloorCanvasPointer = {
  id: number;
  clientX: number;
  clientY: number;
  previousClientX: number;
  previousClientY: number;
};

export type FloorCanvasGestureMode = "idle" | "pan" | "pinch";

export type FloorCanvasGestureState = {
  pointers: Map<number, FloorCanvasPointer>;
  mode: FloorCanvasGestureMode;
  /** Pinch 基线视口：双指落下瞬间的视口。 */
  startViewport: FloorCanvasViewport;
  /** Pinch 基线有效比例（scale × zoom）。 */
  startEffectiveScale: number;
  /** 基线双指中心（单指时为落点），用于点击阈值与 Pinch 总位移。 */
  startCenterClientX: number;
  startCenterClientY: number;
  /** 基线双指距离；单指模式为 null。 */
  startDistance: number | null;
  /** 累计位移是否超过点击阈值；用于区分点击与拖动。 */
  moved: boolean;
};

/** 屏幕像素 → 世界坐标换算所需的画布信息。 */
export type FloorCanvasGestureContext = {
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  svgWidth: number;
  svgHeight: number;
  plotCenterX: number;
  plotCenterY: number;
  effectiveScale: number;
};

/** 空白点击判定阈值：累计位移不超过该值视为点击而非 Pan。 */
export const FLOOR_CANVAS_PAN_CLICK_THRESHOLD_PX = 4;

export function floorPointerDistance(
  first: { clientX: number; clientY: number },
  second: { clientX: number; clientY: number },
): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

export function floorPointerCenter(
  first: { clientX: number; clientY: number },
  second: { clientX: number; clientY: number },
): { x: number; y: number } {
  return { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
}

/** 屏幕位移增量 → 世界坐标位移增量（Pan 使用）。 */
export function floorCanvasPanDeltaWorld(
  context: FloorCanvasGestureContext,
  dxScreen: number,
  dyScreen: number,
): { worldDx: number; worldDy: number } {
  const scale = Math.max(context.effectiveScale, 1e-9);
  return {
    worldDx: dxScreen / Math.max(context.rectWidth / context.svgWidth, 1e-9) / scale,
    worldDy: dyScreen / Math.max(context.rectHeight / context.svgHeight, 1e-9) / scale,
  };
}

function newFloorCanvasPointer(id: number, clientX: number, clientY: number): FloorCanvasPointer {
  return { id, clientX, clientY, previousClientX: clientX, previousClientY: clientY };
}

/** 第一根手指：创建手势，模式为 Pan。 */
export function createFloorCanvasGesture(
  viewport: FloorCanvasViewport,
  effectiveScale: number,
  id: number,
  clientX: number,
  clientY: number,
): FloorCanvasGestureState {
  const pointer = newFloorCanvasPointer(id, clientX, clientY);
  return {
    pointers: new Map([[id, pointer]]),
    mode: "pan",
    startViewport: viewport,
    startEffectiveScale: effectiveScale,
    startCenterClientX: clientX,
    startCenterClientY: clientY,
    startDistance: null,
    moved: false,
  };
}

/**
 * 第二根手指：加入现有手势并切换为 Pinch，
 * 以“当下”的视口/双指中心/双指距离重建 Pinch 基线。
 * 不得清空/覆盖已存在的第一根手指（PRD 3-5）。
 */
export function addFloorCanvasGesturePointer(
  gesture: FloorCanvasGestureState,
  viewport: FloorCanvasViewport,
  effectiveScale: number,
  id: number,
  clientX: number,
  clientY: number,
): FloorCanvasGestureState | null {
  if (gesture.pointers.has(id)) return gesture;
  const pointer = newFloorCanvasPointer(id, clientX, clientY);
  const pointers = new Map(gesture.pointers);
  pointers.set(id, pointer);
  if (pointers.size >= 2) {
    const [first, second] = [...pointers.values()];
    const center = floorPointerCenter(first, second);
    return {
      ...gesture,
      pointers,
      mode: "pinch",
      startViewport: viewport,
      startEffectiveScale: effectiveScale,
      startCenterClientX: center.x,
      startCenterClientY: center.y,
      startDistance: floorPointerDistance(first, second),
    };
  }
  return { ...gesture, pointers };
}

/** 基线双指中心在“基线视口”下的世界坐标（缩放锚点）。 */
function gesturePinchAnchor(
  gesture: FloorCanvasGestureState,
  context: FloorCanvasGestureContext,
): { x: number; y: number } {
  const scale = Math.max(gesture.startEffectiveScale, 1e-9);
  const startViewX = (gesture.startCenterClientX - context.rectLeft) / context.rectWidth * context.svgWidth;
  const startViewY = (gesture.startCenterClientY - context.rectTop) / context.rectHeight * context.svgHeight;
  return {
    x: gesture.startViewport.centerX + (startViewX - context.plotCenterX) / scale,
    y: gesture.startViewport.centerY - (startViewY - context.plotCenterY) / scale,
  };
}

export type FloorCanvasGestureUpdate = {
  gesture: FloorCanvasGestureState;
  viewport: FloorCanvasViewport;
};

/**
 * 指针移动。
 * - 双指（PRD 6/7/15方案B）：从Pinch基线绝对推导
 *    视口 = Pan(基线视口, 总中心位移) → ZoomAt(总距离比例, 基线锚点)，
 *    双指内容同时跟随手指并缩放，中间事件顺序不影响最终结果。
 * - 单指：增量 Pan（PRD 14-15 方案A），不存在从起点累计的漂移。
 */
export function updateFloorCanvasGesture(
  gesture: FloorCanvasGestureState,
  id: number,
  clientX: number,
  clientY: number,
  context: FloorCanvasGestureContext,
  currentViewport: FloorCanvasViewport,
): FloorCanvasGestureUpdate | null {
  const pointer = gesture.pointers.get(id);
  if (!pointer) return null;
  const updated: FloorCanvasPointer = {
    ...pointer,
    previousClientX: pointer.clientX,
    previousClientY: pointer.clientY,
    clientX,
    clientY,
  };
  const pointers = new Map(gesture.pointers);
  pointers.set(id, updated);

  if (pointers.size >= 2) {
    const [first, second] = [...pointers.values()];
    const center = floorPointerCenter(first, second);
    const totalDxScreen = center.x - gesture.startCenterClientX;
    const totalDyScreen = center.y - gesture.startCenterClientY;
    const baseline: FloorCanvasGestureContext = {
      ...context,
      effectiveScale: gesture.startEffectiveScale,
    };
    const totalDelta = floorCanvasPanDeltaWorld(baseline, totalDxScreen, totalDyScreen);
    let next = panViewportByWorld(gesture.startViewport, totalDelta.worldDx, -totalDelta.worldDy);
    if (gesture.startDistance !== null && gesture.startDistance > 0) {
      const currentDistance = floorPointerDistance(first, second);
      const anchor = gesturePinchAnchor(gesture, context);
      next = zoomViewportAt(next, currentDistance / gesture.startDistance, anchor.x, anchor.y);
    }
    const moved = gesture.moved || Math.abs(totalDxScreen) + Math.abs(totalDyScreen) > FLOOR_CANVAS_PAN_CLICK_THRESHOLD_PX;
    return { gesture: { ...gesture, pointers, mode: "pinch", moved }, viewport: next };
  }

  const dxScreen = updated.clientX - updated.previousClientX;
  const dyScreen = updated.clientY - updated.previousClientY;
  const totalDx = clientX - gesture.startCenterClientX;
  const totalDy = clientY - gesture.startCenterClientY;
  const moved = gesture.moved
    || Math.abs(totalDx) + Math.abs(totalDy) > FLOOR_CANVAS_PAN_CLICK_THRESHOLD_PX;
  if (!moved) {
    return { gesture: { ...gesture, pointers }, viewport: currentViewport };
  }
  const delta = floorCanvasPanDeltaWorld(context, dxScreen, dyScreen);
  const next = panViewportByWorld(currentViewport, delta.worldDx, -delta.worldDy);
  return {
    gesture: { ...gesture, pointers, mode: "pan", moved },
    viewport: next,
  };
}

/**
 * 指针抬起：删除该指针。
 * 剩余 1 根 → 从 pinch 切换回 pan（PRD 8）；
 * 全部抬起 → 返回 null，手势结束。
 */
export function removeFloorCanvasGesturePointer(
  gesture: FloorCanvasGestureState,
  pointerId: number,
): FloorCanvasGestureState | null {
  if (!gesture.pointers.has(pointerId)) return gesture;
  const pointers = new Map(gesture.pointers);
  pointers.delete(pointerId);
  if (pointers.size === 0) return null;
  if (pointers.size === 1) {
    // PRD 77：Pinch→Pan 重建单指基线，避免后续阈值/位移受旧Pinch中心影响。
    const remaining = [...pointers.values()][0];
    return {
      ...gesture,
      pointers,
      mode: "pan",
      startDistance: null,
      startCenterClientX: remaining.clientX,
      startCenterClientY: remaining.clientY,
    };
  }
  return { ...gesture, pointers };
}
