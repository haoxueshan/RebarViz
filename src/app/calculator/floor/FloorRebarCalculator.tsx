"use client";

import { Copy, DoorOpen, Grid2X2, House, Info, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CalculatorModeNav } from "@/components/calculator/CalculatorModeNav";
import { FloorBottomResults, FloorBottomSettingsPanel } from "@/components/calculator/floor/FloorBottomPanel";
import { FloorBomPanel } from "@/components/calculator/floor/FloorBomPanel";
import { FloorCanvas, type FloorSelection } from "@/components/calculator/floor/FloorCanvas";
import { FloorTopResults, FloorTopSettingsPanel } from "@/components/calculator/floor/FloorTopPanel";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
  type FloorBottomCalculation,
  type FloorBottomState,
} from "@/lib/floor-bottom-calculator";
import {
  createFloorBottomStoredRecord,
  FLOOR_BOTTOM_STORAGE_KEY,
  parseFloorBottomStoredRecord,
} from "@/lib/floor-bottom-storage";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopCalculation,
  type FloorTopState,
} from "@/lib/floor-top-calculator";
import {
  createFloorTopStoredRecord,
  FLOOR_TOP_STORAGE_KEY,
  parseFloorTopStoredRecord,
} from "@/lib/floor-top-storage";
import {
  buildFloorAtomicBoundarySegments,
  buildFloorDisplayBoundarySegments,
  DEFAULT_FLOOR_PLAN_STATE,
  floorPlanBounds,
  nextAvailableFloorName,
  replaceFloorSupportRuleForAtomicSegment,
  snapFloorOpening,
  snapFloorSlab,
  validateFloorPlanV2,
  type FloorAtomicBoundarySegment,
  type FloorBoundarySegment,
  type FloorEdgeRange,
  type FloorOpening,
  type FloorOpeningType,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSlab,
  type FloorSlabType,
  type FloorSupportRule,
  type FloorSupportRuleTarget,
} from "@/lib/floor-plan";
import { createFloorDraftRecord, FLOOR_DRAFT_KEY, parseFloorDraftRecord } from "@/lib/floor-plan-storage";
import {
  buildFloorRebarRoleDomains,
  DEFAULT_FLOOR_REBAR_ROLE_STATE,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import {
  createFloorRebarRoleStoredRecord,
  FLOOR_REBAR_ROLE_STORAGE_KEY,
  parseFloorRebarRoleStoredRecord,
} from "@/lib/floor-rebar-role-storage";

const SLAB_TYPE_OPTIONS: Array<{ value: FloorSlabType; label: string }> = [
  { value: "room", label: "房间" }, { value: "corridor", label: "内走廊" }, { value: "hall", label: "客厅" },
  { value: "balcony", label: "阳台" }, { value: "other", label: "其他板区" },
];
const OPENING_TYPE_OPTIONS: Array<{ value: FloorOpeningType; label: string }> = [
  { value: "stair", label: "楼梯间" }, { value: "shaft", label: "井道" }, { value: "void", label: "挑空" }, { value: "other", label: "其他洞口" },
];

function cloneDefaultState(): FloorPlanState {
  return structuredClone(DEFAULT_FLOOR_PLAN_STATE);
}

function cloneDefaultBottomState(): FloorBottomState {
  return structuredClone(DEFAULT_FLOOR_BOTTOM_STATE);
}

function cloneDefaultTopState(): FloorTopState {
  return structuredClone(DEFAULT_FLOOR_TOP_STATE);
}

function cloneDefaultRoleState(): FloorRebarRoleState {
  return structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE);
}

function blockBottomForDrafts(
  calculation: FloorBottomCalculation,
  invalidCount: number,
): FloorBottomCalculation {
  if (invalidCount === 0) return calculation;
  return {
    ...calculation,
    lines: [],
    pieces: [],
    groups: [],
    totalBarLines: 0,
    totalPieces: 0,
    totalLengthM: 0,
    totalWeightKg: null,
    errors: [
      ...calculation.errors,
      { code: "bottom-draft-invalid", message: `有 ${invalidCount} 个地筋数字输入为空或非法。` },
    ],
    isValid: false,
  };
}

function blockTopForDrafts(
  calculation: FloorTopCalculation,
  invalidCount: number,
): FloorTopCalculation {
  if (invalidCount === 0) return calculation;
  return {
    ...calculation,
    lines: [],
    pieces: [],
    groups: [],
    totalBarLines: 0,
    totalPieces: 0,
    totalLengthM: 0,
    totalWeightKg: null,
    errors: [
      ...calculation.errors,
      { code: "top-draft-invalid", message: `有 ${invalidCount} 个面筋或几何数字输入为空或非法。` },
    ],
    isValid: false,
  };
}

