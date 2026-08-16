"use client";

/**
 * UI V5：删除工作区内部 App Bar（与全局 Header 重复），
 * “已自动保存”语义移入底部统一状态栏。
 */
export function FloorWorkspaceShell({
  workflow,
  body,
  status,
  fullscreen = false,
}: {
  workflow: React.ReactNode;
  body: React.ReactNode;
  status?: React.ReactNode;
  fullscreen?: boolean;
}) {
  return (
    <main className={fullscreen ? "h-full" : "min-h-0 w-full bg-slate-100 p-2 sm:p-3"} data-testid="floor-workspace-root">
      <div data-testid={fullscreen ? "floor-fullscreen-canvas" : undefined} className={fullscreen ? "fixed inset-0 z-[90] flex min-h-0 flex-col overflow-hidden bg-slate-100" : "flex h-[calc(100dvh-5.25rem)] min-h-[520px] flex-col overflow-hidden border border-slate-200 bg-white shadow-sm"}>
        <div className="shrink-0 border-b border-slate-200 bg-white">{workflow}</div>
        <div className="relative min-h-0 flex-1">{body}</div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
    </main>
  );
}
