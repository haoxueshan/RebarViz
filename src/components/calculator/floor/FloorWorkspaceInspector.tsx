"use client";

import { AlertTriangle, ChevronLeft } from "lucide-react";
import type { FloorInspectorTab } from "./floor-workspace-types";

export type FloorWorkspaceInspectorTab = {
  id: FloorInspectorTab;
  label: string;
};

export function FloorWorkspaceInspector({
  title,
  subtitle,
  tabs,
  activeTab,
  issueCount = 0,
  onTabChange,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  tabs: readonly FloorWorkspaceInspectorTab[];
  activeTab: FloorInspectorTab;
  issueCount?: number;
  onTabChange: (tab: FloorInspectorTab) => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return <div className="flex min-h-0 flex-col bg-white" data-testid="floor-workspace-inspector"><header className="border-b border-slate-200 px-4 py-3">{onBack && <button type="button" onClick={onBack} className="mb-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-blue-700"><ChevronLeft size={15} />返回当前板区</button>}<div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">当前对象</p><h2 className="mt-0.5 truncate font-bold text-slate-950">{title}</h2>{subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}</div>{issueCount > 0 && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-800"><AlertTriangle size={13} />{issueCount}个问题</span>}</div></header><div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2" role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => onTabChange(tab.id)} className={`min-h-11 shrink-0 rounded-xl px-3 text-xs font-semibold ${activeTab === tab.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{tab.label}</button>)}</div><div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div></div>;
}
