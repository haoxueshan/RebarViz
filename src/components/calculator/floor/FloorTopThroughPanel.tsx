"use client";

import { ArrowRight, Link2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  FloorTopCalculation,
  FloorTopState,
  FloorTopThroughPath,
} from "@/lib/floor-top-calculator";
import type { FloorPlanState } from "@/lib/floor-plan";
import { floorBarRoleLabel } from "@/lib/floor-rebar-role";
import { resolveFloorTopThroughPathGeometry } from "@/lib/floor-top-through";
import { directionLabel } from "@/lib/slab-calculator";

function nextPathName(paths: readonly FloorTopThroughPath[]): string {
  const names = new Set(paths.map((path) => path.name));
  let index = 1;
  while (names.has(`通墙${String(index).padStart(2, "0")}`)) index += 1;
  return `通墙${String(index).padStart(2, "0")}`;
}

function nextPathId(): string {
  return `floor-through-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ThroughNumberField({ fieldKey, label, value, onChange, onValidityChange }: {
  fieldKey: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? String(value);
  const parsed = Number(displayed);
  const invalid = displayed.trim() === "" || !Number.isFinite(parsed);
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          value={displayed}
          aria-invalid={invalid}
          onFocus={(event) => { setDraft(String(value)); event.currentTarget.select(); }}
          onChange={(event) => {
            const raw = event.target.value;
            const next = Number(raw);
            const valid = raw.trim() !== "" && Number.isFinite(next);
            setDraft(raw);
            onValidityChange(fieldKey, valid);
            if (valid) onChange(next);
          }}
          onBlur={() => {
            if (!invalid) setDraft(null);
          }}
          className={`h-11 w-full rounded-xl border bg-white px-3 pr-11 text-sm outline-none focus:ring-2 ${invalid ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-cyan-600 focus:ring-cyan-100"}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">mm</span>
      </span>
    </label>
  );
}

