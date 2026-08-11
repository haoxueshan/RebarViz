"use client";

import { AlertTriangle, Layers3 } from "lucide-react";
import { useState } from "react";
import { FloorRolePanel } from "@/components/calculator/floor/FloorRolePanel";
import { FloorTopThroughPanel } from "@/components/calculator/floor/FloorTopThroughPanel";
import {
  resolveFloorTopDefaults,
  type FloorTopCalculation,
  type FloorTopDefaults,
  type FloorTopState,
} from "@/lib/floor-top-calculator";
import type { FloorPlanState, FloorSlab } from "@/lib/floor-plan";
import {
  floorBarRoleLabel,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import { countModeLabel, directionLabel, type CountMode, type TopExtraMode } from "@/lib/slab-calculator";

function extraModeLabel(mode: TopExtraMode): string {
  if (mode === "start") return "起点增加";
  if (mode === "end") return "终点增加";
  return "两端增加";
}

function TopNumberField({ fieldKey, label, value, suffix, min, onChange, onValidityChange }: {
  fieldKey: string;
  label: string;
  value: number;
  suffix: string;
  min: number;
  onChange: (value: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? String(value);
  const parsed = Number(displayed);
  const invalid = displayed.trim() === "" || !Number.isFinite(parsed) || parsed < min;
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          value={displayed}
          min={min}
          aria-invalid={invalid}
          onFocus={(event) => { setDraft(String(value)); event.currentTarget.select(); }}
          onChange={(event) => {
            const raw = event.target.value;
            const next = Number(raw);
            const valid = raw.trim() !== "" && Number.isFinite(next) && next >= min;
            setDraft(raw);
            onValidityChange(fieldKey, valid);
            if (valid) onChange(next);
          }}
          onBlur={() => { if (!invalid) setDraft(null); }}
          className={`h-11 w-full rounded-xl border bg-white px-3 pr-12 text-sm text-slate-900 outline-none focus:ring-2 ${invalid ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-cyan-600 focus:ring-cyan-100"}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{suffix}</span>
      </span>
    </label>
  );
}

const TOP_NUMBER_FIELDS: ReadonlyArray<{ key: "mainDiameter" | "secondaryDiameter" | "xSpacing" | "ySpacing"; label: string }> = [
  { key: "mainDiameter", label: "主筋直径" },
  { key: "secondaryDiameter", label: "副筋直径" },
  { key: "xSpacing", label: "东西向间距" },
  { key: "ySpacing", label: "南北向间距" },
];

function defaultsFields(prefix: string, defaults: FloorTopDefaults, update: (patch: Partial<FloorTopDefaults>) => void, onValidityChange: (key: string, valid: boolean) => void) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {TOP_NUMBER_FIELDS.map((field) => (
          <TopNumberField key={field.key} fieldKey={`${prefix}:${field.key}`} label={field.label} value={defaults[field.key]} suffix="mm" min={0.01} onChange={(value) => update({ [field.key]: value })} onValidityChange={onValidityChange} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["x", "y"] as const).map((direction) => {
          const key = direction === "x" ? "xExtraMode" : "yExtraMode";
          return (
            <label key={direction} className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">{directionLabel(direction)}增加端</span>
              <select value={defaults[key]} onChange={(event) => update({ [key]: event.target.value as TopExtraMode })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">
                {(["both", "start", "end"] as const).map((mode) => <option key={mode} value={mode}>{extraModeLabel(mode)}</option>)}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function FloorTopSettingsPanel({
  plan,
  top,
  selectedSlab,
  selectedRoleDomain,
  roleState,
  roleReviewRequired,
  calculation,
  onChange,
  onRoleStateChange,
  onConfirmRoleReview,
  onValidityChange,
}: {
  plan: FloorPlanState;
  top: FloorTopState;
  selectedSlab: FloorSlab | null;
  selectedRoleDomain: FloorRebarRoleDomain | null;
  roleState: FloorRebarRoleState;
  roleReviewRequired: boolean;
  calculation: FloorTopCalculation;
  onChange: (state: FloorTopState) => void;
  onRoleStateChange: (state: FloorRebarRoleState) => void;
  onConfirmRoleReview: () => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const updateDefault = (patch: Partial<FloorTopDefaults>) => onChange({ ...top, defaults: { ...top.defaults, ...patch } });
  const setOverrideEnabled = (enabled: boolean) => {
    if (!selectedSlab) return;
    const slabOverrides = { ...top.slabOverrides };
    if (enabled) slabOverrides[selectedSlab.id] = { ...top.defaults };
    else {
      delete slabOverrides[selectedSlab.id];
      for (const field of TOP_NUMBER_FIELDS) onValidityChange(`top:${selectedSlab.id}:${field.key}`, true);
    }
    onChange({ ...top, slabOverrides });
  };
  const updateOverride = (patch: Partial<FloorTopDefaults>) => {
    if (!selectedSlab) return;
    const resolved = resolveFloorTopDefaults(top, selectedSlab.id);
    onChange({ ...top, slabOverrides: { ...top.slabOverrides, [selectedSlab.id]: { ...resolved, ...patch } } });
  };
  const custom = selectedSlab ? Boolean(top.slabOverrides[selectedSlab.id]) : false;

  return (
    <div className="space-y-4">
      <FloorRolePanel
        plan={plan}
        domain={selectedRoleDomain}
        roleState={roleState}
        reviewRequired={roleReviewRequired}
        reviewLabel="面筋"
        onChange={onRoleStateChange}
        onConfirmReview={onConfirmRoleReview}
      />
      <section className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2"><Layers3 size={18} className="text-cyan-700" /><h2 className="font-semibold text-slate-900">整层普通面筋默认规格</h2></div>
        <p className="mt-2 text-xs leading-5 text-slate-500">系统按当前连续楼板区域的净跨自动判断：短跨方向为主筋，长跨方向为副筋。增加端仍按真实东西、南北方向设置。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">根数算法</span>
            <select value={top.countMode} onChange={(event) => onChange({ ...top, countMode: event.target.value as CountMode })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{(["project", "round", "floor"] as const).map((mode) => <option key={mode} value={mode}>{countModeLabel(mode)}</option>)}</select>
          </label>
          <TopNumberField fieldKey="top:anchor-extra" label="面筋内墙端增加值" value={top.topAnchorExtra} suffix="mm" min={0} onChange={(topAnchorExtra) => onChange({ ...top, topAnchorExtra })} onValidityChange={onValidityChange} />
        </div>
        <p className="mt-2 rounded-xl bg-cyan-50 p-3 text-xs leading-5 text-cyan-900">仅作用于实际内墙端；外墙端、洞口裁断端和连续板边不增加。X 向起点为西端、终点为东端；Y 向起点为南端、终点为北端。</p>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">{defaultsFields("top:default", top.defaults, updateDefault, onValidityChange)}</div>
      </section>

      <section className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">板区局部面筋规格</h2>
        {!selectedSlab && <p className="mt-2 text-sm text-slate-500">请在平面图中选择板区。洞口不设置普通面筋规格。</p>}
        {selectedSlab && (
          <div className="mt-3 space-y-4">
            <p className="text-sm font-medium text-cyan-900">当前板区：{selectedSlab.name}</p>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={!custom} onChange={(event) => setOverrideEnabled(!event.target.checked)} className="h-5 w-5 rounded border-slate-300" />使用整层默认</label>
            {custom && defaultsFields(`top:${selectedSlab.id}`, resolveFloorTopDefaults(top, selectedSlab.id), updateOverride, onValidityChange)}
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-slate-500">当前楼层共 {plan.slabs.length} 个板区；同一连续 Domain 内同方向的直径、间距和增加位置必须一致。</p>
      </section>
      <FloorTopThroughPanel
        plan={plan}
        top={top}
        calculation={calculation}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />
    </div>
  );
}

function domainLabel(plan: FloorPlanState, slabIds: readonly string[]): string {
  return slabIds.map((id) => plan.slabs.find((slab) => slab.id === id)?.name ?? id).join(" + ");
}

export function FloorTopResults({ plan, calculation, invalidDraftCount }: { plan: FloorPlanState; calculation: FloorTopCalculation; invalidDraftCount: number }) {
  const valid = calculation.isValid && invalidDraftCount === 0;
  let normalIndex = 0;
  let throughIndex = 0;
  const marks = new Map(calculation.groups.map((group) => {
    const index = group.source === "through" ? ++throughIndex : ++normalIndex;
    return [group.id, `${group.source === "through" ? "T" : "M"}${String(index).padStart(2, "0")}`];
  }));
  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">整层面筋料单</h2><p className="mt-1 text-xs text-slate-500">普通面筋与通墙替换后的最终 FloorBarPiece，按来源、路径、方向、角色、规格和真实下料长度聚合。</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${valid ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{valid ? "正式面筋结果有效" : "面筋结果无效"}</span></div>
      {(calculation.errors.length > 0 || invalidDraftCount > 0) && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><div className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} />请先修正以下问题</div><ul className="mt-2 space-y-1">{invalidDraftCount > 0 && <li>• 有 {invalidDraftCount} 个面筋或几何数字输入为空或非法，未使用旧值计算。</li>}{calculation.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul></div>}
      {calculation.warnings.length > 0 && <ul className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{calculation.warnings.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul>}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">{[["理论面筋线", calculation.isValid ? calculation.totalBarLines : "--", "条"], ["普通面筋件", calculation.isValid ? calculation.normalPieceCount : "--", "件"], ["通墙面筋件", calculation.isValid ? calculation.throughPieceCount : "--", "件"], ["实际下料件", calculation.isValid ? calculation.totalPieces : "--", "件"], ["总长度", calculation.isValid ? calculation.totalLengthM.toFixed(3) : "--", "m"], ["总重量", calculation.isValid && calculation.totalWeightKg !== null ? calculation.totalWeightKg.toFixed(2) : "--", "kg"]].map(([label, value, unit]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-950">{value}<small className="ml-1 text-xs font-normal text-slate-500">{unit}</small></strong></div>)}</div>
      {calculation.isValid && calculation.groups.length === 0 && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">当前没有有效楼板区域，因此没有面筋下料件。</p>}
      {calculation.isValid && calculation.groups.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[880px] border-collapse text-left text-sm"><thead><tr className="border-b border-slate-300 bg-slate-50 text-xs text-slate-600"><th className="p-3">编号</th><th className="p-3">板区/连续区域</th><th className="p-3">来源</th><th className="p-3">类型</th><th className="p-3">规格</th><th className="p-3">增加位置</th><th className="p-3">根数</th><th className="p-3">单根长度</th><th className="p-3">总长度</th><th className="p-3">重量</th></tr></thead><tbody>{calculation.groups.map((group) => { const through = calculation.resolvedThroughPaths.find((path) => path.id === group.throughPathId); return <tr key={group.id} className="border-b border-slate-200 align-top"><td className="p-3 font-semibold text-cyan-700">{marks.get(group.id)}</td><td className="p-3"><span className="font-medium text-slate-900">{domainLabel(plan, group.slabIds)}</span><span className="mt-1 block text-xs text-slate-500">{group.source === "through" ? through?.name ?? "通墙路径" : `连续区域 ${calculation.domains.findIndex((domain) => domain.id === group.domainId) + 1}`}</span></td><td className="p-3">{group.source === "through" ? `通墙面筋 · ${through?.name ?? ""}` : "普通面筋"}</td><td className="p-3">{floorBarRoleLabel(group.role)}（{directionLabel(group.direction)}）</td><td className="p-3">Φ{group.diameter}@{group.spacing}</td><td className="p-3">{extraModeLabel(group.extraMode)}</td><td className="p-3">{group.count}根</td><td className="p-3">{(group.singleLengthMm / 1000).toFixed(3)}m</td><td className="p-3">{group.totalLengthM.toFixed(3)}m</td><td className="p-3 font-semibold">{group.weightKg.toFixed(2)}kg</td></tr>; })}</tbody></table></div>}
    </section>
  );
}
