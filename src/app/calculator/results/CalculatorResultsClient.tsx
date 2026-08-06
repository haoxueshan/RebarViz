"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Printer,
  X,
} from "lucide-react";
import { SlabPrintReport } from "@/components/calculator/SlabPrintReport";
import { SlabPrintDialog } from "@/components/calculator/SlabPrintDialog";
import { SlabResultsDiagram } from "@/components/calculator/SlabDiagrams";
import { countModeLabel, directionLabel, type BarResult, type CountMode } from "@/lib/slab-calculator";
import {
  arrangementLabel,
  barTypeDirectionLabel,
  formatAnchorLabel,
  formatCountFormula,
  formatExtraModeLabel,
  formatVariantAnchorLabel,
  formatVariantExtraModeLabel,
  buildSlabPrintReport,
  canPrintSlabReport,
  createResultFigureNumberMap,
  filteredPrintResultIds,
  isPrintableCalculationRecord,
} from "@/lib/slab-calculator-report";
import {
  DEFAULT_RESULT_UI_STATE,
  DEFAULT_SLAB_PRINT_OPTIONS,
  RESULT_KEY,
  RESULT_PRINT_SETTINGS_KEY,
  RESULT_UI_KEY,
  RETURN_TO_INPUT_KEY,
  createDefaultSlabPrintOptions,
  createResultGroups,
  filterResultGroups,
  paginateResultGroups,
  parseCalculationRecord,
  parseResultPrintSettings,
  parseResultUiState,
  serializeResultPrintSettings,
  type ResultGroup,
  type ResultUiState,
  type SlabPrintOptions,
  type StoredCalculationRecord,
} from "@/lib/slab-calculator-storage";
import { getPaginationItems } from "@/lib/slab-calculator-ui";

const fieldClass =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function copyPrintOptions(options: SlabPrintOptions): SlabPrintOptions {
  return {
    ...options,
    selectedResultIds: [...options.selectedResultIds],
    sections: { ...options.sections },
  };
}

function ResultFormula({
  result,
  countMode,
}: {
  result: BarResult;
  countMode: CountMode;
}) {
  if (result.lengthMode === "zoned") {
    return (
      <div className="space-y-1 text-xs leading-5 text-slate-600">
        <p>
          单根长度：本项包含{result.lengthVariants.length}种分区长度；
          {result.singleLengthM.toFixed(3)}m 为按正式根数加权平均值，不代表统一单根长度。
        </p>
        <p>
          根数：{formatCountFormula(result.calculationWidthMm, result.spacing, countMode)} = {result.count}根
        </p>
        <p>面筋增加作用端：按各分区实际内墙锚固端确定</p>
        <p>总长度：Σ（分区根数 × 分区单根长度）= {result.totalLengthM.toFixed(3)}m</p>
        <p>单位重量：π × {result.diameter}² × 7850 ÷ 4 ÷ 1,000,000 = {result.unitWeightKgM.toFixed(4)}kg/m</p>
        <p>重量：{result.totalLengthM.toFixed(3)} × {result.unitWeightKgM.toFixed(4)} = {result.weightKg.toFixed(2)}kg</p>
      </div>
    );
  }
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
        根数：{formatCountFormula(result.calculationWidthMm, result.spacing, countMode)} = {result.count}根
      </p>
      <p>面筋增加作用端（仅内墙端）：{formatExtraModeLabel(result)}</p>
      <p>总长度：{result.count} × {result.singleLengthM.toFixed(3)} = {result.totalLengthM.toFixed(3)}m</p>
      <p>单位重量：π × {result.diameter}² × 7850 ÷ 4 ÷ 1,000,000 = {result.unitWeightKgM.toFixed(4)}kg/m</p>
      <p>重量：{result.totalLengthM.toFixed(3)} × {result.unitWeightKgM.toFixed(4)} = {result.weightKg.toFixed(2)}kg</p>
    </div>
  );
}

