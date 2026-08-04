"use client";

import {
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { Printer, X } from "lucide-react";
import {
  barTypeDirectionLabel,
  buildSlabPrintReport,
  canPrintSlabReport,
  hasSelectedPrintSection,
  normalizePrintResultIds,
} from "@/lib/slab-calculator-report";
import type { BarResult } from "@/lib/slab-calculator";
import type {
  ResultGroup,
  SlabPrintOptions,
  SlabPrintRangeMode,
  SlabPrintSections,
  StoredCalculationRecord,
} from "@/lib/slab-calculator-storage";

type SlabPrintDialogProps = {
  open: boolean;
  record: StoredCalculationRecord;
  groups: ResultGroup[];
  currentFilteredResultIds: string[];
  options: SlabPrintOptions;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onChange: (options: SlabPrintOptions) => void;
  onCancel: () => void;
  onPrint: () => void;
};

const sectionOptions: Array<{ key: keyof SlabPrintSections; label: string }> = [
  { key: "weightSummary", label: "重量汇总" },
  { key: "parameters", label: "参数快照" },
  { key: "roomDimensions", label: "房间尺寸表" },
  { key: "diagram", label: "钢筋示意图" },
  { key: "specificationSummary", label: "规格汇总表" },
  { key: "resultDetails", label: "分组钢筋明细" },
  { key: "calculationNotes", label: "计算说明" },
];

function TriStateCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      className="h-5 w-5 shrink-0 accent-blue-600"
    />
  );
}

function resultOptionLabel(result: BarResult): string {
  return `${barTypeDirectionLabel(result)} · Φ${result.diameter}@${result.spacing}`;
}

