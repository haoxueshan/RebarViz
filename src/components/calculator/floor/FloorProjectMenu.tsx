"use client";

import { ChevronDown, Download, FilePlus, FolderOpen, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type FloorProjectMenuAction = "new" | "import" | "export";

/**
 * UI V5+ 工程入口：轻量「工程名 ▾」菜单（Desktop/Wide 内嵌 Workflow Bar，Phone 用 Bottom Sheet）。
 * 不新增整行 App Bar，不破坏 Canvas First。
 */
export function FloorProjectMenu({
  projectName,
  compact = false,
  onAction,
  onImportFile,
}: {
  projectName: string;
  /** Phone：使用「文件」入口 + Bottom Sheet。 */
  compact?: boolean;
  onAction: (action: FloorProjectMenuAction) => void;
  onImportFile: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      if (next && !compact && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
      } else {
        setPopoverPos(null);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  const run = (action: FloorProjectMenuAction) => {
    if (action === "import") {
      // File input 必须永久挂载；系统文件选择器打开期间如果组件卸载，
      // 用户选中文件后 change 事件会丢失。
      fileInputRef.current?.click();
      return;
    }
    setOpen(false);
    onAction(action);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;

    setOpen(false);
    onImportFile(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,application/json"
      className="sr-only"
      data-testid="floor-project-file-input"
      onChange={(event) => handleFile(event.target.files?.[0])}
    />
  );

  const menuItems = (
    <>
      {!compact && <p className="truncate px-3 pb-1.5 pt-2 text-xs font-semibold text-slate-800">{projectName}</p>}
      {!compact && <div className="mx-2 mb-1 border-t border-slate-100" />}
      <button type="button" onClick={() => run("new")} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><FilePlus size={16} className="text-blue-600" />新建楼板布局</button>
      <button type="button" onClick={() => run("import")} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Upload size={16} className="text-emerald-600" />导入数据</button>
      <button type="button" onClick={() => run("export")} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Download size={16} className="text-amber-600" />导出数据</button>
    </>
  );

  if (compact) {
    return (
      <>
        {fileInput}
        <button type="button" onClick={toggle} aria-expanded={open} data-testid="floor-project-menu-button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FolderOpen size={16} /><span className="hidden sm:inline">工程</span></button>
        {open && (
          <>
            <button type="button" aria-label="关闭工程菜单" onClick={() => setOpen(false)} className="fixed inset-0 z-[60] bg-slate-950/30" />
            <section className="fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl border border-slate-200 bg-white p-2 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl" data-testid="floor-project-mobile-sheet">
              <div className="flex min-h-11 items-center justify-between px-2"><strong className="text-sm text-slate-950">工程</strong><span className="truncate text-xs text-slate-500">当前：{projectName}</span></div>
              {menuItems}
            </section>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {fileInput}
      <div className="relative shrink-0">
        <button ref={buttonRef} type="button" onClick={toggle} aria-expanded={open} data-testid="floor-project-menu-button" className="inline-flex min-h-9 max-w-56 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><span className="truncate">{projectName}</span><ChevronDown size={15} className="shrink-0 text-slate-400" /></button>
        {open && popoverPos && (
          <>
            <button type="button" aria-label="关闭工程菜单" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10" style={{ top: popoverPos.top, right: popoverPos.right }} data-testid="floor-project-menu">
              {menuItems}
            </div>
          </>
        )}
      </div>
    </>
  );
}
