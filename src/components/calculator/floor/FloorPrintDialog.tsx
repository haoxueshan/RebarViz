"use client";

import { Printer, X } from "lucide-react";
import { useState } from "react";
import {
  DEFAULT_FLOOR_PRINT_OPTIONS,
  detectFloorPrintPreset,
  floorPrintOptionsForPreset,
  type FloorPrintEligibility,
  type FloorPrintOptions,
  type FloorPrintProjectInfo,
} from "@/lib/floor-print";
import {
  loadFloorPrintSettings,
  saveFloorPrintSettings,
} from "@/lib/floor-print-storage";

const SECTION_LABELS: Array<[keyof FloorPrintOptions["sections"], string]> = [
  ["summary", "总体汇总"],
  ["floorPlan", "纯楼层平面"],
  ["bottomPlan", "地筋平铺图"],
  ["bottomBom", "地筋料单"],
  ["topPlan", "面筋平铺图"],
  ["topBom", "面筋料单"],
  ["combinedBom", "地筋 + 面筋综合明细"],
  ["diameterSummary", "按直径汇总"],
  ["calculationParameters", "计算参数"],
];

const DISPLAY_LABELS: Array<[keyof FloorPrintOptions["display"], string]> = [
  ["slabNames", "板区名称"],
  ["openingNames", "洞口名称"],
  ["barMarks", "钢筋编号"],
  ["barSpecification", "图中规格"],
  ["weights", "表格重量"],
  ["anchorDetails", "端部支承详情"],
];

export function FloorPrintDialog({
  open,
  eligibility,
  onClose,
  onGenerate,
}: {
  open: boolean;
  eligibility: FloorPrintEligibility;
  onClose: () => void;
  onGenerate: (project: FloorPrintProjectInfo, options: FloorPrintOptions) => void;
}) {
  const [options, setOptions] = useState<FloorPrintOptions>(() => {
    if (typeof window === "undefined") return structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS);
    return loadFloorPrintSettings(window.localStorage)?.options ?? structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS);
  });
  const [project, setProject] = useState<FloorPrintProjectInfo>({ projectName: "", floorName: "", remark: "" });

  if (!open) return null;

  const updateOptions = (next: FloorPrintOptions) => {
    setOptions({ ...next, preset: detectFloorPrintPreset(next) });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="整层打印设置"
      data-testid="floor-print-dialog"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-slate-950">整层打印设置</h2>
            <p className="mt-1 text-xs text-slate-500">生成冻结的结果快照后进入独立打印预览。</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="关闭打印设置"><X size={20} /></button>
        </div>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          <section>
            <h3 className="text-sm font-bold text-slate-900">打印模板</h3>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(["site", "full", "custom"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={preset === "custom"}
                  onClick={() => preset !== "custom" && setOptions(floorPrintOptionsForPreset(preset))}
                  className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${options.preset === preset ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"} disabled:cursor-default`}
                  aria-pressed={options.preset === preset}
                >
                  {preset === "site" ? "现场料单" : preset === "full" ? "完整报告" : "自定义"}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900">项目信息</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">项目名称</span><input value={project.projectName} onChange={(event) => setProject((current) => ({ ...current, projectName: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" placeholder="例如：郝家住宅" /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">楼层名称</span><input value={project.floorName} onChange={(event) => setProject((current) => ({ ...current, floorName: event.target.value }))} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" placeholder="例如：二层顶板" /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-xs font-medium text-slate-600">备注</span><textarea value={project.remark} onChange={(event) => setProject((current) => ({ ...current, remark: event.target.value }))} className="min-h-20 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="例如：现场复核后下料" /></label>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900">打印内容</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SECTION_LABELS.map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                  <input type="checkbox" checked={options.sections[key]} onChange={(event) => updateOptions({ ...options, sections: { ...options.sections, [key]: event.target.checked }, preset: "custom" })} className="h-4 w-4" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900">图表显示</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DISPLAY_LABELS.map(([key, label]) => (
                <label key={key} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                  <input type="checkbox" checked={options.display[key]} onChange={(event) => updateOptions({ ...options, display: { ...options.display, [key]: event.target.checked }, preset: "custom" })} className="h-4 w-4" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900">页面与单位</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label><span className="mb-1 block text-xs font-medium text-slate-600">纸张</span><select value={options.paperSize} onChange={(event) => updateOptions({ ...options, paperSize: event.target.value as FloorPrintOptions["paperSize"], preset: "custom" })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="A3">A3</option><option value="A4">A4</option></select></label>
              <label><span className="mb-1 block text-xs font-medium text-slate-600">方向</span><select value={options.orientation} onChange={(event) => updateOptions({ ...options, orientation: event.target.value as FloorPrintOptions["orientation"], preset: "custom" })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="landscape">横向</option><option value="portrait">纵向</option></select></label>
              <label className="col-span-2 sm:col-span-1"><span className="mb-1 block text-xs font-medium text-slate-600">单根下料单位</span><select value={options.lengthUnit} onChange={(event) => updateOptions({ ...options, lengthUnit: event.target.value as FloorPrintOptions["lengthUnit"], preset: "custom" })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="mm">mm</option><option value="m">m</option></select></label>
            </div>
          </section>

          {!eligibility.eligible && (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4" data-testid="floor-print-ineligible">
              <h3 className="font-semibold text-rose-900">当前不能生成正式下料单</h3>
              <ul className="mt-2 space-y-1 text-sm text-rose-800">{eligibility.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul>
            </section>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-3 border-t border-slate-200 bg-white px-5 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-6">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-slate-300 font-semibold text-slate-700">取消</button>
          <button
            type="button"
            disabled={!eligibility.eligible}
            onClick={() => {
              saveFloorPrintSettings(window.localStorage, options);
              onGenerate(project, options);
            }}
            className="inline-flex min-h-11 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            data-testid="generate-floor-print-preview"
          >
            <Printer size={17} />生成打印预览
          </button>
        </div>
      </div>
    </div>
  );
}