export function FloorTopThroughPanel({
  plan,
  top,
  calculation,
  onChange,
  onValidityChange,
}: {
  plan: FloorPlanState;
  top: FloorTopState;
  calculation: FloorTopCalculation;
  onChange: (state: FloorTopState) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const updatePath = (id: string, patch: Partial<FloorTopThroughPath>) => {
    onChange({
      ...top,
      throughPaths: top.throughPaths.map((path) => path.id === id ? { ...path, ...patch } : path),
    });
  };
  const removePath = (path: FloorTopThroughPath) => {
    onValidityChange(`through:${path.id}:start`, true);
    onValidityChange(`through:${path.id}:end`, true);
    onChange({ ...top, throughPaths: top.throughPaths.filter((item) => item.id !== path.id) });
  };
  const addPath = () => {
    const slabIds = plan.slabs.slice(0, 2).map((slab) => slab.id);
    const draft: FloorTopThroughPath = {
      id: nextPathId(),
      name: nextPathName(top.throughPaths),
      direction: "x",
      slabIds,
      bandStartMm: 0,
      bandEndMm: 0,
      enabled: false,
    };
    const geometry = resolveFloorTopThroughPathGeometry(plan, draft);
    if (geometry.maxBandStartMm !== null && geometry.maxBandEndMm !== null) {
      draft.bandStartMm = geometry.maxBandStartMm;
      draft.bandEndMm = geometry.maxBandEndMm;
    }
    onChange({ ...top, throughPaths: [...top.throughPaths, draft] });
  };

  return (
    <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Link2 size={18} className="text-blue-700" /><h2 className="font-semibold text-slate-900">面筋通墙路径</h2></div>
          <p className="mt-2 text-xs leading-5 text-slate-500">通墙筋从已生成的普通面筋位置中替换产生，不新增布筋相位，也不会与被替换的普通筋重复计量。</p>
        </div>
        <button type="button" onClick={addPath} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={16} />新建通墙路径</button>
      </div>

      {top.throughPaths.length === 0 && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">尚未建立通墙路径；当前面筋结果保持全部普通面筋。</p>}
      <div className="mt-4 space-y-4">
        {top.throughPaths.map((path) => {
          const geometry = resolveFloorTopThroughPathGeometry(plan, path);
          const resolved = calculation.resolvedThroughPaths.find((item) => item.id === path.id);
          const pathIssues = calculation.errors.filter((item) =>
            item.code.startsWith("through-") && (item.objectIds?.includes(path.id) ?? item.message.includes(path.name)));
          const orderedNames = geometry.orderedSlabIds.map((id) =>
            plan.slabs.find((slab) => slab.id === id)?.name ?? id);
          return (
            <article key={path.id} className={`rounded-2xl border p-4 ${path.enabled ? pathIssues.length > 0 ? "border-rose-300 bg-rose-50/50" : "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-slate-50"}`} data-through-path-id={path.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input value={path.name} onChange={(event) => updatePath(path.id, { name: event.target.value })} aria-label="通墙路径名称" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold" />
                <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={path.enabled} onChange={(event) => updatePath(path.id, { enabled: event.target.checked })} className="h-5 w-5 rounded border-slate-300" />启用</label>
                <button type="button" onClick={() => removePath(path)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700"><Trash2 size={15} />删除</button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">通墙方向</span><select value={path.direction} onChange={(event) => updatePath(path.id, { direction: event.target.value as "x" | "y" })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="x">东西向（西→东）</option><option value="y">南北向（南→北）</option></select></label>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600"><strong className="text-slate-900">系统顺序</strong><span className="mt-1 flex flex-wrap items-center gap-1">{orderedNames.length > 0 ? orderedNames.map((name, index) => <span key={`${name}:${index}`} className="inline-flex items-center gap-1">{index > 0 && <ArrowRight size={12} />}{name}</span>) : "尚未形成有效链"}</span></div>
              </div>

              <fieldset className="mt-3">
                <legend className="text-xs font-medium text-slate-600">参与板区</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {plan.slabs.map((slab) => (
                    <label key={slab.id} className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"><input type="checkbox" checked={path.slabIds.includes(slab.id)} onChange={(event) => updatePath(path.id, { slabIds: event.target.checked ? [...path.slabIds, slab.id] : path.slabIds.filter((id) => id !== slab.id) })} className="h-5 w-5 shrink-0 rounded border-slate-300" /><span className="truncate">{slab.name}</span></label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>最大有效范围：<strong className="text-slate-900">{geometry.maxBandStartMm === null ? "--" : `${geometry.maxBandStartMm} ~ ${geometry.maxBandEndMm} mm`}</strong></span><button type="button" disabled={geometry.maxBandStartMm === null || geometry.maxBandEndMm === null} onClick={() => { if (geometry.maxBandStartMm === null || geometry.maxBandEndMm === null) return; onValidityChange(`through:${path.id}:start`, true); onValidityChange(`through:${path.id}:end`, true); updatePath(path.id, { bandStartMm: geometry.maxBandStartMm, bandEndMm: geometry.maxBandEndMm }); }} className="min-h-11 rounded-lg border border-blue-200 px-3 font-medium text-blue-700 disabled:opacity-40">使用最大共同范围</button></div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <ThroughNumberField fieldKey={`through:${path.id}:start`} label={path.direction === "x" ? "Y范围起点" : "X范围起点"} value={path.bandStartMm} onChange={(bandStartMm) => updatePath(path.id, { bandStartMm })} onValidityChange={onValidityChange} />
                  <ThroughNumberField fieldKey={`through:${path.id}:end`} label={path.direction === "x" ? "Y范围终点" : "X范围终点"} value={path.bandEndMm} onChange={(bandEndMm) => updatePath(path.id, { bandEndMm })} onValidityChange={onValidityChange} />
                </div>
              </div>

              {resolved && <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900 sm:grid-cols-4"><span>角色<strong className="mt-1 block">{floorBarRoleLabel(resolved.role)}</strong></span><span>继承规格<strong className="mt-1 block">Φ{resolved.diameter}@{resolved.spacing}</strong></span><span>方向<strong className="mt-1 block">{directionLabel(resolved.direction)}</strong></span><span>有效通墙筋<strong className="mt-1 block">{resolved.linePositionsMm.length}根</strong></span></div>}
              {geometry.errors.length > 0 && <ul className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{geometry.errors.map((item) => <li key={`${item.code}:${item.message}`}>• {item.message}</li>)}</ul>}
              {path.enabled && pathIssues.length > 0 && <ul className="mt-3 rounded-xl bg-rose-100 p-3 text-xs leading-5 text-rose-900">{pathIssues.map((item) => <li key={`${item.code}:${item.message}`}>• {item.message}</li>)}</ul>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
