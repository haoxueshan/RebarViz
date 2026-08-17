"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { FLOOR_DEFAULT_PROJECT_NAME } from "@/lib/floor-project-file";

export type FloorNewProjectMode = "blank" | "example";

/**
 * UI V5+ 新建楼板布局 Dialog：工程名称 + 起始方式（空白/默认示例）。
 * 由父组件条件渲染：每次打开重新挂载，输入状态自动重置。
 */
export function FloorNewProjectDialog({
  currentProjectName,
  onCancel,
  onConfirm,
}: {
  currentProjectName: string;
  onCancel: () => void;
  onConfirm: (name: string, mode: FloorNewProjectMode) => void;
}) {
  const [name, setName] = useState(FLOOR_DEFAULT_PROJECT_NAME);
  const [mode, setMode] = useState<FloorNewProjectMode>("blank");

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="新建楼板布局">
      <button type="button" aria-label="关闭新建对话框" onClick={onCancel} className="absolute inset-0 bg-slate-950/40" />
      <section className="relative w-[min(420px,94vw)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" data-testid="floor-new-project-dialog">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-bold text-slate-950">新建楼板布局</h2>
          <button type="button" onClick={onCancel} aria-label="关闭" className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={17} /></button>
        </div>
        <p className="mt-1 text-xs text-slate-500">当前工程：{currentProjectName}</p>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">新建后当前工作区将被新的空白楼板替换。当前数据已自动保存在浏览器中，但建议重要工程先导出备份。</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-700">工程名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={FLOOR_DEFAULT_PROJECT_NAME} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500" data-testid="new-project-name-input" />
        </label>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-semibold text-slate-700">起始方式</legend>
          <div className="space-y-2">
            <label className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm ${mode === "blank" ? "border-blue-500 bg-blue-50 font-semibold text-blue-800" : "border-slate-200 text-slate-700"}`}>
              <input type="radio" name="floor-new-mode" checked={mode === "blank"} onChange={() => setMode("blank")} className="accent-blue-600" />
              空白楼板
            </label>
            <label className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-sm ${mode === "example" ? "border-blue-500 bg-blue-50 font-semibold text-blue-800" : "border-slate-200 text-slate-700"}`}>
              <input type="radio" name="floor-new-mode" checked={mode === "example"} onChange={() => setMode("example")} className="accent-blue-600" />
              使用默认示例布局
            </label>
          </div>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700">取消</button>
          <button type="button" onClick={() => onConfirm(name.trim() || FLOOR_DEFAULT_PROJECT_NAME, mode)} className="min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white" data-testid="new-project-confirm">新建</button>
        </div>
      </section>
    </div>
  );
}
