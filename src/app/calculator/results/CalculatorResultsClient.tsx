"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calculator, ChevronLeft, ChevronRight } from "lucide-react";
import { SlabResultsDiagram } from "@/components/calculator/SlabDiagrams";
import type { BarResult } from "@/lib/slab-calculator";
import {
  DEFAULT_RESULT_UI_STATE,
  RESULT_KEY,
  RESULT_UI_KEY,
  RETURN_TO_INPUT_KEY,
  createResultGroups,
  filterResultGroups,
  paginateResultGroups,
  parseCalculationRecord,
  parseResultUiState,
  type ResultGroup,
  type ResultUiState,
  type StoredCalculationRecord,
} from "@/lib/slab-calculator-storage";

const fieldClass =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function anchorLabel(result: BarResult, endpoint: "start" | "end") {
  const source = endpoint === "start" ? result.startAnchorSource : result.endAnchorSource;
  const value = endpoint === "start" ? result.startAnchor : result.endAnchor;
  const label = source === "inner-wall" ? "内墙" : source === "outer-wall" ? "外墙" : "手动";
  if (result.layer === "bottom" || source === "manual") {
    return `${label}${value.toFixed(0)}mm${source === "manual" ? "（最终值）" : ""}`;
  }
  const applied = endpoint === "start" ? result.startExtraApplied : result.endExtraApplied;
  return `${label}${value.toFixed(0)}mm（${applied ? `已增加${result.topExtraValue.toFixed(0)}mm` : "未增加"}）`;
}

function extraModeLabel(result: BarResult) {
  if (result.layer === "bottom" || !result.topExtraMode) return "不适用";
  if (result.topExtraMode === "both") return "两端增加";
  const start = result.direction === "x" ? "西端" : "南端";
  const end = result.direction === "x" ? "东端" : "北端";
  const prefix = result.throughWall ? "最" : "";
  return `${prefix}${result.topExtraMode === "start" ? start : end}增加`;
}

function ResultFormula({
  result,
  countMode,
  cover,
}: {
  result: BarResult;
  countMode: "project" | "cover";
  cover: number;
}) {
  const lengthParts = [
    result.netRunSpanMm,
    ...(result.intermediateWallMm > 0 ? [result.intermediateWallMm] : []),
    result.startAnchor,
    result.endAnchor,
  ];
  return (
    <div className="space-y-1 text-xs leading-5 text-slate-600">
      <p>单根长度：{lengthParts.join(" + ")} = {(result.singleLengthM * 1000).toFixed(0)}mm</p>
      <p>
        根数：{countMode === "project"
          ? `ceil(${result.calculationWidthMm} / ${result.spacing})`
          : `ceil((${result.calculationWidthMm} - 2 × ${cover}) / ${result.spacing}) + 1`} = {result.count}根
      </p>
      <p>面筋增加作用端：{extraModeLabel(result)}</p>
      <p>总长度：{result.count} × {result.singleLengthM.toFixed(3)} = {result.totalLengthM.toFixed(3)}m</p>
      <p>单位重量：π × {result.diameter}² × 7850 ÷ 4 ÷ 1,000,000 = {result.unitWeightKgM.toFixed(4)}kg/m</p>
      <p>重量：{result.totalLengthM.toFixed(3)} × {result.unitWeightKgM.toFixed(4)} = {result.weightKg.toFixed(2)}kg</p>
    </div>
  );
}