function ResultVariantDetails({
  result,
  figureNumber,
}: {
  result: BarResult;
  figureNumber: string;
}) {
  if (result.lengthMode !== "zoned") return null;
  const rangeAxis = directionLabel(result.direction === "x" ? "y" : "x");
  return (
    <details className="mt-3 overflow-hidden rounded-lg border border-amber-200 bg-white">
      <summary className="min-h-11 cursor-pointer list-none bg-amber-50 px-3 py-3 text-xs font-semibold text-amber-950">
        查看分区明细 · {result.lengthVariants.length}种下料长度（{rangeAxis}分区）
      </summary>
      <div className="divide-y divide-slate-200">
        {result.lengthVariants.map((variant, index) => (
          <div
            key={variant.id}
            data-variant-id={variant.id}
            className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4"
          >
            <p className="font-semibold text-slate-900">
              {figureNumber}-{String.fromCharCode(65 + index)} · {rangeAxis}={variant.perpendicularStartMm.toFixed(0)}–{variant.perpendicularEndMm.toFixed(0)}mm
            </p>
            <p>根数：{variant.count}根 · 单根：{variant.singleLengthM.toFixed(3)}m</p>
            <p>起点：{formatVariantAnchorLabel(result, variant, "start")}</p>
            <p>终点：{formatVariantAnchorLabel(result, variant, "end")}</p>
            <p className="sm:col-span-2">面筋增加：{formatVariantExtraModeLabel(result, variant)}</p>
            <p>总长度：{variant.totalLengthM.toFixed(3)}m</p>
            <p>重量：{variant.weightKg.toFixed(2)}kg</p>
          </div>
        ))}
      </div>
    </details>
  );
}

function ResultGroupCard({
  group,
  countMode,
  figureNumbers,
}: {
  group: ResultGroup;
  countMode: CountMode;
  figureNumbers: ReadonlyMap<string, string>;
}) {
  return (
    <section id={`scope-${group.scopeId}`} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">{group.title}</h2>
          <p className="mt-1 text-xs text-slate-500">{group.scopeType === "through" ? "通墙组合路径" : "房间独立排筋结果"}</p>
        </div>
        <div className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
          小计 {group.subtotalWeightKg.toFixed(2)}kg
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {group.results.map((result) => {
          const figureNumber = figureNumbers.get(result.id) ?? "R--";
          return (
          <article key={result.id} data-result-id={result.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.9fr_0.95fr_0.95fr_0.8fr]">
              <div><p className="text-xs text-slate-500">编号/钢筋</p><p className="font-semibold">{figureNumber} · {barTypeDirectionLabel(result)}</p></div>
              <div><p className="text-xs text-slate-500">规格</p><p className="font-semibold">Φ{result.diameter}@{result.spacing}</p></div>
              <div><p className="text-xs text-slate-500">正式根数</p><p className="font-semibold">{result.count}根</p></div>
              <div><p className="text-xs text-slate-500">长度</p><p className="font-semibold">{result.lengthMode === "zoned" ? `${result.lengthVariants.length}种下料长度` : `单根 ${result.singleLengthM.toFixed(3)}m`}<br /><span className="text-xs font-medium text-slate-600">总长 {result.totalLengthM.toFixed(3)}m</span></p></div>
              <div><p className="text-xs text-slate-500">重量</p><p className="text-lg font-bold text-slate-900">{result.weightKg.toFixed(2)}kg</p></div>
            </div>
            <details className="mt-3 rounded-lg border border-slate-200 bg-white">
              <summary className="min-h-11 cursor-pointer list-none px-3 py-3 text-sm font-semibold text-blue-700">查看计算明细</summary>
              <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                <div><p className="text-xs text-slate-500">起点锚固</p><p className="text-sm font-medium">{result.lengthMode === "zoned" ? "见分区明细" : formatAnchorLabel(result, "start")}</p></div>
                <div><p className="text-xs text-slate-500">终点锚固</p><p className="text-sm font-medium">{result.lengthMode === "zoned" ? "见分区明细" : formatAnchorLabel(result, "end")}</p></div>
                <div className="sm:col-span-2"><ResultFormula result={result} countMode={countMode} /></div>
              </div>
            </details>
            <ResultVariantDetails result={result} figureNumber={figureNumber} />
          </article>
          );
        })}
      </div>
    </section>
  );
}

