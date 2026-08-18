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

/** 当前 Viewport 覆盖的世界范围（effectiveScale = scale × zoom）。 */
export function floorViewportWorldBounds(
  viewport: FloorCanvasViewport,
  effectiveScale: number,
  plotWidthMm: number,
  plotHeightMm: number,
): FloorCanvasViewportBounds {
  const safeScale = Math.max(effectiveScale, 1e-9);
  const halfWidthMm = plotWidthMm / safeScale / 2;
  const halfHeightMm = plotHeightMm / safeScale / 2;
  return {
    minX: viewport.centerX - halfWidthMm,
    minY: viewport.centerY - halfHeightMm,
    maxX: viewport.centerX + halfWidthMm,
    maxY: viewport.centerY + halfHeightMm,
  };
}

const ENSURE_VISIBLE_EPSILON = 1e-6;

/**
 * Ensure Visible（V1.3.1）：把对象带到当前可视区域内，尽量不改变观察尺度。
 * - 规则A：对象已完整可见 → 返回原 Viewport（Zoom/Center 完全不变）；
 * - 规则B/C：部分/完全在视口外 → 只平移 Center 进入安全边距，Zoom 不变；
 * - 规则D：对象大于当前视口 → 允许必要 Zoom Out，禁止 Zoom In。
 */
export function ensureFloorBoundsVisible(
  viewport: FloorCanvasViewport,
  effectiveScale: number,
  objectBounds: FloorCanvasViewportBounds,
  plotWidthMm: number,
  plotHeightMm: number,
  options?: { marginRatio?: number },
): FloorCanvasViewport {
  const marginRatio = options?.marginRatio ?? 0.1;
  const safeScale = Math.max(effectiveScale, 1e-9);
  const viewWidthMm = plotWidthMm / safeScale;
  const viewHeightMm = plotHeightMm / safeScale;
  const visible = floorViewportWorldBounds(viewport, safeScale, plotWidthMm, plotHeightMm);
  if (
    objectBounds.minX >= visible.minX - ENSURE_VISIBLE_EPSILON
    && objectBounds.maxX <= visible.maxX + ENSURE_VISIBLE_EPSILON
    && objectBounds.minY >= visible.minY - ENSURE_VISIBLE_EPSILON
    && objectBounds.maxY <= visible.maxY + ENSURE_VISIBLE_EPSILON
  ) {
    return viewport;
  }
  const safe = {
    minX: visible.minX + viewWidthMm * marginRatio,
    maxX: visible.maxX - viewWidthMm * marginRatio,
    minY: visible.minY + viewHeightMm * marginRatio,
    maxY: visible.maxY - viewHeightMm * marginRatio,
  };
  const objectWidth = Math.max(objectBounds.maxX - objectBounds.minX, 1);
  const objectHeight = Math.max(objectBounds.maxY - objectBounds.minY, 1);
  const safeWidth = Math.max(safe.maxX - safe.minX, 1);
  const safeHeight = Math.max(safe.maxY - safe.minY, 1);
  if (objectWidth <= safeWidth && objectHeight <= safeHeight) {
    // 规则 B/C：只平移，Zoom 保持不变。
    const overflowLeft = safe.minX - objectBounds.minX;
    const overflowRight = objectBounds.maxX - safe.maxX;
    const overflowBottom = safe.minY - objectBounds.minY;
    const overflowTop = objectBounds.maxY - safe.maxY;
    const deltaX = (overflowRight - overflowLeft) / 2;
    const deltaY = (overflowTop - overflowBottom) / 2;
    if (Math.abs(deltaX) <= ENSURE_VISIBLE_EPSILON && Math.abs(deltaY) <= ENSURE_VISIBLE_EPSILON) return viewport;
    return {
      zoom: viewport.zoom,
      centerX: viewport.centerX + deltaX,
      centerY: viewport.centerY + deltaY,
    };
  }
  // 规则 D：对象比视口还大 → 适度 Zoom Out（禁止 Zoom In）。
  const factor = Math.min(safeWidth / objectWidth, safeHeight / objectHeight);
  const nextZoom = clampViewportZoom(viewport.zoom * Math.min(factor, 1));
  return {
    zoom: nextZoom,
    centerX: (objectBounds.minX + objectBounds.maxX) / 2,
    centerY: (objectBounds.minY + objectBounds.maxY) / 2,
  };
}
