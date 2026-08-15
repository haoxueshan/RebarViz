"use client";

import { Eye, Focus, Layers3, Maximize2, Minimize2, Minus, Move, Plus, Redo2, Undo2 } from "lucide-react";
import type { FloorCanvasFitMode } from "@/lib/floor-2d";

export type FloorCanvasEditMode = "move" | "dock" | "multi";
/** PRD 16-17：水平=只允许X变化（Y固定）；垂直=只允许Y变化（X固定）。 */
export type FloorCanvasAxisLock = "free" | "horizontal" | "vertical";

const BUTTON_CLASS = "min-h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold md:min-h-11 xl:min-h-9";
const ICON_BUTTON_CLASS = "inline-flex min-h-9 shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 disabled:opacity-35 md:min-h-11 xl:min-h-9";

export function FloorCanvasToolbar({
  editMode,
  onEditModeChange,
  axisLock,
  onAxisLockChange,
  fitMode,
  onFit,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  fullscreen,
  onToggleFullscreen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  domainHighlighted = false,
}: {
  editMode: FloorCanvasEditMode;
  onEditModeChange: (mode: FloorCanvasEditMode) => void;
  axisLock: FloorCanvasAxisLock;
  onAxisLockChange: (lock: FloorCanvasAxisLock) => void;
  fitMode: FloorCanvasFitMode;
  onFit: (mode: FloorCanvasFitMode) => void;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  domainHighlighted?: boolean;
}) {
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 flex-nowrap items-center justify-start gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white/90 px-2 py-1.5 shadow-lg shadow-slate-900/5 backdrop-blur"
      data-testid="floor-canvas-toolbar"
      aria-label="画布工具栏"
    >
      <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="编辑模式">
        <button type="button" onClick={() => onEditModeChange("move")} aria-pressed={editMode === "move"} data-edit-mode-button="move" className={`${BUTTON_CLASS} ${editMode === "move" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Move size={13} className="mr-1 inline" />移动</button>
        <button type="button" onClick={() => onEditModeChange("dock")} aria-pressed={editMode === "dock"} data-edit-mode-button="dock" className={`${BUTTON_CLASS} ${editMode === "dock" ? "bg-white text-orange-600 shadow-sm" : "text-slate-600"}`}>拼接</button>
        <button type="button" onClick={() => onEditModeChange("multi")} aria-pressed={editMode === "multi"} data-edit-mode-button="multi" className={`${BUTTON_CLASS} ${editMode === "multi" ? "bg-white text-violet-600 shadow-sm" : "text-slate-600"}`}>多选对齐</button>
      </div>
      <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="移动锁轴">
        {(["free", "horizontal", "vertical"] as const).map((lock) => (
          <button key={lock} type="button" onClick={() => onAxisLockChange(lock)} aria-pressed={axisLock === lock} className={`${BUTTON_CLASS} ${axisLock === lock ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>{lock === "free" ? "自由" : lock === "horizontal" ? "水平" : "垂直"}</button>
        ))}
      </div>
      <div className="h-6 w-px shrink-0 bg-slate-200" />
      <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="画布取景范围">
        <button type="button" onClick={() => onFit("floor")} aria-pressed={fitMode === "floor"} className={`${BUTTON_CLASS} ${fitMode === "floor" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>适合楼层</button>
        <button type="button" onClick={() => onFit("selection")} aria-pressed={fitMode === "selection"} className={`${BUTTON_CLASS} ${fitMode === "selection" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Focus size={12} className="mr-1 inline" />选中</button>
        {domainHighlighted && <button type="button" onClick={() => onFit("domain")} aria-pressed={fitMode === "domain"} className={`${BUTTON_CLASS} ${fitMode === "domain" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600"}`}><Layers3 size={12} className="mr-1 inline" />区域</button>}
        <button type="button" onClick={() => onFit("all")} aria-pressed={fitMode === "all"} className={`${BUTTON_CLASS} ${fitMode === "all" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Eye size={12} className="mr-1 inline" />查看全部</button>
      </div>
      <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="缩放控制">
        <button type="button" onClick={onZoomOut} aria-label="缩小" className="min-h-9 shrink-0 rounded-md px-2 text-xs font-semibold text-slate-600 md:min-h-11 xl:min-h-9"><Minus size={13} /></button>
        <span className="min-w-12 shrink-0 text-center text-xs font-bold text-slate-800" data-testid="canvas-zoom-percent">{Math.round(zoomPercent)}%</span>
        <button type="button" onClick={onZoomIn} aria-label="放大" className="min-h-9 shrink-0 rounded-md px-2 text-xs font-semibold text-slate-600 md:min-h-11 xl:min-h-9"><Plus size={13} /></button>
      </div>
      <div className="h-6 w-px shrink-0 bg-slate-200" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="撤销" title="撤销 (Ctrl+Z)" className={ICON_BUTTON_CLASS}><Undo2 size={14} /></button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="重做" title="重做 (Ctrl+Shift+Z)" className={ICON_BUTTON_CLASS}><Redo2 size={14} /></button>
      <button type="button" onClick={onToggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? "退出全屏画布" : "全屏画布"} className={ICON_BUTTON_CLASS}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    </div>
  );
}
