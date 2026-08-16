"use client";

import { CircleHelp, Settings, Check } from "lucide-react";

export function FloorWorkspaceShell({
  workflow,
  body,
  status,
  fullscreen = false,
  showAppBar = true,
}: {
  workflow: React.ReactNode;
  body: React.ReactNode;
  status?: React.ReactNode;
  fullscreen?: boolean;
  showAppBar?: boolean;
}) {
  return (
    <main className={fullscreen ? "h-full" : "min-h-0 w-full bg-slate-100 p-2 sm:p-3"} data-testid="floor-workspace-shell">
      <div data-testid={fullscreen ? "floor-fullscreen-canvas" : undefined} className={fullscreen ? "fixed inset-0 z-[90] flex min-h-0 flex-col overflow-hidden bg-slate-100" : "flex h-[calc(100dvh-5.25rem)] min-h-[520px] flex-col overflow-hidden border border-slate-200 bg-white shadow-sm"}>
        {!fullscreen && showAppBar && (
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-4" data-testid="floor-workspace-app-bar">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <strong className="shrink-0 text-slate-950">RebarViz</strong>
              <span className="text-slate-300">|</span>
              <span className="truncate text-slate-600">一层楼板</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="hidden items-center gap-1 text-xs font-medium text-emerald-700 sm:inline-flex"><Check size={14} />已自动保存</span>
              <button type="button" title="工作区设置" aria-label="工作区设置" className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Settings size={17} /></button>
              <button type="button" title="帮助" aria-label="帮助" className="flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><CircleHelp size={17} /></button>
            </div>
          </header>
        )}
        <div className="shrink-0 border-b border-slate-200 bg-white">{workflow}</div>
        <div className="relative min-h-0 flex-1">{body}</div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
    </main>
  );
}
