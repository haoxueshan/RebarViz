"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Circle, DoorOpen, Grid2X2, Menu, RotateCcw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FloorBottomResults, FloorBottomSettingsPanel } from "@/components/calculator/floor/FloorBottomPanel";
import { FloorBomPanel } from "@/components/calculator/floor/FloorBomPanel";
import { FloorCanvas, type FloorSelection } from "@/components/calculator/floor/FloorCanvas";
import { FloorTopResults, FloorTopSettingsPanel } from "@/components/calculator/floor/FloorTopPanel";
import { FloorWorkspaceDrawer } from "@/components/calculator/floor/FloorWorkspaceDrawer";
import { FloorWorkspaceInspector, type FloorWorkspaceInspectorTab } from "@/components/calculator/floor/FloorWorkspaceInspector";
import { FloorWorkspaceNavigator } from "@/components/calculator/floor/FloorWorkspaceNavigator";
import { FloorWorkspaceSummary } from "@/components/calculator/floor/FloorWorkspaceSummary";
import type {
  FloorWorkflowStage,
  FloorWorkflowStatus,
  FloorWorkspaceRoleItem,
  FloorWorkspaceThroughItem,
} from "@/components/calculator/floor/floor-workspace-types";
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
  resolveFloorRoleDomainMainDirection,
  type FloorRebarRoleState,
} from "@/lib/floor-rebar-role";
import {
  createFloorRebarRoleStoredRecord,
  FLOOR_REBAR_ROLE_STORAGE_KEY,
  parseFloorRebarRoleStoredRecord,
} from "@/lib/floor-rebar-role-storage";
import { getFloorPrintEligibility } from "@/lib/floor-print";
import { resolveFloorTopThroughPathGeometry } from "@/lib/floor-top-through";

const SLAB_TYPE_OPTIONS: Array<{ value: FloorSlabType; label: string }> = [
  { value: "room", label: "房间" }, { value: "corridor", label: "内走廊" }, { value: "hall", label: "客厅" },
  { value: "balcony", label: "阳台" }, { value: "other", label: "其他板区" },
];
const OPENING_TYPE_OPTIONS: Array<{ value: FloorOpeningType; label: string }> = [
  { value: "stair", label: "楼梯间" }, { value: "shaft", label: "井道" }, { value: "void", label: "挑空" }, { value: "other", label: "其他洞口" },
];

/** Navigator/Inspector 中按对象标记 warning 的几何警告码（PRD 26）。 */
const WORKSPACE_NAV_WARNING_CODES = new Set([
  "opening-uncovered",
  "opening-partial-outside",
  "opening-edge-near-slab-edge",
]);

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

