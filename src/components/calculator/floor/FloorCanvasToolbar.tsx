"use client";

import { Eye, Focus, Layers3, Maximize2, Minimize2, Minus, Move, Plus, Redo2, Settings2, Undo2 } from "lucide-react";
import { useState } from "react";
import type { FloorCanvasFitMode } from "@/lib/floor-2d";
import type { FloorWorkspaceInputProfile } from "./useFloorWorkspaceProfile";

export type FloorCanvasEditMode = "move" | "dock" | "multi";
/** PRD 16-17：水平=只允许X变化（Y固定）；垂直=只允许Y变化（X固定）。 */
export type FloorCanvasAxisLock = "free" | "horizontal" | "vertical";

/**
 * Floor Workspace UI V3 Toolbar（PRD 19-24）：
 * Primary 只保留高频操作，Fit/锁轴等次要工具收进「视图」Popover；
 * 触摸尺寸由 inputProfile 决定（touch≥44px，desktop 36~40px），不再依赖 xl 断点。
 */
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
  inputProfile = "desktop",
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
  inputProfile?: FloorWorkspaceInputProfile;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const touch = inputProfile === "touch";
  const buttonClass = `shrink-0 rounded-md px-2.5 text-xs font-semibold ${touch ? "min-h-11" : "min-h-9"}`;
  const iconClass = `inline-flex shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 disabled:opacity-35 ${touch ? "min-h-11" : "min-h-9"}`;
  const zoomButtonClass = `shrink-0 rounded-md px-2 text-xs font-semibold text-slate-600 ${touch ? "min-h-11" : "min-h-9"}`;

  const runFit = (mode: FloorCanvasFitMode) => {
    onFit(mode);
    setViewOpen(false);
  };

  return (
    <div
      className="pointer-events-auto mx-auto flex w-max max-w-full items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white/95 px-2 py-1 shadow-sm backdrop-blur"
      data-testid="floor-canvas-toolbar"
      aria-label="画布工具栏"
    >
      <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="编辑模式">
        <button type="button" onClick={() => onEditModeChange("move")} aria-pressed={editMode === "move"} data-edit-mode-button="move" className={`${buttonClass} ${editMode === "move" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Move size={13} className="mr-1 inline" />移动</button>
        <button type="button" onClick={() => onEditModeChange("dock")} aria-pressed={editMode === "dock"} data-edit-mode-button="dock" className={`${buttonClass} ${editMode === "dock" ? "bg-white text-orange-600 shadow-sm" : "text-slate-600"}`}>拼接</button>
        <button type="button" onClick={() => onEditModeChange("multi")} aria-pressed={editMode === "multi"} data-edit-mode-button="multi" className={`${buttonClass} ${editMode === "multi" ? "bg-white text-violet-600 shadow-sm" : "text-slate-600"}`}>多选对齐</button>
      </div>
      <div className="h-6 w-px shrink-0 bg-slate-200" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="撤销" title="撤销 (Ctrl+Z)" className={iconClass}><Undo2 size={14} /></button>
      <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="重做" title="重做 (Ctrl+Shift+Z)" className={iconClass}><Redo2 size={14} /></button>
      <div className="h-6 w-px shrink-0 bg-slate-200" />
      <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="缩放控制">
        <button type="button" onClick={onZoomOut} aria-label="缩小" className={zoomButtonClass}><Minus size={13} /></button>
        <span className="min-w-12 shrink-0 text-center text-xs font-bold text-slate-800" data-testid="canvas-zoom-percent">{Math.round(zoomPercent)}%</span>
        <button type="button" onClick={onZoomIn} aria-label="放大" className={zoomButtonClass}><Plus size={13} /></button>
      </div>
      <div className="h-6 w-px shrink-0 bg-slate-200" />
      <div className="relative shrink-0">
        <button type="button" onClick={() => setViewOpen((value) => !value)} aria-expanded={viewOpen} aria-label="视图" title="视图与移动锁轴" className={`${iconClass} ${viewOpen ? "bg-blue-50 text-blue-700" : ""}`}><Settings2 size={14} /></button>
        {viewOpen && (
          <>
            <button type="button" aria-label="关闭视图菜单" onClick={() => setViewOpen(false)} className="fixed inset-0 z-30 cursor-default" />
            <div className="absolute right-0 top-full z-40 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10" data-testid="canvas-view-popover">
              <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">画布取景</p>
              <button type="button" onClick={() => runFit("floor")} aria-pressed={fitMode === "floor"} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${fitMode === "floor" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>适合楼层</button>
              <button type="button" onClick={() => runFit("selection")} aria-pressed={fitMode === "selection"} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${fitMode === "selection" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}><Focus size={13} />选中</button>
              {domainHighlighted && <button type="button" onClick={() => runFit("domain")} aria-pressed={fitMode === "domain"} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${fitMode === "domain" ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}><Layers3 size={13} />区域</button>}
              <button type="button" onClick={() => runFit("all")} aria-pressed={fitMode === "all"} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${fitMode === "all" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}><Eye size={13} />查看全部</button>
              <div className="my-1.5 border-t border-slate-100" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">移动锁轴</p>
              {(["free", "horizontal", "vertical"] as const).map((lock) => (
                <button key={lock} type="button" onClick={() => { onAxisLockChange(lock); setViewOpen(false); }} aria-pressed={axisLock === lock} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${axisLock === lock ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>{lock === "free" ? "自由移动" : lock === "horizontal" ? "水平移动" : "垂直移动"}</button>
              ))}
            </div>
          </>
        )}
      </div>
      <button type="button" onClick={onToggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? "退出全屏画布" : "全屏画布"} className={iconClass}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    </div>
  );
}