function nextObjectId(kind: "slab" | "opening"): string {
  return `floor-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function rangeKey(range: FloorEdgeRange): string {
  return range.mode === "whole" ? "whole" : `${range.startMm}-${range.endMm}`;
}

function targetKey(target: FloorSupportRuleTarget): string {
  return target.kind === "slab-edge"
    ? `slab:${target.slabId}:${target.side}:${rangeKey(target.range)}`
    : `opening:${target.openingId}:${target.side}:${rangeKey(target.range)}`;
}

function sideLabel(side: FloorSupportRuleTarget["side"]): string {
  return side === "west" ? "西侧" : side === "east" ? "东侧" : side === "south" ? "南侧" : "北侧";
}

function supportLabel(support: FloorResolvedSupport): string {
  if (support === "outer-wall") return "建筑外墙";
  if (support === "inner-wall") return "内墙";
  if (support === "continuous") return "连续楼板";
  return "洞口裁断";
}

function geometryLabel(segment: FloorAtomicBoundarySegment): string {
  if (segment.geometryKind === "building-exterior") return "建筑外边";
  if (segment.geometryKind === "shared-slab") return "共享板边";
  return "洞口边";
}

function segmentLength(segment: FloorAtomicBoundarySegment): number {
  return Math.abs(segment.endX - segment.startX) + Math.abs(segment.endY - segment.startY);
}

function targetForSelection(segment: FloorAtomicBoundarySegment, selection: Exclude<FloorSelection, null>): FloorSupportRuleTarget | undefined {
  return segment.targets.find((target) => selection.kind === "slab"
    ? target.kind === "slab-edge" && target.slabId === selection.id
    : target.kind === "opening-edge" && target.openingId === selection.id);
}

function DraftNumberField({
  fieldKey,
  label,
  value,
  onChange,
  onValidityChange,
  min,
}: {
  fieldKey: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
  min?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? String(value);
  const invalid = draft !== null && (draft.trim() === "" || !Number.isFinite(Number(draft)) || (min !== undefined && Number(draft) < min));
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
            setDraft(raw);
            const parsed = Number(raw);
            const valid = raw.trim() !== "" && Number.isFinite(parsed) && (min === undefined || parsed >= min);
            onValidityChange(fieldKey, valid);
            if (valid) onChange(parsed);
          }}
          className={`h-11 w-full rounded-xl border bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 ${invalid ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">mm</span>
      </span>
      {invalid && <span className="mt-1 block text-xs text-rose-600">请输入{min === 1 ? "大于0的" : "有效"}数字。</span>}
    </label>
  );
}

type FloorWorkflowStage = "plan" | "bottom" | "top" | "bom";