function ResultGroupCard({
  group,
  countMode,
  cover,
}: {
  group: ResultGroup;
  countMode: "project" | "cover";
  cover: number;
}) {
  return (
    <section id={`scope-${group.scopeId}`} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">{group.title}</h2>
          <p className="mt-1 text-xs text-slate-500">{group.scopeType === "through" ? "通墙组合路径" : `房间ID：${group.roomId}`}</p>
        </div>
        <div className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
          小计 {group.subtotalWeightKg.toFixed(2)}kg
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {group.results.map((result) => (
          <article key={result.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-slate-500">类型/方向</p><p className="font-semibold">{result.layer === "bottom" ? "地筋" : "面筋"} · {result.direction.toUpperCase()}向{result.throughWall ? "通墙" : result.scopeType === "through" ? "组合区" : ""}</p></div>
              <div><p className="text-xs text-slate-500">规格/根数</p><p className="font-semibold">Φ{result.diameter} · {result.count}根</p></div>
              <div><p className="text-xs text-slate-500">单根/总长度</p><p className="font-semibold">{result.singleLengthM.toFixed(3)}m / {result.totalLengthM.toFixed(3)}m</p></div>
              <div><p className="text-xs text-slate-500">重量</p><p className="text-lg font-bold text-slate-900">{result.weightKg.toFixed(2)}kg</p></div>
              <div><p className="text-xs text-slate-500">起点锚固</p><p className="font-medium">{anchorLabel(result, "start")}</p></div>
              <div><p className="text-xs text-slate-500">终点锚固</p><p className="font-medium">{anchorLabel(result, "end")}</p></div>
              <div className="sm:col-span-2"><ResultFormula result={result} countMode={countMode} cover={cover} /></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CalculatorResultsClient() {
  const router = useRouter();
  const [record, setRecord] = useState<StoredCalculationRecord | null>(null);
  const [ui, setUi] = useState<ResultUiState>(DEFAULT_RESULT_UI_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = parseCalculationRecord(localStorage.getItem(RESULT_KEY));
      if (!restored) {
        localStorage.removeItem(RESULT_KEY);
        router.replace("/calculator");
        return;
      }
      sessionStorage.setItem(RETURN_TO_INPUT_KEY, "1");
      setRecord(restored);
      setUi(parseResultUiState(localStorage.getItem(RESULT_UI_KEY)));
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (!loading) localStorage.setItem(RESULT_UI_KEY, JSON.stringify(ui));
  }, [loading, ui]);

  const allGroups = useMemo(() => (record ? createResultGroups(record) : []), [record]);
  const filteredGroups = useMemo(
    () => filterResultGroups(allGroups, ui.filters),
    [allGroups, ui.filters],
  );
  const pagination = useMemo(
    () => paginateResultGroups(filteredGroups, ui.page, ui.pageSize),
    [filteredGroups, ui.page, ui.pageSize],
  );

  if (loading || !record) {
    return <main className="min-h-screen bg-slate-100 p-6 text-center text-sm text-slate-600">正在恢复有效计算记录…</main>;
  }

  const calculation = record.calculation;
  const total = calculation.totalWeightKg ?? 0;
  const bottomWeight = calculation.results.filter((result) => result.layer === "bottom").reduce((sum, result) => sum + result.weightKg, 0);
  const topWeight = calculation.results.filter((result) => result.layer === "top").reduce((sum, result) => sum + result.weightKg, 0);

  const updateFilters = (filters: Partial<ResultUiState["filters"]>) => {
    setUi((current) => ({
      ...current,
      page: 1,
      selectedScopeId: "",
      filters: { ...current.filters, ...filters },
    }));
  };

  const jumpToScope = (scopeId: string) => {
    const index = filteredGroups.findIndex((group) => group.scopeId === scopeId);
    if (index < 0) return;
    const page = Math.floor(index / ui.pageSize) + 1;
    setUi((current) => ({ ...current, selectedScopeId: scopeId, page }));
    requestAnimationFrame(() => {
      document.getElementById(`scope-${scopeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const returnToInput = () => {
    sessionStorage.setItem(RETURN_TO_INPUT_KEY, "1");
    router.push("/calculator");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-3 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl bg-slate-900 p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-blue-300"><Calculator size={20} /><span className="text-sm font-semibold">RebarViz · 计算结果</span></div>
              <h1 className="text-2xl font-bold sm:text-3xl">楼板钢筋计算结果</h1>
              <p className="mt-2 text-sm text-slate-300">计算时间：{new Date(record.calculatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
            </div>
            <button type="button" onClick={returnToInput} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"><ArrowLeft size={16} />返回修改参数</button>
          </div>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-900 p-5 text-white"><p className="text-sm text-slate-300">全部钢筋</p><p className="mt-1 text-3xl font-bold">{total.toFixed(2)}kg</p></div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><p className="text-sm">地筋重量</p><p className="mt-1 text-2xl font-bold">{bottomWeight.toFixed(2)}kg</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><p className="text-sm">面筋重量</p><p className="mt-1 text-2xl font-bold">{topWeight.toFixed(2)}kg</p></div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">计算参数快照</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">排列/房间数</dt><dd className="font-semibold">{record.inputSnapshot.slab.arrangement.toUpperCase()} · {record.inputSnapshot.slab.rooms.length}间</dd></div>
              <div><dt className="text-slate-500">内墙/外墙</dt><dd className="font-semibold">{record.inputSnapshot.slab.innerWallThickness} / {record.inputSnapshot.slab.outerWallThickness}mm</dd></div>
              <div><dt className="text-slate-500">保护层/根数算法</dt><dd className="font-semibold">{record.inputSnapshot.slab.cover}mm · {record.inputSnapshot.slab.countMode === "project" ? "项目算法" : "保护层算法"}</dd></div>
              <div><dt className="text-slate-500">面筋锚固增加</dt><dd className="font-semibold">{record.inputSnapshot.slab.topAnchorExtra}mm</dd></div>
            </dl>
            <div className="mt-4 space-y-2">
              {record.inputSnapshot.slab.rooms.map((room) => <p key={room.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{room.name}：{room.spanX}×{room.spanY}mm <span className="text-xs text-slate-400">({room.id})</span></p>)}
            </div>
            {calculation.throughWall && (
              <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p>通墙摘要：{calculation.throughWall.direction.toUpperCase()}向 · 净尺寸{calculation.throughWall.netSpanTotal}mm · 中间墙{calculation.throughWall.intermediateWallTotal}mm</p>
                <p>单根长度：{calculation.throughWall.netSpanTotal} + {calculation.throughWall.intermediateWallTotal} + {calculation.throughWall.throughBar.startAnchor} + {calculation.throughWall.throughBar.endAnchor} = {(calculation.throughWall.throughBar.singleLengthM * 1000).toFixed(0)}mm</p>
                <p>垂直方向根数：ceil({calculation.throughWall.netSpanTotal} / {calculation.throughWall.perpendicularBar.spacing}) = {calculation.throughWall.perpendicularBar.count}根（不计中间墙）</p>
              </div>
            )}
          </section>
          <SlabResultsDiagram state={record.inputSnapshot} calculation={calculation} />
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 md:grid-cols-5">
            <select aria-label="类型筛选" className={fieldClass} value={ui.filters.layer} onChange={(event) => updateFilters({ layer: event.target.value as ResultUiState["filters"]["layer"] })}><option value="all">全部类型</option><option value="bottom">地筋</option><option value="top">面筋</option></select>
            <select aria-label="方向筛选" className={fieldClass} value={ui.filters.direction} onChange={(event) => updateFilters({ direction: event.target.value as ResultUiState["filters"]["direction"] })}><option value="all">全部方向</option><option value="x">X向</option><option value="y">Y向</option></select>
            <select aria-label="通墙筛选" className={fieldClass} value={ui.filters.through} onChange={(event) => updateFilters({ through: event.target.value as ResultUiState["filters"]["through"] })}><option value="all">全部状态</option><option value="normal">普通</option><option value="through">通墙</option></select>
            <select aria-label="每页组数" className={fieldClass} value={ui.pageSize} onChange={(event) => setUi((current) => ({ ...current, page: 1, pageSize: Number(event.target.value) as 2 | 5 | 10 }))}><option value="2">每页2组</option><option value="5">每页5组</option><option value="10">每页10组</option></select>
            <select aria-label="快速跳转" className={fieldClass} value={ui.selectedScopeId} onChange={(event) => jumpToScope(event.target.value)}><option value="">快速跳转</option>{filteredGroups.map((group) => <option key={group.scopeId} value={group.scopeId}>{group.title}</option>)}</select>
          </div>
        </section>

        <div className="mt-4 space-y-4">
          {pagination.groups.length > 0 ? pagination.groups.map((group) => <ResultGroupCard key={group.scopeId} group={group} countMode={record.inputSnapshot.slab.countMode} cover={record.inputSnapshot.slab.cover} />) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">当前筛选没有结果；全部重量仍为 {total.toFixed(2)}kg。</div>}
        </div>

        <nav className="mt-5 flex flex-wrap items-center justify-center gap-2" aria-label="结果分页">
          <button type="button" onClick={() => setUi((current) => ({ ...current, page: 1 }))} disabled={pagination.page === 1} className={fieldClass}>首页</button>
          <button type="button" aria-label="上一页" onClick={() => setUi((current) => ({ ...current, page: Math.max(current.page - 1, 1) }))} disabled={pagination.page === 1} className={fieldClass}><ChevronLeft size={16} /></button>
          {Array.from({ length: pagination.pageCount }, (_, index) => index + 1).map((page) => <button type="button" key={page} aria-current={page === pagination.page ? "page" : undefined} onClick={() => setUi((current) => ({ ...current, page }))} className={`${fieldClass} min-w-11 ${page === pagination.page ? "border-blue-600 bg-blue-600 text-white" : ""}`}>{page}</button>)}
          <button type="button" aria-label="下一页" onClick={() => setUi((current) => ({ ...current, page: Math.min(current.page + 1, pagination.pageCount) }))} disabled={pagination.page === pagination.pageCount} className={fieldClass}><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setUi((current) => ({ ...current, page: pagination.pageCount }))} disabled={pagination.page === pagination.pageCount} className={fieldClass}>末页</button>
          <label className="flex items-center gap-2 text-sm text-slate-600">跳至<input aria-label="输入页码" type="number" min={1} max={pagination.pageCount} value={pagination.page} onChange={(event) => setUi((current) => ({ ...current, page: Number(event.target.value) || 1 }))} className={`${fieldClass} w-20`} />页</label>
        </nav>
      </div>
    </main>
  );
}
