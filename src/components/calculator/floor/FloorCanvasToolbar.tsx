"use client";

import { Eye, Focus, Layers3, Maximize2, Minimize2, Minus, MoreHorizontal, Move, Plus, Redo2, Settings2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  compactMode = false,
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
  /** UI V5：手机紧凑模式——只显示 移动/拼接/多选 + 更多菜单。 */
  compactMode?: boolean;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  // UI V3.1：Popover 使用 fixed 定位（相对按钮计算），避免被 Chrome 行 overflow-x-auto 裁剪。
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  // UI V5：手机「更多」菜单（撤销/重做/缩放/视图/锁轴/全屏）。
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [morePos, setMorePos] = useState<{ top: number; right: number } | null>(null);
  const toggleMore = () => {
    setMoreOpen((value) => {
      const next = !value;
      if (next && moreButtonRef.current) {
        const rect = moreButtonRef.current.getBoundingClientRect();
        setMorePos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
      } else {
        setMorePos(null);
      }
      return next;
    });
  };
  const toggleView = () => {
    setViewOpen((value) => {
      const next = !value;
      if (next && viewButtonRef.current) {
        const rect = viewButtonRef.current.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
      } else {
        setPopoverPos(null);
      }
      return next;
    });
  };
  useEffect(() => {
    if (!viewOpen && !moreOpen) return;
    const close = () => { setViewOpen(false); setMoreOpen(false); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [viewOpen, moreOpen]);
  const touch = inputProfile === "touch";
  const buttonClass = `shrink-0 rounded-md px-2.5 text-xs font-semibold ${touch ? "min-h-11" : "min-h-9"}`;
  const iconClass = `inline-flex shrink-0 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 disabled:opacity-35 ${touch ? "min-h-11" : "min-h-9"}`;
  const zoomButtonClass = `shrink-0 rounded-md px-2 text-xs font-semibold text-slate-600 ${touch ? "min-h-11" : "min-h-9"}`;

  const runFit = (mode: FloorCanvasFitMode) => {
    onFit(mode);
    setViewOpen(false);
    setMoreOpen(false);
  };

  // UI V5：手机紧凑模式——只保留编辑模式与「更多」菜单，撤销/缩放/视图/锁轴/全屏收进 Popover。
  if (compactMode) {
    return (
      <div
        className="pointer-events-auto mx-auto flex w-max max-w-full items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur"
        data-testid="floor-canvas-toolbar"
        aria-label="画布工具栏"
      >
        <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="编辑模式">
          <button type="button" onClick={() => onEditModeChange("move")} aria-pressed={editMode === "move"} data-edit-mode-button="move" className={`${buttonClass} ${editMode === "move" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}><Move size={13} className="mr-1 inline" />移动</button>
          <button type="button" onClick={() => onEditModeChange("dock")} aria-pressed={editMode === "dock"} data-edit-mode-button="dock" className={`${buttonClass} ${editMode === "dock" ? "bg-white text-orange-600 shadow-sm" : "text-slate-600"}`}>拼接</button>
          <button type="button" onClick={() => onEditModeChange("multi")} aria-pressed={editMode === "multi"} data-edit-mode-button="multi" className={`${buttonClass} ${editMode === "multi" ? "bg-white text-violet-600 shadow-sm" : "text-slate-600"}`}>多选</button>
        </div>
        <div className="h-6 w-px shrink-0 bg-slate-200" />
        <button ref={moreButtonRef} type="button" onClick={toggleMore} aria-expanded={moreOpen} aria-label="更多" title="更多工具" data-testid="floor-mobile-toolbar-more" className={iconClass}><MoreHorizontal size={15} /></button>
        {moreOpen && morePos && (
          <>
            <button type="button" aria-label="关闭更多菜单" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="fixed z-50 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10" style={{ top: morePos.top, right: morePos.right }} data-testid="floor-mobile-toolbar-menu">
              <div className="grid grid-cols-3 gap-1">
                <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="撤销" className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold text-slate-700 disabled:opacity-35 ${canUndo ? "hover:bg-slate-50" : ""}`}><Undo2 size={16} />撤销</button>
                <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="重做" className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold text-slate-700 disabled:opacity-35 ${canRedo ? "hover:bg-slate-50" : ""}`}><Redo2 size={16} />重做</button>
                <button type="button" onClick={onToggleFullscreen} aria-label={fullscreen ? "退出全屏画布" : "全屏画布"} className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold text-slate-700 hover:bg-slate-50">{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}全屏</button>
              </div>
              <div className="my-1.5 border-t border-slate-100" />
              <div className="flex items-center justify-between gap-1 px-1 pb-1">
                <button type="button" onClick={onZoomOut} aria-label="缩小" className={`${zoomButtonClass} flex-1`}><Minus size={13} /></button>
                <span className="min-w-12 shrink-0 text-center text-xs font-bold text-slate-800" data-testid="canvas-zoom-percent">{Math.round(zoomPercent)}%</span>
                <button type="button" onClick={onZoomIn} aria-label="放大" className={`${zoomButtonClass} flex-1`}><Plus size={13} /></button>
              </div>
              <div className="my-1.5 border-t border-slate-100" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">画布取景</p>
              <button type="button" onClick={() => runFit("floor")} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">适合楼层</button>
              <button type="button" onClick={() => runFit("selection")} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">适合选中</button>
              <button type="button" onClick={() => runFit("all")} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">查看全部</button>
              <div className="my-1.5 border-t border-slate-100" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">移动锁轴</p>
              {(["free", "horizontal", "vertical"] as const).map((lock) => (
                <button key={lock} type="button" onClick={() => { onAxisLockChange(lock); setMoreOpen(false); }} aria-pressed={axisLock === lock} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold ${axisLock === lock ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>{lock === "free" ? "自由移动" : lock === "horizontal" ? "水平移动" : "垂直移动"}</button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

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
        <button ref={viewButtonRef} type="button" onClick={toggleView} aria-expanded={viewOpen} aria-label="视图" title="视图与移动锁轴" className={`${iconClass} ${viewOpen ? "bg-blue-50 text-blue-700" : ""}`}><Settings2 size={14} /></button>
        {viewOpen && popoverPos && (
          <>
            <button type="button" aria-label="关闭视图菜单" onClick={() => setViewOpen(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="fixed z-50 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10" style={{ top: popoverPos.top, right: popoverPos.right }} data-testid="canvas-view-popover">
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