function nextThroughPathName(paths: readonly FloorTopState["throughPaths"][number][]): string {
  const names = new Set(paths.map((path) => path.name));
  let index = 1;
  while (names.has(`通墙${String(index).padStart(2, "0")}`)) index += 1;
  return `通墙${String(index).padStart(2, "0")}`;
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
          onBlur={() => {
            // 非法输入失焦时放弃 draft、恢复正式 State 旧值并解除 invalid 标记。
            if (invalid) onValidityChange(fieldKey, true);
            setDraft(null);
          }}
          className={`h-11 w-full rounded-xl border bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 ${invalid ? "border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100"}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">mm</span>
      </span>
      {invalid && <span className="mt-1 block text-xs text-rose-600">请输入{min === 1 ? "大于0的" : "有效"}数字。</span>}
    </label>
  );
}

function WorkflowTabs({ stage, statuses, onChange }: { stage: FloorWorkflowStage; statuses: Record<FloorWorkflowStage, FloorWorkflowStatus>; onChange: (stage: FloorWorkflowStage) => void }) {
  const tabs: Array<{ stage: FloorWorkflowStage; label: string }> = [
    { stage: "plan", label: "楼层" },
    { stage: "bottom", label: "地筋" },
    { stage: "top", label: "面筋" },
    { stage: "bom", label: "料单" },
  ];
  return (
    <div className="sticky top-0 z-40 mb-3 grid grid-cols-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:static xl:mb-4" aria-label="整层计算步骤">
      {tabs.map((tab, index) => (
        <button key={tab.stage} type="button" onClick={() => onChange(tab.stage)} className={`min-h-12 min-w-0 px-1 py-3 text-center text-xs font-semibold sm:text-sm ${stage === tab.stage ? "bg-blue-600 text-white" : "border-l border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} aria-current={stage === tab.stage ? "step" : undefined}>
          <span className="inline-flex items-center justify-center gap-1">{statuses[tab.stage] === "valid" ? <Check size={14} /> : statuses[tab.stage] === "invalid" || statuses[tab.stage] === "warning" ? <AlertTriangle size={14} /> : <Circle size={11} />}<span className="hidden sm:inline">{index + 1}. </span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  testId,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-h-12 w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          {badge}
        </span>
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

function BoundaryPanel({
  state,
  selection,
  segments,
  selectedBoundaryId,
  onSelectBoundary,
  onSetSupport,
  compact = false,
}: {
  state: FloorPlanState;
  selection: FloorSelection;
  segments: FloorAtomicBoundarySegment[];
  selectedBoundaryId: string | null;
  onSelectBoundary: (id: string) => void;
  onSetSupport: (segment: FloorAtomicBoundarySegment, target: FloorSupportRuleTarget, support: FloorSupportRule["support"]) => void;
  compact?: boolean;
}) {
  if (!selection) return null;
  return (
    <section className={compact ? "space-y-3" : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"}>
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
  const [dragActive, setDragActive] = useState(false);
  const [inputRevision, setInputRevision] = useState(0);
  const [selectedThroughPathId, setSelectedThroughPathId] = useState<string | null>(null);
  const [boundarySectionOpen, setBoundarySectionOpen] = useState(false);
  const [floorSectionOpen, setFloorSectionOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [tabletInspectorExpanded, setTabletInspectorExpanded] = useState(true);
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [highlightedRoleDomainId, setHighlightedRoleDomainId] = useState<string | null>(null);
  const [canvasFocusRequest, setCanvasFocusRequest] = useState<{ mode: "selection" | "domain"; key: string } | null>(null);

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
    if (!hydrated || dragActive) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(FLOOR_DRAFT_KEY, JSON.stringify(createFloorDraftRecord(state)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [dragActive, hydrated, state]);

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
  const printEligibility = useMemo(() => getFloorPrintEligibility({
    plan: state,
    bottom: bottomCalculation,
    top: topCalculation,
    bottomRoleReviewRequired,
    topRoleReviewRequired,
    invalidDraftCount: invalidDrafts.size + invalidBottomDrafts.size + invalidTopDrafts.size,
  }), [bottomCalculation, bottomRoleReviewRequired, invalidBottomDrafts.size, invalidDrafts.size, invalidTopDrafts.size, state, topCalculation, topRoleReviewRequired]);
  const roleItems = useMemo<FloorWorkspaceRoleItem[]>(() => roleDomains.map((domain, index) => {
    const resolved = resolveFloorRoleDomainMainDirection(domain, roleState);
    const mainLabel = resolved.mainDirection === "x" ? "东西向主筋" : resolved.mainDirection === "y" ? "南北向主筋" : "主筋方向待确认";
    const hasError = issues.some((issue) => issue.level === "error" && issue.objectIds?.some((id) => domain.slabIds.includes(id)));
    const hasWarning = issues.some((issue) => issue.level === "warning" && WORKSPACE_NAV_WARNING_CODES.has(issue.code) && issue.objectIds?.some((id) => domain.slabIds.includes(id)));
    return {
      id: domain.id,
      slabIds: domain.slabIds,
      label: `区域${String(index + 1).padStart(2, "0")}`,
      detail: `${domain.shape === "irregular" ? "不规则连续区域" : domain.shape === "square" ? "正方形区域" : resolved.source === "auto" ? "自动判断" : "人工指定"} · ${mainLabel}`,
      status: !resolved.mainDirection || hasError ? "invalid" : hasWarning ? "warning" : "valid",
    };
  }), [issues, roleDomains, roleState]);
  const throughItems = useMemo<FloorWorkspaceThroughItem[]>(() => topState.throughPaths.map((path) => {
    const geometry = resolveFloorTopThroughPathGeometry(state, path);
    const pathErrors = topCalculation.errors.filter((issue) => issue.code.startsWith("through-") && (issue.objectIds?.includes(path.id) || issue.message.includes(path.name)));
    const names = geometry.orderedSlabIds.map((id) => state.slabs.find((slab) => slab.id === id)?.name ?? id);
    const hasWarning = path.slabIds.some((id) => issues.some((issue) => issue.level === "warning" && WORKSPACE_NAV_WARNING_CODES.has(issue.code) && issue.objectIds?.includes(id)));
    return {
      id: path.id,
      name: path.name,
      detail: names.length > 0 ? names.join(" → ") : path.slabIds.map((id) => state.slabs.find((slab) => slab.id === id)?.name ?? id).join(" → ") || "尚未选择板区",
      status: !path.enabled ? "disabled" : pathErrors.length > 0 || geometry.errors.length > 0 ? "invalid" : hasWarning ? "warning" : "valid",
    };
  }), [issues, state, topCalculation.errors, topState.throughPaths]);
  const workflowStatuses: Record<FloorWorkflowStage, FloorWorkflowStatus> = {
    plan: errors.length > 0 || invalidDrafts.size > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    bottom: bottomCalculation.isValid && !bottomRoleReviewRequired && invalidDrafts.size + invalidBottomDrafts.size === 0 ? "valid" : "invalid",
    top: topCalculation.isValid && !topRoleReviewRequired && invalidDrafts.size + invalidTopDrafts.size === 0 ? "valid" : "invalid",
    bom: printEligibility.eligible ? "valid" : "invalid",
  };

  useEffect(() => {
    if (selectedThroughPathId && !topState.throughPaths.some((path) => path.id === selectedThroughPathId)) setSelectedThroughPathId(null);
  }, [selectedThroughPathId, topState.throughPaths]);

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

  const resetPlan = () => {
    if (!window.confirm("确定恢复Geometry V2默认数据吗？当前整层草稿将被替换。")) return;
    const next = cloneDefaultState();
    setState(next);
    setRoleState(cloneDefaultRoleState());
    setBottomState(cloneDefaultBottomState());
    setTopState(cloneDefaultTopState());
    setBottomRoleReviewRequired(false);
    setTopRoleReviewRequired(false);
    setSelection({ kind: "slab", id: next.slabs[0].id });
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(null);
    setInvalidDrafts(new Set());
    setInvalidBottomDrafts(new Set());
    setInvalidTopDrafts(new Set());
    setInputRevision((value) => value + 1);
    window.localStorage.removeItem(FLOOR_DRAFT_KEY);
    window.localStorage.removeItem(FLOOR_REBAR_ROLE_STORAGE_KEY);
    window.localStorage.removeItem(FLOOR_BOTTOM_STORAGE_KEY);
    window.localStorage.removeItem(FLOOR_TOP_STORAGE_KEY);
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

  const selectAtomicBoundary = (segment: FloorAtomicBoundarySegment) => {
    setSelectedBoundaryId(segment.id);
    if (segment.openingId) setSelection({ kind: "opening", id: segment.openingId });
    else if (segment.slabIds[0]) setSelection({ kind: "slab", id: segment.slabIds[0] });
    setBoundarySectionOpen(true);
    setInspectorOpen(true);
    setTabletInspectorExpanded(true);
  };

  const changeStage = (nextStage: FloorWorkflowStage) => {
    setStage(nextStage);
    setDetailsExpanded(false);
    setNavigatorOpen(false);
    setInspectorOpen(false);
    setHighlightedRoleDomainId(null);
    if (nextStage !== "top") setSelectedThroughPathId(null);
    setTabletInspectorExpanded(true);
  };

  const selectWorkspaceObject = (nextSelection: Exclude<FloorSelection, null>) => {
    setSelection(nextSelection);
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(null);
    setCanvasFocusRequest({ mode: "selection", key: `${nextSelection.kind}:${nextSelection.id}:${Date.now()}` });
    setNavigatorOpen(false);
  };

  const selectRoleItem = (item: FloorWorkspaceRoleItem) => {
    const slab = state.slabs.find((candidate) => item.slabIds.includes(candidate.id));
    if (slab) setSelection({ kind: "slab", id: slab.id });
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(item.id);
    setCanvasFocusRequest({ mode: "domain", key: `${item.id}:${Date.now()}` });
    setNavigatorOpen(false);
    setInspectorOpen(true);
    setTabletInspectorExpanded(true);
  };

  const selectThroughPath = (id: string) => {
    setSelectedThroughPathId(id);
    setHighlightedRoleDomainId(null);
    setNavigatorOpen(false);
    setInspectorOpen(true);
    setTabletInspectorExpanded(true);
  };

  const addThroughPath = () => {
    const next = {
      id: `floor-through-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: nextThroughPathName(topState.throughPaths),
      direction: "x" as const,
      slabIds: selectedSlab ? [selectedSlab.id] : [],
      bandStartMm: 0,
      bandEndMm: 0,
      enabled: false,
    };
    setTopState((current) => ({ ...current, throughPaths: [...current.throughPaths, next] }));
    setSelectedThroughPathId(next.id);
    setNavigatorOpen(false);
    setInspectorOpen(true);
    setTabletInspectorExpanded(true);
  };

  useEffect(() => {
    if (stage !== "top" || !selectedThroughPathId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-through-path-id="${selectedThroughPathId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [selectedThroughPathId, stage]);

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
  const selectedThroughPath = selectedThroughPathId
    ? topState.throughPaths.find((path) => path.id === selectedThroughPathId) ?? null
    : null;
  const inspectorTabs: FloorWorkspaceInspectorTab[] = [];
  const inspectorTitle = selectedThroughPath
    ? selectedThroughPath.name
    : selectedSlab?.name ?? selectedOpening?.name ?? "未选择对象";
  const inspectorSubtitle = selectedThroughPath
    ? `${selectedThroughPath.enabled ? "已启用" : "未启用"} · ${selectedThroughPath.direction === "x" ? "东西向" : "南北向"}`
    : selectedSlab
      ? `${SLAB_TYPE_OPTIONS.find((option) => option.value === selectedSlab.type)?.label ?? "板区"} · ${formatMm(selectedSlab.width)} × ${formatMm(selectedSlab.height)}mm`
      : selectedOpening
        ? `${OPENING_TYPE_OPTIONS.find((option) => option.value === selectedOpening.type)?.label ?? "洞口"} · ${formatMm(selectedOpening.width)} × ${formatMm(selectedOpening.height)}mm`
        : undefined;
  const inspectorIssueCount = stage === "plan"
    ? errors.length + invalidDrafts.size
    : stage === "bottom"
      ? bottomCalculation.errors.length
      : topCalculation.errors.length;

  const inspectorContent = stage === "plan" ? (
    !selection ? (
      <p className="text-sm text-slate-500">请从左侧Navigator或Canvas选择板区/洞口。</p>
    ) : (
      <div className="space-y-4">
        {selectedSlab ? (
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm" data-testid="floor-size-editor">
            <div className="flex items-center gap-2"><Grid2X2 size={18} className="text-blue-600" /><h3 className="font-semibold text-slate-900">当前板区参数</h3></div>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区名称</span><input value={selectedSlab.name} onChange={(event) => updateSlab({ name: event.target.value })} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区类型</span><select value={selectedSlab.type} onChange={(event) => updateSlab({ type: event.target.value as FloorSlabType })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{SLAB_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div><span className="mb-1.5 block text-xs font-medium text-slate-600">位置</span><div className="grid grid-cols-2 gap-3">{field(`${selectedSlab.id}:x`, "西南角 X", selectedSlab.x, (value) => updateSlab({ x: value }))}{field(`${selectedSlab.id}:y`, "西南角 Y", selectedSlab.y, (value) => updateSlab({ y: value }))}</div></div>
              <div><span className="mb-1.5 block text-xs font-medium text-slate-600">净尺寸</span><div className="grid grid-cols-2 gap-3">{field(`${selectedSlab.id}:w`, "东西向净尺寸", selectedSlab.width, (value) => updateSlab({ width: value }), 1)}{field(`${selectedSlab.id}:h`, "南北向净尺寸", selectedSlab.height, (value) => updateSlab({ height: value }), 1)}</div></div>
            </div>
          </section>
        ) : selectedOpening ? (
          <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-sm" data-testid="floor-size-editor">
            <div className="flex items-center gap-2"><DoorOpen size={18} className="text-rose-600" /><h3 className="font-semibold text-slate-900">洞口精确参数</h3></div>
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口名称</span><input value={selectedOpening.name} onChange={(event) => updateOpening({ name: event.target.value })} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口类型</span><select value={selectedOpening.type} onChange={(event) => updateOpening({ type: event.target.value as FloorOpeningType })} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{OPENING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div><span className="mb-1.5 block text-xs font-medium text-slate-600">位置</span><div className="grid grid-cols-2 gap-3">{field(`${selectedOpening.id}:x`, "西南角 X", selectedOpening.x, (value) => updateOpening({ x: value }))}{field(`${selectedOpening.id}:y`, "西南角 Y", selectedOpening.y, (value) => updateOpening({ y: value }))}</div></div>
              <div><span className="mb-1.5 block text-xs font-medium text-slate-600">净尺寸</span><div className="grid grid-cols-2 gap-3">{field(`${selectedOpening.id}:w`, "东西向尺寸", selectedOpening.width, (value) => updateOpening({ width: value }), 1)}{field(`${selectedOpening.id}:h`, "南北向尺寸", selectedOpening.height, (value) => updateOpening({ height: value }), 1)}</div></div>
              <p className="rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-800">洞口会从与其重叠的板区中扣除。楼梯间仅表示无普通水平楼板区域。</p>
            </div>
          </section>
        ) : null}
        <CollapsibleSection title="边界关系" open={boundarySectionOpen} onToggle={() => setBoundarySectionOpen((value) => !value)} testId="floor-boundary-section">
          <BoundaryPanel compact state={state} selection={selection} segments={selectedSegments} selectedBoundaryId={selectedBoundaryId} onSelectBoundary={setSelectedBoundaryId} onSetSupport={setSegmentSupport} />
        </CollapsibleSection>
        <CollapsibleSection title="楼层设置" open={floorSectionOpen} onToggle={() => setFloorSectionOpen((value) => !value)} testId="floor-settings-section">
          <div className="space-y-5">
            <section className="space-y-4">
              <div><h3 className="font-semibold text-slate-900">净跨拓扑设置</h3><p className="mt-1 text-xs leading-5 text-slate-500">X/Y仅表达板区净跨拼接，不含墙厚；墙厚通过支承拓扑单独保存。</p></div>
              {field("inner-wall", "内墙厚度", state.innerWallThickness, (value) => setState((current) => ({ ...current, innerWallThickness: value })), 1)}
              {field("outer-wall", "外墙厚度", state.outerWallThickness, (value) => setState((current) => ({ ...current, outerWallThickness: value })), 1)}
              {field("snap", "自动吸附距离", state.snapDistanceMm, (value) => setState((current) => ({ ...current, snapDistanceMm: value })), 0)}
              <button type="button" onClick={resetPlan} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"><RotateCcw size={16} />重置平面</button>
            </section>
            <section className={`rounded-xl border p-4 ${errors.length > 0 || invalidDrafts.size > 0 ? "border-rose-200 bg-rose-50" : warnings.length > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              <h3 className="font-semibold text-slate-900">{errors.length > 0 || invalidDrafts.size > 0 ? "几何输入无效" : warnings.length > 0 ? "几何有效，但需要确认" : "几何与支承拓扑有效"}</h3>
              {invalidDrafts.size > 0 && <p className="mt-2 text-sm text-rose-800">有 {invalidDrafts.size} 个数字输入仍为空或非法，旧数值不会被当作当前输入提交。</p>}
              <ul className="mt-2 space-y-1 text-xs leading-5">{issues.map((issue) => <li key={`${issue.code}:${issue.message}`} className={issue.level === "error" ? "text-rose-800" : "text-amber-900"}>• {issue.message}</li>)}</ul>
            </section>
          </div>
        </CollapsibleSection>
      </div>
    )
  ) : selection?.kind === "opening" ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">洞口不设置普通{stage === "bottom" ? "地筋" : "面筋"}规格。<button type="button" onClick={() => changeStage("plan")} className="mt-3 block min-h-11 w-full rounded-xl border border-amber-300 bg-white font-semibold">返回楼层编辑洞口</button></div>
  ) : stage === "bottom" ? (
    <div className="space-y-4">{bottomCalculation.errors.length > 0 && <section className="rounded-xl border border-rose-200 bg-rose-50 p-3"><strong className="text-sm text-rose-900">地筋问题</strong><ul className="mt-2 space-y-1 text-xs leading-5 text-rose-800">{bottomCalculation.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul></section>}<FloorBottomSettingsPanel plan={state} bottom={bottomState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={bottomRoleReviewRequired} onChange={setBottomState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setBottomRoleReviewRequired(false)} onValidityChange={setBottomDraftValidity} section="all" /></div>
  ) : (
    <div className="space-y-4">{topCalculation.errors.length > 0 && <section className="rounded-xl border border-rose-200 bg-rose-50 p-3"><strong className="text-sm text-rose-900">面筋问题</strong><ul className="mt-2 space-y-1 text-xs leading-5 text-rose-800">{topCalculation.errors.map((issue) => <li key={`${issue.code}:${issue.message}`}>• {issue.message}</li>)}</ul></section>}<FloorTopSettingsPanel plan={state} top={topState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={topRoleReviewRequired} calculation={topCalculation} onChange={setTopState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setTopRoleReviewRequired(false)} onValidityChange={setTopDraftValidity} section="all" selectedThroughPathId={selectedThroughPathId} onSelectThroughPath={setSelectedThroughPathId} /></div>
  );

  const inspector = <FloorWorkspaceInspector title={inspectorTitle} subtitle={inspectorSubtitle} tabs={inspectorTabs} issueCount={inspectorIssueCount}>{inspectorContent}</FloorWorkspaceInspector>;
  const navigator = <FloorWorkspaceNavigator stage={stage} plan={state} selection={selection} geometryIssues={issues} bottomOverrides={new Set(Object.keys(bottomState.slabOverrides))} topOverrides={new Set(Object.keys(topState.slabOverrides))} roleItems={roleItems} throughItems={throughItems} selectedThroughPathId={selectedThroughPathId} onSelect={selectWorkspaceObject} onSelectRole={selectRoleItem} onSelectThrough={selectThroughPath} onAddSlab={addSlab} onAddOpening={addOpening} onDuplicate={duplicateSelected} onDelete={deleteSelected} onAddThrough={addThroughPath} />;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <header className="mb-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 xl:text-3xl">整层楼板板筋系统</h1>
        <p className="mt-1 hidden truncate text-xs font-semibold text-blue-600 xl:block">FloorRebarCalculator · Multi-Block Workspace V1 + Tablet Workspace V1 · Geometry V2.1 + Floor 2D V2.2 + Bottom/Top/Through + BOM/Print V1</p>
      </header>
      <WorkflowTabs stage={stage} statuses={workflowStatuses} onChange={changeStage} />

      {stage === "bom" ? (
        <FloorBomPanel
          plan={state}
          bottom={bottomCalculation}
          top={topCalculation}
          bottomRoleReviewRequired={bottomRoleReviewRequired}
          topRoleReviewRequired={topRoleReviewRequired}
          invalidDraftCount={invalidDrafts.size + invalidBottomDrafts.size + invalidTopDrafts.size}
        />
      ) : <>
        <div className="mb-2 flex items-center gap-2 xl:hidden">
          <button type="button" onClick={() => setNavigatorOpen(true)} className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800"><Menu size={17} /><span className="min-w-0 flex-1 truncate">当前：{selectedSlab?.name ?? selectedOpening?.name ?? selectedThroughPath?.name ?? "请选择对象"}</span><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setInspectorOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white md:hidden"><Settings2 size={17} />编辑</button>
          <button type="button" aria-expanded={tabletInspectorExpanded} onClick={() => setTabletInspectorExpanded((value) => !value)} className="hidden min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 md:inline-flex lg:hidden"><Settings2 size={17} />{tabletInspectorExpanded ? "收起编辑" : "展开编辑"}</button>
        </div>

        <div className={`grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_370px] ${navigatorCollapsed ? "xl:grid-cols-[52px_minmax(0,1fr)_370px]" : "xl:grid-cols-[240px_minmax(0,1fr)_370px]"}`} data-testid="floor-workspace-grid">
          <aside className="relative hidden min-h-[480px] overflow-hidden rounded-2xl border border-slate-200 bg-white xl:sticky xl:top-20 xl:col-start-1 xl:row-start-1 xl:block xl:h-[calc(100dvh-15rem)] xl:max-h-[calc(100dvh-15rem)]">
            <button type="button" aria-label={navigatorCollapsed ? "展开左侧导航" : "收起左侧导航"} onClick={() => setNavigatorCollapsed((value) => !value)} className="absolute right-1 top-1 z-10 flex size-10 items-center justify-center rounded-xl bg-white/90 text-slate-600 shadow-sm">{navigatorCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button>
            {navigatorCollapsed ? <FloorWorkspaceNavigator compact stage={stage} plan={state} selection={selection} geometryIssues={issues} bottomOverrides={new Set(Object.keys(bottomState.slabOverrides))} topOverrides={new Set(Object.keys(topState.slabOverrides))} roleItems={roleItems} throughItems={throughItems} selectedThroughPathId={selectedThroughPathId} onSelect={selectWorkspaceObject} onSelectRole={selectRoleItem} onSelectThrough={selectThroughPath} onAddSlab={addSlab} onAddOpening={addOpening} onDuplicate={duplicateSelected} onDelete={deleteSelected} onAddThrough={addThroughPath} /> : navigator}
          </aside>

          <section className="min-w-0 space-y-3 md:col-start-1 md:row-start-1 lg:col-start-1 lg:row-start-1 xl:col-start-2">
            <FloorCanvas key={canvasFocusRequest?.key ?? "floor-canvas"} state={state} selection={selection} selectedBoundaryId={selectedBoundaryId} onSelect={(next) => { setSelection(next); setSelectedBoundaryId(null); setSelectedThroughPathId(null); setHighlightedRoleDomainId(null); }} onSelectBoundary={selectAtomicBoundary} onMove={moveObject} onDragStateChange={setDragActive} bottomCalculation={stage === "bottom" ? bottomCalculation : undefined} topCalculation={stage === "top" ? topCalculation : undefined} roleDomains={roleDomains} roleState={roleState} highlightedRoleDomainId={highlightedRoleDomainId} highlightedThroughPathId={selectedThroughPathId} initialFitMode={canvasFocusRequest?.mode} />
            {stage === "plan" && <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 lg:hidden">{[["板区", state.slabs.length], ["洞口", state.openings.length], ["建筑外边", stats.exterior], ["内墙", stats.inner], ["连续板边", stats.continuous], ["洞口边", stats.opening]].map(([label, value]) => <span key={String(label)} className="rounded-full bg-slate-100 px-2.5 py-1"><strong className="text-slate-900">{value}</strong> {label}</span>)}</div>}
          </section>

          {inspectorOpen && <button type="button" aria-label="关闭属性面板遮罩" onClick={() => setInspectorOpen(false)} className="fixed inset-0 z-[60] bg-slate-950/40 md:hidden" />}
          <aside className={`${inspectorOpen ? "fixed inset-x-0 bottom-0 z-[70] block max-h-[82dvh] overflow-hidden rounded-t-3xl" : "hidden"} ${tabletInspectorExpanded ? "md:block" : "md:hidden lg:block"} border border-slate-200 bg-white shadow-2xl md:relative md:top-auto md:z-auto md:col-start-1 md:row-start-2 md:rounded-2xl md:shadow-none lg:col-start-2 lg:row-start-1 lg:self-start xl:col-start-3`}>
            <div className="flex min-h-14 items-center justify-between border-b border-slate-200 px-4 md:hidden"><strong className="text-sm text-slate-950">编辑：{inspectorTitle}</strong><button type="button" onClick={() => setInspectorOpen(false)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-slate-600">关闭</button></div>
            <div className="max-h-[calc(82dvh-3.5rem)] overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))] md:max-h-none md:overflow-visible md:pb-0">{inspector}</div>
          </aside>

          <div className="min-w-0 md:col-start-1 md:row-start-3 lg:col-span-2 lg:row-start-2 xl:col-span-3">
            <FloorWorkspaceSummary stage={stage} bottom={bottomCalculation} top={topCalculation} geometryErrorCount={errors.length + invalidDrafts.size} onShowDetails={() => setDetailsExpanded((value) => !value)} onShowIssues={() => { if (stage === "plan") { setFloorSectionOpen(true); setInspectorOpen(true); setTabletInspectorExpanded(true); } else { setDetailsExpanded(true); } }} />
          </div>
        </div>

        {detailsExpanded && stage === "bottom" && <FloorBottomResults plan={state} calculation={bottomCalculation} invalidDraftCount={invalidDrafts.size + invalidBottomDrafts.size} />}
        {detailsExpanded && stage === "top" && <FloorTopResults plan={state} calculation={topCalculation} invalidDraftCount={invalidDrafts.size + invalidTopDrafts.size} />}

        <FloorWorkspaceDrawer open={navigatorOpen} title={stage === "plan" ? "楼层对象" : stage === "bottom" ? "地筋导航" : "面筋导航"} side="left" onClose={() => setNavigatorOpen(false)}>{navigator}</FloorWorkspaceDrawer>
      </>}
      <p className="mt-5 text-xs text-slate-500">当前显示边界 {displays.length} 段；正式板筋计算使用原子边界 {atomic.length} 段。显示段ID不会用于保存支承或钢筋业务规则。</p>
    </main>
  );
}