export function CalculatorResultsClient() {
  const router = useRouter();
  const [record, setRecord] = useState<StoredCalculationRecord | null>(null);
  const [ui, setUi] = useState<ResultUiState>(DEFAULT_RESULT_UI_STATE);
  const [loading, setLoading] = useState(true);
  const [printedAt, setPrintedAt] = useState(() => new Date().toISOString());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [draftPrintOptions, setDraftPrintOptions] = useState<SlabPrintOptions>(
    () => copyPrintOptions(DEFAULT_SLAB_PRINT_OPTIONS),
  );
  const [activePrintOptions, setActivePrintOptions] = useState<SlabPrintOptions>(
    () => copyPrintOptions(DEFAULT_SLAB_PRINT_OPTIONS),
  );
  const printButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = parseCalculationRecord(localStorage.getItem(RESULT_KEY));
      if (!restored) {
        localStorage.removeItem(RESULT_KEY);
        router.replace("/calculator");
        return;
      }
      sessionStorage.setItem(RETURN_TO_INPUT_KEY, "1");
      const preferences = parseResultPrintSettings(
        localStorage.getItem(RESULT_PRINT_SETTINGS_KEY),
      );
      const printOptions = createDefaultSlabPrintOptions(restored, preferences);
      setRecord(restored);
      setUi(parseResultUiState(localStorage.getItem(RESULT_UI_KEY)));
      setDraftPrintOptions(copyPrintOptions(printOptions));
      setActivePrintOptions(copyPrintOptions(printOptions));
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (!loading) localStorage.setItem(RESULT_UI_KEY, JSON.stringify(ui));
  }, [loading, ui]);

  useEffect(() => {
    if (!diagramOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDiagramOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [diagramOpen]);

  const allGroups = useMemo(() => (record ? createResultGroups(record) : []), [record]);
  const filteredGroups = useMemo(
    () => filterResultGroups(allGroups, ui.filters),
    [allGroups, ui.filters],
  );
  const pagination = useMemo(
    () => paginateResultGroups(filteredGroups, ui.page, ui.pageSize),
    [filteredGroups, ui.page, ui.pageSize],
  );
  const currentFilteredResultIds = useMemo(
    () => (record ? filteredPrintResultIds(record, ui.filters) : []),
    [record, ui.filters],
  );
  const hasActiveFilters =
    ui.filters.layer !== "all" ||
    ui.filters.direction !== "all" ||
    ui.filters.through !== "all";
  const screenVisibleResultIds = useMemo(
    () =>
      hasActiveFilters
        ? new Set(currentFilteredResultIds)
        : undefined,
    [currentFilteredResultIds, hasActiveFilters],
  );
  const figureNumbers = useMemo(
    () => createResultFigureNumberMap(record?.calculation.results ?? []),
    [record],
  );
  const paginationItems = getPaginationItems(pagination.page, pagination.pageCount);

  if (loading || !record) {
    return <main className="min-h-screen bg-slate-100 p-6 text-center text-sm text-slate-600">正在恢复有效计算记录…</main>;
  }

  const calculation = record.calculation;
  const printable = isPrintableCalculationRecord(record);
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

  const openPrintSettings = () => {
    if (!printable) return;
    const preferences = parseResultPrintSettings(
      localStorage.getItem(RESULT_PRINT_SETTINGS_KEY),
    );
    setDraftPrintOptions(createDefaultSlabPrintOptions(record, preferences));
    setPrintDialogOpen(true);
  };

  const printSelectedResults = () => {
    if (!printable) return;
    const model = buildSlabPrintReport(record, draftPrintOptions);
    if (!canPrintSlabReport(model, draftPrintOptions)) return;
    localStorage.setItem(
      RESULT_PRINT_SETTINGS_KEY,
      serializeResultPrintSettings(draftPrintOptions),
    );
    flushSync(() => {
      setActivePrintOptions(copyPrintOptions(draftPrintOptions));
      setPrintedAt(new Date().toISOString());
      setPrintDialogOpen(false);
    });
    window.print();
  };

  return (
    <>
      <main className="slab-results-screen min-h-screen bg-gradient-to-b from-slate-100 to-white px-3 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl bg-slate-900 p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-blue-300"><Calculator size={20} /><span className="text-sm font-semibold">RebarViz · 计算结果</span></div>
              <h1 className="text-2xl font-bold sm:text-3xl">楼板钢筋计算结果</h1>
              <p className="mt-2 text-sm text-slate-300">计算时间：{new Date(record.calculatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
            </div>
            <div className="max-w-md space-y-2">
              <div className="flex flex-wrap justify-end gap-2">
                {printable && (
                  <button ref={printButtonRef} type="button" onClick={openPrintSettings} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-400">
                    <Printer size={17} />打印设置
                  </button>
                )}
                <button type="button" onClick={returnToInput} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"><ArrowLeft size={16} />返回修改参数</button>
              </div>
              {printable && (
                <p className="text-right text-xs leading-5 text-slate-300">
                  可打印全部结果、当前筛选或自定义钢筋项；当前筛选打印不受分页影响。
                </p>
              )}
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-900 p-5 text-white"><p className="text-sm text-slate-300">全部钢筋</p><p className="mt-1 text-3xl font-bold">{total.toFixed(2)}kg</p></div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><p className="text-sm">地筋重量</p><p className="mt-1 text-2xl font-bold">{bottomWeight.toFixed(2)}kg</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><p className="text-sm">面筋重量</p><p className="mt-1 text-2xl font-bold">{topWeight.toFixed(2)}kg</p></div>
        </section>

        <details className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-4">
              <span className="font-bold text-slate-900">计算参数</span>
              <span className="text-xs font-medium text-slate-500">{arrangementLabel(record.inputSnapshot.slab.arrangement)} · {record.inputSnapshot.slab.rooms.length}间 · {countModeLabel(record.inputSnapshot.slab.countMode)}{calculation.throughWall ? ` · ${directionLabel(calculation.throughWall.direction)}通墙` : ""}　查看完整参数</span>
            </summary>
          <div className="border-t border-slate-200 p-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">排列/房间数</dt><dd className="font-semibold">{arrangementLabel(record.inputSnapshot.slab.arrangement)} · {record.inputSnapshot.slab.rooms.length}间</dd></div>
              <div><dt className="text-slate-500">内墙/外墙</dt><dd className="font-semibold">{record.inputSnapshot.slab.innerWallThickness} / {record.inputSnapshot.slab.outerWallThickness}mm</dd></div>
              <div><dt className="text-slate-500">根数算法</dt><dd className="font-semibold">{countModeLabel(record.inputSnapshot.slab.countMode)}</dd></div>
              <div><dt className="text-slate-500">内墙面筋锚固增加</dt><dd className="font-semibold">{record.inputSnapshot.slab.topAnchorExtra}mm</dd></div>
            </dl>
            <div className="mt-4 space-y-2">
              {record.inputSnapshot.slab.rooms.map((room, index) => <p key={room.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="mr-2 text-xs font-semibold text-slate-400">#{String(index + 1).padStart(2, "0")}</span>{room.name}：{room.spanX}×{room.spanY}mm</p>)}
            </div>
            {calculation.throughWall && (
              <div className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p>通墙摘要：{directionLabel(calculation.throughWall.direction)} · 净尺寸{calculation.throughWall.netSpanTotal}mm · 中间墙{calculation.throughWall.intermediateWallTotal}mm</p>
                <p>单根长度：{calculation.throughWall.netSpanTotal} + {calculation.throughWall.intermediateWallTotal} + {calculation.throughWall.throughBar.startAnchor} + {calculation.throughWall.throughBar.endAnchor} = {(calculation.throughWall.throughBar.singleLengthM * 1000).toFixed(0)}mm</p>
                <p>通墙方向根数：{formatCountFormula(calculation.throughWall.throughBar.calculationWidthMm, calculation.throughWall.throughBar.spacing, record.inputSnapshot.slab.countMode)} = {calculation.throughWall.throughBar.count}根</p>
                <p>垂直方向普通面筋仍按各房间独立计算，详见各房间面筋结果。</p>
              </div>
            )}
          </div>
        </details>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-bold text-slate-900">楼板钢筋计算二维示意图</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {hasActiveFilters
                  ? `二维图同步当前筛选：显示 ${currentFilteredResultIds.length}/${calculation.results.length} 项正式结果，不受结果分页影响。`
                  : `当前显示全部 ${calculation.results.length} 项正式结果。`}
              </p>
            </div>
            {hasActiveFilters && currentFilteredResultIds.length === 0 && (
              <span className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
                当前筛选无钢筋，图中仅保留房间和墙体。
              </span>
            )}
            <button type="button" onClick={() => { setDiagramZoom(1); setDiagramOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-700"><Maximize2 size={16} />放大查看</button>
          </div>
          <div className="w-full pb-1">
            <div className="w-full">
              <SlabResultsDiagram
                state={record.inputSnapshot}
                calculation={calculation}
                visibleResultIds={screenVisibleResultIds}
                selectionContext={
                  hasActiveFilters
                    ? {
                        kind: "current-filters",
                        selectedCount: currentFilteredResultIds.length,
                        totalCount: calculation.results.length,
                      }
                    : undefined
                }
              />
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
          <h2 className="font-bold text-slate-900">钢筋筛选</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-medium text-slate-500">类型</span><select aria-label="类型筛选" className={`${fieldClass} w-full`} value={ui.filters.layer} onChange={(event) => updateFilters({ layer: event.target.value as ResultUiState["filters"]["layer"] })}><option value="all">全部类型</option><option value="bottom">地筋</option><option value="top">面筋</option></select></label>
            <label><span className="mb-1 block text-xs font-medium text-slate-500">方向</span><select aria-label="方向筛选" className={`${fieldClass} w-full`} value={ui.filters.direction} onChange={(event) => updateFilters({ direction: event.target.value as ResultUiState["filters"]["direction"] })}><option value="all">全部方向</option><option value="x">东西向</option><option value="y">南北向</option></select></label>
            <label><span className="mb-1 block text-xs font-medium text-slate-500">状态</span><select aria-label="通墙筛选" className={`${fieldClass} w-full`} value={ui.filters.through} onChange={(event) => updateFilters({ through: event.target.value as ResultUiState["filters"]["through"] })}><option value="all">全部钢筋</option><option value="normal">普通钢筋</option><option value="through">通墙钢筋</option></select></label>
          </div>
        </section>

        <section className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="font-bold text-slate-900">结果明细</h2><p className="mt-1 text-xs text-slate-500">按房间或通墙路径分组分页，筛选不影响全部重量。</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label><span className="mb-1 block text-xs text-slate-500">每页显示</span><select aria-label="每页组数" className={`${fieldClass} w-full`} value={ui.pageSize} onChange={(event) => setUi((current) => ({ ...current, page: 1, pageSize: Number(event.target.value) as 2 | 5 | 10 }))}><option value="2">每页2组</option><option value="5">每页5组</option><option value="10">每页10组</option></select></label>
            <label><span className="mb-1 block text-xs text-slate-500">快速导航</span><select aria-label="快速跳转" className={`${fieldClass} w-full`} value={ui.selectedScopeId} onChange={(event) => jumpToScope(event.target.value)}><option value="">选择房间/路径</option>{filteredGroups.map((group) => <option key={group.scopeId} value={group.scopeId}>{group.title}</option>)}</select></label>
          </div>
        </section>

        <div className="mt-4 space-y-4">
          {pagination.groups.length > 0 ? pagination.groups.map((group) => <ResultGroupCard key={group.scopeId} group={group} countMode={record.inputSnapshot.slab.countMode} figureNumbers={figureNumbers} />) : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">当前筛选没有结果；全部重量仍为 {total.toFixed(2)}kg。</div>}
        </div>

        <nav className="mt-5 flex items-center justify-center gap-2" aria-label="结果分页">
          <div className="flex w-full items-center justify-between gap-2 sm:hidden">
            <button type="button" onClick={() => setUi((current) => ({ ...current, page: Math.max(current.page - 1, 1) }))} disabled={pagination.page === 1} className={fieldClass}>上一页</button>
            <span className="text-sm font-semibold text-slate-700">{pagination.page} / {pagination.pageCount}</span>
            <button type="button" onClick={() => setUi((current) => ({ ...current, page: Math.min(current.page + 1, pagination.pageCount) }))} disabled={pagination.page === pagination.pageCount} className={fieldClass}>下一页</button>
          </div>
          <div className="hidden flex-wrap items-center justify-center gap-2 sm:flex">
            <button type="button" onClick={() => setUi((current) => ({ ...current, page: 1 }))} disabled={pagination.page === 1} className={fieldClass}>首页</button>
            <button type="button" aria-label="上一页" onClick={() => setUi((current) => ({ ...current, page: Math.max(current.page - 1, 1) }))} disabled={pagination.page === 1} className={fieldClass}><ChevronLeft size={16} /></button>
            {paginationItems.map((item) => typeof item === "number" ? <button type="button" key={item} aria-current={item === pagination.page ? "page" : undefined} onClick={() => setUi((current) => ({ ...current, page: item }))} className={`${fieldClass} min-w-11 ${item === pagination.page ? "border-blue-600 bg-blue-600 text-white" : ""}`}>{item}</button> : <span key={item} className="px-1 text-slate-400">…</span>)}
            <button type="button" aria-label="下一页" onClick={() => setUi((current) => ({ ...current, page: Math.min(current.page + 1, pagination.pageCount) }))} disabled={pagination.page === pagination.pageCount} className={fieldClass}><ChevronRight size={16} /></button>
            <button type="button" onClick={() => setUi((current) => ({ ...current, page: pagination.pageCount }))} disabled={pagination.page === pagination.pageCount} className={fieldClass}>末页</button>
            <label className="flex items-center gap-2 text-sm text-slate-600">跳至<input aria-label="输入页码" type="number" min={1} max={pagination.pageCount} value={pagination.page} onChange={(event) => setUi((current) => ({ ...current, page: Number(event.target.value) || 1 }))} className={`${fieldClass} w-20`} />页</label>
          </div>
        </nav>
        </div>
        {printable && (
          <SlabPrintDialog
            open={printDialogOpen}
            record={record}
            groups={allGroups}
            currentFilteredResultIds={currentFilteredResultIds}
            options={draftPrintOptions}
            returnFocusRef={printButtonRef}
            onChange={setDraftPrintOptions}
            onCancel={() => setPrintDialogOpen(false)}
            onPrint={printSelectedResults}
          />
        )}
      </main>
      {diagramOpen && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/90" role="dialog" aria-modal="true" aria-label="放大查看楼板钢筋二维示意图">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/15 bg-slate-950 px-4 py-3 text-white">
            <div><h2 className="font-bold">楼板钢筋计算二维示意图</h2><p className="text-xs text-slate-300">可滚动查看；缩放只影响显示，不改变正式结果。</p></div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">缩放<input aria-label="二维图缩放" type="range" min="1" max="2.5" step="0.25" value={diagramZoom} onChange={(event) => setDiagramZoom(Number(event.target.value))} /></label>
              <button type="button" onClick={() => setDiagramOpen(false)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10" aria-label="关闭放大图"><X size={20} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
            <div className="mx-auto origin-top-left" style={{ width: `${diagramZoom * 100}%`, minWidth: diagramZoom > 1 ? 900 : undefined }}>
              <SlabResultsDiagram
                state={record.inputSnapshot}
                calculation={calculation}
                visibleResultIds={screenVisibleResultIds}
                selectionContext={hasActiveFilters ? { kind: "current-filters", selectedCount: currentFilteredResultIds.length, totalCount: calculation.results.length } : undefined}
              />
            </div>
          </div>
        </div>
      )}
      {printable && (
        <SlabPrintReport
          record={record}
          printedAt={printedAt}
          options={activePrintOptions}
        />
      )}
    </>
  );
}
