"use client";

import { Eye, Focus, Layers3, Move, TriangleAlert } from "lucide-react";
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
  floorDockDirectionLabel,
  type FloorDockDirection,
  type FloorDockPreview,
} from "@/lib/floor-docking";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";
import {
  floorBarRoleLabel,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import type { FloorBarPiece } from "@/lib/floor-rebar-types";

export type FloorSelection =
  | { kind: "slab"; id: string }
  | { kind: "opening"; id: string }
  | null;

type DragState = {
  pointerId: number;
  selection: Exclude<FloorSelection, null>;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  pixelsPerWorldX: number;
  pixelsPerWorldY: number;
};

type DrawablePiece = {
  piece: FloorBarPiece;
  positionMm: number;
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 650;
const PLOT = { x: 72, y: 54, width: 856, height: 520 };

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [fitMode, setFitMode] = useState<FloorCanvasFitMode>(initialFitMode);
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

  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(state.outerWallThickness, 240) * 1.8;
  const scale = Math.min(PLOT.width / (worldWidth + padding * 2), PLOT.height / (worldHeight + padding * 2));
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = PLOT.x + (PLOT.width - drawnWidth) / 2 - bounds.minX * scale;
  const originY = PLOT.y + (PLOT.height - drawnHeight) / 2 + bounds.maxY * scale;
  const toX = (x: number) => originX + x * scale;
  const toY = (y: number) => originY - y * scale;
  const visibleWorld = {
    minX: (PLOT.x - originX) / scale,
    maxX: (PLOT.x + PLOT.width - originX) / scale,
    minY: (originY - (PLOT.y + PLOT.height)) / scale,
    maxY: (originY - PLOT.y) / scale,
  };
  const gridStep = chooseFloorGridStep(scale * svgWidthPx / SVG_WIDTH);
  const minorXs = gridCoordinates(visibleWorld.minX, visibleWorld.maxX, gridStep.minorMm);
  const minorYs = gridCoordinates(visibleWorld.minY, visibleWorld.maxY, gridStep.minorMm);
  const majorXs = gridCoordinates(visibleWorld.minX, visibleWorld.maxX, gridStep.majorMm);
  const majorYs = gridCoordinates(visibleWorld.minY, visibleWorld.maxY, gridStep.majorMm);

  const dragPosition = (event: React.PointerEvent<SVGSVGElement>, drag: DragState) => ({
    x: Math.round(drag.startX + (event.clientX - drag.startClientX) * drag.pixelsPerWorldX),
    y: Math.round(drag.startY - (event.clientY - drag.startClientY) * drag.pixelsPerWorldY),
  });

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
    dragRef.current = {
      pointerId: event.pointerId,
      selection: nextSelection,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x,
      startY: object.y,
      pixelsPerWorldX: SVG_WIDTH / rect.width / scale,
      pixelsPerWorldY: SVG_HEIGHT / rect.height / scale,
    };
    try {
      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    } catch {
      // 部分触控取消/自动化事件不允许捕获；SVG内移动与cancel回滚仍然有效。
    }
    onDragStateChange?.(true);
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = dragPosition(event, drag);
    onMove(drag.selection, moved.x, moved.y, true);
    dragRef.current = null;
    onDragStateChange?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onMove(drag.selection, drag.startX, drag.startY, false);
    dragRef.current = null;
    onDragStateChange?.(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
  const modeHint = editMode === "dock"
    ? (!dockSource ? "点击选择源板区" : !dockTarget ? "已选源板区，点击选择目标板区" : "已选目标板区，点击目标四边确认拼接")
    : editMode === "multi"
      ? `已选${multiSelection.size}个板区，选择2个以上后可对齐`
      : "拖动板区或洞口自由布置";
  const dockGhost = dockPreview?.sourcePreview ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50" data-testid="floor-canvas-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900">{topCalculation ? "整层面筋净跨路径" : bottomCalculation ? "整层地筋净跨路径" : "整层板区平面"}</h2>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-slate-500 lg:hidden">图中钢筋线表示净跨位置关系；实际下料长度以料单/钢筋详情为准，已包含墙厚、端部增加及通墙中间墙厚。网格为净跨坐标辅助网格。</p>
          <p className="mt-0.5 hidden text-xs leading-5 text-slate-500 lg:block">净跨布置示意；下料长度以钢筋详情/料单为准。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {uncoveredOpenings.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700"><TriangleAlert size={13} /> 有{uncoveredOpenings.length}个洞口位于楼板范围外</span>}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="画布取景范围">
            <button type="button" onClick={() => setFitMode("floor")} aria-pressed={fitMode === "floor"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${fitMode === "floor" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>适合楼层</button>
            <button type="button" disabled={!selection} onClick={() => setFitMode("selection")} aria-pressed={fitMode === "selection"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-40 ${fitMode === "selection" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Focus size={13} className="mr-1 inline" />选中</button>
            {highlightedRoleDomain && <button type="button" onClick={() => setFitMode("domain")} aria-pressed={fitMode === "domain"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${fitMode === "domain" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}><Layers3 size={13} className="mr-1 inline" />区域</button>}
            <button type="button" onClick={() => setFitMode("all")} aria-pressed={fitMode === "all"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${fitMode === "all" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Eye size={13} className="mr-1 inline" />查看全部</button>
          </div>
          <span className="inline-flex min-h-10 items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"><Move size={13} /> {modeHint}</span>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="编辑模式" data-testid="floor-edit-mode">
            <button type="button" onClick={() => onEditModeChange?.("move")} aria-pressed={editMode === "move"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${editMode === "move" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>移动</button>
            <button type="button" onClick={() => onEditModeChange?.("dock")} aria-pressed={editMode === "dock"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${editMode === "dock" ? "bg-white text-orange-600 shadow-sm" : "text-slate-600"}`}>拼接</button>
            <button type="button" onClick={() => onEditModeChange?.("multi")} aria-pressed={editMode === "multi"} className={`min-h-11 rounded-lg px-3 text-xs font-semibold ${editMode === "multi" ? "bg-white text-violet-600 shadow-sm" : "text-slate-600"}`}>多选对齐</button>
          </div>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-[clamp(360px,54dvh,430px)] w-full select-none bg-white md:h-[clamp(380px,52dvh,500px)] lg:h-[clamp(330px,42dvh,460px)] xl:h-auto"
        role="img"
        aria-label="整层板区、洞口、正式钢筋Piece和支承关系布局预览"
        data-floor-canvas-fit={fitMode}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          setSelectedPieceId(null);
          onSelect(null);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const moved = dragPosition(event, drag);
          onMove(drag.selection, moved.x, moved.y, false);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
      >
        <defs>
          <clipPath id="floor-plot-clip-v22"><rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" /></clipPath>
          <pattern id="opening-hatch-v22" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="12" height="12" fill="#f8fafc" />
            <line x1="0" y1="0" x2="0" y2="12" stroke="#cbd5e1" strokeWidth="4" />
          </pattern>
        </defs>
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" fill="#fff" stroke="#cbd5e1" />

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
                width={Math.max(slab.width * scale, 1)} height={Math.max(slab.height * scale, 1)}
                fill={slabFill(slab.type, selected)} fillOpacity={ghostDimmed ? 0.25 : highlightedRoleDomain ? domainHighlighted ? 1 : 0.42 : 1}
                stroke={dockSourceSelected ? "#f97316" : dockTargetSelected ? "#0ea5e9" : multiSelected ? "#8b5cf6" : selected ? "#2563eb" : domainHighlighted ? "#4f46e5" : "#94a3b8"}
                strokeWidth={dockSourceSelected || dockTargetSelected || multiSelected ? 4 : selected ? 4 : domainHighlighted ? 3 : 1.5}
                className={interactive ? "cursor-move touch-none" : editMode === "dock" ? "cursor-pointer touch-none" : "cursor-crosshair touch-none"}
                role="button" aria-label={`选择板区 ${slab.name}`} tabIndex={0}
                data-dock-role={dockSourceSelected ? "source" : dockTargetSelected ? "target" : undefined}
                data-multi-selected={multiSelected ? "true" : undefined}
                onPointerDown={(event) => {
                  if (editMode === "dock") { event.stopPropagation(); onDockPick?.(slab.id); return; }
                  if (editMode === "multi") { event.stopPropagation(); onMultiToggle?.(slab.id); return; }
                  beginDrag(event, { kind: "slab", id: slab.id }, slab);
                }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelect({ kind: "slab", id: slab.id }); } }}
              />
            );
          })}
          {state.openings.map((opening) => (
            <rect
              key={`opening-fill-${opening.id}`}
              x={toX(opening.x)} y={toY(opening.y + opening.height)}
              width={Math.max(opening.width * scale, 1)} height={Math.max(opening.height * scale, 1)}
              fill="url(#opening-hatch-v22)" stroke="transparent" className="cursor-move touch-none"
              role="button" aria-label={`选择洞口 ${opening.name}`} tabIndex={0}
              onPointerDown={(event) => beginDrag(event, { kind: "opening", id: opening.id }, opening)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelect({ kind: "opening", id: opening.id }); } }}
            />
          ))}
        </g>

        {dockGhost && <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="dock-ghost" pointerEvents="none" data-dock-ghost="true">
          <rect
            x={toX(dockGhost.x)} y={toY(dockGhost.y + dockGhost.height)}
            width={Math.max(dockGhost.width * scale, 1)} height={Math.max(dockGhost.height * scale, 1)}
            fill="#3b82f6" fillOpacity="0.35" stroke="#2563eb" strokeWidth="3" strokeDasharray="8 5"
          />
          <text x={toX(dockGhost.x + dockGhost.width / 2)} y={toY(dockGhost.y + dockGhost.height / 2) + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#1d4ed8">{dockGhost.name} 预览</text>
        </g>}

        {editMode === "dock" && dockTarget && (() => {
          const target = dockTarget;
          const sides: Array<{ direction: FloorDockDirection; x: number; y: number; width: number; height: number; labelX: number; labelY: number }> = [
            { direction: "north", x: toX(target.x), y: toY(target.y + target.height) - 48, width: Math.max(target.width * scale, 1), height: 88, labelX: toX(target.x + target.width / 2), labelY: toY(target.y + target.height) - 52 },
            { direction: "south", x: toX(target.x), y: toY(target.y) - 40, width: Math.max(target.width * scale, 1), height: 88, labelX: toX(target.x + target.width / 2), labelY: toY(target.y) + 14 },
            { direction: "west", x: toX(target.x) - 48, y: toY(target.y + target.height), width: 88, height: Math.max(target.height * scale, 1), labelX: toX(target.x) - 52, labelY: toY(target.y + target.height / 2) + 4 },
            { direction: "east", x: toX(target.x + target.width) - 40, y: toY(target.y + target.height), width: 88, height: Math.max(target.height * scale, 1), labelX: toX(target.x + target.width) + 8, labelY: toY(target.y + target.height / 2) + 4 },
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

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="normal-pieces-visible" pointerEvents="none">
          {normalPieces.map((drawable) => {
            const { piece } = drawable;
            const coordinates = pieceCoordinates(drawable);
            const topLayer = piece.layer === "top";
            const selected = selectedPiece?.id === piece.id;
            return <line key={piece.id} {...coordinates} opacity={highlightedThroughPathId ? 0.25 : 1} stroke={topLayer ? piece.direction === "x" ? "#0891b2" : "#047857" : piece.direction === "x" ? "#dc2626" : "#7c3aed"} strokeWidth={selected ? 5 : topLayer ? 2.8 : 2.4} strokeDasharray={topLayer ? "8 5" : undefined} strokeLinecap="round" />;
          })}
        </g>
        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="normal-pieces-hit">
          {normalPieces.map((drawable) => {
            const coordinates = pieceCoordinates(drawable);
            return <line key={`hit:${drawable.piece.id}`} {...coordinates} stroke="transparent" strokeWidth="16" pointerEvents="stroke" className="cursor-pointer" data-piece-id={drawable.piece.id} data-piece-source="normal" role="button" tabIndex={0} aria-label={`检查钢筋 ${drawable.piece.id}`} onPointerDown={(event) => { event.stopPropagation(); setSelectedPieceId(drawable.piece.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPieceId(drawable.piece.id); }} />;
          })}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="display-boundaries" pointerEvents="none">
          {displayBoundaries.map((segment) => {
            const style = wallStyle(segment, scale);
            return <line key={segment.id} x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)} stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} strokeLinecap="square" />;
          })}
          {state.openings.map((opening) => {
            const selected = selection?.kind === "opening" && selection.id === opening.id;
            return <rect key={`opening-outline-${opening.id}`} x={toX(opening.x)} y={toY(opening.y + opening.height)} width={Math.max(opening.width * scale, 1)} height={Math.max(opening.height * scale, 1)} fill="none" stroke={selected ? "#e11d48" : "#64748b"} strokeWidth={selected ? 4 : 2.5} strokeDasharray="9 6" />;
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

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="through-pieces-visible" pointerEvents="none">
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
        </g>
        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="through-pieces-hit">
          {throughPieces.map((drawable) => {
            const coordinates = pieceCoordinates(drawable);
            return <line key={`hit:${drawable.piece.id}`} {...coordinates} stroke="transparent" strokeWidth="18" pointerEvents="stroke" className="cursor-pointer" data-piece-id={drawable.piece.id} data-piece-source="through" role="button" tabIndex={0} aria-label={`检查通墙钢筋 ${drawable.piece.id}`} onPointerDown={(event) => { event.stopPropagation(); setSelectedPieceId(drawable.piece.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPieceId(drawable.piece.id); }} />;
          })}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="atomic-boundary-hit">
          {atomicBoundaries.map((segment) => (
            <line
              key={`atomic-hit:${segment.id}`}
              x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)}
              stroke="transparent" strokeWidth="22" pointerEvents="stroke" className="cursor-pointer"
              data-atomic-boundary-id={segment.id} data-boundary-support={segment.support} data-boundary-kind={segment.geometryKind}
              role="button" tabIndex={0} aria-label={`编辑${segment.geometryKind === "shared-slab" ? "共享板边" : segment.geometryKind === "opening-edge" ? "洞口边" : "建筑外边"} ${segment.id}`}
              onPointerDown={(event) => { event.stopPropagation(); setSelectedPieceId(null); onSelectBoundary(segment); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedPieceId(null); onSelectBoundary(segment); } }}
            />
          ))}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="labels" pointerEvents="none">
          {state.slabs.map((slab) => {
            const centerX = toX(slab.x + slab.width / 2);
            const centerY = toY(slab.y + slab.height / 2);
            const selected = selection?.kind === "slab" && selection.id === slab.id;
            const shortName = slab.name.length > 10 ? `${slab.name.slice(0, 9)}…` : slab.name;
            if (!selected) return <text key={`label-${slab.id}`} x={centerX} y={centerY + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4, strokeLinejoin: "round" }}>{shortName}</text>;
            return <g key={`label-${slab.id}`}><rect x={centerX - 88} y={centerY - 42} width="176" height="84" rx="8" fill="white" fillOpacity="0.94" stroke="#93c5fd" /><text x={centerX} y={centerY - 19} textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">{shortName}</text><text x={centerX} y={centerY + 1} textAnchor="middle" fontSize="11" fill="#475569">X {formatMm(slab.x)} · Y {formatMm(slab.y)}</text><text x={centerX} y={centerY + 22} textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{formatMm(slab.width)} × {formatMm(slab.height)} mm</text></g>;
          })}
          {state.openings.map((opening) => {
            const centerX = toX(opening.x + opening.width / 2);
            const centerY = toY(opening.y + opening.height / 2);
            const selected = selection?.kind === "opening" && selection.id === opening.id;
            return <g key={`opening-label-${opening.id}`}><rect x={centerX - (selected ? 78 : 52)} y={centerY - (selected ? 37 : 20)} width={selected ? 156 : 104} height={selected ? 74 : 40} rx="7" fill="white" fillOpacity="0.9" /><text x={centerX} y={centerY - (selected ? 17 : 3)} textAnchor="middle" fontSize="13" fontWeight="700" fill="#881337">{opening.name}</text><text x={centerX} y={centerY + (selected ? 1 : 14)} textAnchor="middle" fontSize="10" fontWeight="700" fill="#64748b">VOID</text>{selected && <><text x={centerX} y={centerY + 18} textAnchor="middle" fontSize="10" fill="#64748b">X {formatMm(opening.x)} · Y {formatMm(opening.y)}</text><text x={centerX} y={centerY + 32} textAnchor="middle" fontSize="10" fill="#64748b">{formatMm(opening.width)} × {formatMm(opening.height)} mm</text></>}</g>;
          })}
          {selectedIrregularRole && <g data-irregular-role-domain={selectedIrregularRole.id}><rect x={PLOT.x + 12} y={PLOT.y + PLOT.height - 38} width="270" height="26" rx="6" fill="#fff7ed" stroke="#fdba74" /><text x={PLOT.x + 22} y={PLOT.y + PLOT.height - 20} fontSize="11" fontWeight="700" fill="#9a3412">不规则连续板区域 · 主筋：{roleState?.mainDirectionOverrides[selectedIrregularRole.id] === "x" ? "东西向" : roleState?.mainDirectionOverrides[selectedIrregularRole.id] === "y" ? "南北向" : "未指定"}</text></g>}
        </g>

        <g clipPath="url(#floor-plot-clip-v22)" data-floor-layer="warnings" pointerEvents="none">
          {nearMisses.map((nearMiss, index) => {
            const vertical = nearMiss.orientation === "vertical";
            const x = toX(vertical ? (nearMiss.coordinateA + nearMiss.coordinateB) / 2 : (nearMiss.overlapStartMm + nearMiss.overlapEndMm) / 2);
            const y = toY(vertical ? (nearMiss.overlapStartMm + nearMiss.overlapEndMm) / 2 : (nearMiss.coordinateA + nearMiss.coordinateB) / 2);
            return <g key={`near-miss:${nearMiss.slabIds.join(":")}:${index}`} data-near-miss={nearMiss.distanceMm}><circle cx={x} cy={y} r="12" fill="#fff" stroke="#dc2626" strokeWidth="3" /><text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="900" fill="#dc2626">!</text><text x={x + 16} y={y - 10} fontSize="11" fontWeight="800" fill="#b91c1c" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4 }}>⚠ {formatMm(nearMiss.distanceMm)}mm</text></g>;
          })}
        </g>

        <g aria-label="方向标识" fontSize="13" fill="#334155">
          <line x1="92" y1="608" x2="198" y2="608" stroke="#2563eb" strokeWidth="3" /><path d="M198 608 l-12 -6 v12 z" fill="#2563eb" /><text x="92" y="630">西</text><text x="202" y="630">东 · X</text>
          <line x1="48" y1="555" x2="48" y2="445" stroke="#dc2626" strokeWidth="3" /><path d="M48 445 l-6 12 h12 z" fill="#dc2626" /><text x="30" y="558">南</text><text x="24" y="432">北 · Y</text>
        </g>
        <g transform="translate(560 600)" fontSize="11" fill="#475569">
          <line x1="0" y1="0" x2="35" y2="0" stroke="#0f172a" strokeWidth="7" /><text x="42" y="4">建筑外边</text>
          <line x1="120" y1="0" x2="155" y2="0" stroke="#2563eb" strokeWidth="7" /><text x="162" y="4">内墙</text>
          <line x1="225" y1="0" x2="260" y2="0" stroke="#64748b" strokeWidth="2.5" strokeDasharray="9 6" /><text x="267" y="4">连续</text>
          <line x1="330" y1="0" x2="365" y2="0" stroke="#94a3b8" strokeWidth="3" strokeDasharray="5 6" /><text x="372" y="4">洞口裁断</text>
        </g>
        {rebarCalculation && <g transform="translate(560 625)" fontSize="11" fill="#475569"><line x1="0" y1="0" x2="35" y2="0" stroke={topCalculation ? "#0891b2" : "#dc2626"} strokeWidth={topCalculation ? "2.8" : "2.4"} strokeDasharray={topCalculation ? "8 5" : undefined} /><text x="42" y="4">东西向{topCalculation ? "面筋" : "地筋"}Piece</text><line x1="150" y1="0" x2="185" y2="0" stroke={topCalculation ? "#047857" : "#7c3aed"} strokeWidth={topCalculation ? "2.8" : "2.4"} strokeDasharray={topCalculation ? "8 5" : undefined} /><text x="192" y="4">南北向{topCalculation ? "面筋" : "地筋"}Piece</text>{topCalculation && <><line x1="315" y1="0" x2="350" y2="0" stroke="#1d4ed8" strokeWidth="5" /><circle cx="332" cy="0" r="4" fill="white" stroke="#1d4ed8" strokeWidth="2" /><text x="357" y="4">通墙面筋Piece</text></>}</g>}
      </svg>
      {selectedPiece && <FloorPieceInspector piece={selectedPiece} throughPathName={throughPathName} />}
    </div>
  );
}
