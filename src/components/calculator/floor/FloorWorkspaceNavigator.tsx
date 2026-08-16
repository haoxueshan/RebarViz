"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  Copy,
  DoorOpen,
  Grid2X2,
  Link2,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { FloorSelection } from "./FloorCanvas";
import type {
  FloorWorkflowStage,
  FloorWorkspaceRoleItem,
  FloorWorkspaceThroughItem,
} from "./floor-workspace-types";
import type { FloorPlanIssue, FloorPlanState } from "@/lib/floor-plan";

const SLAB_TYPE_LABELS: Record<string, string> = {
  room: "房间",
  corridor: "内走廊",
  hall: "客厅",
  balcony: "阳台",
  other: "其他板区",
};

const OPENING_TYPE_LABELS: Record<string, string> = {
  stair: "楼梯间",
  shaft: "井道",
  void: "挑空",
  other: "其他洞口",
};

/** 按对象标记 warning 的几何警告码；楼层级警告（如多组件）不落到单个对象上。 */
const OBJECT_WARNING_CODES = new Set([
  "opening-uncovered",
  "opening-partial-outside",
  "opening-edge-near-slab-edge",
  "object-name-empty",
]);

function StatusMark({ status }: { status: "valid" | "warning" | "invalid" | "disabled" }) {
  if (status === "invalid") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700"><AlertTriangle size={13} />异常</span>;
  if (status === "disabled") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500"><Circle size={11} />未启用</span>;
  if (status === "warning") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700"><TriangleAlert size={13} />需确认</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Check size={13} />正常</span>;
}

function SectionTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return <div className="mb-1 mt-4 flex items-center justify-between px-2 text-[11px] font-bold uppercase tracking-wide text-slate-500"><span>{children}</span><span>{count}</span></div>;
}

