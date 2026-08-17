"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFloorAtomicBoundarySegments,
  buildFloorDisplayBoundarySegments,
  findFloorSlabNearMisses,
  type FloorAtomicBoundarySegment,
  type FloorBoundarySegment,
  type FloorOpening,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSlab,
} from "@/lib/floor-plan";
import {
  calculateFloorCanvasBounds,
  chooseFloorGridStep,
  floorOpeningTouchesFloor,
  type FloorCanvasFitMode,
} from "@/lib/floor-2d";
import {
  expandViewportBounds,
  viewportForBounds,
  zoomViewportAt,
  type FloorCanvasViewport,
} from "@/lib/floor-canvas-viewport";
import {
  addFloorCanvasGesturePointer,
  createFloorCanvasGesture,
  removeFloorCanvasGesturePointer,
  updateFloorCanvasGesture,
  type FloorCanvasGestureState,
} from "@/lib/floor-canvas-gesture";
import {
  floorDockDirectionLabel,
  previewFloorDock,
  type FloorDockDirection,
  type FloorDockPreview,
  type FloorDockRequest,
} from "@/lib/floor-docking";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";
import {
  floorBarRoleLabel,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import type { FloorBarPiece } from "@/lib/floor-rebar-types";
import { FloorCanvasToolbar, type FloorCanvasAxisLock } from "./FloorCanvasToolbar";

export type FloorSelection =
  | { kind: "slab"; id: string }
  | { kind: "opening"; id: string }
  | null;

type DragState = {
  pointerId: number;
  pointerType: string;
  selection: Exclude<FloorSelection, null>;
  startClientX: number;
  startClientY: number;
  /** 指针最近一次位置（用于双指升级 Pinch 时重建基线，PRD 41）。 */
  lastClientX: number;
  lastClientY: number;
  startX: number;
  startY: number;
  pixelsPerWorldX: number;
  pixelsPerWorldY: number;
  activated: boolean;
  moved: boolean;
};

type FloorDragGuide = {
  axis: "x" | "y";
  coordinate: number;
  targetSlabId: string;
  targetSlabName: string;
  targetSide: "west" | "east" | "south" | "north";
  gapMm: number;
};

type DrawablePiece = {
  piece: FloorBarPiece;
  positionMm: number;
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 650;
// UI V3（PRD 33-35）：Plot 占 SVG 宽度 93.6%、高度 91.4%，不再保留四周大空白。
const PLOT = { x: 32, y: 28, width: 936, height: 594 };
const PLOT_CENTER_X = PLOT.x + PLOT.width / 2;
const PLOT_CENTER_Y = PLOT.y + PLOT.height / 2;
const TOUCH_DRAG_THRESHOLD_PX = 10;

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * preserveAspectRatio="xMidYMid meet" 存在 letterbox：
 * 屏幕像素 ↔ 世界坐标换算必须使用内容盒而非容器盒，否则拖放/Pan/滚轮出现比例误差。
 */
function svgContentRect(rect: DOMRect) {
  const contentWidth = Math.min(rect.width, rect.height * SVG_WIDTH / SVG_HEIGHT);
  const contentHeight = Math.min(rect.height, rect.width * SVG_HEIGHT / SVG_WIDTH);
  return {
    left: rect.left + (rect.width - contentWidth) / 2,
    top: rect.top + (rect.height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  };
}

function wallStyle(segment: FloorBoundarySegment, scale: number) {
  if (segment.support === "outer-wall") return { stroke: "#0f172a", width: Math.max(4, Math.min(12, segment.thicknessMm * scale)), dash: undefined };
  if (segment.support === "inner-wall") return { stroke: "#2563eb", width: Math.max(4, Math.min(11, segment.thicknessMm * scale)), dash: undefined };
  if (segment.support === "continuous") return { stroke: "#64748b", width: 2.5, dash: "11 7" };
  return { stroke: "#94a3b8", width: 3, dash: "5 6" };
}

function slabFill(type: FloorSlab["type"], selected: boolean): string {
  if (selected) return "#dbeafe";
  if (type === "corridor") return "#ecfeff";
  if (type === "hall") return "#f5f3ff";
  if (type === "balcony") return "#f0fdf4";
  return "#f8fafc";
}

function supportLabel(support: FloorResolvedSupport): string {
  if (support === "outer-wall") return "外墙";
  if (support === "inner-wall") return "内墙";
  if (support === "opening-cut") return "洞口裁断";
  return "连续板边";
}

function endpointLabel(direction: "x" | "y", endpoint: "start" | "end"): string {
  if (direction === "x") return endpoint === "start" ? "西端" : "东端";
  return endpoint === "start" ? "南端" : "北端";
}

function gridCoordinates(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + step * 1e-7 && values.length < 200; value += step) values.push(value);
  return values;
}

function FloorPieceInspector({
  piece,
  throughPathName,
}: {
  piece: FloorBarPiece;
  throughPathName?: string;
}) {
  const top = piece.layer === "top";
  const through = piece.source === "through";
  return (
    <section className="border-t border-slate-200 bg-white p-4" data-testid="floor-piece-inspector" data-piece-id={piece.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">钢筋 Piece 检查</p>
          <h3 className="mt-1 font-semibold text-slate-950">
            {through ? `${throughPathName ?? "通墙路径"} · 通墙面筋` : top ? "普通面筋" : "地筋"}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{floorBarRoleLabel(piece.role)} · {piece.direction === "x" ? "东西向" : "南北向"}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-slate-500">规格</dt><dd className="font-semibold text-slate-900">Φ{piece.diameter}@{piece.spacing}</dd></div>
        <div><dt className="text-xs text-slate-500">净跨</dt><dd className="font-semibold text-slate-900">{formatMm(piece.netLengthMm)} mm</dd></div>
        <div><dt className="text-xs text-slate-500">{endpointLabel(piece.direction, "start")}</dt><dd className="font-semibold text-slate-900">{supportLabel(piece.startSupport)} {formatMm(piece.startAnchorMm)} mm{piece.startExtraApplied ? "（含增加）" : ""}</dd></div>
        <div><dt className="text-xs text-slate-500">{endpointLabel(piece.direction, "end")}</dt><dd className="font-semibold text-slate-900">{supportLabel(piece.endSupport)} {formatMm(piece.endAnchorMm)} mm{piece.endExtraApplied ? "（含增加）" : ""}</dd></div>
        {through && <>
          <div><dt className="text-xs text-slate-500">中间穿墙</dt><dd className="font-semibold text-slate-900">{formatMm(piece.intermediateWallMm)} mm</dd></div>
          <div><dt className="text-xs text-slate-500">中间墙数</dt><dd className="font-semibold text-slate-900">{piece.intermediateBoundaryIds.length}</dd></div>
        </>}
        {top && <div><dt className="text-xs text-slate-500">面筋增加</dt><dd className="font-semibold text-slate-900">{piece.startExtraApplied || piece.endExtraApplied ? `${formatMm(piece.topExtraValueMm)} mm` : "未生效"}</dd></div>}
        <div><dt className="text-xs text-slate-500">正式下料</dt><dd className="font-bold text-blue-700">{formatMm(piece.singleLengthMm)} mm</dd></div>
      </dl>
    </section>
  );
}

export function FloorCanvas({
  state,
  selection,
  selectedBoundaryId,
  onSelect,
  onSelectBoundary,
  onMove,
  onDragStateChange,
  bottomCalculation,
  topCalculation,
  roleDomains = [],
  roleState,
  highlightedRoleDomainId,
  highlightedThroughPathId,
  initialFitMode = "floor",
  focusRequest = null,
  compactHeight = false,
  editMode = "move",
  onEditModeChange,
  dockSourceId = null,
  dockTargetId = null,
  dockHoverDirection = null,
  dockPreview = null,
  multiSelection = new Set<string>(),
  onDockPick,
  onDockHoverDirection,
  onDockConfirm,
  onMultiToggle,
  fullscreen = false,
  onToggleFullscreen,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onQuickDock,
  inputProfile = "desktop",
  compactMode = false,
  commandBar = null,
  onZoomChange,
}: {
  state: FloorPlanState;
  selection: FloorSelection;
  selectedBoundaryId: string | null;
  onSelect: (selection: FloorSelection) => void;
  onSelectBoundary: (segment: FloorAtomicBoundarySegment) => void;
  onMove: (selection: Exclude<FloorSelection, null>, x: number, y: number, finished: boolean) => void;
  onDragStateChange?: (dragging: boolean) => void;
  /** 仅消费正式计算结果；Canvas不计算根数、长度、锚固或重量。 */
  bottomCalculation?: FloorBottomCalculation;
  topCalculation?: FloorTopCalculation;
  roleDomains?: readonly FloorRebarRoleDomain[];
  roleState?: FloorRebarRoleState;
  highlightedRoleDomainId?: string | null;
  highlightedThroughPathId?: string | null;
  initialFitMode?: "floor" | "selection" | "domain";
  /** UI V3.1：显式 Viewport Focus Request，只更新视口不 remount 组件（替代 React key）。 */
  focusRequest?: { id: number; mode: "floor" | "selection" | "domain" } | null;
  /** UI V3.1：Touch 短横屏（如 1366×768）使用紧凑高度策略，不用 600px 最小高度。 */
  compactHeight?: boolean;
  editMode?: "move" | "dock" | "multi";
  onEditModeChange?: (mode: "move" | "dock" | "multi") => void;
  dockSourceId?: string | null;
  dockTargetId?: string | null;
  dockHoverDirection?: FloorDockDirection | null;
  dockPreview?: FloorDockPreview | null;
  multiSelection?: ReadonlySet<string>;
  onDockPick?: (slabId: string) => void;
  onDockHoverDirection?: (direction: FloorDockDirection | null) => void;
  onDockConfirm?: (direction: FloorDockDirection) => void;
  onMultiToggle?: (slabId: string) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Quick Dock：拖动松手且Smart Guide激活时，把Dock请求交给父层复用floor-docking计算。 */
  onQuickDock?: (request: FloorDockRequest, x: number, y: number) => void;
  /** UI V3：输入模式决定触摸尺寸（touch≥44px），不再由 xl 断点判断。 */
  inputProfile?: "touch" | "desktop";
  /** UI V5：手机紧凑 Toolbar（移动/拼接/多选 + 更多菜单）。 */
  compactMode?: boolean;
  /** UI V3：Dock确认/Multi对齐等Command Bar渲染在Canvas内部底部（PRD 47-57）。 */
  commandBar?: React.ReactNode;
  /** 仅把Viewport缩放反馈给Workspace Status Bar，不进入工程State/History。 */
  onZoomChange?: (zoomPercent: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const gestureRef = useRef<FloorCanvasGestureState | null>(null);
  const pendingRef = useRef<{ viewport?: FloorCanvasViewport; preview?: { objectId: string; x: number; y: number } | null } | null>(null);
  const rafRef = useRef<number | null>(null);
  // UI V3.1：Command Bar 真实高度测量（ResizeObserver），Fit 后主对象不被遮挡。
  const commandBarWrapRef = useRef<HTMLDivElement>(null);
  const [commandBarHeight, setCommandBarHeight] = useState(0);
  const commandBarHeightRef = useRef(0);
  const transformRef = useRef<{ scale: number }>({ scale: 1 });
  const [fitMode, setFitMode] = useState<FloorCanvasFitMode>(initialFitMode);
  const [viewport, setViewport] = useState<FloorCanvasViewport>({ zoom: 1, centerX: 0, centerY: 0 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    onZoomChange?.(viewport.zoom * 100);
  }, [onZoomChange, viewport.zoom]);
  const [axisLock, setAxisLock] = useState<FloorCanvasAxisLock>("free");
  const [dragPreview, setDragPreview] = useState<{ objectId: string; x: number; y: number } | null>(null);
  const [svgWidthPx, setSvgWidthPx] = useState(SVG_WIDTH);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const highlightedRoleDomain = roleDomains.find((domain) => domain.id === highlightedRoleDomainId);
  const bounds = useMemo(() => {
    if (fitMode === "selection" && selection) {
      const object = selection.kind === "slab"
        ? state.slabs.find((slab) => slab.id === selection.id)
        : state.openings.find((opening) => opening.id === selection.id);
      if (object) return { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height };
    }
    if (fitMode === "domain" && highlightedRoleDomain) return { minX: highlightedRoleDomain.minX, minY: highlightedRoleDomain.minY, maxX: highlightedRoleDomain.maxX, maxY: highlightedRoleDomain.maxY };
    return calculateFloorCanvasBounds(state, fitMode === "all" ? "all" : "floor");
  }, [fitMode, highlightedRoleDomain, selection, state]);
  const displayBoundaries = useMemo(() => buildFloorDisplayBoundarySegments(state), [state]);
  const atomicBoundaries = useMemo(() => buildFloorAtomicBoundarySegments(state), [state]);
  const atomicById = useMemo(() => new Map(atomicBoundaries.map((segment) => [segment.id, segment])), [atomicBoundaries]);
  const selectedAtomicSegment = selectedBoundaryId ? atomicById.get(selectedBoundaryId) ?? null : null;
  const nearMisses = useMemo(() => findFloorSlabNearMisses(state), [state]);
  const uncoveredOpenings = useMemo(() => state.openings.filter((opening) => !floorOpeningTouchesFloor(opening, state)), [state]);
  const rebarCalculation = topCalculation ?? bottomCalculation;
  const rebarLines = useMemo(
    () => new Map(rebarCalculation?.lines.map((line) => [line.id, line]) ?? []),
    [rebarCalculation],
  );
  const drawablePieces = useMemo<DrawablePiece[]>(() => {
    if (!rebarCalculation?.isValid) return [];
    return rebarCalculation.pieces.flatMap((piece) => {
      const line = rebarLines.get(piece.lineId);
      return line ? [{ piece, positionMm: line.positionMm }] : [];
    });
  }, [rebarCalculation, rebarLines]);
  const normalPieces = drawablePieces.filter(({ piece }) => piece.source === "normal");
  const throughPieces = drawablePieces.filter(({ piece }) => piece.source === "through");
  const selectedPiece = drawablePieces.find(({ piece }) => piece.id === selectedPieceId)?.piece ?? null;
  const throughPathName = selectedPiece?.throughPathId
    ? topCalculation?.resolvedThroughPaths.find((path) => path.id === selectedPiece.throughPathId)?.name
    : undefined;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) setSvgWidthPx(width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // PRD 24/56：卸载时清理 RAF 与交互引用，避免Stage/路由切换后执行旧帧。
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      pendingRef.current = null;
      gestureRef.current = null;
      dragRef.current = null;
    };
  }, []);

  const boundsKey = fitMode === "selection" && selection
    ? `${selection.kind}:${selection.id}`
    : fitMode === "domain" && highlightedRoleDomain
      ? highlightedRoleDomain.id
      : fitMode;

  // UI V3.1：Navigator 与一次性聚焦请求只更新 Viewport，不永久写入 fitMode；
  // 这样点击不同板区时不会被持续 selection fit 反复重置视口。 
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.mode === "floor") {
      const base = viewportForBounds(calculateFloorCanvasBounds(state, "floor"));
      applyViewportImmediate({ ...base, centerY: base.centerY + barShiftMmRef.current });
      return;
    }
    if (focusRequest.mode === "selection" && selection) {
      const object = selection.kind === "slab"
        ? state.slabs.find((slab) => slab.id === selection.id)
        : state.openings.find((opening) => opening.id === selection.id);
      if (object) {
        const boundsForTarget = expandViewportBounds({
          minX: object.x,
          minY: object.y,
          maxX: object.x + object.width,
          maxY: object.y + object.height,
        }, 1.8);
        applyViewportImmediate(viewportForBounds(boundsForTarget));
      }
      return;
    }
    if (focusRequest.mode === "domain" && highlightedRoleDomain) {
      const domainBounds = expandViewportBounds({
        minX: highlightedRoleDomain.minX,
        minY: highlightedRoleDomain.minY,
        maxX: highlightedRoleDomain.maxX,
        maxY: highlightedRoleDomain.maxY,
      }, 1.8);
      applyViewportImmediate(viewportForBounds(domainBounds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.id, selection, highlightedRoleDomain, state]);

  useEffect(() => {
    const base = viewportForBounds(bounds);
    setViewport({ ...base, centerY: base.centerY + barShiftMmRef.current });
    // 只有Fit模式/选中对象变化时才重新适配；Zoom/Pan由用户操作更新Viewport。
    // Command Bar 出现后的偏移通过 barShiftMmRef 一并带入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  // UI V3.1：Command Bar 真实高度测量，出现时把视口中心向上平移一半高度，
  // 保证 Fit 后的主要对象不被底部 Command Bar 遮挡（只改 Viewport，不改 Geometry）。
  const barShiftMmRef = useRef(0);
  useEffect(() => {
    const wrapper = commandBarWrapRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height === undefined || !Number.isFinite(height)) return;
      setCommandBarHeight(height);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(commandBar)]);

  useEffect(() => {
    const previous = commandBarHeightRef.current;
    commandBarHeightRef.current = commandBarHeight;
    const delta = commandBarHeight - previous;
    if (delta <= 0) return;
    const pxPerMm = effectiveScale * (svgWidthPx / SVG_WIDTH);
    if (pxPerMm <= 0) return;
    const shiftMm = (delta / 2) / pxPerMm;
    // world→view 的 Y 轴会随 centerY 增大而向下移动，因此命令栏出现时必须
    // 减小 centerY，才能把工程对象让到命令栏上方。
    barShiftMmRef.current -= shiftMm;
    setViewport((current) => ({ ...current, centerY: current.centerY - shiftMm }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandBarHeight]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const viewToWorld = (viewX: number, viewY: number, target: FloorCanvasViewport) => ({
      x: target.centerX + (viewX - PLOT_CENTER_X) / (transformRef.current.scale * target.zoom),
      y: target.centerY - (viewY - PLOT_CENTER_Y) / (transformRef.current.scale * target.zoom),
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const content = svgContentRect(rect);
      const viewX = (event.clientX - content.left) / content.width * SVG_WIDTH;
      const viewY = (event.clientY - content.top) / content.height * SVG_HEIGHT;
      const current = viewportRef.current;
      const anchor = viewToWorld(viewX, viewY, current);
      const factor = Math.exp(-event.deltaY * 0.0015);
      viewportRef.current = zoomViewportAt(current, factor, anchor.x, anchor.y);
      setViewport(viewportRef.current);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(state.outerWallThickness, 240) * 1.8;
  const scale = Math.min(PLOT.width / (worldWidth + padding * 2), PLOT.height / (worldHeight + padding * 2));
  const effectiveScale = scale * viewport.zoom;
  const toX = (x: number) => PLOT_CENTER_X + (x - viewport.centerX) * effectiveScale;
  const toY = (y: number) => PLOT_CENTER_Y - (y - viewport.centerY) * effectiveScale;
  transformRef.current = { scale };
  const visibleWorld = {
    minX: viewport.centerX - (PLOT.width / 2) / effectiveScale,
    maxX: viewport.centerX + (PLOT.width / 2) / effectiveScale,
    minY: viewport.centerY - (PLOT.height / 2) / effectiveScale,
    maxY: viewport.centerY + (PLOT.height / 2) / effectiveScale,
  };
  const gridStep = chooseFloorGridStep(effectiveScale * svgWidthPx / SVG_WIDTH);
  const minorXs = gridCoordinates(visibleWorld.minX, visibleWorld.maxX, gridStep.minorMm);
  const minorYs = gridCoordinates(visibleWorld.minY, visibleWorld.maxY, gridStep.minorMm);
  const majorXs = gridCoordinates(visibleWorld.minX, visibleWorld.maxX, gridStep.majorMm);
  const majorYs = gridCoordinates(visibleWorld.minY, visibleWorld.maxY, gridStep.majorMm);

  const dragPosition = (event: React.PointerEvent<SVGSVGElement>, drag: DragState) => {
    let x = drag.startX + (event.clientX - drag.startClientX) * drag.pixelsPerWorldX;
    let y = drag.startY - (event.clientY - drag.startClientY) * drag.pixelsPerWorldY;
    // PRD 16-18：水平=只允许X变化；垂直=只允许Y变化；Shift按主位移方向临时锁定。
    if (axisLock === "horizontal") {
      y = drag.startY;
    } else if (axisLock === "vertical") {
      x = drag.startX;
    } else if (event.shiftKey) {
      if (Math.abs(x - drag.startX) >= Math.abs(y - drag.startY)) y = drag.startY;
      else x = drag.startX;
    }
    return { x: Math.round(x), y: Math.round(y) };
  };

  const computeDragGuide = (moving: FloorSlab | FloorOpening, x: number, y: number): FloorDragGuide | null => {
    const snap = state.snapDistanceMm;
    if (snap <= 0) return null;
    let best: FloorDragGuide | null = null;
    const consider = (gap: number, candidate: Omit<FloorDragGuide, "gapMm">) => {
      if (Math.abs(gap) > snap) return;
      if (!best || Math.abs(gap) < Math.abs(best.gapMm)) best = { ...candidate, gapMm: gap };
    };
    state.slabs.forEach((other) => {
      if (other.id === moving.id) return;
      const xOverlap = x < other.x + other.width - 1e-7 && x + moving.width > other.x + 1e-7;
      const yOverlap = y < other.y + other.height - 1e-7 && y + moving.height > other.y + 1e-7;
      if (yOverlap) {
        // moving西边贴other东边：x = other.east
        consider(other.x + other.width - x, { axis: "x", coordinate: other.x + other.width, targetSlabId: other.id, targetSlabName: other.name, targetSide: "east" });
        // moving东边贴other西边：x = other.x - moving.width
        consider(other.x - (x + moving.width), { axis: "x", coordinate: other.x, targetSlabId: other.id, targetSlabName: other.name, targetSide: "west" });
      }
      if (xOverlap) {
        // moving南边贴other北边：y = other.north
        consider(other.y + other.height - y, { axis: "y", coordinate: other.y + other.height, targetSlabId: other.id, targetSlabName: other.name, targetSide: "north" });
        // moving北边贴other南边：y = other.south - moving.height
        consider(other.y - (y + moving.height), { axis: "y", coordinate: other.y, targetSlabId: other.id, targetSlabName: other.name, targetSide: "south" });
      }
    });
    return best;
  };

  /** Smart Guide → 标准Dock请求；正式坐标完全交给floor-docking计算（PRD 20/21）。 */
  const quickDockRequest = (guide: FloorDragGuide, sourceSlabId: string): FloorDockRequest => ({
    sourceSlabId,
    targetSlabId: guide.targetSlabId,
    direction: guide.targetSide,
    alignment: "preserve",
  });

  /** 把源板放到拖动中的位置后再参与Docking，保证preserve与预览一致（PRD 19/73）。 */
  const stateWithPreviewSource = (source: FloorSlab, x: number, y: number): FloorPlanState => ({
    ...state,
    slabs: state.slabs.map((slab) => slab.id === source.id ? { ...slab, x, y } : slab),
  });

  /**
   * 交互帧调度（PRD 52-55）：viewport 与 preview 合并而非互相覆盖；
   * RAF 回调同时同步 viewportRef，保证下一次 PointerMove 基于最新交互 Viewport。
   */
  const scheduleFrame = (next: { viewport?: FloorCanvasViewport; preview?: { objectId: string; x: number; y: number } | null }) => {
    pendingRef.current = { ...pendingRef.current, ...next };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      if (pending.viewport) {
        viewportRef.current = pending.viewport;
        setViewport(pending.viewport);
      }
      if (pending.preview !== undefined) setDragPreview(pending.preview);
    });
  };

  /** PRD 9-10/107：交互路径统一入口——先同步最新 Viewport ref，再走 RAF 渲染，不等待 React Render。 */
  const commitInteractionViewport = (next: FloorCanvasViewport) => {
    viewportRef.current = next;
    scheduleFrame({ viewport: next });
  };

  /** 一次性入口（滚轮/按钮/Fit）：同步 ref 并立即 setState。 */
  const applyViewportImmediate = (next: FloorCanvasViewport) => {
    viewportRef.current = next;
    setViewport(next);
  };

  /** PRD 16/19/23：取消未执行的交互帧（拖板松手/取消前清掉过期 Preview RAF）。 */
  const cancelPendingInteractionFrame = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
  };

  /** PRD 20-22：冲刷 pending 交互帧（Pan PointerUp 前不丢最后一段位移）。 */
  const flushPendingInteractionFrame = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (pending.viewport) {
      viewportRef.current = pending.viewport;
      setViewport(pending.viewport);
    }
    if (pending.preview !== undefined) setDragPreview(pending.preview);
  };

  const beginDrag = (
    event: React.PointerEvent<SVGRectElement>,
    nextSelection: Exclude<FloorSelection, null>,
    object: FloorSlab | FloorOpening,
  ) => {
    event.stopPropagation();
    setSelectedPieceId(null);
    onSelect(nextSelection);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const content = svgContentRect(rect);
    const touchCandidate = event.pointerType === "touch";
    dragRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      selection: nextSelection,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startX: object.x,
      startY: object.y,
      pixelsPerWorldX: SVG_WIDTH / content.width / effectiveScale,
      pixelsPerWorldY: SVG_HEIGHT / content.height / effectiveScale,
      activated: !touchCandidate,
      moved: false,
    };
    if (!touchCandidate) {
      setDragPreview({ objectId: object.id, x: object.x, y: object.y });
      onDragStateChange?.(true);
    }
    if (event.pointerType !== "mouse") {
      try {
        event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
      } catch {
        // 部分触控取消/自动化事件不允许捕获；SVG内移动与cancel回滚仍然有效。
      }
    }
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.activated || !drag.moved) {
      cancelPendingInteractionFrame();
      dragRef.current = null;
      setDragPreview(null);
      onDragStateChange?.(false);
      if (event.pointerType !== "mouse" && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    // PRD 18：先取消遗留的 Preview RAF，再用 PointerUp 坐标计算最终值，避免松手后旧帧回弹。
    cancelPendingInteractionFrame();
    const moved = dragPosition(event, drag);
    const movingSlab = drag.selection.kind === "slab"
      ? state.slabs.find((slab) => slab.id === drag.selection.id)
      : null;
    // PRD 19-25：Quick Dock只针对FloorSlab，Guide激活时直接复用floor-docking并禁止二次普通Snap。
    const guide = movingSlab ? computeDragGuide(movingSlab, moved.x, moved.y) : null;
    if (movingSlab && guide) {
      const request = quickDockRequest(guide, movingSlab.id);
      const preview = previewFloorDock(stateWithPreviewSource(movingSlab, moved.x, moved.y), request);
      if (preview?.valid) {
        if (onQuickDock) onQuickDock(request, moved.x, moved.y);
        else onMove(drag.selection, preview.x, preview.y, true);
      }
      // PRD 74：Dock后与第三板区重叠时不提交任何坐标。
    } else {
      onMove(drag.selection, moved.x, moved.y, true);
    }
    dragRef.current = null;
    setDragPreview(null);
    onDragStateChange?.(false);
    if (event.pointerType !== "mouse" && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // PRD 19：取消未执行的 Preview RAF，禁止过期帧恢复 Ghost。
    cancelPendingInteractionFrame();
    dragRef.current = null;
    setDragPreview(null);
    onDragStateChange?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** PRD 27-35：触摸双指手势优先于单板拖动——取消未提交的拖动预览并升级为 Pinch。 */
  const upgradeTouchDragToGesture = (event: React.PointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId === event.pointerId) return;
    // 不调用 onMove、不写 FloorPlan、不产生 History（PRD 42/46）。
    dragRef.current = null;
    cancelPendingInteractionFrame();
    setDragPreview(null);
    onDragStateChange?.(false);
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // 忽略捕获失败。
    }
    const effectiveScale = transformRef.current.scale * viewportRef.current.zoom;
    gestureRef.current = addFloorCanvasGesturePointer(
      createFloorCanvasGesture(viewportRef.current, effectiveScale, drag.pointerId, drag.lastClientX, drag.lastClientY),
      viewportRef.current,
      effectiveScale,
      event.pointerId,
      event.clientX,
      event.clientY,
    );
  };

  const beginPan = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // 忽略捕获失败。
    }
    const gesture = gestureRef.current;
    const currentEffectiveScale = transformRef.current.scale * viewportRef.current.zoom;
    gestureRef.current = gesture
      ? addFloorCanvasGesturePointer(gesture, viewportRef.current, currentEffectiveScale, event.pointerId, event.clientX, event.clientY) ?? gesture
      : createFloorCanvasGesture(viewportRef.current, currentEffectiveScale, event.pointerId, event.clientX, event.clientY);
  };

  const movePan = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const content = svgContentRect(rect);
    const previous = viewportRef.current;
    const result = updateFloorCanvasGesture(
      gesture,
      event.pointerId,
      event.clientX,
      event.clientY,
      {
        rectLeft: content.left,
        rectTop: content.top,
        rectWidth: content.width,
        rectHeight: content.height,
        svgWidth: SVG_WIDTH,
        svgHeight: SVG_HEIGHT,
        plotCenterX: PLOT_CENTER_X,
        plotCenterY: PLOT_CENTER_Y,
        effectiveScale: transformRef.current.scale * viewportRef.current.zoom,
      },
      previous,
    );
    if (!result) return;
    gestureRef.current = result.gesture;
    // PRD 9/107：立即同步最新 Viewport ref 再 RAF 渲染，高频 PointerMove 不丢增量。
    if (result.viewport !== previous) commitInteractionViewport(result.viewport);
  };

  const finishPan = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    // PRD 20-22：PointerUp 前 flush 最后一帧 pending Viewport，不丢最后一段位移。
    flushPendingInteractionFrame();
    const remaining = removeFloorCanvasGesturePointer(gesture, event.pointerId);
    gestureRef.current = remaining;
    if (!remaining && !gesture.moved) {
      setSelectedPieceId(null);
      onSelect(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelPan = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    // PRD 23/80：Cancel 停止未来 pending 更新，保留已正式渲染的 Viewport。
    cancelPendingInteractionFrame();
    const remaining = removeFloorCanvasGesturePointer(gesture, event.pointerId);
    gestureRef.current = remaining;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const pieceCoordinates = ({ piece, positionMm }: DrawablePiece) => {
    const xDirection = piece.direction === "x";
    return {
      x1: toX(xDirection ? piece.runStartMm : positionMm),
      y1: toY(xDirection ? positionMm : piece.runStartMm),
      x2: toX(xDirection ? piece.runEndMm : positionMm),
      y2: toY(xDirection ? positionMm : piece.runEndMm),
    };
  };

  const selectedIrregularRole = selection?.kind === "slab"
    ? roleDomains.find((domain) => domain.shape === "irregular" && domain.slabIds.includes(selection.id))
    : undefined;

  const dockSource = state.slabs.find((slab) => slab.id === dockSourceId) ?? null;
  const dockTarget = state.slabs.find((slab) => slab.id === dockTargetId) ?? null;
  const dockGhost = dockPreview?.sourcePreview ?? null;
  // UI V3.1：实例 ID 用于回归验证 Navigator 选择不 remount Canvas。
  const instanceIdRef = useRef(`floor-canvas-${Math.random().toString(36).slice(2, 10)}`);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50" data-testid="floor-canvas-card" data-canvas-instance-id={instanceIdRef.current}>
      {!fullscreen && <div className="flex min-h-9 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-1.5">
        <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900">{topCalculation ? "整层面筋净跨路径" : bottomCalculation ? "整层地筋净跨路径" : "整层板区平面"}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {uncoveredOpenings.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700"><TriangleAlert size={13} /> 有{uncoveredOpenings.length}个洞口位于楼板范围外</span>}
          {nearMisses.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"><TriangleAlert size={13} /> {nearMisses.length}处临近</span>}
        </div>
      </div>}
      {/* UI V3（PRD 26-28）：Toolbar 独立 Chrome 行，不再 absolute 覆盖 SVG 绘图区；提升层级保证视图 Popover 不被 SVG 盖住；窄屏允许行内横向滚动（PRD 102）。 */}
      <div className="relative z-30 flex min-h-12 flex-wrap items-center justify-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1">
        <FloorCanvasToolbar
          editMode={editMode}
          onEditModeChange={onEditModeChange ?? (() => undefined)}
          axisLock={axisLock}
          onAxisLockChange={setAxisLock}
          fitMode={fitMode}
          onFit={(mode) => {
            setFitMode(mode);
            // UI V3.1：Fit 按钮是显式一次性取景，即使 fitMode 未变化也要立即更新 Viewport。
            if (mode === "selection" && selection) {
              const object = selection.kind === "slab"
                ? state.slabs.find((slab) => slab.id === selection.id)
                : state.openings.find((opening) => opening.id === selection.id);
              if (object) {
                applyViewportImmediate(viewportForBounds({
                  minX: object.x,
                  minY: object.y,
                  maxX: object.x + object.width,
                  maxY: object.y + object.height,
                }));
                return;
              }
            }
            if (mode === "domain" && highlightedRoleDomain) {
              applyViewportImmediate(viewportForBounds({
                minX: highlightedRoleDomain.minX,
                minY: highlightedRoleDomain.minY,
                maxX: highlightedRoleDomain.maxX,
                maxY: highlightedRoleDomain.maxY,
              }));
              return;
            }
            const base = viewportForBounds(calculateFloorCanvasBounds(state, mode === "all" ? "all" : "floor"));
            applyViewportImmediate({ ...base, centerY: base.centerY + barShiftMmRef.current });
          }}
          zoomPercent={viewport.zoom * 100}
          onZoomIn={() => {
            const current = viewportRef.current;
            applyViewportImmediate(zoomViewportAt(current, 1.25, current.centerX, current.centerY));
          }}
          onZoomOut={() => {
            const current = viewportRef.current;
            applyViewportImmediate(zoomViewportAt(current, 1 / 1.25, current.centerX, current.centerY));
          }}
          fullscreen={fullscreen}
          onToggleFullscreen={onToggleFullscreen ?? (() => undefined)}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo ?? (() => undefined)}
          onRedo={onRedo ?? (() => undefined)}
          domainHighlighted={Boolean(highlightedRoleDomain)}
          inputProfile={inputProfile}
          compactMode={compactMode}
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {commandBar && <div ref={commandBarWrapRef} className="pointer-events-none absolute inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom))] z-30 flex justify-center">{commandBar}</div>}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: "auto" }}
          className={`block h-full w-full touch-none select-none bg-white ${compactHeight ? "min-h-[280px]" : "min-h-[320px]"}`}
          role="img"
          aria-label="整层板区、洞口、正式钢筋Piece和支承关系布局预览"
          data-floor-canvas-fit={fitMode}
          data-zoom-percent={Math.round(viewport.zoom * 100)}
          data-plot-width={PLOT.width}
          data-plot-height={PLOT.height}
          data-viewport-center-x={viewport.centerX}
          data-viewport-center-y={viewport.centerY}
          onPointerDown={(event) => {
            if (dragRef.current) {
              // 第二根手指落在画布：touch 拖动升级为双指 Pinch（PRD 27-35）。
              if (event.pointerType === "touch") upgradeTouchDragToGesture(event);
              return;
            }
            const target = event.target as Element;
            const isBackground = target === event.currentTarget || target.getAttribute("data-floor-canvas-background") === "true";
            if (!isBackground) return;
            beginPan(event);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (drag && drag.pointerId === event.pointerId) {
              drag.lastClientX = event.clientX;
              drag.lastClientY = event.clientY;
              if (event.pointerType === "touch" && !drag.activated) {
                const dxPx = event.clientX - drag.startClientX;
                const dyPx = event.clientY - drag.startClientY;
                const distancePx = Math.hypot(dxPx, dyPx);
                if (distancePx < TOUCH_DRAG_THRESHOLD_PX) return;
                drag.activated = true;
                drag.moved = true;
                setDragPreview({ objectId: drag.selection.id, x: drag.startX, y: drag.startY });
                onDragStateChange?.(true);
              }
              if (drag.activated) {
                drag.moved = true;
              }
              const moved = dragPosition(event, drag);
              scheduleFrame({ preview: { objectId: drag.selection.id, x: moved.x, y: moved.y } });
              return;
            }
            movePan(event);
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) { finishDrag(event); return; }
            finishPan(event);
          }}
          onPointerCancel={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) { cancelDrag(event); return; }
            cancelPan(event);
          }}
          onDoubleClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setFitMode("floor");
            applyViewportImmediate(viewportForBounds(calculateFloorCanvasBounds(state, "floor")));
          }}
        >
        <defs>
          <clipPath id="floor-plot-clip-v22"><rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" /></clipPath>
          <pattern id="opening-hatch-v22" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="12" height="12" fill="#f8fafc" />
            <line x1="0" y1="0" x2="0" y2="12" stroke="#cbd5e1" strokeWidth="4" />
          </pattern>
        </defs>
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" fill="#fff" stroke="#cbd5e1" data-floor-canvas-background="true" />

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="grid" pointerEvents="none">
          {minorXs.map((value) => <line key={`minor-x:${value}`} x1={toX(value)} y1={PLOT.y} x2={toX(value)} y2={PLOT.y + PLOT.height} stroke="#edf2f7" strokeWidth="1" />)}
          {minorYs.map((value) => <line key={`minor-y:${value}`} x1={PLOT.x} y1={toY(value)} x2={PLOT.x + PLOT.width} y2={toY(value)} stroke="#edf2f7" strokeWidth="1" />)}
          {majorXs.map((value) => <line key={`major-x:${value}`} x1={toX(value)} y1={PLOT.y} x2={toX(value)} y2={PLOT.y + PLOT.height} stroke="#d7e0ea" strokeWidth="1.4" />)}
          {majorYs.map((value) => <line key={`major-y:${value}`} x1={PLOT.x} y1={toY(value)} x2={PLOT.x + PLOT.width} y2={toY(value)} stroke="#d7e0ea" strokeWidth="1.4" />)}
        </g>
        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="coordinate-labels" pointerEvents="none" fontSize="10" fill="#64748b">
          {majorXs.map((value) => <text key={`x-label:${value}`} x={toX(value) + 3} y={PLOT.y + 13}>{formatMm(value)}</text>)}
          {majorYs.map((value) => <text key={`y-label:${value}`} x={PLOT.x + 4} y={toY(value) - 4}>{formatMm(value)}</text>)}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="slabs">
          {state.slabs.map((slab) => {
            const selected = selection?.kind === "slab" && selection.id === slab.id;
            const domainHighlighted = Boolean(highlightedRoleDomain?.slabIds.includes(slab.id));
            const dockSourceSelected = editMode === "dock" && dockSourceId === slab.id;
            const dockTargetSelected = editMode === "dock" && dockTargetId === slab.id;
            const multiSelected = editMode === "multi" && multiSelection.has(slab.id);
            const ghostDimmed = dockGhost?.id === slab.id;
            const interactive = editMode === "move";
            return (
              <rect
                key={slab.id}
                x={toX(slab.x)} y={toY(slab.y + slab.height)}
                width={Math.max(slab.width * effectiveScale, 1)} height={Math.max(slab.height * effectiveScale, 1)}
                fill={slabFill(slab.type, selected)} fillOpacity={ghostDimmed ? 0.25 : highlightedRoleDomain ? domainHighlighted ? 1 : 0.42 : 1}
                stroke={dockSourceSelected ? "#f97316" : dockTargetSelected ? "#0ea5e9" : multiSelected ? "#8b5cf6" : selected ? "#2563eb" : domainHighlighted ? "#4f46e5" : "#94a3b8"}
                strokeWidth={dockSourceSelected || dockTargetSelected || multiSelected ? 4 : selected ? 4 : domainHighlighted ? 3 : 1.5}
                className={interactive ? "cursor-move touch-none" : editMode === "dock" ? "cursor-pointer touch-none" : "cursor-crosshair touch-none"}
                style={{ pointerEvents: "all" }}
                pointerEvents="all"
                role="button" aria-label={`选择板区 ${slab.name}`} tabIndex={0}
                data-dock-role={dockSourceSelected ? "source" : dockTargetSelected ? "target" : undefined}
                data-multi-selected={multiSelected ? "true" : undefined}
                onPointerDown={(event) => {
                  if (editMode === "dock") { event.stopPropagation(); onDockPick?.(slab.id); return; }
                  if (editMode === "multi") { event.stopPropagation(); onMultiToggle?.(slab.id); return; }
                  // PRD 27-35/44：两指手势优先于单板拖动（仅 touch；鼠标/触控笔立即Drag）。
                  if (event.pointerType === "touch" && dragRef.current && dragRef.current.pointerId !== event.pointerId) {
                    event.stopPropagation();
                    upgradeTouchDragToGesture(event);
                    return;
                  }
                  beginDrag(event, { kind: "slab", id: slab.id }, slab);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (editMode !== "move") return;
                  applyViewportImmediate(viewportForBounds(expandViewportBounds({
                    minX: slab.x,
                    minY: slab.y,
                    maxX: slab.x + slab.width,
                    maxY: slab.y + slab.height,
                  }, 1.8)));
                }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelect({ kind: "slab", id: slab.id }); } }}
              />
            );
          })}
          {state.openings.map((opening) => (
            <rect
              key={`opening-fill-${opening.id}`}
              x={toX(opening.x)} y={toY(opening.y + opening.height)}
              width={Math.max(opening.width * effectiveScale, 1)} height={Math.max(opening.height * effectiveScale, 1)}
              fill="url(#opening-hatch-v22)" stroke="transparent" className="cursor-move touch-none"
              style={{ pointerEvents: "all" }}
              pointerEvents="all"
              role="button" aria-label={`选择洞口 ${opening.name}`} tabIndex={0}
              onPointerDown={(event) => {
                if (event.pointerType === "touch" && dragRef.current && dragRef.current.pointerId !== event.pointerId) {
                  event.stopPropagation();
                  upgradeTouchDragToGesture(event);
                  return;
                }
                beginDrag(event, { kind: "opening", id: opening.id }, opening);
              }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelect({ kind: "opening", id: opening.id }); } }}
            />
          ))}
        </g>

        {dragPreview && (() => {
          const movingSlab = state.slabs.find((slab) => slab.id === dragPreview.objectId);
          const moving = movingSlab ?? state.openings.find((opening) => opening.id === dragPreview.objectId);
          if (!moving) return null;
          const guide = movingSlab ? computeDragGuide(movingSlab, dragPreview.x, dragPreview.y) : null;
          const dockPreviewResult = movingSlab && guide
            ? previewFloorDock(stateWithPreviewSource(movingSlab, dragPreview.x, dragPreview.y), quickDockRequest(guide, movingSlab.id))
            : null;
          // PRD 19/22：预览位置与最终提交完全一致（由floor-docking计算）。
          const previewX = dockPreviewResult?.valid ? dockPreviewResult.x : dragPreview.x;
          const previewY = dockPreviewResult?.valid ? dockPreviewResult.y : dragPreview.y;
          const aligned = guide ? Math.abs(guide.gapMm) < 1e-6 : false;
          const conflict = Boolean(dockPreviewResult && !dockPreviewResult.valid);
          const guideColor = conflict ? "#dc2626" : aligned ? "#16a34a" : "#2563eb";
          const conflictNames = dockPreviewResult ? dockPreviewResult.conflicts.join("、") : "";
          const guideLabel = !guide
            ? ""
            : conflict
              ? `无法拼接：将与${conflictNames}重叠`
              : aligned
                ? "✓ 精确共边 0mm"
                : `松手将贴到${guide.targetSlabName}${floorDockDirectionLabel(guide.targetSide)}（差${formatMm(Math.abs(guide.gapMm))}mm）`;
          return (
            <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="drag-preview" pointerEvents="none" data-drag-preview="true" data-preview-x={dragPreview.x} data-preview-y={dragPreview.y}>
              <rect x={toX(moving.x)} y={toY(moving.y + moving.height)} width={Math.max(moving.width * effectiveScale, 1)} height={Math.max(moving.height * effectiveScale, 1)} fill="#94a3b8" fillOpacity="0.22" />
              <rect x={toX(previewX)} y={toY(previewY + moving.height)} width={Math.max(moving.width * effectiveScale, 1)} height={Math.max(moving.height * effectiveScale, 1)} fill={conflict ? "#fecaca" : "#3b82f6"} fillOpacity={conflict ? 0.6 : 0.35} stroke={guideColor} strokeWidth="3" strokeDasharray={aligned ? undefined : "8 5"} />
              <text x={toX(previewX + moving.width / 2)} y={toY(previewY + moving.height / 2) + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill={guideColor} style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>{moving.name}</text>
              {guide && <g data-drag-guide={guide.axis} data-guide-gap={guide.gapMm}>
                {guide.axis === "x"
                  ? <line x1={toX(guide.coordinate)} y1={PLOT.y} x2={toX(guide.coordinate)} y2={PLOT.y + PLOT.height} stroke={guideColor} strokeWidth={aligned ? 3 : 2} strokeDasharray={aligned ? undefined : "6 4"} />
                  : <line x1={PLOT.x} y1={toY(guide.coordinate)} x2={PLOT.x + PLOT.width} y2={toY(guide.coordinate)} stroke={guideColor} strokeWidth={aligned ? 3 : 2} strokeDasharray={aligned ? undefined : "6 4"} />}
                <text x={guide.axis === "x" ? toX(guide.coordinate) + 8 : PLOT.x + PLOT.width - 8} y={guide.axis === "x" ? PLOT.y + 18 : toY(guide.coordinate) - 8} textAnchor={guide.axis === "x" ? "start" : "end"} fontSize="11" fontWeight="800" fill={guideColor} style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>{guideLabel}</text>
              </g>}
            </g>
          );
        })()}

        {dockGhost && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="dock-ghost" pointerEvents="none" data-dock-ghost="true">
          <rect
            x={toX(dockGhost.x)} y={toY(dockGhost.y + dockGhost.height)}
            width={Math.max(dockGhost.width * effectiveScale, 1)} height={Math.max(dockGhost.height * effectiveScale, 1)}
            fill="#3b82f6" fillOpacity="0.35" stroke="#2563eb" strokeWidth="3" strokeDasharray="8 5"
          />
          <text x={toX(dockGhost.x + dockGhost.width / 2)} y={toY(dockGhost.y + dockGhost.height / 2) + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1d4ed8">{dockGhost.name} 预览</text>
        </g>}

        {editMode === "dock" && dockTarget && (() => {
          const target = dockTarget;
          // PRD 67：Dock方向点击区至少 44-52px 屏幕尺寸（48px起）。
          const dockHit = Math.max(88, 48 / effectiveScale);
          const sides: Array<{ direction: FloorDockDirection; x: number; y: number; width: number; height: number; labelX: number; labelY: number }> = [
            { direction: "north", x: toX(target.x), y: toY(target.y + target.height) - dockHit / 2, width: Math.max(target.width * effectiveScale, 1), height: dockHit, labelX: toX(target.x + target.width / 2), labelY: toY(target.y + target.height) - dockHit / 2 - 10 },
            { direction: "south", x: toX(target.x), y: toY(target.y) - dockHit / 2, width: Math.max(target.width * effectiveScale, 1), height: dockHit, labelX: toX(target.x + target.width / 2), labelY: toY(target.y) + dockHit / 2 + 16 },
            { direction: "west", x: toX(target.x) - dockHit / 2, y: toY(target.y + target.height), width: dockHit, height: Math.max(target.height * effectiveScale, 1), labelX: toX(target.x) - dockHit / 2 - 8, labelY: toY(target.y + target.height / 2) + 4 },
            { direction: "east", x: toX(target.x + target.width) - dockHit / 2, y: toY(target.y + target.height), width: dockHit, height: Math.max(target.height * effectiveScale, 1), labelX: toX(target.x + target.width) + dockHit / 2 + 4, labelY: toY(target.y + target.height / 2) + 4 },
          ];
          return (
            <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="dock-hit">
              {sides.map((side) => {
                const hovered = dockHoverDirection === side.direction;
                return (
                  <g key={side.direction}>
                    <rect
                      x={side.x} y={side.y} width={side.width} height={side.height}
                      fill={hovered ? "#bfdbfe" : "#e0f2fe"} fillOpacity={hovered ? 0.85 : 0.25}
                      stroke={hovered ? "#2563eb" : "#93c5fd"} strokeWidth={hovered ? 4 : 1.5} strokeDasharray={hovered ? undefined : "4 4"}
                      className="cursor-pointer" role="button" tabIndex={0} data-dock-side={side.direction}
                      aria-label={`拼到${target.name}${floorDockDirectionLabel(side.direction)}`}
                      onPointerEnter={() => onDockHoverDirection?.(side.direction)}
                      onPointerLeave={() => onDockHoverDirection?.(null)}
                      onPointerDown={(event) => { event.stopPropagation(); onDockConfirm?.(side.direction); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onDockConfirm?.(side.direction); }}
                    />
                    {hovered && <text x={side.labelX} y={side.labelY} textAnchor="middle" fontSize="12" fontWeight="800" fill="#1d4ed8" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>拼到{target.name}{floorDockDirectionLabel(side.direction)}</text>}
                  </g>
                );
              })}
            </g>
          );
        })()}

        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="normal-pieces-visible" pointerEvents="none">
          {normalPieces.map((drawable) => {
            const { piece } = drawable;
            const coordinates = pieceCoordinates(drawable);
            const topLayer = piece.layer === "top";
            const selected = selectedPiece?.id === piece.id;
            return <line key={piece.id} {...coordinates} opacity={highlightedThroughPathId ? 0.25 : 1} stroke={topLayer ? piece.direction === "x" ? "#0891b2" : "#047857" : piece.direction === "x" ? "#dc2626" : "#7c3aed"} strokeWidth={selected ? 5 : topLayer ? 2.8 : 2.4} strokeDasharray={topLayer ? "8 5" : undefined} strokeLinecap="round" />;
          })}
        </g>}
        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="normal-pieces-hit">
          {normalPieces.map((drawable) => {
            const coordinates = pieceCoordinates(drawable);
            return <line key={`hit:${drawable.piece.id}`} {...coordinates} stroke="transparent" strokeWidth="16" pointerEvents="stroke" className="cursor-pointer" data-piece-id={drawable.piece.id} data-piece-source="normal" role="button" tabIndex={0} aria-label={`检查钢筋 ${drawable.piece.id}`} onPointerDown={(event) => { event.stopPropagation(); setSelectedPieceId(drawable.piece.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPieceId(drawable.piece.id); }} />;
          })}
        </g>}

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="display-boundaries" pointerEvents="none">
          {displayBoundaries.map((segment) => {
            const style = wallStyle(segment, effectiveScale);
            return <line key={segment.id} x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)} stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} strokeLinecap="square" />;
          })}
          {state.openings.map((opening) => {
            const selected = selection?.kind === "opening" && selection.id === opening.id;
            return <rect key={`opening-outline-${opening.id}`} x={toX(opening.x)} y={toY(opening.y + opening.height)} width={Math.max(opening.width * effectiveScale, 1)} height={Math.max(opening.height * effectiveScale, 1)} fill="none" stroke={selected ? "#e11d48" : "#64748b"} strokeWidth={selected ? 4 : 2.5} strokeDasharray="9 6" />;
          })}
          {displayBoundaries.filter((segment) => segment.support === "continuous").map((segment) => (
            <text key={`continuous:${segment.id}`} x={toX((segment.startX + segment.endX) / 2)} y={toY((segment.startY + segment.endY) / 2) - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#475569" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>连续</text>
          ))}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="selected-atomic-overlay" pointerEvents="none">
          {selectedAtomicSegment && (
            <line
              key={`selected-atomic:${selectedAtomicSegment.id}`}
              x1={toX(selectedAtomicSegment.startX)} y1={toY(selectedAtomicSegment.startY)}
              x2={toX(selectedAtomicSegment.endX)} y2={toY(selectedAtomicSegment.endY)}
              stroke="#f97316" strokeWidth="9" strokeLinecap="round"
              data-selected-atomic-id={selectedAtomicSegment.id}
            />
          )}
        </g>

        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="through-pieces-visible" pointerEvents="none">
          {throughPieces.map((drawable) => {
            const coordinates = pieceCoordinates(drawable);
            const selected = selectedPiece?.id === drawable.piece.id;
            const pathSelected = !highlightedThroughPathId || drawable.piece.throughPathId === highlightedThroughPathId;
            return <line key={drawable.piece.id} {...coordinates} opacity={pathSelected ? 1 : 0.18} stroke="#1d4ed8" strokeWidth={selected ? 7 : pathSelected && highlightedThroughPathId ? 6.5 : 5} strokeLinecap="round" />;
          })}
          {throughPieces.flatMap((drawable) => drawable.piece.intermediateBoundaryIds.flatMap((boundaryId) => {
            const boundary = atomicById.get(boundaryId);
            if (!boundary) return [];
            const x = toX(drawable.piece.direction === "x" ? boundary.startX : drawable.positionMm);
            const y = toY(drawable.piece.direction === "x" ? drawable.positionMm : boundary.startY);
            return [<g key={`${drawable.piece.id}:${boundaryId}`} data-through-crossing={boundaryId}><circle cx={x} cy={y} r="5" fill="white" stroke="#1d4ed8" strokeWidth="2.5" /><line x1={drawable.piece.direction === "x" ? x : x - 7} y1={drawable.piece.direction === "x" ? y - 7 : y} x2={drawable.piece.direction === "x" ? x : x + 7} y2={drawable.piece.direction === "x" ? y + 7 : y} stroke="#1d4ed8" strokeWidth="2" /></g>];
          }))}
        </g>}
        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="through-pieces-hit">
          {throughPieces.map((drawable) => {
            const coordinates = pieceCoordinates(drawable);
            return <line key={`hit:${drawable.piece.id}`} {...coordinates} stroke="transparent" strokeWidth="18" pointerEvents="stroke" className="cursor-pointer" data-piece-id={drawable.piece.id} data-piece-source="through" role="button" tabIndex={0} aria-label={`检查通墙钢筋 ${drawable.piece.id}`} onPointerDown={(event) => { event.stopPropagation(); setSelectedPieceId(drawable.piece.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPieceId(drawable.piece.id); }} />;
          })}
        </g>}

        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="atomic-boundary-hit">
          {atomicBoundaries.map((segment) => (
            <line
              key={`atomic-hit:${segment.id}`}
              x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)}
              stroke="transparent" strokeWidth={inputProfile === "touch" ? 34 : 22} pointerEvents="stroke" className="cursor-pointer"
              data-atomic-boundary-id={segment.id} data-boundary-support={segment.support} data-boundary-kind={segment.geometryKind} data-atomic-hit-width={inputProfile === "touch" ? 34 : 22}
              role="button" tabIndex={0} aria-label={`编辑${segment.geometryKind === "shared-slab" ? "共享板边" : segment.geometryKind === "opening-edge" ? "洞口边" : "建筑外边"} ${segment.id}`}
              onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedPieceId(null); onSelectBoundary(segment); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelectBoundary(segment); } }}
            />
          ))}
        </g>}

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="labels" pointerEvents="none">
          {state.slabs.map((slab) => {
            const centerX = toX(slab.x + slab.width / 2);
            const centerY = toY(slab.y + slab.height / 2);
            const selected = selection?.kind === "slab" && selection.id === slab.id;
            const shortName = slab.name.length > 10 ? `${slab.name.slice(0, 9)}…` : slab.name;
            if (!selected) return <text key={`label-${slab.id}`} x={centerX} y={centerY + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4, strokeLinejoin: "round" }}>{shortName}</text>;
            // PRD 47-50：选中板区只显示名称与尺寸；小板区只显示名称避免遮挡。
            const screenWidthPx = Math.max(slab.width * effectiveScale, 0);
            const screenHeightPx = Math.max(slab.height * effectiveScale, 0);
            if (screenWidthPx < 180 || screenHeightPx < 80) {
              return <text key={`label-${slab.id}`} x={centerX} y={centerY + 5} textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a" data-slab-label-slim="true" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4, strokeLinejoin: "round" }}>{shortName}</text>;
            }
            return <g key={`label-${slab.id}`}><rect x={centerX - 78} y={centerY - 30} width="156" height="60" rx="8" fill="white" fillOpacity="0.94" stroke="#93c5fd" /><text x={centerX} y={centerY - 8} textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">{shortName}</text><text x={centerX} y={centerY + 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{formatMm(slab.width)} × {formatMm(slab.height)} mm</text></g>;
          })}
          {state.openings.map((opening) => {
            const centerX = toX(opening.x + opening.width / 2);
            const centerY = toY(opening.y + opening.height / 2);
            const selected = selection?.kind === "opening" && selection.id === opening.id;
            return <g key={`opening-label-${opening.id}`}><rect x={centerX - (selected ? 78 : 52)} y={centerY - (selected ? 37 : 20)} width={selected ? 156 : 104} height={selected ? 74 : 40} rx="7" fill="white" fillOpacity="0.9" /><text x={centerX} y={centerY - (selected ? 17 : 3)} textAnchor="middle" fontSize="13" fontWeight="700" fill="#881337">{opening.name}</text><text x={centerX} y={centerY + (selected ? 1 : 14)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#64748b">VOID</text>{selected && <><text x={centerX} y={centerY + 18} textAnchor="middle" fontSize="10" fill="#64748b">X {formatMm(opening.x)} · Y {formatMm(opening.y)}</text><text x={centerX} y={centerY + 32} textAnchor="middle" fontSize="10" fill="#64748b">{formatMm(opening.width)} × {formatMm(opening.height)} mm</text></>}</g>;
          })}
          {selectedIrregularRole && <g data-irregular-role-domain={selectedIrregularRole.id}><rect x={PLOT.x + 12} y={PLOT.y + PLOT.height - 38} width="270" height="26" rx="6" fill="#fff7ed" stroke="#fdba74" /><text x={PLOT.x + 22} y={PLOT.y + PLOT.height - 20} fontSize="11" fontWeight="700" fill="#9a3412">不规则连续板区域 · 主筋：{roleState?.mainDirectionOverrides[selectedIrregularRole.id] === "x" ? "东西向" : roleState?.mainDirectionOverrides[selectedIrregularRole.id] === "y" ? "南北向" : "未指定"}</text></g>}
        </g>

        {!dragPreview && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="warnings" pointerEvents="none">
          {nearMisses.map((nearMiss, index) => {
            const vertical = nearMiss.orientation === "vertical";
            const x = toX(vertical ? (nearMiss.coordinateA + nearMiss.coordinateB) / 2 : (nearMiss.overlapStartMm + nearMiss.overlapEndMm) / 2);
            const y = toY(vertical ? (nearMiss.overlapStartMm + nearMiss.overlapEndMm) / 2 : (nearMiss.coordinateA + nearMiss.coordinateB) / 2);
            return <g key={`near-miss:${nearMiss.slabIds.join(":")}:${index}`} data-near-miss={nearMiss.distanceMm}><circle cx={x} cy={y} r="12" fill="#fff" stroke="#dc2626" strokeWidth="3" /><text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="900" fill="#dc2626">!</text><text x={x + 16} y={y - 10} fontSize="11" fontWeight="800" fill="#b91c1c" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>⚠ {formatMm(nearMiss.distanceMm)}mm</text></g>;
          })}
        </g>}

        {/* UI V3：图例与方向标识移入 PLOT 内部左上/左下，pointerEvents none 不拦截交互（PRD 123）。 */}
        <g aria-label="图例" fontSize="11" fill="#475569" pointerEvents="none">
          <rect x={PLOT.x + 10} y={PLOT.y + 8} width="470" height={rebarCalculation ? 52 : 32} rx="8" fill="white" fillOpacity="0.88" stroke="#e2e8f0" />
          <line x1={PLOT.x + 22} y1={PLOT.y + 24} x2={PLOT.x + 57} y2={PLOT.y + 24} stroke="#0f172a" strokeWidth="7" /><text x={PLOT.x + 64} y={PLOT.y + 28}>建筑外边</text>
          <line x1={PLOT.x + 142} y1={PLOT.y + 24} x2={PLOT.x + 177} y2={PLOT.y + 24} stroke="#2563eb" strokeWidth="7" /><text x={PLOT.x + 184} y={PLOT.y + 28}>内墙</text>
          <line x1={PLOT.x + 247} y1={PLOT.y + 24} x2={PLOT.x + 282} y2={PLOT.y + 24} stroke="#64748b" strokeWidth="2.5" strokeDasharray="9 6" /><text x={PLOT.x + 289} y={PLOT.y + 28}>连续</text>
          <line x1={PLOT.x + 352} y1={PLOT.y + 24} x2={PLOT.x + 387} y2={PLOT.y + 24} stroke="#94a3b8" strokeWidth="3" strokeDasharray="5 6" /><text x={PLOT.x + 394} y={PLOT.y + 28}>洞口裁断</text>
          {rebarCalculation && <>
            <line x1={PLOT.x + 22} y1={PLOT.y + 46} x2={PLOT.x + 57} y2={PLOT.y + 46} stroke={topCalculation ? "#0891b2" : "#dc2626"} strokeWidth={topCalculation ? "2.8" : "2.4"} strokeDasharray={topCalculation ? "8 5" : undefined} /><text x={PLOT.x + 64} y={PLOT.y + 50}>东西向{topCalculation ? "面筋" : "地筋"}Piece</text>
            <line x1={PLOT.x + 242} y1={PLOT.y + 46} x2={PLOT.x + 277} y2={PLOT.y + 46} stroke={topCalculation ? "#047857" : "#7c3aed"} strokeWidth={topCalculation ? "2.8" : "2.4"} strokeDasharray={topCalculation ? "8 5" : undefined} /><text x={PLOT.x + 284} y={PLOT.y + 50}>南北向{topCalculation ? "面筋" : "地筋"}Piece</text>
            {topCalculation && <><line x1={PLOT.x + 407} y1={PLOT.y + 46} x2={PLOT.x + 442} y2={PLOT.y + 46} stroke="#1d4ed8" strokeWidth="5" /><circle cx={PLOT.x + 424} cy={PLOT.y + 46} r="4" fill="white" stroke="#1d4ed8" strokeWidth="2" /><text x={PLOT.x + 449} y={PLOT.y + 50}>通墙面筋Piece</text></>}
          </>}
        </g>
        <g aria-label="方向标识" fontSize="13" fill="#334155" pointerEvents="none">
          <rect x={PLOT.x + 10} y={PLOT.y + PLOT.height - 42} width="140" height="32" rx="8" fill="white" fillOpacity="0.88" stroke="#e2e8f0" />
          <line x1={PLOT.x + 22} y1={PLOT.y + PLOT.height - 26} x2={PLOT.x + 92} y2={PLOT.y + PLOT.height - 26} stroke="#2563eb" strokeWidth="3" /><path d={`M${PLOT.x + 92} ${PLOT.y + PLOT.height - 26} l-12 -6 v12 z`} fill="#2563eb" /><text x={PLOT.x + 22} y={PLOT.y + PLOT.height - 10}>西</text><text x={PLOT.x + 96} y={PLOT.y + PLOT.height - 10}>东 · X</text>
          <line x1={PLOT.x + 132} y1={PLOT.y + PLOT.height - 26} x2={PLOT.x + 132} y2={PLOT.y + PLOT.height - 78} stroke="#dc2626" strokeWidth="3" /><path d={`M${PLOT.x + 132} ${PLOT.y + PLOT.height - 78} l-6 12 h12 z`} fill="#dc2626" /><text x={PLOT.x + 118} y={PLOT.y + PLOT.height - 8}>南</text><text x={PLOT.x + 114} y={PLOT.y + PLOT.height - 82}>北 · Y</text>
        </g>
        </svg>
      </div>
      {selectedPiece && <FloorPieceInspector piece={selectedPiece} throughPathName={throughPathName} />}
    </div>
  );
}
