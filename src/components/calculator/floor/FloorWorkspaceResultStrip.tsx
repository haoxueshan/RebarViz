"use client";

import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";

export function FloorWorkspaceResultStrip({
  layer,
  bottom,
  top,
  onOpenBom,
  onOpenIssues,
}: {
  layer: "bottom" | "top";
  bottom: FloorBottomCalculation;
  top: FloorTopCalculation;
  onOpenBom: () => void;
  onOpenIssues: () => void;
}) {
  const calculation = layer === "bottom" ? bottom : top;
  const label = layer === "bottom" ? "地筋" : "面筋";
  if (!calculation.isValid) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-rose-200 bg-rose-50 px-3 text-xs" data-testid="floor-live-summary">
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-rose-800"><AlertTriangle size={15} />{label}结果无效 · {calculation.errors.length}个问题</span>
        <button type="button" onClick={onOpenIssues} className="min-h-9 shrink-0 rounded-lg border border-rose-300 bg-white px-3 font-semibold text-rose-800">查看问题</button>
      </div>
    );
  }
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-3 py-1.5 text-xs" data-testid="floor-live-summary">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 size={15} />{label}有效</span>
        <span>理论线 <strong className="text-slate-900">{calculation.totalBarLines}</strong></span>
        <span>Piece <strong className="text-slate-900">{calculation.totalPieces}</strong></span>
        {layer === "top" && <><span>普通 <strong className="text-slate-900">{top.normalPieceCount}</strong></span><span>Through <strong className="text-slate-900">{top.throughPieceCount}</strong></span></>}
        <span><strong className="text-slate-900">{calculation.totalLengthM.toFixed(3)}</strong>m</span>
        <span><strong className="text-slate-900">{calculation.totalWeightKg?.toFixed(2) ?? "--"}</strong>kg</span>
      </div>
      <button type="button" onClick={onOpenBom} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-700 hover:bg-slate-50"><FileText size={14} />查看料单</button>
    </div>
  );
}
