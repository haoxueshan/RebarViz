"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, FileText } from "lucide-react";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";
import type { FloorWorkflowStage } from "./floor-workspace-types";

function Value({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return <div className="min-w-0 lg:min-w-[72px]"><span className="block text-[10px] font-medium text-slate-500">{label}</span><strong className="mt-0.5 block truncate text-sm text-slate-950">{value}{unit && <small className="ml-1 text-[10px] font-normal text-slate-500">{unit}</small>}</strong></div>;
}

export function FloorWorkspaceSummary({
  stage,
  bottom,
  top,
  geometryErrorCount,
  onShowDetails,
  onShowIssues,
}: {
  stage: FloorWorkflowStage;
  bottom: FloorBottomCalculation;
  top: FloorTopCalculation;
  geometryErrorCount: number;
  onShowDetails: () => void;
  onShowIssues: () => void;
}) {
  if (stage === "plan") return <section className={`flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${geometryErrorCount > 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`} data-testid="floor-live-summary"><div className="flex items-center gap-2">{geometryErrorCount > 0 ? <AlertTriangle className="text-rose-700" size={19} /> : <CheckCircle2 className="text-emerald-700" size={19} />}<div><strong className="text-sm text-slate-950">{geometryErrorCount > 0 ? "楼层几何无效" : "楼层几何有效"}</strong><p className="text-xs text-slate-600">{geometryErrorCount > 0 ? `${geometryErrorCount}个问题会阻止正式计算` : "Atomic支承拓扑可用于正式计算"}</p></div></div>{geometryErrorCount > 0 && <button type="button" onClick={onShowIssues} className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 text-xs font-semibold text-rose-800">查看问题</button>}</section>;
  const calculation = stage === "top" ? top : bottom;
  const label = stage === "top" ? "面筋" : "地筋";
  const issueCount = calculation.errors.length;
  if (!calculation.isValid) return <section className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3" data-testid="floor-live-summary"><div className="flex items-center gap-2"><AlertTriangle className="text-rose-700" size={19} /><div><strong className="text-sm text-slate-950">{label}结果无效</strong><p className="text-xs text-rose-800">{issueCount}个问题；旧的合法统计不会继续显示</p></div></div><button type="button" onClick={onShowIssues} className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 text-xs font-semibold text-rose-800">查看问题</button></section>;
  return <section className="grid min-h-20 grid-cols-1 items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 shadow-sm md:grid-cols-[minmax(150px,auto)_1fr_auto]" data-testid="floor-live-summary"><div className="flex min-w-0 items-center gap-2"><CheckCircle2 className="shrink-0 text-emerald-600" size={19} /><div className="min-w-0"><strong className="block truncate text-sm text-slate-950">正式{label}结果有效</strong><p className="truncate text-[11px] text-slate-500">正式 Calculation 实时结果</p></div></div><div className="grid flex-1 grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:gap-x-6"> <Value label="理论线" value={calculation.totalBarLines} /><Value label="实际Piece" value={calculation.totalPieces} /><Value label="总长度" value={calculation.totalLengthM.toFixed(3)} unit="m" /><Value label="重量" value={calculation.totalWeightKg?.toFixed(2) ?? "--"} unit="kg" />{stage === "top" && <><Value label="普通" value={top.normalPieceCount} /><Value label="通墙" value={top.throughPieceCount} /></>}</div><button type="button" onClick={onShowDetails} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700"><FileText size={15} />详细料单<ChevronDown size={14} /></button></section>;
}
