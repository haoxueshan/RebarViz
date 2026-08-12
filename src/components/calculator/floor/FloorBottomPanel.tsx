"use client";

import { AlertTriangle, Layers3 } from "lucide-react";
import { useState } from "react";
import { FloorRolePanel } from "@/components/calculator/floor/FloorRolePanel";
import {
  resolveFloorBottomDefaults,
  type FloorBottomCalculation,
  type FloorBottomDefaults,
  type FloorBottomState,
} from "@/lib/floor-bottom-calculator";
import type { FloorPlanState, FloorSlab } from "@/lib/floor-plan";
import {
  floorBarRoleLabel,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import { countModeLabel, directionLabel, type CountMode } from "@/lib/slab-calculator";

function BottomNumberField({
  fieldKey,
  label,
  value,
  suffix,
  onChange,
  onValidityChange,
}: {
  fieldKey: string;
  label: string;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? String(value);
  const parsed = Number(displayed);
  const invalid = displayed.trim() === "" || !Number.isFinite(parsed) || parsed <= 0;
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          value={displayed}
          min="0.01"
          aria-invalid={invalid}
          onFocus={(event) => {
            setDraft(String(value));
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const raw = event.target.value;
            const next = Number(raw);
            const valid = raw.trim() !== "" && Number.isFinite(next) && next > 0;
            setDraft(raw);
            onValidityChange(fieldKey, valid);
            if (valid) onChange(next);
          }}
          onBlur={() => {
            if (!invalid) setDraft(null);
          }}
          className={`h-11 w-full rounded-xl border bg-white px-3 pr-12 text-sm text-slate-900 outline-none focus:ring-2 ${invalid ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{suffix}</span>
      </span>
    </label>
  );
}

const BOTTOM_FIELDS: ReadonlyArray<{
  key: keyof FloorBottomDefaults;
  label: string;
}> = [
  { key: "mainDiameter", label: "主筋直径" },
  { key: "secondaryDiameter", label: "副筋直径" },
  { key: "xSpacing", label: "东西向间距" },
  { key: "ySpacing", label: "南北向间距" },
];

function defaultsFields(
  prefix: string,
  defaults: FloorBottomDefaults,
  update: (patch: Partial<FloorBottomDefaults>) => void,
  onValidityChange: (key: string, valid: boolean) => void,
) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {BOTTOM_FIELDS.map((field) => (
        <BottomNumberField
          key={field.key}
          fieldKey={`${prefix}:${field.key}`}
          label={field.label}
          value={defaults[field.key]}
          suffix="mm"
          onChange={(value) => update({ [field.key]: value })}
          onValidityChange={onValidityChange}
        />
      ))}
    </div>
  );
}

export function FloorBottomSettingsPanel({
  plan,
  bottom,
  selectedSlab,
  selectedRoleDomain,
  roleState,
  roleReviewRequired,
  onChange,
  onRoleStateChange,
  onConfirmRoleReview,
  onValidityChange,
  section = "all",
}: {
  plan: FloorPlanState;
  bottom: FloorBottomState;
  selectedSlab: FloorSlab | null;
  selectedRoleDomain: FloorRebarRoleDomain | null;
  roleState: FloorRebarRoleState;
  roleReviewRequired: boolean;
  onChange: (state: FloorBottomState) => void;
  onRoleStateChange: (state: FloorRebarRoleState) => void;
  onConfirmRoleReview: () => void;
  onValidityChange: (key: string, valid: boolean) => void;
  section?: "all" | "role" | "defaults" | "slab";
}) {
  const updateDefault = (patch: Partial<FloorBottomDefaults>) => {
    onChange({ ...bottom, defaults: { ...bottom.defaults, ...patch } });
  };
  const setOverrideEnabled = (enabled: boolean) => {
    if (!selectedSlab) return;
    const slabOverrides = { ...bottom.slabOverrides };
    if (enabled) slabOverrides[selectedSlab.id] = { ...bottom.defaults };
    else {
      delete slabOverrides[selectedSlab.id];
      for (const field of BOTTOM_FIELDS) {
        onValidityChange(`bottom:${selectedSlab.id}:${field.key}`, true);
      }
    }
    onChange({ ...bottom, slabOverrides });
  };
  const updateOverride = (patch: Partial<FloorBottomDefaults>) => {
    if (!selectedSlab) return;
    const resolved = resolveFloorBottomDefaults(bottom, selectedSlab.id);
    onChange({
      ...bottom,
      slabOverrides: {
        ...bottom.slabOverrides,
        [selectedSlab.id]: { ...resolved, ...patch },
      },
    });
  };

  const custom = selectedSlab
    ? Boolean(bottom.slabOverrides[selectedSlab.id])
    : false;

  return (
    <div className="space-y-4">
      {(section === "all" || section === "role") && <FloorRolePanel
        plan={plan}
        domain={selectedRoleDomain}
        roleState={roleState}
        reviewRequired={roleReviewRequired}
        reviewLabel="地筋"
        onChange={onRoleStateChange}
        onConfirmReview={onConfirmRoleReview}
      />}
      {(section === "all" || section === "defaults") && <section className={section === "all" ? "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" : "space-y-4"}>
        <div className="flex items-center gap-2"><Layers3 size={18} className="text-blue-600" /><h2 className="font-semibold text-slate-900">整层地筋默认规格</h2></div>
        <p className="mt-2 text-xs leading-5 text-slate-500">系统按当前连续楼板区域的净跨自动判断：短跨方向为主筋，长跨方向为副筋。间距仍按东西、南北方向设置。</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">根数算法</span>
          <select value={bottom.countMode} onChange={(event) => onChange({ ...bottom, countMode: event.target.value as CountMode })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">
            {(["project", "round", "floor"] as const).map((mode) => <option key={mode} value={mode}>{countModeLabel(mode)}</option>)}
          </select>
        </label>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {defaultsFields("bottom:default", bottom.defaults, updateDefault, onValidityChange)}
        </div>
      </section>}

      {(section === "all" || section === "slab") && <section className={section === "all" ? "rounded-2xl border border-blue-200 bg-white p-5 shadow-sm" : "space-y-4"}>
        <h2 className="font-semibold text-slate-900">板区局部规格</h2>
        {!selectedSlab && <p className="mt-2 text-sm text-slate-500">请在平面图中选择板区。洞口不设置普通地筋规格。</p>}
        {selectedSlab && (
          <div className="mt-3 space-y-4">
            <p className="text-sm font-medium text-blue-800">当前板区：{selectedSlab.name}</p>
            <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="地筋规格来源">
              <button type="button" aria-pressed={!custom} onClick={() => setOverrideEnabled(false)} className={`min-h-11 rounded-lg px-2 text-xs font-semibold ${!custom ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}>整层默认</button>
              <button type="button" aria-pressed={custom} onClick={() => setOverrideEnabled(true)} className={`min-h-11 rounded-lg px-2 text-xs font-semibold ${custom ? "bg-blue-600 text-white" : "text-slate-600"}`}>局部规格</button>
            </div>
            {custom && defaultsFields(`bottom:${selectedSlab.id}`, resolveFloorBottomDefaults(bottom, selectedSlab.id), updateOverride, onValidityChange)}
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-slate-500">当前楼层共 {plan.slabs.length} 个板区；同一连续 Domain 内同方向的最终规格必须一致。</p>
      </section>}
    </div>
  );
}

function domainLabel(plan: FloorPlanState, slabIds: readonly string[]): string {
  return slabIds.map((id) => plan.slabs.find((slab) => slab.id === id)?.name ?? id).join(" + ");
}

export function FloorBottomResults({
  plan,
  calculation,
  invalidDraftCount,
}: {
  plan: FloorPlanState;
  calculation: FloorBottomCalculation;
  invalidDraftCount: number;
}) {
  const valid = calculation.isValid && invalidDraftCount === 0;
  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-bold text-slate-950">整层地筋料单</h2><p className="mt-1 text-xs text-slate-500">按连续 Domain、方向、角色、规格和真实单根长度聚合。</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${valid ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{valid ? "正式地筋结果有效" : "地筋结果无效"}</span>
      </div>
      {(calculation.errors.length > 0 || invalidDraftCount > 0) && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} />请先修正以下问题</div>
          <ul className="mt-2 space-y-1">{invalidDraftCount > 0 && <li>• 有 {invalidDraftCount} 个地筋数字输入为空或非法，未使用旧值计算。</li>}{calculation.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul>
        </div>
      )}
      {calculation.warnings.length > 0 && <ul className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{calculation.warnings.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul>}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["理论布筋线", calculation.isValid ? calculation.totalBarLines : "--", "条"], ["实际下料件", calculation.isValid ? calculation.totalPieces : "--", "件"], ["总长度", calculation.isValid ? calculation.totalLengthM.toFixed(3) : "--", "m"], ["总重量", calculation.isValid && calculation.totalWeightKg !== null ? calculation.totalWeightKg.toFixed(2) : "--", "kg"]].map(([label, value, unit]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-950">{value}<small className="ml-1 text-xs font-normal text-slate-500">{unit}</small></strong></div>)}
      </div>
      {calculation.isValid && calculation.groups.length === 0 && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">当前没有有效楼板区域，因此没有地筋下料件。</p>}
      {calculation.isValid && calculation.groups.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-slate-300 bg-slate-50 text-xs text-slate-600"><th className="p-3">编号</th><th className="p-3">板区/连续区域</th><th className="p-3">类型</th><th className="p-3">规格</th><th className="p-3">根数</th><th className="p-3">单根长度</th><th className="p-3">总长度</th><th className="p-3">重量</th></tr></thead>
            <tbody>{calculation.groups.map((group, index) => (
              <tr key={group.id} className="border-b border-slate-200 align-top">
                <td className="p-3 font-semibold text-blue-700">D{String(index + 1).padStart(2, "0")}</td>
                <td className="p-3"><span className="font-medium text-slate-900">{domainLabel(plan, group.slabIds)}</span><span className="mt-1 block text-xs text-slate-500">连续区域 {calculation.domains.findIndex((domain) => domain.id === group.domainId) + 1}</span></td>
                <td className="p-3">{floorBarRoleLabel(group.role)}（{directionLabel(group.direction)}）</td><td className="p-3">Φ{group.diameter}@{group.spacing}</td><td className="p-3">{group.count}根</td><td className="p-3">{(group.singleLengthMm / 1000).toFixed(3)}m</td><td className="p-3">{group.totalLengthM.toFixed(3)}m</td><td className="p-3 font-semibold">{group.weightKg.toFixed(2)}kg</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
