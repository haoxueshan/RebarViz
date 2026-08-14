"use client";

import { AlertTriangle, Ruler } from "lucide-react";
import type { FloorPlanState } from "@/lib/floor-plan";
import {
  resolveFloorRoleDomainMainDirection,
  type FloorMainDirection,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import { directionLabel } from "@/lib/slab-calculator";

function domainLabel(plan: FloorPlanState, domain: FloorRebarRoleDomain): string {
  return domain.slabIds
    .map((id) => plan.slabs.find((slab) => slab.id === id)?.name ?? id)
    .join(" + ");
}

export function FloorRolePanel({
  plan,
  domain,
  roleState,
  reviewRequired,
  reviewLabel,
  onChange,
  onConfirmReview,
}: {
  plan: FloorPlanState;
  domain: FloorRebarRoleDomain | null;
  roleState: FloorRebarRoleState;
  reviewRequired: boolean;
  reviewLabel: "地筋" | "面筋";
  onChange: (state: FloorRebarRoleState) => void;
  onConfirmReview: () => void;
}) {
  const resolved = domain
    ? resolveFloorRoleDomainMainDirection(domain, roleState)
    : null;
  const choose = (direction: FloorMainDirection) => {
    if (!domain) return;
    onChange({
      mainDirectionOverrides: {
        ...roleState.mainDirectionOverrides,
        [domain.id]: direction,
      },
    });
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Ruler size={18} className="text-indigo-700" />
        <h2 className="font-semibold text-slate-900">当前主副筋区域</h2>
      </div>
      {reviewRequired && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 shrink-0" size={17} />
            <span>旧版本的东西/南北向直径已迁移为主/副筋语义，请复核当前{reviewLabel}主筋、副筋直径。</span>
          </div>
          <button
            type="button"
            onClick={onConfirmReview}
            className="mt-3 min-h-11 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800"
          >
            确认{reviewLabel}主副筋规格
          </button>
        </div>
      )}
      {!domain && (
        <p className="mt-3 text-sm text-slate-500">请在平面图中选择一个板区，以查看其所属主副筋参考区域。</p>
      )}
      {domain && resolved && (
        <div className="mt-3 space-y-3">
          {resolved.source === "auto" ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              自动判断：{directionLabel(resolved.mainDirection!)}为主筋，
              {directionLabel(resolved.mainDirection === "x" ? "y" : "x")}为副筋。
            </p>
          ) : (
            <fieldset className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <legend className="px-1 text-sm font-semibold text-amber-950">主筋方向</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(["x", "y"] as const).map((direction) => {
                  const selected = resolved.mainDirection === direction;
                  return (
                    <button
                      key={direction}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => choose(direction)}
                      className={`flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition ${selected ? "border-amber-600 bg-amber-600 text-white shadow-sm" : "border-amber-300 bg-white text-slate-800"}`}
                    >
                      {directionLabel(direction)}主筋
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-900">
                {domain.shape === "square"
                  ? "当前连续板区域两个方向净跨相同，请人工指定主筋方向。该选择同时用于地筋和面筋。"
                  : "当前连续板区域为 L/T 或其他非矩形形状，无法可靠通过外包尺寸判断主副筋，请人工指定。"}
              </p>
            </fieldset>
          )}
          <div className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-950">
            <strong className="block">{domainLabel(plan, domain)}</strong>
            <span className="mt-1 block text-xs text-indigo-800">
              东西净跨 {domain.maxX - domain.minX}mm · 南北净跨 {domain.maxY - domain.minY}mm
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
