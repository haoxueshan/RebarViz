"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { FloorWorkflowStage } from "./floor-workspace-types";

export function FloorWorkspaceStatusBar({
  stage,
  mode,
  selectionLabel,
  detail,
  issueCount,
  zoomPercent,
  onOpenIssues,
}: {
  stage: FloorWorkflowStage;
  mode: string;
  selectionLabel: string;
  detail?: string;
  issueCount: number;
  zoomPercent: number;
  onOpenIssues: () => void;
}) {
  const stageLabel = stage === "plan" ? "楼层" : stage === "bottom" ? "地筋" : stage === "top" ? "面筋" : "料单";
  return (
    <footer className="flex min-h-9 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-600 sm:px-4" data-testid="floor-workspace-status-bar">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <strong className="shrink-0 text-slate-800">{stageLabel}</strong>
        <span className="text-slate-300">|</span>
        <span className="shrink-0">{mode}</span>
        <span className="text-slate-300">|</span>
        <span className="truncate font-medium text-slate-800" data-testid="status-selection-label">{selectionLabel}</span>
        {detail && <><span className="hidden text-slate-300 sm:inline">|</span><span className="hidden truncate sm:inline">{detail}</span></>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button type="button" onClick={onOpenIssues} className={`inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-semibold ${issueCount > 0 ? "text-rose-700 hover:bg-rose-50" : "text-emerald-700"}`} data-testid="status-issues-button">
          {issueCount > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          {issueCount > 0 ? `${issueCount}个问题` : "状态正常"}
        </button>
        <span className="tabular-nums" data-testid="status-zoom">{Math.round(zoomPercent)}%</span>
      </div>
    </footer>
  );
}