function WorkflowTabs({ stage, onChange }: { stage: FloorWorkflowStage; onChange: (stage: FloorWorkflowStage) => void }) {
  const tabs: Array<{ stage: FloorWorkflowStage; label: string }> = [
    { stage: "plan", label: "楼层" },
    { stage: "bottom", label: "地筋" },
    { stage: "top", label: "面筋" },
    { stage: "bom", label: "料单" },
  ];
  return (
    <div className="mb-5 grid grid-cols-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="整层计算步骤">
      {tabs.map((tab, index) => (
        <button key={tab.stage} type="button" onClick={() => onChange(tab.stage)} className={`min-h-12 min-w-0 px-1 py-3 text-center text-xs font-semibold sm:text-sm ${stage === tab.stage ? "bg-blue-600 text-white" : "border-l border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} aria-current={stage === tab.stage ? "step" : undefined}>
          <span className="hidden sm:inline">{index + 1}. </span>{tab.label}
        </button>
      ))}
    </div>
  );
}

function BoundaryPanel({
  state,
  selection,
  segments,
  selectedBoundaryId,
  onSelectBoundary,
  onSetSupport,
}: {
  state: FloorPlanState;
  selection: FloorSelection;
  segments: FloorAtomicBoundarySegment[];
  selectedBoundaryId: string | null;
  onSelectBoundary: (id: string) => void;
  onSetSupport: (segment: FloorAtomicBoundarySegment, target: FloorSupportRuleTarget, support: FloorSupportRule["support"]) => void;
}) {
  if (!selection) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">{selection.kind === "slab" ? "板区边界关系" : "洞口边界处理"}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">几何关系与实际支承分开保存；此处不设置钢筋锚固长度。</p>
      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
        {segments.length === 0 && <p className="text-sm text-slate-500">当前对象没有可编辑边界。</p>}
        {segments.map((segment) => {
          const target = targetForSelection(segment, selection);
          const relatedNames = segment.slabIds.filter((id) => id !== selection.id).map((id) => state.slabs.find((slab) => slab.id === id)?.name).filter(Boolean);
          const selected = selectedBoundaryId === segment.id;
          return (
            <div key={segment.id} className={`rounded-xl border p-3 ${selected ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-slate-50"}`}>
              <button type="button" onClick={() => onSelectBoundary(segment.id)} className="flex min-h-11 w-full items-start justify-between gap-2 text-left">
                <span><strong className="block text-sm text-slate-900">{target ? sideLabel(target.side) : geometryLabel(segment)} · {formatMm(segmentLength(segment))}mm</strong><span className="mt-1 block text-xs text-slate-500">几何：{geometryLabel(segment)}{relatedNames.length > 0 ? ` · 与${relatedNames.join("、")}` : ""}</span></span>
                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-700">{supportLabel(segment.support)}</span>
              </button>
              {target && segment.geometryKind === "shared-slab" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onSetSupport(segment, target, "inner-wall")} aria-pressed={segment.support === "inner-wall"} className={`min-h-11 rounded-lg border text-xs font-medium ${segment.support === "inner-wall" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>内墙</button>
                  <button type="button" onClick={() => onSetSupport(segment, target, "continuous")} aria-pressed={segment.support === "continuous"} className={`min-h-11 rounded-lg border text-xs font-medium ${segment.support === "continuous" ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>连续楼板</button>
                </div>
              )}
              {target && segment.geometryKind === "opening-edge" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onSetSupport(segment, target, "opening-cut")} aria-pressed={segment.support === "opening-cut"} className={`min-h-11 rounded-lg border text-xs font-medium ${segment.support === "opening-cut" ? "border-slate-700 bg-slate-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}>洞口裁断</button>
                  <button type="button" onClick={() => onSetSupport(segment, target, "inner-wall")} aria-pressed={segment.support === "inner-wall"} className={`min-h-11 rounded-lg border text-xs font-medium ${segment.support === "inner-wall" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>按内墙</button>
                </div>
              )}
              {!target && segment.geometryKind === "opening-edge" && <p className="mt-2 text-xs text-slate-500">请选中对应洞口后设置该边。</p>}
              {segment.geometryKind === "building-exterior" && <p className="mt-2 text-xs text-slate-500">建筑真正外边固定按外墙处理。</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function FloorRebarCalculator() {
  const [state, setState] = useState<FloorPlanState>(cloneDefaultState);
  const [bottomState, setBottomState] = useState<FloorBottomState>(cloneDefaultBottomState);
  const [topState, setTopState] = useState<FloorTopState>(cloneDefaultTopState);
  const [roleState, setRoleState] = useState<FloorRebarRoleState>(cloneDefaultRoleState);
  const [bottomRoleReviewRequired, setBottomRoleReviewRequired] = useState(false);
  const [topRoleReviewRequired, setTopRoleReviewRequired] = useState(false);
  const [stage, setStage] = useState<FloorWorkflowStage>("plan");
  const [selection, setSelection] = useState<FloorSelection>({ kind: "slab", id: DEFAULT_FLOOR_PLAN_STATE.slabs[0].id });
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null);
  const [invalidDrafts, setInvalidDrafts] = useState<Set<string>>(new Set());
  const [invalidBottomDrafts, setInvalidBottomDrafts] = useState<Set<string>>(new Set());
  const [invalidTopDrafts, setInvalidTopDrafts] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);

  useEffect(() => {
    try {
      const restoreRoleState = (plan: FloorPlanState) => {
        const roleSaved = window.localStorage.getItem(FLOOR_REBAR_ROLE_STORAGE_KEY);
        if (!roleSaved) return;
        const validKeys = new Set(buildFloorRebarRoleDomains(plan).map((domain) => domain.id));
        const roleRecord = parseFloorRebarRoleStoredRecord(JSON.parse(roleSaved), validKeys);
        if (roleRecord) setRoleState(roleRecord.state);
      };
      const saved = window.localStorage.getItem(FLOOR_DRAFT_KEY);
      if (saved) {
        const record = parseFloorDraftRecord(JSON.parse(saved));
        if (record) {
          setState(record.state);
          const bottomSaved = window.localStorage.getItem(FLOOR_BOTTOM_STORAGE_KEY);
          if (bottomSaved) {
            const bottomRecord = parseFloorBottomStoredRecord(
              JSON.parse(bottomSaved),
              new Set(record.state.slabs.map((slab) => slab.id)),
            );
            if (bottomRecord) {
              setBottomState(bottomRecord.state);
              setBottomRoleReviewRequired(bottomRecord.roleReviewRequired);
            }
          }
          const topSaved = window.localStorage.getItem(FLOOR_TOP_STORAGE_KEY);
          if (topSaved) {
            const topRecord = parseFloorTopStoredRecord(
              JSON.parse(topSaved),
              new Set(record.state.slabs.map((slab) => slab.id)),
            );
            if (topRecord) {
              setTopState(topRecord.state);
              setTopRoleReviewRequired(topRecord.roleReviewRequired);
            }
          }
          restoreRoleState(record.state);
          setSelection(record.state.slabs[0] ? { kind: "slab", id: record.state.slabs[0].id } : record.state.openings[0] ? { kind: "opening", id: record.state.openings[0].id } : null);
        }
      } else {
        const bottomSaved = window.localStorage.getItem(FLOOR_BOTTOM_STORAGE_KEY);
        if (bottomSaved) {
          const bottomRecord = parseFloorBottomStoredRecord(
            JSON.parse(bottomSaved),
            new Set(DEFAULT_FLOOR_PLAN_STATE.slabs.map((slab) => slab.id)),
          );
          if (bottomRecord) {
            setBottomState(bottomRecord.state);
            setBottomRoleReviewRequired(bottomRecord.roleReviewRequired);
          }
        }
        const topSaved = window.localStorage.getItem(FLOOR_TOP_STORAGE_KEY);
        if (topSaved) {
          const topRecord = parseFloorTopStoredRecord(
            JSON.parse(topSaved),
            new Set(DEFAULT_FLOOR_PLAN_STATE.slabs.map((slab) => slab.id)),
          );
          if (topRecord) {
            setTopState(topRecord.state);
            setTopRoleReviewRequired(topRecord.roleReviewRequired);
          }
        }
        restoreRoleState(DEFAULT_FLOOR_PLAN_STATE);
      }
    } catch {
      // 损坏草稿使用默认布局，不阻塞Geometry V2页面。
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(FLOOR_DRAFT_KEY, JSON.stringify(createFloorDraftRecord(state)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydrated, state]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const slabIds = new Set(state.slabs.map((slab) => slab.id));
      const cleaned = {
        ...bottomState,
        slabOverrides: Object.fromEntries(
          Object.entries(bottomState.slabOverrides).filter(([slabId]) => slabIds.has(slabId)),
        ),
      };
      window.localStorage.setItem(
        FLOOR_BOTTOM_STORAGE_KEY,
        JSON.stringify(createFloorBottomStoredRecord(cleaned, new Date().toISOString(), bottomRoleReviewRequired)),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [bottomRoleReviewRequired, bottomState, hydrated, state.slabs]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const slabIds = new Set(state.slabs.map((slab) => slab.id));
      const cleaned = {
        ...topState,
        slabOverrides: Object.fromEntries(
          Object.entries(topState.slabOverrides).filter(([slabId]) => slabIds.has(slabId)),
        ),
        throughPaths: topState.throughPaths.filter((path) =>
          path.slabIds.every((slabId) => slabIds.has(slabId))),
      };
      window.localStorage.setItem(
        FLOOR_TOP_STORAGE_KEY,
        JSON.stringify(createFloorTopStoredRecord(cleaned, new Date().toISOString(), topRoleReviewRequired)),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydrated, state.slabs, topRoleReviewRequired, topState]);

  const roleDomains = useMemo(() => buildFloorRebarRoleDomains(state), [state]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const validKeys = new Set(roleDomains.map((domain) => domain.id));
      const cleaned: FloorRebarRoleState = {
        mainDirectionOverrides: Object.fromEntries(
          Object.entries(roleState.mainDirectionOverrides).filter(([key]) => validKeys.has(key)),
        ),
      };
      window.localStorage.setItem(
        FLOOR_REBAR_ROLE_STORAGE_KEY,
        JSON.stringify(createFloorRebarRoleStoredRecord(cleaned)),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydrated, roleDomains, roleState]);

  const atomic = useMemo(() => buildFloorAtomicBoundarySegments(state), [state]);
  const displays = useMemo(() => buildFloorDisplayBoundarySegments(state), [state]);
  const issues = useMemo(() => validateFloorPlanV2(state), [state]);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const rawBottomCalculation = useMemo(
    () => calculateFloorBottomRebar(state, bottomState, roleState, bottomRoleReviewRequired),
    [bottomRoleReviewRequired, bottomState, roleState, state],
  );
  const bottomCalculation = useMemo(
    () => blockBottomForDrafts(rawBottomCalculation, invalidDrafts.size + invalidBottomDrafts.size),
    [invalidBottomDrafts.size, invalidDrafts.size, rawBottomCalculation],
  );
  const rawTopCalculation = useMemo(
    () => calculateFloorTopRebar(state, topState, roleState, topRoleReviewRequired),
    [roleState, state, topRoleReviewRequired, topState],
  );
  const topCalculation = useMemo(
    () => blockTopForDrafts(rawTopCalculation, invalidDrafts.size + invalidTopDrafts.size),
    [invalidDrafts.size, invalidTopDrafts.size, rawTopCalculation],
  );
  const selectedSlab = selection?.kind === "slab" ? state.slabs.find((slab) => slab.id === selection.id) ?? null : null;
  const selectedRoleDomain = selectedSlab
    ? roleDomains.find((domain) => domain.slabIds.includes(selectedSlab.id)) ?? null
    : null;
  const selectedOpening = selection?.kind === "opening" ? state.openings.find((opening) => opening.id === selection.id) ?? null : null;
  const selectedSegments = selection ? atomic.filter((segment) => selection.kind === "slab" ? segment.slabIds.includes(selection.id) : segment.openingId === selection.id) : [];

  const setDraftValidity = (key: string, valid: boolean) => {
    setInvalidDrafts((current) => { const next = new Set(current); if (valid) next.delete(key); else next.add(key); return next; });
  };
  const setBottomDraftValidity = (key: string, valid: boolean) => {
    setInvalidBottomDrafts((current) => { const next = new Set(current); if (valid) next.delete(key); else next.add(key); return next; });
  };
  const setTopDraftValidity = (key: string, valid: boolean) => {
    setInvalidTopDrafts((current) => { const next = new Set(current); if (valid) next.delete(key); else next.add(key); return next; });
  };

  const updateSlab = (patch: Partial<FloorSlab>) => {
    if (!selectedSlab) return;
    setState((current) => ({ ...current, slabs: current.slabs.map((slab) => slab.id === selectedSlab.id ? { ...slab, ...patch } : slab) }));
  };

  const updateOpening = (patch: Partial<FloorOpening>) => {
    if (!selectedOpening) return;
    setState((current) => ({ ...current, openings: current.openings.map((opening) => opening.id === selectedOpening.id ? { ...opening, ...patch } : opening) }));
  };

  const addSlab = () => {
    const bounds = floorPlanBounds(state.slabs);
    const next: FloorSlab = { id: nextObjectId("slab"), name: nextAvailableFloorName(state.slabs.map((slab) => slab.name), "板区"), type: "room", x: bounds.maxX, y: bounds.minY, width: 3600, height: 3600 };
    setState((current) => ({ ...current, slabs: [...current.slabs, next] }));
    setSelection({ kind: "slab", id: next.id });
    setSelectedBoundaryId(null);
  };

  const addOpening = () => {
    const host = selectedSlab ?? state.slabs[0];
    const width = host ? Math.min(2400, Math.max(600, host.width / 2)) : 2400;
    const height = host ? Math.min(2400, Math.max(600, host.height / 2)) : 2400;
    const next: FloorOpening = {
      id: nextObjectId("opening"), name: nextAvailableFloorName(state.openings.map((opening) => opening.name), "洞口"), type: "stair",
      x: host ? host.x + (host.width - width) / 2 : 0, y: host ? host.y + (host.height - height) / 2 : 0, width, height,
    };
    setState((current) => ({ ...current, openings: [...current.openings, next] }));
    setSelection({ kind: "opening", id: next.id });
    setSelectedBoundaryId(null);
  };

  const duplicateSelected = () => {
    if (selectedSlab) {
      const next = { ...selectedSlab, id: nextObjectId("slab"), name: nextAvailableFloorName(state.slabs.map((slab) => slab.name), "板区"), x: selectedSlab.x + selectedSlab.width };
      setState((current) => ({ ...current, slabs: [...current.slabs, next] }));
      setSelection({ kind: "slab", id: next.id });
    } else if (selectedOpening) {
      const next = { ...selectedOpening, id: nextObjectId("opening"), name: nextAvailableFloorName(state.openings.map((opening) => opening.name), "洞口"), x: selectedOpening.x + state.snapDistanceMm, y: selectedOpening.y + state.snapDistanceMm };
      setState((current) => ({ ...current, openings: [...current.openings, next] }));
      setSelection({ kind: "opening", id: next.id });
    }
  };

  const deleteSelected = () => {
    if (!selection) return;
    const object = selectedSlab ?? selectedOpening;
    if (!object || (selection.kind === "slab" && state.slabs.length <= 1)) return;
    if (!window.confirm(`确定删除“${object.name}”吗？`)) return;
    const removedThroughPathIds = selection.kind === "slab"
      ? new Set(topState.throughPaths.filter((path) => path.slabIds.includes(selection.id)).map((path) => path.id))
      : new Set<string>();
    setState((current) => ({
      ...current,
      slabs: selection.kind === "slab" ? current.slabs.filter((slab) => slab.id !== selection.id) : current.slabs,
      openings: selection.kind === "opening" ? current.openings.filter((opening) => opening.id !== selection.id) : current.openings,
      supportRules: current.supportRules.filter((rule) => rule.target.kind === "slab-edge" ? rule.target.slabId !== selection.id : rule.target.openingId !== selection.id),
    }));
    if (selection.kind === "slab") {
      setTopState((current) => ({
        ...current,
        slabOverrides: Object.fromEntries(
          Object.entries(current.slabOverrides).filter(([slabId]) => slabId !== selection.id),
        ),
        throughPaths: current.throughPaths.filter((path) => !path.slabIds.includes(selection.id)),
      }));
      setInvalidBottomDrafts((current) => new Set(
        [...current].filter((key) => !key.startsWith(`bottom:${selection.id}:`)),
      ));
      setInvalidTopDrafts((current) => new Set(
        [...current].filter((key) =>
          !key.startsWith(`top:${selection.id}:`)
          && ![...removedThroughPathIds].some((pathId) => key.startsWith(`through:${pathId}:`))),
      ));
    }
    const fallback = selection.kind === "slab" ? state.slabs.find((slab) => slab.id !== selection.id) : state.slabs[0];
    setSelection(fallback ? { kind: "slab", id: fallback.id } : null);
    setSelectedBoundaryId(null);
    setInvalidDrafts(new Set());
  };

  const moveObject = (nextSelection: Exclude<FloorSelection, null>, x: number, y: number, finished: boolean) => {
    setState((current) => {
      if (nextSelection.kind === "slab") {
        const object = current.slabs.find((slab) => slab.id === nextSelection.id);
        if (!object) return current;
        const moved = { ...object, x, y };
        const finalObject = finished ? snapFloorSlab(moved, current.slabs.filter((slab) => slab.id !== object.id), current.snapDistanceMm) : moved;
        return { ...current, slabs: current.slabs.map((slab) => slab.id === object.id ? finalObject : slab) };
      }
      const object = current.openings.find((opening) => opening.id === nextSelection.id);
      if (!object) return current;
      const moved = { ...object, x, y };
      const finalObject = finished ? snapFloorOpening(moved, current.slabs, current.openings.filter((opening) => opening.id !== object.id), current.snapDistanceMm) : moved;
      return { ...current, openings: current.openings.map((opening) => opening.id === object.id ? finalObject : opening) };
    });
  };

  const setSegmentSupport = (segment: FloorAtomicBoundarySegment, target: FloorSupportRuleTarget, support: FloorSupportRule["support"]) => {
    const key = targetKey(target);
    setState((current) => {
      // 同一Atomic Segment可能同时由A东侧和B西侧稳定target描述。
      // UI写入时清除两侧所有重叠规则，避免制造互相冲突的双边状态。
      return {
        ...current,
        supportRules: replaceFloorSupportRuleForAtomicSegment(current, segment, {
          id: `support:${key}`,
          target: structuredClone(target),
          support,
        }),
      };
    });
    setSelectedBoundaryId(segment.id);
  };

  const selectDisplayBoundary = (segment: FloorBoundarySegment) => {
    setSelectedBoundaryId(segment.atomicIds[0] ?? null);
    if (segment.openingId) setSelection({ kind: "opening", id: segment.openingId });
    else if (segment.slabIds[0]) setSelection({ kind: "slab", id: segment.slabIds[0] });
  };

  if (!hydrated) return <main className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 text-sm text-slate-500">正在迁移并恢复整层几何草稿…</main>;

  const field = (key: string, label: string, value: number, onChange: (value: number) => void, min?: number) => (
    <DraftNumberField key={`${inputRevision}:${key}`} fieldKey={key} label={label} value={value} onChange={onChange} onValidityChange={setDraftValidity} min={min} />
  );
  const stats = {
    exterior: atomic.filter((segment) => segment.geometryKind === "building-exterior").length,
    inner: atomic.filter((segment) => segment.support === "inner-wall").length,
    continuous: atomic.filter((segment) => segment.support === "continuous").length,
    opening: atomic.filter((segment) => segment.geometryKind === "opening-edge").length,
  };

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-blue-600">FloorRebarCalculator · Geometry V2.1 + Bottom V1.1 + Top/Through V1 + Role V1.1 + BOM/Print V1</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">整层楼板板筋系统</h1>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">当前支持整层楼板几何、洞口、支承拓扑、主副筋、地筋、普通面筋、面筋通墙、整层下料单及冻结快照打印。</p>
      </header>
      <CalculatorModeNav />
      <WorkflowTabs stage={stage} onChange={setStage} />

      {stage === "bom" ? (
        <FloorBomPanel
          plan={state}
          bottom={bottomCalculation}
          top={topCalculation}
          bottomRoleReviewRequired={bottomRoleReviewRequired}
          topRoleReviewRequired={topRoleReviewRequired}
          invalidDraftCount={invalidDrafts.size + invalidBottomDrafts.size + invalidTopDrafts.size}
        />
      ) : (
      <>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.75fr)]">
        <section className="min-w-0 space-y-4">
          {stage === "plan" && <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button type="button" onClick={addSlab} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={17} />添加板区</button>
            <button type="button" onClick={addOpening} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"><DoorOpen size={17} />添加洞口</button>
            <button type="button" onClick={duplicateSelected} disabled={!selection} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"><Copy size={16} />复制所选</button>
            <button type="button" onClick={deleteSelected} disabled={!selection || (selection.kind === "slab" && state.slabs.length <= 1)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-40"><Trash2 size={16} />删除所选</button>
            <button type="button" onClick={() => {
              if (!window.confirm("确定恢复Geometry V2默认数据吗？当前整层草稿将被替换。")) return;
              const next = cloneDefaultState();
              setState(next); setRoleState(cloneDefaultRoleState()); setSelection({ kind: "slab", id: next.slabs[0].id }); setSelectedBoundaryId(null); setInvalidDrafts(new Set()); setInputRevision((value) => value + 1); window.localStorage.removeItem(FLOOR_DRAFT_KEY); window.localStorage.removeItem(FLOOR_REBAR_ROLE_STORAGE_KEY);
            }} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 sm:col-span-1"><RotateCcw size={16} />重置平面</button>
          </div>}

          <FloorCanvas state={state} selection={selection} selectedBoundaryId={selectedBoundaryId} onSelect={(next) => { setSelection(next); setSelectedBoundaryId(null); }} onSelectBoundary={selectDisplayBoundary} onMove={moveObject} bottomCalculation={stage === "bottom" ? bottomCalculation : undefined} topCalculation={stage === "top" ? topCalculation : undefined} />

          {stage === "plan" && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[["板区", state.slabs.length, "slate"], ["洞口", state.openings.length, "rose"], ["建筑外边", stats.exterior, "slate"], ["内墙段", stats.inner, "blue"], ["连续板边", stats.continuous, "cyan"], ["洞口边", stats.opening, "amber"]].map(([label, value, tone]) => (
              <div key={String(label)} className={`rounded-2xl border p-4 ${tone === "blue" ? "border-blue-200 bg-blue-50" : tone === "rose" ? "border-rose-200 bg-rose-50" : tone === "cyan" ? "border-cyan-200 bg-cyan-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><span className="text-xs text-slate-600">{label}</span><strong className="mt-1 block text-2xl text-slate-950">{value}</strong></div>
            ))}
          </div>}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          {stage === "bottom" ? (
            <FloorBottomSettingsPanel
              plan={state}
              bottom={bottomState}
              selectedSlab={selectedSlab}
              selectedRoleDomain={selectedRoleDomain}
              roleState={roleState}
              roleReviewRequired={bottomRoleReviewRequired}
              onChange={setBottomState}
              onRoleStateChange={setRoleState}
              onConfirmRoleReview={() => setBottomRoleReviewRequired(false)}
              onValidityChange={setBottomDraftValidity}
            />
          ) : stage === "top" ? (
            <FloorTopSettingsPanel
              plan={state}
              top={topState}
              selectedSlab={selectedSlab}
              selectedRoleDomain={selectedRoleDomain}
              roleState={roleState}
              roleReviewRequired={topRoleReviewRequired}
              calculation={topCalculation}
              onChange={setTopState}
              onRoleStateChange={setRoleState}
              onConfirmRoleReview={() => setTopRoleReviewRequired(false)}
              onValidityChange={setTopDraftValidity}
            />
          ) : <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><House size={18} className="text-blue-600" /><h2 className="font-semibold text-slate-900">净跨拓扑设置</h2></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">X/Y仅表达板区净跨拼接，不含墙厚；墙厚通过支承拓扑单独保存。</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              {field("inner-wall", "内墙厚度", state.innerWallThickness, (value) => setState((current) => ({ ...current, innerWallThickness: value })), 1)}
              {field("outer-wall", "外墙厚度", state.outerWallThickness, (value) => setState((current) => ({ ...current, outerWallThickness: value })), 1)}
              {field("snap", "自动吸附距离", state.snapDistanceMm, (value) => setState((current) => ({ ...current, snapDistanceMm: value })), 0)}
            </div>
          </section>

          {selectedSlab && (
            <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2"><Grid2X2 size={18} className="text-blue-600" /><h2 className="font-semibold text-slate-900">板区精确参数</h2></div>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区名称</span><input value={selectedSlab.name} onChange={(event) => updateSlab({ name: event.target.value })} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区类型</span><select value={selectedSlab.type} onChange={(event) => updateSlab({ type: event.target.value as FloorSlabType })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{SLAB_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-3">
                  {field(`${selectedSlab.id}:x`, "西南角 X", selectedSlab.x, (value) => updateSlab({ x: value }))}
                  {field(`${selectedSlab.id}:y`, "西南角 Y", selectedSlab.y, (value) => updateSlab({ y: value }))}
                  {field(`${selectedSlab.id}:w`, "东西向净尺寸", selectedSlab.width, (value) => updateSlab({ width: value }), 1)}
                  {field(`${selectedSlab.id}:h`, "南北向净尺寸", selectedSlab.height, (value) => updateSlab({ height: value }), 1)}
                </div>
              </div>
            </section>
          )}

          {selectedOpening && (
            <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2"><DoorOpen size={18} className="text-rose-600" /><h2 className="font-semibold text-slate-900">洞口精确参数</h2></div>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口名称</span><input value={selectedOpening.name} onChange={(event) => updateOpening({ name: event.target.value })} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口类型</span><select value={selectedOpening.type} onChange={(event) => updateOpening({ type: event.target.value as FloorOpeningType })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{OPENING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-3">
                  {field(`${selectedOpening.id}:x`, "西南角 X", selectedOpening.x, (value) => updateOpening({ x: value }))}
                  {field(`${selectedOpening.id}:y`, "西南角 Y", selectedOpening.y, (value) => updateOpening({ y: value }))}
                  {field(`${selectedOpening.id}:w`, "东西向尺寸", selectedOpening.width, (value) => updateOpening({ width: value }), 1)}
                  {field(`${selectedOpening.id}:h`, "南北向尺寸", selectedOpening.height, (value) => updateOpening({ height: value }), 1)}
                </div>
                <p className="rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-800">洞口会从与其重叠的板区中扣除。楼梯间仅表示无普通水平楼板区域，不表示楼梯平台。</p>
              </div>
            </section>
          )}

          <BoundaryPanel state={state} selection={selection} segments={selectedSegments} selectedBoundaryId={selectedBoundaryId} onSelectBoundary={setSelectedBoundaryId} onSetSupport={setSegmentSupport} />

          <section className={`rounded-2xl border p-5 ${errors.length > 0 || invalidDrafts.size > 0 ? "border-rose-200 bg-rose-50" : warnings.length > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <h2 className="font-semibold text-slate-900">{errors.length > 0 || invalidDrafts.size > 0 ? "几何输入无效" : warnings.length > 0 ? "几何有效，但需要确认" : "几何与支承拓扑有效"}</h2>
            {invalidDrafts.size > 0 && <p className="mt-2 text-sm text-rose-800">有 {invalidDrafts.size} 个数字输入仍为空或非法，旧数值不会被当作当前输入提交。</p>}
            <ul className="mt-2 space-y-1 text-sm text-slate-700">{issues.map((issue) => <li key={`${issue.code}:${issue.message}`} className={issue.level === "error" ? "text-rose-800" : "text-amber-900"}>• {issue.message}</li>)}</ul>
            {issues.length === 0 && invalidDrafts.size === 0 && <p className="mt-2 text-sm leading-6 text-emerald-800">系统已区分建筑外边、共享板边、连续板边与洞口裁断边。</p>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <div className="flex items-start gap-2"><Info size={18} className="mt-0.5 shrink-0 text-blue-600" /><div><strong>几何职责</strong><p className="mt-1">楼层页只维护Geometry与Support。地筋和普通面筋页基于同一Atomic Boundary生成Domain、理论BarLine、Opening裁断后的Piece和分层料单。</p></div></div>
          </section>
          </>}
        </aside>
        </div>
        {stage === "bottom" && <FloorBottomResults plan={state} calculation={bottomCalculation} invalidDraftCount={invalidDrafts.size + invalidBottomDrafts.size} />}
        {stage === "top" && <FloorTopResults plan={state} calculation={topCalculation} invalidDraftCount={invalidDrafts.size + invalidTopDrafts.size} />}
      </>
      )}
      <p className="mt-5 text-xs text-slate-500">当前显示边界 {displays.length} 段；正式板筋计算使用原子边界 {atomic.length} 段。显示段ID不会用于保存支承或钢筋业务规则。</p>
    </main>
  );
}
