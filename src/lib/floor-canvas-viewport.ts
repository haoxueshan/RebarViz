export type FloorCanvasViewport = {
  /** 相对基础适配的缩放倍数；1 表示与“适合楼层/选中/全部”一致。 */
  zoom: number;
  /** 画布中心显示的世界坐标（X）。 */
  centerX: number;
  /** 画布中心显示的世界坐标（Y）。 */
  centerY: number;
};

export const FLOOR_CANVAS_MIN_ZOOM = 0.25;
export const FLOOR_CANVAS_MAX_ZOOM = 6;
export const FLOOR_CANVAS_ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function clampViewportZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(FLOOR_CANVAS_MAX_ZOOM, Math.max(FLOOR_CANVAS_MIN_ZOOM, zoom));
}

/**
 * 以世界坐标锚点为中心缩放：锚点在缩放前后保持在同一屏幕位置。
 * 不修改任何 FloorPlan 坐标，只改变 View Transform。
 */
export function zoomViewportAt(
  viewport: FloorCanvasViewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): FloorCanvasViewport {
  const nextZoom = clampViewportZoom(viewport.zoom * factor);
  if (nextZoom === viewport.zoom) return viewport;
  const ratio = viewport.zoom / nextZoom;
  return {
    zoom: nextZoom,
    centerX: anchorX - (anchorX - viewport.centerX) * ratio,
    centerY: anchorY - (anchorY - viewport.centerY) * ratio,
  };
}

export function panViewportByWorld(
  viewport: FloorCanvasViewport,
  deltaWorldX: number,
  deltaWorldY: number,
): FloorCanvasViewport {
  return {
    ...viewport,
    centerX: viewport.centerX - deltaWorldX,
    centerY: viewport.centerY - deltaWorldY,
  };
}

export type FloorCanvasViewportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** 适配给定世界范围：zoom 重置为 1，中心对准范围中心（与现有Fit渲染完全一致）。 */
export function viewportForBounds(bounds: FloorCanvasViewportBounds): FloorCanvasViewport {
  return {
    zoom: 1,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };
}

/** 选择上下文适配：范围外扩 padding 比例（PRD 31：保留相邻板区）。 */
export function expandViewportBounds(
  bounds: FloorCanvasViewportBounds,
  contextFactor: number,
): FloorCanvasViewportBounds {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const padX = (width * (contextFactor - 1)) / 2;
  const padY = (height * (contextFactor - 1)) / 2;
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}
