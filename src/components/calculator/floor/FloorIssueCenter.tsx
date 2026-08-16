"use client";

import { AlertTriangle, LocateFixed, X } from "lucide-react";
import type { FloorWorkspaceIssue } from "./floor-workspace-types";

export function FloorIssueCenter({ open, issues, onClose, onLocate }: { open: boolean; issues: readonly FloorWorkspaceIssue[]; onClose: () => void; onLocate: (issue: FloorWorkspaceIssue) => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[85]" data-testid="floor-issue-center">
      <button type="button" aria-label="关闭问题中心遮罩" onClick={onClose} className="absolute inset-0 bg-slate-950/15" />
      <aside className="absolute inset-y-0 right-0 flex w-[min(92vw,430px)] flex-col bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="工程问题中心">
        <header className="flex min-h-14 items-center justify-between border-b border-slate-200 px-4"><div><strong className="text-slate-950">工程问题</strong><span className="ml-2 text-xs text-slate-500">{issues.length}项</span></div><button type="button" onClick={onClose} aria-label="关闭问题中心" className="flex size-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={19} /></button></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          {issues.length === 0 ? <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">当前没有需要处理的问题。</p> : <ol className="space-y-2">{issues.map((issue, index) => <li key={issue.id} className="border-b border-slate-200 px-1 py-3"><div className="flex items-start gap-2"><AlertTriangle size={16} className={issue.severity === "error" ? "mt-0.5 shrink-0 text-rose-600" : "mt-0.5 shrink-0 text-amber-600"} /><div className="min-w-0 flex-1"><strong className="text-sm text-slate-900">{index + 1}. {issue.title}</strong>{issue.detail && <p className="mt-1 text-xs leading-5 text-slate-600">{issue.detail}</p>}<span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">{issue.stage === "plan" ? "楼层" : issue.stage === "bottom" ? "地筋" : "面筋"} · {issue.code}</span></div></div><button type="button" onClick={() => onLocate(issue)} className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><LocateFixed size={14} />定位</button></li>)}</ol>}
        </div>
      </aside>
    </div>
  );
}