export function FloorWorkspaceNavigator({
  stage,
  plan,
  selection,
  geometryIssues,
  bottomOverrides,
  topOverrides,
  roleItems,
  throughItems,
  selectedThroughPathId,
  compact = false,
  onOpenOverlay,
  onSelect,
  onSelectRole,
  onSelectThrough,
  onAddSlab,
  onAddOpening,
  onDuplicate,
  onDelete,
  onAddThrough,
}: {
  stage: FloorWorkflowStage;
  plan: FloorPlanState;
  selection: FloorSelection;
  geometryIssues: readonly FloorPlanIssue[];
  bottomOverrides: ReadonlySet<string>;
  topOverrides: ReadonlySet<string>;
  roleItems: readonly FloorWorkspaceRoleItem[];
  throughItems: readonly FloorWorkspaceThroughItem[];
  selectedThroughPathId: string | null;
  compact?: boolean;
  /** UI V3（PRD 59-64）：Rail 按钮打开完整 Navigator Overlay。 */
  onOpenOverlay?: () => void;
  onSelect: (selection: Exclude<FloorSelection, null>) => void;
  onSelectRole: (item: FloorWorkspaceRoleItem) => void;
  onSelectThrough: (id: string) => void;
  onAddSlab: () => void;
  onAddOpening: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddThrough: () => void;
}) {
  const [query, setQuery] = useState("");
  const objectErrors = useMemo(() => {
    const result = new Set<string>();
    geometryIssues.filter((issue) => issue.level === "error").forEach((issue) => issue.objectIds?.forEach((id) => result.add(id)));
    return result;
  }, [geometryIssues]);
  const objectWarnings = useMemo(() => {
    const result = new Set<string>();
    geometryIssues.filter((issue) => issue.level === "warning" && OBJECT_WARNING_CODES.has(issue.code)).forEach((issue) => issue.objectIds?.forEach((id) => result.add(id)));
    return result;
  }, [geometryIssues]);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredSlabs = plan.slabs.filter((slab) => !normalizedQuery || `${slab.name} ${SLAB_TYPE_LABELS[slab.type] ?? slab.type}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const filteredOpenings = plan.openings.filter((opening) => !normalizedQuery || `${opening.name} ${OPENING_TYPE_LABELS[opening.type] ?? opening.type}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const localCount = stage === "bottom" ? bottomOverrides.size : stage === "top" ? topOverrides.size : 0;

  if (compact) {
    // UI V3（PRD 59-64）：Rail 不再截断对象列表（删除 slice(0,8)），
    // 按钮按类别打开完整 Navigator Overlay，任何数量的板区/洞口/通墙都可访问。
    const railButton = (label: string, icon: React.ReactNode, onClick: () => void, active = false) => (
      <button key={label} type="button" title={label} aria-label={`导航-${label}`} aria-current={active ? "true" : undefined} onClick={onClick} className={`flex size-11 items-center justify-center rounded-xl ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{icon}</button>
    );
    return (
      <nav className="flex h-full flex-col items-center gap-2 border-r border-slate-200 bg-white p-1.5" aria-label="工作台对象快捷导航">
        {stage === "plan" ? (
          <>
            {railButton("对象", <Grid2X2 size={17} />, () => onOpenOverlay?.(), selection?.kind === "slab")}
            {railButton("洞口", <DoorOpen size={17} />, () => onOpenOverlay?.(), selection?.kind === "opening")}
            {railButton("新增", <Plus size={17} />, () => { onAddSlab(); })}
          </>
        ) : (
          <>
            {railButton("板区", <Grid2X2 size={17} />, () => onOpenOverlay?.(), selection?.kind === "slab")}
            {railButton("主副筋", <Circle size={17} />, () => onOpenOverlay?.())}
            {stage === "top" && railButton("通墙", <Link2 size={17} />, () => onOpenOverlay?.(), Boolean(selectedThroughPathId))}
          </>
        )}
      </nav>
    );
  }

  return (
    <nav className="flex h-full min-h-0 flex-col bg-white" aria-label="整层工作台导航" data-testid="floor-workspace-navigator">
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <div><h2 className="text-sm font-bold text-slate-950">{stage === "plan" ? "楼层对象" : stage === "bottom" ? "地筋设置" : "面筋设置"}</h2><p className="mt-0.5 text-[11px] text-slate-500">{plan.slabs.length}板区 · {plan.openings.length}洞口{localCount > 0 ? ` · ${localCount}局部` : ""}{stage === "top" && throughItems.length > 0 ? ` · ${throughItems.length}通墙` : ""}</p></div>
        </div>
        {stage === "plan" && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" aria-label="添加板区" onClick={onAddSlab} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-blue-600 px-2 text-xs font-semibold text-white"><Plus size={15} />板区</button><button type="button" aria-label="添加洞口" onClick={onAddOpening} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-600 px-2 text-xs font-semibold text-white"><DoorOpen size={15} />洞口</button></div>}
        {plan.slabs.length + plan.openings.length >= 8 && <label className="relative mt-3 block"><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><span className="sr-only">搜索板区或洞口</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索板区/洞口" className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></label>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <SectionTitle count={filteredSlabs.length}>板区</SectionTitle>
        <div className="space-y-1">
          {filteredSlabs.map((slab) => {
            const selected = selection?.kind === "slab" && selection.id === slab.id;
            const local = stage === "bottom" ? bottomOverrides.has(slab.id) : stage === "top" ? topOverrides.has(slab.id) : false;
            const invalid = objectErrors.has(slab.id);
            const warning = !invalid && objectWarnings.has(slab.id);
            return <button key={slab.id} type="button" aria-current={selected ? "true" : undefined} data-navigator-object-id={slab.id} data-selected={selected ? "true" : "false"} onClick={() => onSelect({ kind: "slab", id: slab.id })} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left ${selected ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-slate-50"}`}><Grid2X2 size={15} className={selected ? "text-blue-700" : "text-slate-400"} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-900">{slab.name}</strong><span className="block truncate text-[11px] text-slate-500">{SLAB_TYPE_LABELS[slab.type] ?? slab.type}{local ? " · 局部规格" : stage !== "plan" ? " · 整层默认" : ""}</span></span>{invalid ? <AlertTriangle size={15} className="shrink-0 text-rose-600" aria-label="存在几何错误" /> : warning ? <TriangleAlert size={15} className="shrink-0 text-amber-600" aria-label="存在几何警告" /> : local ? <span className="text-blue-600" aria-label="使用局部规格">●</span> : <Check size={14} className="shrink-0 text-emerald-600" />}</button>;
          })}
        </div>
        {stage === "plan" && <><SectionTitle count={filteredOpenings.length}>洞口</SectionTitle><div className="space-y-1">{filteredOpenings.map((opening) => { const selected = selection?.kind === "opening" && selection.id === opening.id; const invalid = objectErrors.has(opening.id); const warning = !invalid && objectWarnings.has(opening.id); return <button key={opening.id} type="button" aria-current={selected ? "true" : undefined} data-selected={selected ? "true" : "false"} data-navigator-object-id={opening.id} onClick={() => onSelect({ kind: "opening", id: opening.id })} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left ${selected ? "bg-rose-50 ring-1 ring-rose-300" : "hover:bg-slate-50"}`}><DoorOpen size={15} className="text-rose-500" /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-900">{opening.name}</strong><span className="block truncate text-[11px] text-slate-500">{OPENING_TYPE_LABELS[opening.type] ?? opening.type}</span></span>{invalid ? <AlertTriangle size={15} className="text-rose-600" aria-label="存在几何错误" /> : warning ? <TriangleAlert size={15} className="text-amber-600" aria-label="存在几何警告" /> : <Check size={14} className="text-emerald-600" />}</button>; })}</div></>}
        {(stage === "bottom" || stage === "top") && <><SectionTitle count={roleItems.length}>主副筋区域</SectionTitle><div className="space-y-1">{roleItems.map((item) => <button key={item.id} type="button" onClick={() => onSelectRole(item)} data-navigator-role-id={item.id} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-indigo-50"><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-900">{item.label}</strong><span className="block truncate text-[11px] text-slate-500">{item.detail}</span></span><StatusMark status={item.status} /></button>)}</div></>}
        {stage === "top" && <><SectionTitle count={throughItems.length}>通墙路径</SectionTitle><div className="space-y-1">{throughItems.map((item) => <button key={item.id} type="button" aria-pressed={selectedThroughPathId === item.id} data-navigator-through-id={item.id} onClick={() => onSelectThrough(item.id)} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left ${selectedThroughPathId === item.id ? "bg-cyan-50 ring-1 ring-cyan-300" : "hover:bg-slate-50"}`}><Link2 size={15} className="shrink-0 text-cyan-700" /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-900">{item.name}</strong><span className="block truncate text-[11px] text-slate-500">{item.detail}</span></span><StatusMark status={item.status} /></button>)}<button type="button" onClick={onAddThrough} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300 text-xs font-semibold text-cyan-800"><Plus size={15} />新建通墙路径</button></div></>}
      </div>
      {stage === "plan" && <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-3"><button type="button" onClick={onDuplicate} disabled={!selection} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 disabled:opacity-40"><Copy size={14} />复制</button><button type="button" onClick={onDelete} disabled={!selection || (selection.kind === "slab" && plan.slabs.length <= 1)} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 text-xs font-semibold text-rose-700 disabled:opacity-40"><Trash2 size={14} />删除</button></div>}
    </nav>
  );
}