export function SlabPrintDialog({
  open,
  record,
  groups,
  currentFilteredResultIds,
  options,
  returnFocusRef,
  onChange,
  onCancel,
  onPrint,
}: SlabPrintDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);

  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const returnFocusElement = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusElement ?? previousFocus)?.focus();
    };
  }, [open, returnFocusRef]);

  const allResults = useMemo(
    () => groups.flatMap((group) => group.results),
    [groups],
  );
  const allResultIds = useMemo(
    () => allResults.map((result) => result.id),
    [allResults],
  );
  const selectedIds = useMemo(
    () => new Set(options.selectedResultIds),
    [options.selectedResultIds],
  );
  const model = useMemo(
    () => buildSlabPrintReport(record, options),
    [options, record],
  );
  const hasSection = hasSelectedPrintSection(options.sections);
  const canPrint = canPrintSlabReport(model, options);

  if (!open) return null;

  const replaceSelection = (results: readonly BarResult[]) => {
    onChange({
      ...options,
      rangeMode: "custom",
      selectedResultIds: normalizePrintResultIds(
        record,
        results.map((result) => result.id),
      ),
    });
  };

  const setRangeMode = (rangeMode: SlabPrintRangeMode) => {
    const selectedResultIds =
      rangeMode === "all"
        ? allResultIds
        : rangeMode === "current-filters"
          ? currentFilteredResultIds
          : options.selectedResultIds;
    onChange({
      ...options,
      rangeMode,
      selectedResultIds: normalizePrintResultIds(record, selectedResultIds),
    });
  };

  const toggleGroup = (group: ResultGroup) => {
    const groupIds = group.results.map((result) => result.id);
    const allSelected = groupIds.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    groupIds.forEach((id) => {
      if (allSelected) next.delete(id);
      else next.add(id);
    });
    onChange({
      ...options,
      rangeMode: "custom",
      selectedResultIds: normalizePrintResultIds(record, [...next]),
    });
  };

  const toggleResult = (resultId: string) => {
    const next = new Set(selectedIds);
    if (next.has(resultId)) next.delete(resultId);
    else next.add(resultId);
    onChange({
      ...options,
      rangeMode: "custom",
      selectedResultIds: normalizePrintResultIds(record, [...next]),
    });
  };

  const updateSection = (key: keyof SlabPrintSections, checked: boolean) => {
    onChange({
      ...options,
      sections: { ...options.sections, [key]: checked },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 p-2 sm:p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="slab-print-dialog-title"
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div>
            <h2 id="slab-print-dialog-title" className="text-xl font-bold text-slate-950">
              打印设置
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              选择打印范围、报表章节和明细格式；打印数据始终来自当前正式计算记录。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭打印设置"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          <section>
            <h3 className="font-semibold text-slate-900">打印范围</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {([
                ["all", "全部正式结果", `${allResultIds.length}项`],
                ["current-filters", "当前筛选结果", `${currentFilteredResultIds.length}项，不受分页影响`],
                ["custom", "自定义选择", "按分组和钢筋项选择"],
              ] as const).map(([value, label, description]) => (
                <label
                  key={value}
                  className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                    options.rangeMode === value
                      ? "border-blue-600 bg-blue-50"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="slab-print-range"
                    value={value}
                    checked={options.rangeMode === value}
                    onChange={() => setRangeMode(value)}
                    className="mt-0.5 h-5 w-5 accent-blue-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{label}</span>
                    <span className="mt-1 block text-xs text-slate-500">{description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {options.rangeMode === "custom" && (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900">自定义数据选择</h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => replaceSelection(allResults)} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">全选</button>
                  <button type="button" onClick={() => replaceSelection([])} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">清空</button>
                  <button type="button" onClick={() => replaceSelection(allResults.filter((result) => result.layer === "bottom"))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">仅地筋</button>
                  <button type="button" onClick={() => replaceSelection(allResults.filter((result) => result.layer === "top"))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">仅面筋</button>
                  <button type="button" onClick={() => replaceSelection(allResults.filter((result) => result.direction === "x"))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">仅X向</button>
                  <button type="button" onClick={() => replaceSelection(allResults.filter((result) => result.direction === "y"))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">仅Y向</button>
                  <button type="button" onClick={() => replaceSelection(allResults.filter((result) => result.scopeType === "through"))} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">仅通墙组合区</button>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {groups.map((group) => {
                  const selectedCount = group.results.filter((result) => selectedIds.has(result.id)).length;
                  const checked = selectedCount === group.results.length;
                  const indeterminate = selectedCount > 0 && !checked;
                  return (
                    <div key={group.scopeId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold text-slate-900">
                        <TriStateCheckbox
                          checked={checked}
                          indeterminate={indeterminate}
                          label={`选择${group.title}`}
                          onChange={() => toggleGroup(group)}
                        />
                        <span className="min-w-0 flex-1">{group.title}</span>
                        <span className="text-xs font-normal text-slate-500">{selectedCount}/{group.results.length}</span>
                      </label>
                      <div className="ml-4 mt-1 border-l border-slate-300 pl-4 sm:ml-6">
                        {group.results.map((result) => (
                          <label key={result.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(result.id)}
                              onChange={() => toggleResult(result.id)}
                              className="h-5 w-5 shrink-0 accent-blue-600"
                            />
                            <span className="min-w-0 flex-1">{resultOptionLabel(result)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="font-semibold text-slate-900">打印章节</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {sectionOptions.map((section) => (
                  <label key={section.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={options.sections[section.key]}
                      onChange={(event) => updateSection(section.key, event.target.checked)}
                      className="h-5 w-5 accent-blue-600"
                    />
                    {section.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">明细模式</h3>
              <div className="mt-3 space-y-2">
                <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="radio" name="slab-print-detail" checked={options.detailMode === "full"} onChange={() => onChange({ ...options, detailMode: "full" })} className="mt-0.5 h-5 w-5 accent-blue-600" />
                  <span><span className="block text-sm font-semibold">完整明细</span><span className="mt-1 block text-xs text-slate-500">包含锚固来源、最终锚固和面筋增加位置</span></span>
                </label>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="radio" name="slab-print-detail" checked={options.detailMode === "compact"} onChange={() => onChange({ ...options, detailMode: "compact" })} className="mt-0.5 h-5 w-5 accent-blue-600" />
                  <span><span className="block text-sm font-semibold">简洁料单</span><span className="mt-1 block text-xs text-slate-500">仅保留规格、根数、长度和重量等核心字段</span></span>
                </label>
              </div>
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-semibold text-slate-900">
                已选择{model.selectedRowCount}/{model.fullRowCount}项
                <span className="ml-3">本次选择重量：{model.selectedTotalWeightKg.toFixed(2)}kg</span>
              </p>
              {model.selectedRowCount === 0 && <p className="mt-1 text-red-600">请至少选择一项钢筋结果</p>}
              {!hasSection && <p className="mt-1 text-red-600">请至少选择一个打印章节</p>}
            </div>
            <div className="flex gap-2 sm:justify-end">
              <button type="button" onClick={onCancel} className="min-h-11 flex-1 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:flex-none">取消</button>
              <button type="button" onClick={onPrint} disabled={!canPrint} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 sm:flex-none">
                <Printer size={17} />打印所选内容
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
