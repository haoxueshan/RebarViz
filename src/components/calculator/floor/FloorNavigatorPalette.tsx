"use client";

import { X } from "lucide-react";

export function FloorNavigatorPalette({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <aside className="absolute bottom-2 left-[52px] top-2 z-50 hidden w-[304px] min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg xl:flex xl:flex-col" data-testid="floor-navigator-palette" aria-label={title}>
      <div className="flex min-h-11 items-center justify-between border-b border-slate-200 px-3">
        <strong className="text-sm text-slate-900">{title}</strong>
        <button type="button" onClick={onClose} aria-label="关闭对象浏览器" className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={17} /></button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  );
}
