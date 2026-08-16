"use client";

import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";
import type { FloorWorkflowStage } from "./floor-workspace-types";

/**
 * UI V5：Unified Bottom Status Bar——合并原 ResultStrip 与 StatusBar，
 * 高度约 44px（min-h-11），有错误优先显示问题，无错误显示计算摘要。
 * 兼容 test id：floor-workspace-status-bar（V4）/ floor-live-summary（摘要）/ floor-unified-status-bar（V5）。
 */
export function FloorWorkspaceStatusBar({
  stage,
  mode,
  selectionLabel,
  detail,
  issueCount,
  zoomPercent,
  saved,
  bottom,
  top,
  onOpenIssues,
  onOpenBom,
}: {
  stage: FloorWorkflowStage;
  mode: string;
  selectionLabel: string;
  detail?: string;
  issueCount: number;
  zoomPercent: number;
  saved: boolean;
  bottom: FloorBottomCalculation;
  top: FloorTopCalculation;
  onOpenIssues: () => void;
  onOpenBom: () => void;
}) {
  const stageLabel = stage === "plan" ? "楼层" : stage === "bottom" ? "地筋" : stage === "top" ? "面筋" : "料单";
  const calculation = stage === "bottom" ? bottom : stage === "top" ? top : null;
  const hasIssues = issueCount > 0;
  const summaryText = !calculation
    ? null
    : calculation.isValid
      ? `${stageLabel}有效 · 理论线 ${calculation.totalBarLines} · Piece ${calculation.totalPieces}${stage === "top" ? ` · Through ${top.throughPieceCount}` : ""} · ${calculation.totalLengthM.toFixed(3)}m · ${calculation.totalWeightKg?.toFixed(2) ?? "--"}kg`
      : `${stageLabel}结果无效 · ${calculation.errors.length}个问题`;

  return (
    <footer className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-600" data-testid="floor-unified-status-bar">
      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 overflow-hidden" data-testid="floor-workspace-status-bar">
        <strong className="shrink-0 text-slate-800">{stageLabel}</strong>
        <span className="text-slate-300">|</span>
        <span className="shrink-0">{mode}</span>
        <span className="text-slate-300">|</span>
        <span className="truncate font-medium text-slate-800" data-testid="status-selection-label">{selectionLabel}</span>
        <span className="hidden text-slate-300 sm:inline">|</span>
        <div className={`flex min-w-0 items-center gap-2 ${hasIssues ? "font-semibold text-rose-700" : ""}`} data-testid="floor-live-summary">
          <span className="min-w-0 truncate">{summaryText ?? (hasIssues ? `${stageLabel}有 ${issueCount} 个问题` : detail ?? "")}</span>
          {stage !== "plan" && !hasIssues && (
            <button type="button" onClick={onOpenBom} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-semibold text-slate-700 hover:bg-slate-50"><FileText size={13} />查看料单</button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {hasIssues ? (
          <button type="button" onClick={onOpenIssues} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-semibold text-rose-700 hover:bg-rose-50" data-testid="status-issues-button">
            <AlertTriangle size={13} />
            {issueCount}个问题
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 size={13} />正常</span>
        )}
        <span className="tabular-nums" data-testid="status-zoom">{Math.round(zoomPercent)}%</span>
        {saved && <span className="hidden items-center gap-1 text-emerald-700 lg:inline-flex" data-testid="status-saved"><span className="size-1.5 rounded-full bg-emerald-500" />已保存</span>}
      </div>
    </footer>
  );
}
