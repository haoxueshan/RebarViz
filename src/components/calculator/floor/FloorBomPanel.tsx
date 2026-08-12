"use client";

import { FileText, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";
import type { FloorPlanState } from "@/lib/floor-plan";
import {
  buildFloorPrintContent,
  buildFloorPrintSnapshot,
  getFloorPrintEligibility,
  type FloorPrintBomRow,
  type FloorPrintOptions,
  type FloorPrintProjectInfo,
} from "@/lib/floor-print";
import { saveFloorPrintSnapshot } from "@/lib/floor-print-storage";
import type { FloorTopCalculation } from "@/lib/floor-top-calculator";
import { FloorPrintDialog } from "./FloorPrintDialog";

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function roleDirection(row: FloorPrintBomRow): string {
  return `${row.role === "main" ? "主筋" : "副筋"}（${row.direction === "x" ? "东西向" : "南北向"}）`;
}

function sourceLabel(row: FloorPrintBomRow): string {
  if (row.layer === "bottom") return "地筋";
  return row.source === "through"
    ? `通墙面筋${row.throughPathName ? ` · ${row.throughPathName}` : ""}`
    : "普通面筋";
}

function PreviewTable({ title, rows }: { title: string; rows: readonly FloorPrintBomRow[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h3 className="font-bold text-slate-950">{title}</h3>
      <div className="mt-4 space-y-3 sm:hidden">
        {rows.map((row) => <article key={`card:${row.layer}:${row.mark}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-bom-card-mark={row.mark}><div className="flex items-start justify-between gap-3"><div><strong className="text-lg text-blue-700">{row.mark}</strong><p className="mt-1 text-xs text-slate-600">{sourceLabel(row)} · {roleDirection(row)}</p></div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-900">Φ{row.diameter}@{row.spacing}</span></div><p className="mt-3 text-sm font-medium text-slate-900">{row.slabNames.join(" + ")}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">单根下料</dt><dd className="font-semibold">{Number(row.singleLengthMm.toFixed(1)).toLocaleString("zh-CN")} mm</dd></div><div><dt className="text-xs text-slate-500">根数</dt><dd className="font-semibold">{row.count} 根</dd></div><div><dt className="text-xs text-slate-500">总长度</dt><dd className="font-semibold">{formatNumber(row.totalLengthM)} m</dd></div><div><dt className="text-xs text-slate-500">重量</dt><dd className="font-semibold">{formatNumber(row.weightKg)} kg</dd></div></dl></article>)}
        {rows.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">当前筛选没有料单项。</p>}
      </div>
      <div className="mt-4 hidden overflow-x-auto sm:block">
        <table className="min-w-[820px] w-full border-collapse text-sm">
          <thead><tr className="bg-slate-100 text-slate-700"><th className="border border-slate-300 px-3 py-2">编号</th><th className="border border-slate-300 px-3 py-2 text-left">板区/区域</th><th className="border border-slate-300 px-3 py-2">来源</th><th className="border border-slate-300 px-3 py-2">主副/方向</th><th className="border border-slate-300 px-3 py-2">规格</th><th className="border border-slate-300 px-3 py-2">单根下料</th><th className="border border-slate-300 px-3 py-2">根数</th><th className="border border-slate-300 px-3 py-2">总长度</th><th className="border border-slate-300 px-3 py-2">重量</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.layer}:${row.mark}`} data-bom-mark={row.mark} data-source={row.source}><td className="border border-slate-300 px-3 py-2 text-center font-bold">{row.mark}</td><td className="border border-slate-300 px-3 py-2">{row.slabNames.join(" + ")}</td><td className="border border-slate-300 px-3 py-2 text-center">{sourceLabel(row)}</td><td className="border border-slate-300 px-3 py-2 text-center">{roleDirection(row)}</td><td className="border border-slate-300 px-3 py-2 text-center">Φ{row.diameter}@{row.spacing}</td><td className="border border-slate-300 px-3 py-2 text-center">{Number(row.singleLengthMm.toFixed(1)).toLocaleString("zh-CN")} mm</td><td className="border border-slate-300 px-3 py-2 text-center">{row.count}</td><td className="border border-slate-300 px-3 py-2 text-center">{formatNumber(row.totalLengthM)} m</td><td className="border border-slate-300 px-3 py-2 text-center">{formatNumber(row.weightKg)} kg</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function FloorBomPanel({
  plan,
  bottom,
  top,
  bottomRoleReviewRequired,
  topRoleReviewRequired,
  invalidDraftCount,
}: {
  plan: FloorPlanState;
  bottom: FloorBottomCalculation;
  top: FloorTopCalculation;
  bottomRoleReviewRequired: boolean;
  topRoleReviewRequired: boolean;
  invalidDraftCount: number;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"all" | "bottom" | "top-normal" | "top-through">("all");
  const [previewQuery, setPreviewQuery] = useState("");
  const eligibility = useMemo(() => getFloorPrintEligibility({
    plan,
    bottom,
    top,
    bottomRoleReviewRequired,
    topRoleReviewRequired,
    invalidDraftCount,
  }), [bottom, bottomRoleReviewRequired, invalidDraftCount, plan, top, topRoleReviewRequired]);
  const content = useMemo(() => {
    if (!eligibility.eligible) return null;
    try {
      return buildFloorPrintContent(plan, bottom, top);
    } catch {
      return null;
    }
  }, [bottom, eligibility.eligible, plan, top]);
  const filteredRows = useMemo(() => {
    if (!content) return [];
    const query = previewQuery.trim().toLocaleLowerCase("zh-CN");
    return content.combinedRows.filter((row) => {
      const typeMatches = previewFilter === "all"
        || (previewFilter === "bottom" && row.layer === "bottom")
        || (previewFilter === "top-normal" && row.layer === "top" && row.source === "normal")
        || (previewFilter === "top-through" && row.layer === "top" && row.source === "through");
      return typeMatches && (!query || `${row.mark} ${row.slabNames.join(" ")} ${row.throughPathName ?? ""}`.toLocaleLowerCase("zh-CN").includes(query));
    });
  }, [content, previewFilter, previewQuery]);

  const generate = (project: FloorPrintProjectInfo, options: FloorPrintOptions) => {
    try {
      const snapshot = buildFloorPrintSnapshot({
        plan,
        bottom,
        top,
        bottomRoleReviewRequired,
        topRoleReviewRequired,
        invalidDraftCount,
        project,
        options,
      });
      saveFloorPrintSnapshot(window.sessionStorage, snapshot);
      setBuildError(null);
      router.push(`/calculator/floor/print?id=${encodeURIComponent(snapshot.id)}`);
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : "打印快照生成失败。");
    }
  };

  return (
    <div className="space-y-5" data-testid="floor-bom-panel">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><FileText size={20} className="text-blue-600" /><h2 className="text-xl font-bold text-slate-950">整层地筋 + 面筋料单</h2></div>
            <p className="mt-2 text-sm leading-6 text-slate-600">料单只消费当前正式 FloorBarPiece 与分层 BOM；不会重新计算根数、锚固、主副筋或洞口裁断。</p>
          </div>
          <button
            type="button"
            disabled={!eligibility.eligible}
            onClick={() => setDialogOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            data-testid="open-floor-print-dialog"
          >
            <Printer size={17} />打印设置
          </button>
        </div>

        {!eligibility.eligible && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4" data-testid="floor-bom-draft-warning">
            <strong className="text-rose-900">草稿预览 · 不可用于正式下料</strong>
            <ul className="mt-2 space-y-1 text-sm text-rose-800">{eligibility.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul>
          </div>
        )}
        {eligibility.warnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><strong className="text-amber-900">正式计算警告</strong><ul className="mt-2 space-y-1 text-sm text-amber-900">{eligibility.warnings.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul></div>}
        {buildError && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{buildError}</p>}
      </section>

      {content && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="整层料单汇总">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="text-xs text-slate-500">地筋</span><strong className="mt-1 block text-2xl text-slate-950">{content.summary.bottomPieceCount} 件</strong><span className="mt-2 block text-sm text-slate-600">{formatNumber(content.summary.bottomLengthM)} m · {formatNumber(content.summary.bottomWeightKg)} kg</span></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="text-xs text-slate-500">普通面筋</span><strong className="mt-1 block text-2xl text-slate-950">{content.summary.topNormalPieceCount} 件</strong><span className="mt-2 block text-sm text-slate-600">最终保留的普通Piece</span></div>
            <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm"><span className="text-xs text-blue-700">通墙面筋</span><strong className="mt-1 block text-2xl text-slate-950">{content.summary.topThroughPieceCount} 件</strong><span className="mt-2 block text-sm text-slate-600">已替换对应普通Piece</span></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm"><span className="text-xs text-blue-700">整层合计</span><strong className="mt-1 block text-2xl text-slate-950">{content.summary.totalPieceCount} 件</strong><span className="mt-2 block text-sm text-slate-700">{formatNumber(content.summary.totalLengthM)} m · {formatNumber(content.summary.totalWeightKg)} kg</span></div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-2" aria-label="料单预览筛选">{[["all", "全部"], ["bottom", "地筋"], ["top-normal", "普通面筋"], ["top-through", "通墙面筋"]].map(([value, label]) => <button key={value} type="button" aria-pressed={previewFilter === value} onClick={() => setPreviewFilter(value as typeof previewFilter)} className={`min-h-11 rounded-xl px-4 text-xs font-semibold ${previewFilter === value ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-700"}`}>{label}</button>)}</div><label className="block min-w-0 lg:w-72"><span className="sr-only">搜索料单编号或板区</span><input value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="搜索编号/板区" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label></div></section>
          {(previewFilter === "all" || previewFilter === "bottom") && <PreviewTable title="地筋料单" rows={filteredRows.filter((row) => row.layer === "bottom")} />}
          {(previewFilter === "all" || previewFilter === "top-normal" || previewFilter === "top-through") && <PreviewTable title="面筋料单（普通 + 通墙）" rows={filteredRows.filter((row) => row.layer === "top")} />}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="font-bold text-slate-950">按直径汇总</h3>
            <div className="mt-4 overflow-x-auto"><table className="min-w-[560px] w-full border-collapse text-sm"><thead><tr className="bg-slate-100"><th className="border border-slate-300 px-3 py-2">直径</th><th className="border border-slate-300 px-3 py-2">实际件数</th><th className="border border-slate-300 px-3 py-2">总长度</th><th className="border border-slate-300 px-3 py-2">理论重量</th></tr></thead><tbody>{content.diameterSummary.map((row) => <tr key={row.diameter}><td className="border border-slate-300 px-3 py-2 text-center font-bold">Φ{row.diameter}</td><td className="border border-slate-300 px-3 py-2 text-center">{row.pieceCount}</td><td className="border border-slate-300 px-3 py-2 text-center">{formatNumber(row.totalLengthM)} m</td><td className="border border-slate-300 px-3 py-2 text-center">{formatNumber(row.weightKg)} kg</td></tr>)}</tbody></table></div>
            <p className="mt-3 text-xs text-slate-500">本汇总不计算 9m/12m 原材根数、套料、采购量或施工损耗。</p>
          </section>
        </>
      )}

      <FloorPrintDialog open={dialogOpen} eligibility={eligibility} onClose={() => setDialogOpen(false)} onGenerate={generate} />
    </div>
  );
}
