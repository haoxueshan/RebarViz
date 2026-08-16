"use client";

import { Check, X } from "lucide-react";
import type { ParsedFloorProject } from "@/lib/floor-project-file";

export type FloorImportError = { message: string } | null;

/**
 * UI V5+ 导入楼板数据 Dialog：解析成功先预览摘要，确认后才替换工作区（Atomic Import）。
 */
export function FloorImportProjectDialog({
  open,
  fileName,
  project,
  errorMessage,
  onCancel,
  onConfirm,
  onExportCurrent,
}: {
  open: boolean;
  fileName: string;
  project: ParsedFloorProject | null;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onExportCurrent: () => void;
}) {
  if (!open) return null;

  const slabs = project?.planState.slabs.length ?? 0;
  const openings = project?.planState.openings.length ?? 0;
  const through = project?.topState.throughPaths.length ?? 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="导入楼板数据">
      <button type="button" aria-label="关闭导入对话框" onClick={onCancel} className="absolute inset-0 bg-slate-950/40" />
      <section className="relative w-[min(440px,94vw)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" data-testid="floor-import-project-dialog">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-bold text-slate-950">导入楼板数据</h2>
          <button type="button" onClick={onCancel} aria-label="关闭" className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={17} /></button>
        </div>

        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800" data-testid="floor-import-error">{errorMessage}</p>
        ) : project ? (
          <div className="mt-4 space-y-3">
            <p className="truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">文件：{fileName}</p>
            <p className="truncate text-sm font-semibold text-slate-800" data-testid="floor-import-project-name">工程名称：{project.projectName}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-200 p-2"><strong className="block text-lg text-slate-900">{slabs}</strong><span className="text-[11px] text-slate-500">板区</span></div>
              <div className="rounded-lg border border-slate-200 p-2"><strong className="block text-lg text-slate-900">{openings}</strong><span className="text-[11px] text-slate-500">洞口</span></div>
              <div className="rounded-lg border border-slate-200 p-2"><strong className="block text-lg text-slate-900">{through}</strong><span className="text-[11px] text-slate-500">通墙路径</span></div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-600" />楼层布局</span>
              <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-600" />地筋设置</span>
              <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-600" />面筋设置</span>
              <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-600" />主副筋设置</span>
            </div>
            {project.legacy && <p className="rounded-lg bg-amber-50 p-2.5 text-xs leading-5 text-amber-800" data-testid="floor-import-legacy-note">检测到旧版楼层布局文件。将导入楼层布局，地筋、面筋和主副筋设置将使用默认值。</p>}
            <p className="text-xs leading-5 text-slate-500">导入后将替换当前工作区数据。建议：导入前先导出当前工程作为备份。</p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {project && (
            <button type="button" onClick={onExportCurrent} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">先导出当前工程</button>
          )}
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700">取消</button>
          {project && (
            <button type="button" onClick={onConfirm} className="min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white" data-testid="floor-import-confirm">确认导入</button>
          )}
        </div>
      </section>
    </div>
  );
}
