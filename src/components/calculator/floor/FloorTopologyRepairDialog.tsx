"use client";

import { Ban, BrickWall, Layers3, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { FloorSlab } from "@/lib/floor-plan";
import type {
  FloorTopologyRepairCandidate,
  FloorTopologyRepairDecision,
  FloorTopologyRepairSupport,
} from "@/lib/floor-topology-repair";

type RepairChoice = FloorTopologyRepairSupport | "ignore";

const SIDE_LABELS = { west: "西侧", east: "东侧", south: "南侧", north: "北侧" } as const;

export function FloorTopologyRepairDialog({
  candidates,
  slabs,
  innerWallThickness,
  errorMessage,
  onCancel,
  onApply,
}: {
  candidates: readonly FloorTopologyRepairCandidate[];
  slabs: readonly FloorSlab[];
  innerWallThickness: number;
  errorMessage: string | null;
  onCancel: () => void;
  onApply: (decisions: FloorTopologyRepairDecision[]) => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, RepairChoice | undefined>>({});
  const names = useMemo(() => new Map(slabs.map((slab) => [slab.id, slab.name])), [slabs]);
  const allConfirmed = candidates.length > 0 && candidates.every((candidate) => decisions[candidate.id] !== undefined);

  const choose = (candidateId: string, action: RepairChoice) => {
    setDecisions((current) => ({ ...current, [candidateId]: action }));
  };
  const chooseAll = (action: RepairChoice) => {
    setDecisions(Object.fromEntries(candidates.flatMap((candidate) => {
      if (action !== "ignore" && !candidate.allowedSupports.includes(action)) return [];
      return [[candidate.id, action]];
    })));
  };
  const apply = () => {
    if (!allConfirmed) return;
    onApply(candidates.map((candidate) => ({ candidateId: candidate.id, action: decisions[candidate.id]! })));
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
      data-testid="floor-topology-repair-dialog"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <section className="flex max-h-[min(92dvh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="floor-repair-title">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="floor-repair-title" className="text-base font-semibold text-slate-950">检测到可能缺失的板区连接</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">这些板区当前在几何上相邻，但没有正式连接关系。请确认它们之间是内墙、连续楼板，还是保持不连接。</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭拓扑修复" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={20} /></button>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <button type="button" onClick={() => chooseAll("inner-wall")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50"><BrickWall size={17} />全部设为内墙 {innerWallThickness}</button>
          <button type="button" onClick={() => chooseAll("ignore")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Ban size={17} />全部忽略</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
          <ol className="divide-y divide-slate-200">
            {candidates.map((candidate, index) => {
              const choice = decisions[candidate.id];
              return (
                <li key={candidate.id} className="py-4" data-testid="floor-topology-repair-candidate">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="text-sm text-slate-950">{index + 1}. {names.get(candidate.a.slabId) ?? candidate.a.slabId} {SIDE_LABELS[candidate.a.side]} ↔ {names.get(candidate.b.slabId) ?? candidate.b.slabId} {SIDE_LABELS[candidate.b.side]}</strong>
                    <span className="text-xs tabular-nums text-slate-500">净空间距 {Number(candidate.currentGapMm.toFixed(3))} mm · 共享长度 {Number(candidate.overlapLengthMm.toFixed(3))} mm</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={`第${index + 1}项连接处理方式`}>
                    <button
                      type="button"
                      disabled={!candidate.allowedSupports.includes("inner-wall")}
                      aria-pressed={choice === "inner-wall"}
                      onClick={() => choose(candidate.id, "inner-wall")}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${choice === "inner-wall" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                    ><BrickWall size={17} />内墙 {innerWallThickness}</button>
                    <button
                      type="button"
                      disabled={!candidate.allowedSupports.includes("continuous")}
                      aria-pressed={choice === "continuous"}
                      onClick={() => choose(candidate.id, "continuous")}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${choice === "continuous" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                    ><Layers3 size={17} />连续楼板</button>
                    <button
                      type="button"
                      aria-pressed={choice === "ignore"}
                      onClick={() => choose(candidate.id, "ignore")}
                      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold ${choice === "ignore" ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                    ><Ban size={17} />忽略</button>
                  </div>
                  {!choice && <p className="mt-2 text-xs font-medium text-amber-700">待确认</p>}
                </li>
              );
            })}
          </ol>
        </div>

        {errorMessage && <p role="alert" className="mx-4 mb-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:mx-5">{errorMessage}</p>}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button>
          <button type="button" onClick={apply} disabled={!allConfirmed} className="min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">应用修复</button>
        </footer>
      </section>
    </div>
  );
}
