"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, Circle, DoorOpen, Grid2X2, Menu, RotateCcw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloorBottomSettingsPanel } from "@/components/calculator/floor/FloorBottomPanel";
import { FloorBomPanel } from "@/components/calculator/floor/FloorBomPanel";
import { FloorCanvas, type FloorSelection } from "@/components/calculator/floor/FloorCanvas";
import { FloorCanvasCommandBar } from "@/components/calculator/floor/FloorCanvasCommandBar";
import { FloorTopSettingsPanel } from "@/components/calculator/floor/FloorTopPanel";
import { FloorIssueCenter } from "@/components/calculator/floor/FloorIssueCenter";
import { FloorImportProjectDialog } from "@/components/calculator/floor/FloorImportProjectDialog";
import { FloorNavigatorPalette } from "@/components/calculator/floor/FloorNavigatorPalette";
import { FloorNewProjectDialog, type FloorNewProjectMode } from "@/components/calculator/floor/FloorNewProjectDialog";
import { FloorProjectMenu } from "@/components/calculator/floor/FloorProjectMenu";
import { FloorWorkspaceDrawer } from "@/components/calculator/floor/FloorWorkspaceDrawer";
import { FloorWorkspaceInspector, type FloorWorkspaceInspectorTab } from "@/components/calculator/floor/FloorWorkspaceInspector";
import { FloorWorkspaceNavigator, FLOOR_NAVIGATOR_SECTION_LABELS, type FloorNavigatorSection } from "@/components/calculator/floor/FloorWorkspaceNavigator";
import { FloorWorkspaceShell } from "@/components/calculator/floor/FloorWorkspaceShell";
import { FloorWorkspaceStatusBar } from "@/components/calculator/floor/FloorWorkspaceStatusBar";
import { useFloorWorkspaceProfile } from "@/components/calculator/floor/useFloorWorkspaceProfile";
import {
  createBlankFloorPlanState,
  createFloorProjectFile,
  createFloorProjectMetaRecord,
  FLOOR_DEFAULT_PROJECT_NAME,
  FLOOR_PROJECT_FILE_MAX_BYTES,
  FLOOR_PROJECT_META_KEY,
  FLOOR_PROJECT_PARSE_ERROR_MESSAGES,
  floorProjectFileName,
  parseFloorProjectFile,
  parseFloorProjectMetaRecord,
  serializeFloorProjectFile,
  type ParsedFloorProject,
} from "@/lib/floor-project-file";
import type {
  FloorWorkflowStage,
  FloorWorkflowStatus,
  FloorInspectorTab,
  FloorWorkspaceIssue,
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
import {
  applyFloorDock,
  applyFloorMultiAlign,
  describeFloorSlabSideRelations,
  floorDockAlignmentLabel,
  floorDockDirectionLabel,
  FLOOR_DOCK_ALIGNMENTS,
  previewFloorDock,
  previewFloorMultiAlign,
  suggestFloorDockFixes,
  type FloorDockAlignment,
  type FloorDockDirection,
  type FloorDockPreview,
  type FloorDockRequest,
  type FloorDockSuggestion,
  type FloorMultiAlignKind,
} from "@/lib/floor-docking";
import {
  resolveFloorGeometryTolerance,
} from "@/lib/floor-geometry-tolerance";
import {
  createFloorHistory,
  pushFloorHistory,
  redoFloorHistory,
  undoFloorHistory,
  type FloorHistoryState,
} from "@/lib/floor-history";
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
  max,
}: {
  fieldKey: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (key: string, valid: boolean) => void;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? String(value);
  const invalid = draft !== null && (draft.trim() === "" || !Number.isFinite(Number(draft)) || (min !== undefined && Number(draft) < min) || (max !== undefined && Number(draft) > max));
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          value={displayed}
          min={min}
          max={max}
          aria-invalid={invalid}
          onFocus={(event) => { setDraft(String(value)); event.currentTarget.select(); }}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = Number(raw);
            const valid = raw.trim() !== "" && Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max);
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

function WorkflowTabs({ stage, statuses, issueCounts, onChange, onOpenIssues }: { stage: FloorWorkflowStage; statuses: Record<FloorWorkflowStage, FloorWorkflowStatus>; issueCounts: Record<FloorWorkflowStage, number>; onChange: (stage: FloorWorkflowStage) => void; onOpenIssues: (stage: FloorWorkflowStage) => void }) {
  const tabs: Array<{ stage: FloorWorkflowStage; label: string }> = [
    { stage: "plan", label: "楼层" },
    { stage: "bottom", label: "地筋" },
    { stage: "top", label: "面筋" },
    { stage: "bom", label: "料单" },
  ];
  return (
    <div className="sticky top-0 z-40 grid h-11 grid-cols-4 bg-white md:static" aria-label="整层计算步骤" data-testid="floor-workflow-bar">
      {tabs.map((tab, index) => (
        <div key={tab.stage} className={`relative flex min-w-0 items-stretch border-l border-slate-200 first:border-l-0 ${stage === tab.stage ? "bg-blue-600 text-white" : "bg-white text-slate-700"}`}>
          <button type="button" data-workflow-stage={tab.stage} onClick={() => onChange(tab.stage)} className="min-w-0 flex-1 px-1 text-center text-xs font-semibold hover:bg-black/5 sm:text-sm" aria-current={stage === tab.stage ? "step" : undefined}>
            <span className="inline-flex items-center justify-center gap-1">{statuses[tab.stage] === "valid" ? <Check size={14} /> : statuses[tab.stage] === "invalid" || statuses[tab.stage] === "warning" ? <AlertTriangle size={14} /> : <Circle size={11} />}<span className="hidden sm:inline">{index + 1}. </span>{tab.label}</span>
          </button>
          {issueCounts[tab.stage] > 0 && <button type="button" aria-label={`查看${tab.label}问题`} onClick={() => onOpenIssues(tab.stage)} className={`mr-1 self-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${stage === tab.stage ? "bg-white/20 text-white" : "bg-rose-100 text-rose-700"}`}>{issueCounts[tab.stage]}</button>}
        </div>
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
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  // UI V3.1：Inspector 状态收敛为单一 overlay 状态（Touch/Desktop 统一 Overlay，不压缩 Canvas）。
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // UI V3.1（PRD 20）：Rail 分类导航的当前 Section。
  const [navigatorSection, setNavigatorSection] = useState<FloorNavigatorSection | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<FloorInspectorTab>("object");
  const [issueCenterOpen, setIssueCenterOpen] = useState(false);
  const [issueStageFilter, setIssueStageFilter] = useState<FloorWorkflowStage | null>(null);
  const [bomFilter, setBomFilter] = useState<"all" | "bottom" | "top" | "through">("all");
  const [canvasZoomPercent, setCanvasZoomPercent] = useState(100);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // UI V5+ 工程文件：工程名称、新建/导入 Dialog 与状态栏闪示。
  const [projectName, setProjectName] = useState(FLOOR_DEFAULT_PROJECT_NAME);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [importDialog, setImportDialog] = useState<{ open: boolean; fileName: string; project: ParsedFloorProject | null; errorMessage: string | null }>({ open: false, fileName: "", project: null, errorMessage: null });
  const [statusFlash, setStatusFlash] = useState<string | null>(null);
  const statusFlashTimerRef = useRef<number | null>(null);
  const [highlightedRoleDomainId, setHighlightedRoleDomainId] = useState<string | null>(null);
  const [canvasFocusRequest, setCanvasFocusRequest] = useState<{ id: number; mode: "floor" | "selection" | "domain" } | null>(null);
  const [editMode, setEditMode] = useState<"move" | "dock" | "multi">("move");
  const [dockSourceId, setDockSourceId] = useState<string | null>(null);
  const [dockTargetId, setDockTargetId] = useState<string | null>(null);
  const [dockHoverDirection, setDockHoverDirection] = useState<FloorDockDirection | null>(null);
  const [dockPinned, setDockPinned] = useState(false);
  const [dockAlignment, setDockAlignment] = useState<FloorDockAlignment>("preserve");
  const [multiSelection, setMultiSelection] = useState<Set<string>>(new Set());
  const [multiAlignKind, setMultiAlignKind] = useState<FloorMultiAlignKind | null>(null);
  const [workspaceFullscreen, setWorkspaceFullscreen] = useState(false);
  const [history, setHistory] = useState<FloorHistoryState<FloorPlanState>>(() => createFloorHistory(cloneDefaultState()));
  const stateRef = useRef<FloorPlanState>(cloneDefaultState());
  stateRef.current = state;
  const profile = useFloorWorkspaceProfile();
  const touchInput = profile.input === "touch";

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
          setHistory(createFloorHistory(record.state));
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
    // V4不再持久化Workspace UI；仅一次性兼容V3.1遗留偏好，后续刷新不会回写。
    if (window.innerWidth >= 1280 && window.localStorage.getItem("floorNavigatorCollapsed") === "false") setNavigatorOpen(true);
    if (window.innerWidth >= 640 && window.localStorage.getItem("floorWorkspaceInspectorOpen") === "true") setInspectorOpen(true);
    // UI V5：Wide（≥1600px）首访默认 Inspector Dock 展开。
    if (window.innerWidth >= 1600 && window.localStorage.getItem("floorWorkspaceInspectorOpen") === null) setInspectorOpen(true);
    // UI V5+ 工程名称：独立 project-meta 存储；损坏的 meta 不影响 Floor Workspace。
    try {
      const metaRaw = window.localStorage.getItem(FLOOR_PROJECT_META_KEY);
      if (metaRaw) {
        const projectMeta = parseFloorProjectMetaRecord(JSON.parse(metaRaw));
        if (projectMeta) setProjectName(projectMeta.projectName);
      }
    } catch {
      setProjectName(FLOOR_DEFAULT_PROJECT_NAME);
    }
  }, []);

  const toleranceResult = useMemo(() => resolveFloorGeometryTolerance(state), [state]);
  const canonicalPlan = toleranceResult.plan;
  const roleDomains = useMemo(() => buildFloorRebarRoleDomains(canonicalPlan), [canonicalPlan]);

  useEffect(() => {
    if (!hydrated || dragActive) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(FLOOR_DRAFT_KEY, JSON.stringify(createFloorDraftRecord(toleranceResult.plan)));
      setDraftSavedAt(Date.now());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [dragActive, hydrated, toleranceResult]);

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

  const atomic = useMemo(() => buildFloorAtomicBoundarySegments(canonicalPlan), [canonicalPlan]);
  const issues = useMemo(() => validateFloorPlanV2(canonicalPlan), [canonicalPlan]);
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const rawBottomCalculation = useMemo(
    () => calculateFloorBottomRebar(canonicalPlan, bottomState, roleState, bottomRoleReviewRequired),
    [bottomRoleReviewRequired, bottomState, canonicalPlan, roleState],
  );
  const bottomCalculation = useMemo(
    () => blockBottomForDrafts(rawBottomCalculation, invalidDrafts.size + invalidBottomDrafts.size),
    [invalidBottomDrafts.size, invalidDrafts.size, rawBottomCalculation],
  );
  const rawTopCalculation = useMemo(
    () => calculateFloorTopRebar(canonicalPlan, topState, roleState, topRoleReviewRequired),
    [canonicalPlan, roleState, topRoleReviewRequired, topState],
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
    plan: canonicalPlan,
    bottom: bottomCalculation,
    top: topCalculation,
    bottomRoleReviewRequired,
    topRoleReviewRequired,
    invalidDraftCount: invalidDrafts.size + invalidBottomDrafts.size + invalidTopDrafts.size,
  }), [bottomCalculation, bottomRoleReviewRequired, canonicalPlan, invalidBottomDrafts.size, invalidDrafts.size, invalidTopDrafts.size, topCalculation, topRoleReviewRequired]);
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
    const geometry = resolveFloorTopThroughPathGeometry(canonicalPlan, path);
    const pathErrors = topCalculation.errors.filter((issue) => issue.code.startsWith("through-") && (issue.objectIds?.includes(path.id) || issue.message.includes(path.name)));
    const names = geometry.orderedSlabIds.map((id) => canonicalPlan.slabs.find((slab) => slab.id === id)?.name ?? id);
    const hasWarning = path.slabIds.some((id) => issues.some((issue) => issue.level === "warning" && WORKSPACE_NAV_WARNING_CODES.has(issue.code) && issue.objectIds?.includes(id)));
    return {
      id: path.id,
      name: path.name,
      detail: names.length > 0 ? names.join(" → ") : path.slabIds.map((id) => canonicalPlan.slabs.find((slab) => slab.id === id)?.name ?? id).join(" → ") || "尚未选择板区",
      status: !path.enabled ? "disabled" : pathErrors.length > 0 || geometry.errors.length > 0 ? "invalid" : hasWarning ? "warning" : "valid",
    };
  }), [canonicalPlan, issues, topCalculation.errors, topState.throughPaths]);
  const workflowStatuses: Record<FloorWorkflowStage, FloorWorkflowStatus> = {
    plan: errors.length > 0 || invalidDrafts.size > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    bottom: bottomCalculation.isValid && !bottomRoleReviewRequired && invalidDrafts.size + invalidBottomDrafts.size === 0 ? "valid" : "invalid",
    top: topCalculation.isValid && !topRoleReviewRequired && invalidDrafts.size + invalidTopDrafts.size === 0 ? "valid" : "invalid",
    bom: printEligibility.eligible ? "valid" : "invalid",
  };
  const workspaceIssues = useMemo<FloorWorkspaceIssue[]>(() => {
    const result: FloorWorkspaceIssue[] = [];
    issues.forEach((issue, index) => result.push({
      id: `plan:${issue.code}:${index}`,
      code: issue.code,
      severity: issue.level,
      stage: "plan",
      title: issue.message,
      objectId: issue.objectIds?.find((id) => canonicalPlan.slabs.some((slab) => slab.id === id) || canonicalPlan.openings.some((opening) => opening.id === id)),
    }));
    bottomCalculation.errors.forEach((issue, index) => result.push({ id: `bottom:error:${issue.code}:${index}`, code: issue.code, severity: "error", stage: "bottom", title: issue.message, objectId: issue.objectIds?.find((id) => canonicalPlan.slabs.some((slab) => slab.id === id)), domainId: issue.objectIds?.find((id) => roleDomains.some((domain) => domain.id === id)) }));
    bottomCalculation.warnings.forEach((issue, index) => result.push({ id: `bottom:warning:${issue.code}:${index}`, code: issue.code, severity: "warning", stage: "bottom", title: issue.message, objectId: issue.objectIds?.find((id) => canonicalPlan.slabs.some((slab) => slab.id === id)), domainId: issue.objectIds?.find((id) => roleDomains.some((domain) => domain.id === id)) }));
    topCalculation.errors.forEach((issue, index) => result.push({ id: `top:error:${issue.code}:${index}`, code: issue.code, severity: "error", stage: "top", title: issue.message, objectId: issue.objectIds?.find((id) => canonicalPlan.slabs.some((slab) => slab.id === id)), domainId: issue.objectIds?.find((id) => roleDomains.some((domain) => domain.id === id)), throughPathId: issue.objectIds?.find((id) => topState.throughPaths.some((path) => path.id === id)) }));
    topCalculation.warnings.forEach((issue, index) => result.push({ id: `top:warning:${issue.code}:${index}`, code: issue.code, severity: "warning", stage: "top", title: issue.message, objectId: issue.objectIds?.find((id) => canonicalPlan.slabs.some((slab) => slab.id === id)), domainId: issue.objectIds?.find((id) => roleDomains.some((domain) => domain.id === id)), throughPathId: issue.objectIds?.find((id) => topState.throughPaths.some((path) => path.id === id)) }));
    if (invalidDrafts.size > 0) result.push({ id: "plan:invalid-drafts", code: "invalid-draft", severity: "error", stage: "plan", title: `有 ${invalidDrafts.size} 个几何数字输入为空或非法。` });
    if (invalidBottomDrafts.size > 0) result.push({ id: "bottom:invalid-drafts", code: "invalid-draft", severity: "error", stage: "bottom", title: `有 ${invalidBottomDrafts.size} 个地筋数字输入为空或非法。` });
    if (invalidTopDrafts.size > 0) result.push({ id: "top:invalid-drafts", code: "invalid-draft", severity: "error", stage: "top", title: `有 ${invalidTopDrafts.size} 个面筋数字输入为空或非法。` });
    return result;
  }, [bottomCalculation.errors, bottomCalculation.warnings, canonicalPlan.openings, canonicalPlan.slabs, invalidBottomDrafts.size, invalidDrafts.size, invalidTopDrafts.size, issues, roleDomains, topCalculation.errors, topCalculation.warnings, topState.throughPaths]);
  const workflowIssueCounts: Record<FloorWorkflowStage, number> = {
    plan: workspaceIssues.filter((issue) => issue.stage === "plan").length,
    bottom: workspaceIssues.filter((issue) => issue.stage === "bottom").length,
    top: workspaceIssues.filter((issue) => issue.stage === "top").length,
    bom: printEligibility.eligible ? 0 : printEligibility.errors.length,
  };

  const dockPreview: FloorDockPreview | null = useMemo(() => {
    if (!dockSourceId || !dockTargetId || !dockHoverDirection) return null;
    return previewFloorDock(state, {
      sourceSlabId: dockSourceId,
      targetSlabId: dockTargetId,
      direction: dockHoverDirection,
      alignment: dockAlignment,
    });
  }, [dockAlignment, dockHoverDirection, dockSourceId, dockTargetId, state]);
  const dockSourceSlab = state.slabs.find((slab) => slab.id === dockSourceId) ?? null;
  const dockTargetSlab = state.slabs.find((slab) => slab.id === dockTargetId) ?? null;
  const multiAlignPreview = useMemo(
    () => multiAlignKind ? previewFloorMultiAlign(state, [...multiSelection], multiAlignKind) : null,
    [multiAlignKind, multiSelection, state],
  );
  const dockSuggestions = useMemo(() => suggestFloorDockFixes(canonicalPlan), [canonicalPlan]);
  const sideRelations = useMemo(
    () => selectedSlab ? describeFloorSlabSideRelations(canonicalPlan, selectedSlab.id) : [],
    [canonicalPlan, selectedSlab],
  );

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
    const next = resolveFloorGeometryTolerance({
      ...state,
      slabs: state.slabs.map((slab) => slab.id === selectedSlab.id ? { ...slab, ...patch } : slab),
    }).plan;
    applyStateWithHistory(next);
  };

  const updateOpening = (patch: Partial<FloorOpening>) => {
    if (!selectedOpening) return;
    const next = resolveFloorGeometryTolerance({
      ...state,
      openings: state.openings.map((opening) => opening.id === selectedOpening.id ? { ...opening, ...patch } : opening),
    }).plan;
    applyStateWithHistory(next);
  };

  const addSlab = () => {
    // 空白工程的第一个板区从原点创建，后续板区继续放在已有 bounds 右侧。
    const isFirstSlab = state.slabs.length === 0;
    const bounds = floorPlanBounds(state.slabs);
    const next: FloorSlab = { id: nextObjectId("slab"), name: nextAvailableFloorName(state.slabs.map((slab) => slab.name), "板区"), type: "room", x: isFirstSlab ? 0 : bounds.maxX, y: isFirstSlab ? 0 : bounds.minY, width: 3600, height: 3600 };
    applyStateWithHistory({ ...state, slabs: [...state.slabs, next] });
    setSelection({ kind: "slab", id: next.id });
    setSelectedBoundaryId(null);
    setActiveInspectorTab("object");
    setInspectorOpen(true);
  };

  const addOpening = () => {
    const host = selectedSlab ?? state.slabs[0];
    const width = host ? Math.min(2400, Math.max(600, host.width / 2)) : 2400;
    const height = host ? Math.min(2400, Math.max(600, host.height / 2)) : 2400;
    const next: FloorOpening = {
      id: nextObjectId("opening"), name: nextAvailableFloorName(state.openings.map((opening) => opening.name), "洞口"), type: "stair",
      x: host ? host.x + (host.width - width) / 2 : 0, y: host ? host.y + (host.height - height) / 2 : 0, width, height,
    };
    applyStateWithHistory({ ...state, openings: [...state.openings, next] });
    setSelection({ kind: "opening", id: next.id });
    setSelectedBoundaryId(null);
    setActiveInspectorTab("object");
    setInspectorOpen(true);
  };

  const resetPlan = () => {
    if (!window.confirm("确定恢复Geometry V2默认数据吗？当前整层草稿将被替换。")) return;
    const next = cloneDefaultState();
    applyStateWithHistory(next);
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
      applyStateWithHistory({ ...state, slabs: [...state.slabs, next] });
      setSelection({ kind: "slab", id: next.id });
    } else if (selectedOpening) {
      const next = { ...selectedOpening, id: nextObjectId("opening"), name: nextAvailableFloorName(state.openings.map((opening) => opening.name), "洞口"), x: selectedOpening.x + state.snapDistanceMm, y: selectedOpening.y + state.snapDistanceMm };
      applyStateWithHistory({ ...state, openings: [...state.openings, next] });
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
    applyStateWithHistory({
      ...state,
      slabs: selection.kind === "slab" ? state.slabs.filter((slab) => slab.id !== selection.id) : state.slabs,
      openings: selection.kind === "opening" ? state.openings.filter((opening) => opening.id !== selection.id) : state.openings,
      supportRules: state.supportRules.filter((rule) => rule.target.kind === "slab-edge" ? rule.target.slabId !== selection.id : rule.target.openingId !== selection.id),
    });
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
    // PRD 40/41/43：拖动过程只更新Canvas本地预览，仅pointerup提交一次正式State。
    if (!finished) return;
    if (nextSelection.kind === "slab") {
      const object = state.slabs.find((slab) => slab.id === nextSelection.id);
      if (!object) return;
      const moved = { ...object, x, y };
      const finalObject = snapFloorSlab(moved, state.slabs.filter((slab) => slab.id !== object.id), state.snapDistanceMm);
      const next = { ...state, slabs: state.slabs.map((slab) => slab.id === object.id ? finalObject : slab) };
      applyStateWithHistory(resolveFloorGeometryTolerance(next).plan);
      return;
    }
    const object = state.openings.find((opening) => opening.id === nextSelection.id);
    if (!object) return;
    const moved = { ...object, x, y };
    const finalObject = snapFloorOpening(moved, state.slabs, state.openings.filter((opening) => opening.id !== object.id), state.snapDistanceMm);
    const next = { ...state, openings: state.openings.map((opening) => opening.id === object.id ? finalObject : opening) };
    applyStateWithHistory(resolveFloorGeometryTolerance(next).plan);
  };

  const setSegmentSupport = (segment: FloorAtomicBoundarySegment, target: FloorSupportRuleTarget, support: FloorSupportRule["support"]) => {
    const key = targetKey(target);
    const next = {
      ...state,
      // 同一Atomic Segment可能同时由A东侧和B西侧稳定target描述。
      // UI写入时清除两侧所有重叠规则，避免制造互相冲突的双边状态。
      supportRules: replaceFloorSupportRuleForAtomicSegment(state, segment, {
        id: `support:${key}`,
        target: structuredClone(target),
        support,
      }),
    };
    applyStateWithHistory(next);
    setSelectedBoundaryId(segment.id);
  };

  const applyQuickDock = (request: FloorDockRequest, x: number, y: number) => {
    // PRD 19-23：Quick Dock直接复用floor-docking；源板先放到拖动位置再拼接（preserve），
    // 不再经过普通Snap；与第三板区冲突时整次操作不提交（PRD 74）。
    const source = state.slabs.find((slab) => slab.id === request.sourceSlabId);
    if (!source) return;
    const positioned = {
      ...state,
      slabs: state.slabs.map((slab) => slab.id === source.id ? { ...slab, x, y } : slab),
    };
    const next = applyFloorDock(positioned, request);
    if (next === positioned) return;
    applyStateWithHistory(next);
  };

  const commitHistory = (next: FloorPlanState) => {
    setHistory((current) => pushFloorHistory({ ...current, present: stateRef.current }, next));
  };

  const applyStateWithHistory = (next: FloorPlanState) => {
    commitHistory(next);
    setState(next);
  };

  /** PRD 28：Undo/Redo 恢复 Selection 时 kind 必须与对象类型一致。 */
  const restoreHistorySelection = (value: FloorPlanState) => {
    const slab = value.slabs[0];
    if (slab) { setSelection({ kind: "slab", id: slab.id }); return; }
    const opening = value.openings[0];
    if (opening) { setSelection({ kind: "opening", id: opening.id }); return; }
    setSelection(null);
  };

  const undoHistory = () => {
    if (history.past.length === 0) return;
    const result = undoFloorHistory({ ...history, present: stateRef.current });
    setState(result.value);
    setHistory(result.history);
    restoreHistorySelection(result.value);
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
  };

  const redoHistory = () => {
    if (history.future.length === 0) return;
    const result = redoFloorHistory({ ...history, present: stateRef.current });
    setState(result.value);
    setHistory(result.history);
    restoreHistorySelection(result.value);
    setSelectedBoundaryId(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoHistory();
        else undoHistory();
      } else if (event.key === "Delete") {
        if (selection) {
          event.preventDefault();
          deleteSelected();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (issueCenterOpen) { setIssueCenterOpen(false); return; }
        if (inspectorOpen) { closeInspector(); return; }
        if (navigatorOpen) { closeNavigatorOverlay(); return; }
        if (editMode === "dock" && (dockSourceId || dockTargetId || dockPinned)) { cancelDock(); return; }
        if (editMode === "multi" && (multiSelection.size > 0 || multiAlignKind)) { setMultiSelection(new Set()); setMultiAlignKind(null); return; }
        if (workspaceFullscreen) { setWorkspaceFullscreen(false); return; }
        if (selection) { setSelection(null); setSelectedBoundaryId(null); }
      } else if (event.key === "Enter") {
        if (editMode === "dock" && dockPinned && dockPreview?.valid) { event.preventDefault(); confirmDock(); }
        else if (editMode === "multi" && multiAlignPreview?.valid) { event.preventDefault(); confirmMultiAlign(); }
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setCanvasFocusRequest({ id: Date.now(), mode: event.shiftKey && selection ? "selection" : "floor" });
      } else if (stage === "plan" && ["v", "d", "m"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        changeEditMode(event.key.toLowerCase() === "d" ? "dock" : event.key.toLowerCase() === "m" ? "multi" : "move");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, selection, state, issueCenterOpen, inspectorOpen, navigatorOpen, editMode, dockSourceId, dockTargetId, dockPinned, dockPreview, multiSelection, multiAlignKind, multiAlignPreview, workspaceFullscreen, stage]);

  const changeEditMode = (mode: "move" | "dock" | "multi") => {
    setEditMode(mode);
    setDockSourceId(null);
    setDockTargetId(null);
    setDockHoverDirection(null);
    setDockPinned(false);
    setMultiSelection(new Set());
    setMultiAlignKind(null);
  };

  // UI V3.1：Inspector/Navigator 全部经 helper 收敛，禁止散落 setInspectorOpen 等。
  const openInspector = () => setInspectorOpen(true);
  const closeInspector = () => setInspectorOpen(false);
  const openNavigatorOverlay = (section: FloorNavigatorSection | null = null) => {
    setNavigatorSection(section);
    setNavigatorOpen(true);
  };
  const closeNavigatorOverlay = () => setNavigatorOpen(false);
  const requestCanvasFocus = (mode: "floor" | "selection" | "domain") => {
    setCanvasFocusRequest({ id: Date.now(), mode });
  };

  // —— UI V5+ 工程文件：统一数据应用入口（新建与导入共用，防 Autosave Race） ——
  const persistFloorProjectSnapshot = (plan: FloorPlanState, bottom: FloorBottomState, top: FloorTopState, role: FloorRebarRoleState, bottomReview: boolean, topReview: boolean, name: string) => {
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(FLOOR_DRAFT_KEY, JSON.stringify(createFloorDraftRecord(plan, savedAt)));
    window.localStorage.setItem(FLOOR_BOTTOM_STORAGE_KEY, JSON.stringify(createFloorBottomStoredRecord(bottom, savedAt, bottomReview)));
    window.localStorage.setItem(FLOOR_TOP_STORAGE_KEY, JSON.stringify(createFloorTopStoredRecord(top, savedAt, topReview)));
    window.localStorage.setItem(FLOOR_REBAR_ROLE_STORAGE_KEY, JSON.stringify(createFloorRebarRoleStoredRecord(role, savedAt)));
    window.localStorage.setItem(FLOOR_PROJECT_META_KEY, JSON.stringify(createFloorProjectMetaRecord(name)));
  };

  const flashStatus = (message: string) => {
    setStatusFlash(message);
    if (statusFlashTimerRef.current !== null) window.clearTimeout(statusFlashTimerRef.current);
    statusFlashTimerRef.current = window.setTimeout(() => setStatusFlash(null), 4000);
  };

  const applyFloorProject = (imported: ParsedFloorProject, name: string, flash: string) => {
    persistFloorProjectSnapshot(
      imported.planState,
      imported.bottomState,
      imported.topState,
      imported.roleState,
      imported.bottomRoleReviewRequired,
      imported.topRoleReviewRequired,
      name,
    );
    setState(imported.planState);
    setBottomState(imported.bottomState);
    setTopState(imported.topState);
    setRoleState(imported.roleState);
    setBottomRoleReviewRequired(imported.bottomRoleReviewRequired);
    setTopRoleReviewRequired(imported.topRoleReviewRequired);
    setProjectName(name);
    setHistory(createFloorHistory(imported.planState));
    const firstSlab = imported.planState.slabs[0];
    const firstOpening = imported.planState.openings[0];
    setSelection(firstSlab ? { kind: "slab", id: firstSlab.id } : firstOpening ? { kind: "opening", id: firstOpening.id } : null);
    setStage("plan");
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(null);
    setInvalidDrafts(new Set());
    setInvalidBottomDrafts(new Set());
    setInvalidTopDrafts(new Set());
    setMultiSelection(new Set());
    setMultiAlignKind(null);
    setDockSourceId(null);
    setDockTargetId(null);
    setDockHoverDirection(null);
    setDockPinned(false);
    setDockAlignment("preserve");
    changeEditMode("move");
    setNavigatorSection(null);
    setNavigatorOpen(false);
    setIssueCenterOpen(false);
    setIssueStageFilter(null);
    setInspectorOpen(false);
    setBomFilter("all");
    setActiveInspectorTab("object");
    requestCanvasFocus("floor");
    flashStatus(flash);
  };

  const handleNewFloorProject = (name: string, mode: FloorNewProjectMode) => {
    const plan = mode === "blank" ? createBlankFloorPlanState() : structuredClone(DEFAULT_FLOOR_PLAN_STATE);
    setNewProjectOpen(false);
    applyFloorProject(
      {
        projectName: name,
        planState: plan,
        bottomState: cloneDefaultBottomState(),
        topState: cloneDefaultTopState(),
        roleState: cloneDefaultRoleState(),
        bottomRoleReviewRequired: false,
        topRoleReviewRequired: false,
        legacy: false,
      },
      name,
      `✓ 已新建：${name}`,
    );
  };

  const handleExportFloorProject = () => {
    // 导出必须使用几何容差纠偏后的 canonical Plan，与正式计算及 Floor Draft 自动保存语义一致。
    const project = createFloorProjectFile({
      projectName,
      plan: canonicalPlan,
      bottom: bottomState,
      top: topState,
      role: roleState,
      bottomRoleReviewRequired,
      topRoleReviewRequired,
    });
    const blob = new Blob([serializeFloorProjectFile(project)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = floorProjectFileName(projectName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashStatus("✓ 楼板数据已导出");
  };

  const handleImportFile = async (file: File) => {
    if (file.size > FLOOR_PROJECT_FILE_MAX_BYTES) {
      setImportDialog({ open: true, fileName: file.name, project: null, errorMessage: "文件过大，无法导入。" });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportDialog({ open: true, fileName: file.name, project: null, errorMessage: "无法读取文件：读取失败。" });
      return;
    }
    const result = parseFloorProjectFile(text);
    if (!result.ok) {
      setImportDialog({ open: true, fileName: file.name, project: null, errorMessage: FLOOR_PROJECT_PARSE_ERROR_MESSAGES[result.error] });
      return;
    }
    setImportDialog({ open: true, fileName: file.name, project: result.project, errorMessage: null });
  };

  const confirmImportProject = () => {
    if (!importDialog.project) return;
    const imported = importDialog.project;
    setImportDialog({ open: false, fileName: "", project: null, errorMessage: null });
    applyFloorProject(imported, imported.projectName, `✓ 已导入：${imported.projectName}`);
  };

  const handleDockPick = (slabId: string) => {
    setDockPinned(false);
    if (!dockSourceId) {
      setDockSourceId(slabId);
      setDockTargetId(null);
      setDockHoverDirection(null);
      return;
    }
    if (slabId === dockSourceId) {
      setDockSourceId(null);
      setDockTargetId(null);
      setDockHoverDirection(null);
      return;
    }
    setDockTargetId(slabId);
    setDockHoverDirection(null);
  };

  const handleDockHover = (direction: FloorDockDirection | null) => {
    if (dockPinned) return;
    setDockHoverDirection(direction);
  };

  const pinDockDirection = (direction: FloorDockDirection) => {
    setDockHoverDirection(direction);
    setDockPinned(true);
  };

  const cancelDock = () => {
    setDockSourceId(null);
    setDockTargetId(null);
    setDockHoverDirection(null);
    setDockPinned(false);
    setDockAlignment("preserve");
  };

  const confirmDock = () => {
    if (!dockSourceId || !dockTargetId || !dockHoverDirection || !dockPreview?.valid) return;
    const request = {
      sourceSlabId: dockSourceId,
      targetSlabId: dockTargetId,
      direction: dockHoverDirection,
      alignment: dockAlignment,
    };
    applyStateWithHistory(applyFloorDock(state, request));
    setDockSourceId(null);
    setDockTargetId(null);
    setDockHoverDirection(null);
    setDockPinned(false);
    setDockAlignment("preserve");
  };

  const applyDockSuggestion = (suggestion: FloorDockSuggestion) => {
    applyStateWithHistory(applyFloorDock(state, {
      sourceSlabId: suggestion.sourceSlabId,
      targetSlabId: suggestion.targetSlabId,
      direction: suggestion.direction,
      alignment: suggestion.alignment,
    }));
    if (editMode !== "move") changeEditMode("move");
  };

  const toggleMultiSelect = (slabId: string) => {
    setMultiSelection((current) => {
      const next = new Set(current);
      if (next.has(slabId)) next.delete(slabId);
      else next.add(slabId);
      return next;
    });
    setMultiAlignKind(null);
  };

  const confirmMultiAlign = () => {
    if (!multiAlignKind || !multiAlignPreview?.valid) return;
    applyStateWithHistory(applyFloorMultiAlign(state, [...multiSelection], multiAlignKind));
    setMultiSelection(new Set());
    setMultiAlignKind(null);
  };

  const selectAtomicBoundary = (segment: FloorAtomicBoundarySegment) => {
    setSelectedBoundaryId(segment.id);
    if (segment.openingId) setSelection({ kind: "opening", id: segment.openingId });
    else if (segment.slabIds[0]) setSelection({ kind: "slab", id: segment.slabIds[0] });
    setActiveInspectorTab("boundary");
    openInspector();
  };

  const changeStage = (nextStage: FloorWorkflowStage) => {
    setStage(nextStage);
    if (touchInput || profile.viewport === "phone" || profile.viewport === "tablet") setNavigatorOpen(false);
    // UI V3.1：切换阶段保持 Inspector 打开状态，不打断编辑连续性。
    setHighlightedRoleDomainId(null);
    if (nextStage !== "top") setSelectedThroughPathId(null);
    setActiveInspectorTab(nextStage === "plan" ? "object" : nextStage === "bottom" || nextStage === "top" ? "defaults" : "object");
  };

  const selectWorkspaceObject = (nextSelection: Exclude<FloorSelection, null>) => {
    setSelection(nextSelection);
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(null);
    requestCanvasFocus("selection");
    if (stage === "plan") setActiveInspectorTab("object");
    if (touchInput || profile.viewport === "phone" || profile.viewport === "tablet") setNavigatorOpen(false);
  };

  const selectRoleItem = (item: FloorWorkspaceRoleItem) => {
    const slab = state.slabs.find((candidate) => item.slabIds.includes(candidate.id));
    if (slab) setSelection({ kind: "slab", id: slab.id });
    setSelectedBoundaryId(null);
    setSelectedThroughPathId(null);
    setHighlightedRoleDomainId(item.id);
    requestCanvasFocus("domain");
    setActiveInspectorTab("role");
    if (touchInput || profile.viewport === "phone" || profile.viewport === "tablet") setNavigatorOpen(false);
    openInspector();
  };

  const selectThroughPath = (id: string) => {
    setSelectedThroughPathId(id);
    setHighlightedRoleDomainId(null);
    if (touchInput || profile.viewport === "phone" || profile.viewport === "tablet") setNavigatorOpen(false);
    setActiveInspectorTab("through");
    openInspector();
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
    setActiveInspectorTab("through");
    if (touchInput || profile.viewport === "phone" || profile.viewport === "tablet") setNavigatorOpen(false);
    openInspector();
  };

  const openIssueCenter = (filter: FloorWorkflowStage | null = null) => {
    setIssueStageFilter(filter);
    setIssueCenterOpen(true);
  };

  const locateWorkspaceIssue = (issue: FloorWorkspaceIssue) => {
    changeStage(issue.stage);
    if (issue.throughPathId) {
      setSelectedThroughPathId(issue.throughPathId);
      setActiveInspectorTab("through");
    } else if (issue.domainId) {
      const domain = roleDomains.find((candidate) => candidate.id === issue.domainId);
      const slabId = domain?.slabIds[0];
      if (slabId) setSelection({ kind: "slab", id: slabId });
      setHighlightedRoleDomainId(issue.domainId);
      setActiveInspectorTab("role");
      requestCanvasFocus("domain");
    } else if (issue.objectId) {
      const nextSelection: Exclude<FloorSelection, null> = canonicalPlan.openings.some((opening) => opening.id === issue.objectId)
        ? { kind: "opening", id: issue.objectId }
        : { kind: "slab", id: issue.objectId };
      setSelection(nextSelection);
      setActiveInspectorTab("diagnostics");
      requestCanvasFocus("selection");
    } else {
      setActiveInspectorTab("diagnostics");
      requestCanvasFocus("floor");
    }
    setIssueCenterOpen(false);
    openInspector();
  };

  useEffect(() => {
    if (stage !== "top" || !selectedThroughPathId) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-through-path-id="${selectedThroughPathId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [selectedThroughPathId, stage]);

  if (!hydrated) return <main className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 text-sm text-slate-500">正在迁移并恢复整层几何草稿…</main>;

  const field = (key: string, label: string, value: number, onChange: (value: number) => void, min?: number, max?: number) => (
    <DraftNumberField key={`${inputRevision}:${key}`} fieldKey={key} label={label} value={value} onChange={onChange} onValidityChange={setDraftValidity} min={min} max={max} />
  );
  const selectedThroughPath = selectedThroughPathId
    ? topState.throughPaths.find((path) => path.id === selectedThroughPathId) ?? null
    : null;
  const inspectorTabs: FloorWorkspaceInspectorTab[] = stage === "plan"
    ? [{ id: "object", label: "属性" }, { id: "boundary", label: "边界" }, { id: "diagnostics", label: "诊断" }]
    : stage === "bottom"
      ? [{ id: "defaults", label: "规格" }, { id: "role", label: "主副筋" }, { id: "diagnostics", label: "诊断" }]
      : [{ id: "defaults", label: "规格" }, { id: "role", label: "主副筋" }, { id: "through", label: "通墙" }, { id: "diagnostics", label: "诊断" }];
  const effectiveInspectorTab = inspectorTabs.some((tab) => tab.id === activeInspectorTab) ? activeInspectorTab : inspectorTabs[0].id;
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
  const inspectorBreadcrumb = selectedBoundaryId
    ? `${selectedSlab?.name ?? selectedOpening?.name ?? "对象"} > Atomic ${selectedBoundaryId}`
    : highlightedRoleDomainId
      ? `${stage === "top" ? "面筋" : "地筋"} > ${roleItems.find((item) => item.id === highlightedRoleDomainId)?.label ?? highlightedRoleDomainId}`
      : selectedThroughPath
        ? `面筋 > ${selectedThroughPath.name}`
        : `${stage === "plan" ? "楼层" : stage === "bottom" ? "地筋" : "面筋"} > ${inspectorTitle}`;
  const stageIssues = workspaceIssues.filter((issue) => issue.stage === stage);
  const diagnosticsContent = (
    <div className="space-y-2" data-testid="inspector-diagnostics">
      {stageIssues.length === 0 ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">当前阶段没有需要处理的问题。</p> : stageIssues.map((issue) => (
        <button key={issue.id} type="button" onClick={() => locateWorkspaceIssue(issue)} className={`block min-h-11 w-full border-b px-1 py-3 text-left ${issue.severity === "error" ? "border-rose-100" : "border-amber-100"}`}>
          <strong className={issue.severity === "error" ? "text-sm text-rose-800" : "text-sm text-amber-800"}>{issue.title}</strong>
          <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">{issue.code} · 点击定位</span>
        </button>
      ))}
      {stage === "plan" && dockSuggestions.length > 0 && <section className="border-t border-slate-200 pt-3"><h3 className="text-xs font-bold text-slate-700">可用几何修复</h3><div className="mt-2 space-y-2">{dockSuggestions.map((suggestion) => <button key={`${suggestion.kind}:${suggestion.sourceSlabId}:${suggestion.direction}`} type="button" onClick={() => applyDockSuggestion(suggestion)} className="min-h-10 w-full rounded-lg border border-orange-300 bg-white px-3 text-left text-xs font-semibold text-orange-700" data-testid="dock-suggestion-button">{suggestion.label}</button>)}</div></section>}
    </div>
  );

  const planObjectContent = !selection ? (
    <p className="text-sm text-slate-500">请从对象浏览器或Canvas选择板区/洞口。</p>
  ) : (
    <div className="space-y-5">
      {selectedSlab ? (
        <section className="space-y-4" data-testid="floor-size-editor">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2"><Grid2X2 size={17} className="text-blue-600" /><h3 className="text-sm font-semibold text-slate-900">板区属性</h3></div>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区名称</span><input value={selectedSlab.name} onChange={(event) => updateSlab({ name: event.target.value })} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">板区类型</span><select value={selectedSlab.type} onChange={(event) => updateSlab({ type: event.target.value as FloorSlabType })} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{SLAB_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">{field(`${selectedSlab.id}:x`, "西南角 X", selectedSlab.x, (value) => updateSlab({ x: value }))}{field(`${selectedSlab.id}:y`, "西南角 Y", selectedSlab.y, (value) => updateSlab({ y: value }))}{field(`${selectedSlab.id}:w`, "东西向净尺寸", selectedSlab.width, (value) => updateSlab({ width: value }), 1)}{field(`${selectedSlab.id}:h`, "南北向净尺寸", selectedSlab.height, (value) => updateSlab({ height: value }), 1)}</div>
          <section className="border-t border-slate-200 pt-3"><h3 className="text-xs font-bold text-slate-700">位置关系</h3><div className="mt-2 space-y-1">{sideRelations.map((relation) => <div key={relation.side} className="flex min-h-10 items-center justify-between gap-2 border-b border-slate-100 px-1 text-xs"><span><strong>{relation.side === "west" ? "西侧" : relation.side === "east" ? "东侧" : relation.side === "south" ? "南侧" : "北侧"}</strong> · {relation.label}</span>{relation.otherSlabId && <button type="button" onClick={() => { changeEditMode("dock"); setDockSourceId(selectedSlab.id); setDockTargetId(relation.otherSlabId); }} className="min-h-9 rounded-lg border border-orange-300 px-2 font-semibold text-orange-700">拼接</button>}</div>)}</div></section>
        </section>
      ) : selectedOpening ? (
        <section className="space-y-4" data-testid="floor-size-editor">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2"><DoorOpen size={17} className="text-rose-600" /><h3 className="text-sm font-semibold text-slate-900">洞口属性</h3></div>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口名称</span><input value={selectedOpening.name} onChange={(event) => updateOpening({ name: event.target.value })} className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">洞口类型</span><select value={selectedOpening.type} onChange={(event) => updateOpening({ type: event.target.value as FloorOpeningType })} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{OPENING_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">{field(`${selectedOpening.id}:x`, "西南角 X", selectedOpening.x, (value) => updateOpening({ x: value }))}{field(`${selectedOpening.id}:y`, "西南角 Y", selectedOpening.y, (value) => updateOpening({ y: value }))}{field(`${selectedOpening.id}:w`, "东西向尺寸", selectedOpening.width, (value) => updateOpening({ width: value }), 1)}{field(`${selectedOpening.id}:h`, "南北向尺寸", selectedOpening.height, (value) => updateOpening({ height: value }), 1)}</div>
        </section>
      ) : null}
      <section className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">楼层设置</h3>
        {field("inner-wall", "内墙厚度", state.innerWallThickness, (value) => setState((current) => ({ ...current, innerWallThickness: value })), 1)}
        {field("outer-wall", "外墙厚度", state.outerWallThickness, (value) => setState((current) => ({ ...current, outerWallThickness: value })), 1)}
        {field("snap", "自动吸附距离", state.snapDistanceMm, (value) => setState((current) => ({ ...current, snapDistanceMm: value })), 0)}
        {field("overlap-tolerance", "几何对齐容差", state.overlapToleranceMm, (value) => setState((current) => ({ ...current, overlapToleranceMm: value })), 0, 30)}
        <button type="button" onClick={resetPlan} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700"><RotateCcw size={16} />重置平面</button>
      </section>
    </div>
  );

  const inspectorContent = stage === "plan" ? (
    effectiveInspectorTab === "diagnostics" ? diagnosticsContent : effectiveInspectorTab === "boundary" ? (
      selection ? <BoundaryPanel compact state={state} selection={selection} segments={selectedSegments} selectedBoundaryId={selectedBoundaryId} onSelectBoundary={setSelectedBoundaryId} onSetSupport={setSegmentSupport} /> : <p className="text-sm text-slate-500">请先选择板区或洞口。</p>
    ) : planObjectContent
  ) : selection?.kind === "opening" ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">洞口不设置普通{stage === "bottom" ? "地筋" : "面筋"}规格。<button type="button" onClick={() => changeStage("plan")} className="mt-3 block min-h-11 w-full rounded-lg border border-amber-300 bg-white font-semibold">返回楼层编辑洞口</button></div>
  ) : effectiveInspectorTab === "diagnostics" ? diagnosticsContent : stage === "bottom" ? (
    <div className="space-y-5">
      {effectiveInspectorTab === "role" ? <FloorBottomSettingsPanel plan={state} bottom={bottomState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={bottomRoleReviewRequired} onChange={setBottomState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setBottomRoleReviewRequired(false)} onValidityChange={setBottomDraftValidity} section="role" /> : <><FloorBottomSettingsPanel plan={state} bottom={bottomState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={bottomRoleReviewRequired} onChange={setBottomState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setBottomRoleReviewRequired(false)} onValidityChange={setBottomDraftValidity} section="defaults" /><section className="border-t border-slate-200 pt-4"><FloorBottomSettingsPanel plan={state} bottom={bottomState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={bottomRoleReviewRequired} onChange={setBottomState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setBottomRoleReviewRequired(false)} onValidityChange={setBottomDraftValidity} section="slab" /></section></>}
    </div>
  ) : (
    <div className="space-y-5">
      {effectiveInspectorTab === "role" ? <FloorTopSettingsPanel plan={state} top={topState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={topRoleReviewRequired} calculation={topCalculation} onChange={setTopState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setTopRoleReviewRequired(false)} onValidityChange={setTopDraftValidity} section="role" selectedThroughPathId={selectedThroughPathId} onSelectThroughPath={setSelectedThroughPathId} /> : effectiveInspectorTab === "through" ? <FloorTopSettingsPanel plan={state} top={topState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={topRoleReviewRequired} calculation={topCalculation} onChange={setTopState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setTopRoleReviewRequired(false)} onValidityChange={setTopDraftValidity} section="through" selectedThroughPathId={selectedThroughPathId} onSelectThroughPath={setSelectedThroughPathId} /> : <><FloorTopSettingsPanel plan={state} top={topState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={topRoleReviewRequired} calculation={topCalculation} onChange={setTopState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setTopRoleReviewRequired(false)} onValidityChange={setTopDraftValidity} section="defaults" selectedThroughPathId={selectedThroughPathId} onSelectThroughPath={setSelectedThroughPathId} /><section className="border-t border-slate-200 pt-4"><FloorTopSettingsPanel plan={state} top={topState} selectedSlab={selectedSlab} selectedRoleDomain={selectedRoleDomain} roleState={roleState} roleReviewRequired={topRoleReviewRequired} calculation={topCalculation} onChange={setTopState} onRoleStateChange={setRoleState} onConfirmRoleReview={() => setTopRoleReviewRequired(false)} onValidityChange={setTopDraftValidity} section="slab" selectedThroughPathId={selectedThroughPathId} onSelectThroughPath={setSelectedThroughPathId} /></section></>}
    </div>
  );

  // UI V5：Inspector 自带单层 Header（含关闭按钮），外层不再渲染「属性面板 + 关闭」。
  const inspectorWithClose = <FloorWorkspaceInspector title={inspectorTitle} subtitle={inspectorSubtitle} breadcrumb={inspectorBreadcrumb} tabs={inspectorTabs} activeTab={effectiveInspectorTab} onTabChange={setActiveInspectorTab} issueCount={inspectorIssueCount} onClose={closeInspector} closeAriaLabel={profile.viewport === "phone" ? "关闭" : "关闭参数面板"}>{inspectorContent}</FloorWorkspaceInspector>;


  // UI V3（PRD 47-57）：Dock确认与Multi对齐统一进入 Canvas 内部底部 Command Bar。
  const canvasCommandBar = stage === "plan" && editMode === "dock" && dockPinned && dockSourceSlab && dockTargetSlab && dockHoverDirection && dockPreview ? (
    <FloorCanvasCommandBar tone="dock" testId="dock-confirm-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-800">
          源板区：<strong>{dockSourceSlab.name}</strong>
          <span className="mx-1 text-slate-400">→</span>
          目标板区：<strong>{dockTargetSlab.name}</strong>
          <span className="mx-1 text-slate-400">·</span>
          方向：<strong>{floorDockDirectionLabel(dockHoverDirection)}</strong>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">对齐：</span>
          {FLOOR_DOCK_ALIGNMENTS.map((alignment) => (
            <button key={alignment} type="button" onClick={() => setDockAlignment(alignment)} aria-pressed={dockAlignment === alignment} className={`rounded-lg border px-2.5 text-xs font-medium ${touchInput ? "min-h-11" : "min-h-9"} ${dockAlignment === alignment ? "border-orange-500 bg-white text-orange-700" : "border-slate-300 bg-white text-slate-600"}`}>{floorDockAlignmentLabel(alignment)}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span>移动：X {formatMm(Math.abs(dockPreview.moveXmm))}mm · Y {formatMm(Math.abs(dockPreview.moveYmm))}mm</span>
        {Math.max(Math.abs(dockPreview.moveXmm), Math.abs(dockPreview.moveYmm)) <= state.overlapToleranceMm && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">微小位移，可直接确认</span>}
        {Math.max(Math.abs(dockPreview.moveXmm), Math.abs(dockPreview.moveYmm)) > state.snapDistanceMm && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">该操作将移动板区{formatMm(Math.max(Math.abs(dockPreview.moveXmm), Math.abs(dockPreview.moveYmm)))}mm</span>}
      </div>
      {dockPreview.valid ? (
        <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs leading-5 text-emerald-800">拼接后将形成精确 0mm 共享板边（Gap=0 / Overlap=0）。</p>
      ) : (
        <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs leading-5 text-rose-800">无法拼接：{dockSourceSlab.name}移动到{dockTargetSlab.name}{floorDockDirectionLabel(dockHoverDirection)}后，将与{new Intl.ListFormat("zh-CN").format(dockPreview.conflicts)}发生面积重叠。</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={cancelDock} className={`rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 ${touchInput ? "min-h-11" : "min-h-10"}`}>取消</button>
        <button type="button" onClick={confirmDock} disabled={!dockPreview.valid} className={`rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white disabled:opacity-40 ${touchInput ? "min-h-11" : "min-h-10"}`}>确认拼接</button>
      </div>
    </FloorCanvasCommandBar>
  ) : stage === "plan" && editMode === "multi" && multiSelection.size >= 2 ? (
    <FloorCanvasCommandBar tone="multi" testId="multi-align-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">对齐 {multiSelection.size} 个板区：</span>
        {(["left", "right", "top", "bottom"] as FloorMultiAlignKind[]).map((kind) => (
          <button key={kind} type="button" onClick={() => setMultiAlignKind(kind)} aria-pressed={multiAlignKind === kind} className={`rounded-xl border px-3 text-xs font-semibold ${touchInput ? "min-h-11" : "min-h-10"} ${multiAlignKind === kind ? "border-violet-500 bg-white text-violet-700" : "border-slate-300 bg-white text-slate-700"}`}>{kind === "left" ? "左对齐" : kind === "right" ? "右对齐" : kind === "top" ? "上对齐" : "下对齐"}</button>
        ))}
      </div>
      {multiAlignPreview && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          {multiAlignPreview.valid ? (
            <p className="text-xs text-slate-700">将移动 {multiAlignPreview.movedSlabCount} 个板区，最大位移：{formatMm(multiAlignPreview.maxMoveMm)}mm</p>
          ) : (
            <p className="text-xs text-rose-700">对齐后{new Intl.ListFormat("zh-CN").format(multiAlignPreview.conflicts)}将发生面积重叠，禁止执行。</p>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setMultiAlignKind(null)} className={`rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 ${touchInput ? "min-h-11" : "min-h-9"}`}>取消</button>
            <button type="button" onClick={confirmMultiAlign} disabled={!multiAlignPreview.valid} className={`rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40 ${touchInput ? "min-h-11" : "min-h-9"}`}>确认对齐</button>
          </div>
        </div>
      )}
    </FloorCanvasCommandBar>
  ) : null;

  const canvasElement = (
    <FloorCanvas
      state={canonicalPlan}
      selection={selection}
      selectedBoundaryId={selectedBoundaryId}
      onSelect={(next) => { setSelection(next); setSelectedBoundaryId(null); setSelectedThroughPathId(null); setHighlightedRoleDomainId(null); }}
      onSelectBoundary={selectAtomicBoundary}
      onMove={moveObject}
      onDragStateChange={setDragActive}
      onQuickDock={applyQuickDock}
      bottomCalculation={stage === "bottom" ? bottomCalculation : undefined}
      topCalculation={stage === "top" ? topCalculation : undefined}
      roleDomains={roleDomains}
      roleState={roleState}
      highlightedRoleDomainId={highlightedRoleDomainId}
      highlightedThroughPathId={selectedThroughPathId}
      initialFitMode={canvasFocusRequest?.mode}
      focusRequest={canvasFocusRequest}
      compactHeight={touchInput && profile.shortViewport}
      editMode={stage === "plan" ? editMode : "move"}
      onEditModeChange={changeEditMode}
      dockSourceId={dockSourceId}
      dockTargetId={dockTargetId}
      dockHoverDirection={dockHoverDirection}
      dockPreview={dockPreview}
      multiSelection={multiSelection}
      onDockPick={handleDockPick}
      onDockHoverDirection={handleDockHover}
      onDockConfirm={pinDockDirection}
      onMultiToggle={toggleMultiSelect}
      fullscreen={workspaceFullscreen}
      onToggleFullscreen={() => setWorkspaceFullscreen((value) => !value)}
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      onUndo={undoHistory}
      onRedo={redoHistory}
      inputProfile={profile.input}
      compactMode={profile.viewport === "phone"}
      commandBar={canvasCommandBar}
      onZoomChange={setCanvasZoomPercent}
    />
  );
  const overlayNavigator = <FloorWorkspaceNavigator activeSection={navigatorSection} stage={stage} plan={state} selection={selection} geometryIssues={issues} bottomOverrides={new Set(Object.keys(bottomState.slabOverrides))} topOverrides={new Set(Object.keys(topState.slabOverrides))} roleItems={roleItems} throughItems={throughItems} selectedThroughPathId={selectedThroughPathId} onSelect={selectWorkspaceObject} onSelectRole={selectRoleItem} onSelectThrough={selectThroughPath} onAddSlab={addSlab} onAddOpening={addOpening} onDuplicate={duplicateSelected} onDelete={deleteSelected} onAddThrough={addThroughPath} />;
  // UI V5：布局只由 profile 决定。Desktop 52px Rail | Canvas（无 44px 列）；
  // Wide（≥1600px）真 Dock：Navigator 220-250 | Canvas 1fr | Inspector 340-380。
  // 注：wide 分支整体替换 grid-cols（Tailwind 自定义 breakpoint 排序不可靠，避免同元素双规则）。
  const wideInspectorDocked = !touchInput && profile.viewport === "wide" && inspectorOpen;
  const gridClass = touchInput
    ? ""
    : profile.viewport === "wide"
      ? wideInspectorDocked
        ? "xl:grid-cols-[minmax(220px,250px)_minmax(0,1fr)_minmax(340px,380px)]"
        : "xl:grid-cols-[minmax(220px,250px)_minmax(0,1fr)]"
      : "xl:grid-cols-[52px_minmax(0,1fr)]";
  const desktopNavigatorClass = touchInput ? "hidden" : "hidden xl:block xl:col-start-1";
  const canvasColumnClass = touchInput ? "relative min-w-0" : "relative min-w-0 xl:col-start-2";
  const useSheetNavigation = touchInput || profile.viewport === "phone" || profile.viewport === "tablet";
  const currentSelectionLabel = editMode === "dock" && dockSourceSlab
    ? `${dockSourceSlab.name}${dockTargetSlab ? ` → ${dockTargetSlab.name}` : " → 请选择目标"}`
    : editMode === "multi" && multiSelection.size > 0
      ? `已选 ${multiSelection.size} 个板区`
      : selectedThroughPath?.name ?? selectedSlab?.name ?? selectedOpening?.name ?? "未选择对象";
  const currentStageIssueCount = stage === "bom" ? printEligibility.errors.length : workspaceIssues.filter((issue) => issue.stage === stage).length;
  const commandModeLabel = stage !== "plan" ? (stage === "bottom" ? "地筋预览" : stage === "top" ? "面筋预览" : "正式结果") : editMode === "dock" ? "拼接" : editMode === "multi" ? "多选" : "移动";
  const statusDetail = stage === "plan"
    ? editMode === "dock" && dockHoverDirection
      ? `${floorDockDirectionLabel(dockHoverDirection)} · Gap ${dockPreview?.valid ? "0" : "--"}mm · Snap ${formatMm(state.snapDistanceMm)}mm`
      : `Snap ${formatMm(state.snapDistanceMm)}mm · ${state.slabs.length}板区 · ${state.openings.length}洞口`
    : stage === "bottom"
      ? `${bottomCalculation.totalPieces} Piece · ${bottomCalculation.totalLengthM.toFixed(3)}m`
      : stage === "top"
        ? `${topCalculation.totalPieces} Piece · Through ${topCalculation.throughPieceCount}`
        : `${bottomCalculation.totalPieces + topCalculation.totalPieces} Piece`;
  const paletteTitle = navigatorSection ? FLOOR_NAVIGATOR_SECTION_LABELS[navigatorSection] : stage === "plan" ? "对象浏览器" : stage === "bottom" ? "地筋对象" : "面筋对象";
  const filteredIssueCenterItems = issueStageFilter && issueStageFilter !== "bom" ? workspaceIssues.filter((issue) => issue.stage === issueStageFilter) : workspaceIssues;

  const workflow = (
    <div className="flex items-stretch bg-white" data-testid="floor-workflow-row">
      <div className="min-w-0 flex-1"><WorkflowTabs stage={stage} statuses={workflowStatuses} issueCounts={workflowIssueCounts} onChange={changeStage} onOpenIssues={(nextStage) => openIssueCenter(nextStage)} /></div>
      {!touchInput && profile.viewport !== "phone" && <FloorProjectMenu projectName={projectName} onAction={(action) => { if (action === "new") setNewProjectOpen(true); else if (action === "export") handleExportFloorProject(); }} onImportFile={handleImportFile} />}
    </div>
  );
  const statusBar = <FloorWorkspaceStatusBar stage={stage} mode={commandModeLabel} selectionLabel={currentSelectionLabel} detail={statusDetail} issueCount={currentStageIssueCount} zoomPercent={canvasZoomPercent} saved={draftSavedAt !== null} flash={statusFlash} bottom={bottomCalculation} top={topCalculation} onOpenIssues={() => openIssueCenter(stage)} onOpenBom={() => { setBomFilter(stage === "top" ? "top" : "bottom"); changeStage("bom"); }} />;

  const workspaceBody = stage === "bom" ? (
    <div className="h-full overflow-y-auto bg-slate-100 p-3 sm:p-4" data-testid="floor-bom-workspace">
      {state.slabs.length === 0 ? (
        <div className="mx-auto max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="floor-bom-empty"><p className="font-bold text-slate-900">尚未创建板区</p><p className="mt-1 text-xs text-slate-500">料单根据板区、地筋与面筋设置生成，请先创建板区。</p></div>
      ) : (
        <FloorBomPanel plan={state} bottom={bottomCalculation} top={topCalculation} bottomRoleReviewRequired={bottomRoleReviewRequired} topRoleReviewRequired={topRoleReviewRequired} invalidDraftCount={invalidDrafts.size + invalidBottomDrafts.size + invalidTopDrafts.size} initialFilter={bomFilter} />
      )}
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      {!workspaceFullscreen && <div className={`flex items-center gap-2 border-b border-slate-200 bg-white p-2 ${touchInput ? "" : "xl:hidden"}`}>
        {profile.viewport === "phone" && <FloorProjectMenu compact projectName={projectName} onAction={(action) => { if (action === "new") setNewProjectOpen(true); else if (action === "export") handleExportFloorProject(); }} onImportFile={handleImportFile} />}
        <button type="button" onClick={() => openNavigatorOverlay(null)} className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800"><Menu size={17} /><span className="min-w-0 flex-1 truncate">当前：{currentSelectionLabel}</span><ChevronRight size={16} /></button>
        <button type="button" aria-expanded={inspectorOpen} onClick={() => { if (inspectorOpen) closeInspector(); else openInspector(); }} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${inspectorOpen ? "border border-slate-300 bg-white text-slate-700" : "bg-blue-600 text-white"}`}><Settings2 size={17} />{profile.viewport === "phone" ? "编辑" : inspectorOpen ? "收起编辑" : "展开编辑"}</button>
      </div>}
      <div className={`relative grid min-h-0 min-w-0 flex-1 gap-2 bg-slate-100 p-2 ${workspaceFullscreen ? "h-full" : gridClass}`} data-testid="floor-workspace-grid">
        <aside className={`min-h-0 overflow-hidden border-r border-slate-200 bg-white ${desktopNavigatorClass} ${workspaceFullscreen ? "xl:hidden" : ""}`}>
          {/* UI V5：Wide（≥1600px）渲染完整 Navigator Dock；其余桌面渲染 52px Rail（JS 条件渲染避免重复 DOM）。 */}
          {!touchInput && profile.viewport === "wide" ? (
            <div className="h-full" data-testid="floor-wide-navigator">
              <FloorWorkspaceNavigator stage={stage} plan={state} selection={selection} geometryIssues={issues} bottomOverrides={new Set(Object.keys(bottomState.slabOverrides))} topOverrides={new Set(Object.keys(topState.slabOverrides))} roleItems={roleItems} throughItems={throughItems} selectedThroughPathId={selectedThroughPathId} onSelect={selectWorkspaceObject} onSelectRole={selectRoleItem} onSelectThrough={selectThroughPath} onAddSlab={addSlab} onAddOpening={addOpening} onDuplicate={duplicateSelected} onDelete={deleteSelected} onAddThrough={addThroughPath} />
            </div>
          ) : (
            <div className="h-full" data-testid="floor-desktop-rail">
              <FloorWorkspaceNavigator compact onOpenOverlay={openNavigatorOverlay} stage={stage} plan={state} selection={selection} geometryIssues={issues} bottomOverrides={new Set(Object.keys(bottomState.slabOverrides))} topOverrides={new Set(Object.keys(topState.slabOverrides))} roleItems={roleItems} throughItems={throughItems} selectedThroughPathId={selectedThroughPathId} onSelect={selectWorkspaceObject} onSelectRole={selectRoleItem} onSelectThrough={selectThroughPath} onAddSlab={addSlab} onAddOpening={addOpening} onDuplicate={duplicateSelected} onDelete={deleteSelected} onAddThrough={addThroughPath} />
            </div>
          )}
        </aside>
        <section className={`${canvasColumnClass} flex min-h-0 flex-col`} data-testid="floor-canvas-column">
          {/* UI V5+：空工程（0 板区）阶段提示，不制造 JS Exception。 */}
          {!workspaceFullscreen && state.slabs.length === 0 && stage !== "plan" && (
            <div className="mx-2 mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800" data-testid="floor-empty-stage-hint">请先创建板区，再设置{stage === "bottom" ? "地筋" : "面筋"}。</div>
          )}
          <div className="min-h-0 flex-1">
            {state.slabs.length === 0 && state.openings.length === 0 && stage === "plan" && !workspaceFullscreen ? (
              <div className="mx-2 flex h-[min(420px,58dvh)] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-300 bg-white" data-testid="floor-canvas-empty">
                <div className="text-center">
                  <p className="font-bold text-slate-900">尚未创建板区</p>
                  <p className="mt-1 text-xs text-slate-500">添加第一个板区开始绘制楼板布局</p>
                </div>
                <button type="button" onClick={addSlab} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white"><Grid2X2 size={15} />新增板区</button>
              </div>
            ) : (
              canvasElement
            )}
          </div>
        </section>

        {!workspaceFullscreen && <FloorNavigatorPalette open={navigatorOpen && !useSheetNavigation} title={paletteTitle} onClose={closeNavigatorOverlay}>{overlayNavigator}</FloorNavigatorPalette>}
        {!workspaceFullscreen && inspectorOpen && profile.viewport === "phone" && <button type="button" aria-label="关闭属性面板遮罩" onClick={closeInspector} className="fixed inset-0 z-[60] bg-slate-950/35" />}
        {!workspaceFullscreen && inspectorOpen && !wideInspectorDocked && (
          <aside className={[
            "flex flex-col overflow-hidden border border-slate-200 bg-white shadow-xl",
            profile.viewport === "phone"
              ? "fixed inset-x-0 bottom-0 z-[70] max-h-[82dvh] rounded-t-2xl"
              : `absolute right-2 top-2 z-[70] w-[min(390px,88vw)] rounded-xl ${stage === "bottom" || stage === "top" ? "bottom-14" : "bottom-2"}`,
          ].join(" ")} data-testid={profile.viewport === "phone" ? "floor-mobile-inspector-sheet" : "floor-inspector-overlay"}>
            {inspectorWithClose}
          </aside>
        )}
        {/* UI V5：Wide Dock Inspector（独立列，不覆盖 Canvas） */}
        {!workspaceFullscreen && wideInspectorDocked && (
          <aside className="hidden min-h-0 overflow-hidden border-l border-slate-200 bg-white 3xl:block 3xl:col-start-3" data-testid="floor-wide-inspector">
            {inspectorWithClose}
          </aside>
        )}
        {/* UI V5：浮动属性按钮（Desktop；Wide Dock 时隐藏），不再占用固定 44px 列 */}
        {!workspaceFullscreen && !touchInput && !inspectorOpen && (
          <button type="button" onClick={openInspector} aria-label="打开参数面板" data-testid="open-inspector-handle" className="absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-3 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 xl:inline-flex"><ChevronLeft size={14} /><span className="[writing-mode:vertical-rl]">属性</span></button>
        )}
      </div>
      {!workspaceFullscreen && useSheetNavigation && <FloorWorkspaceDrawer open={navigatorOpen} title={paletteTitle} side="left" onClose={closeNavigatorOverlay}>{overlayNavigator}</FloorWorkspaceDrawer>}
    </div>
  );

  return (
    <>
      <FloorWorkspaceShell workflow={workflow} body={workspaceBody} status={statusBar} fullscreen={workspaceFullscreen} />
      <FloorIssueCenter open={issueCenterOpen} issues={filteredIssueCenterItems} onClose={() => setIssueCenterOpen(false)} onLocate={locateWorkspaceIssue} />
      {newProjectOpen && <FloorNewProjectDialog currentProjectName={projectName} onCancel={() => setNewProjectOpen(false)} onConfirm={handleNewFloorProject} />}
      <FloorImportProjectDialog open={importDialog.open} fileName={importDialog.fileName} project={importDialog.project} errorMessage={importDialog.errorMessage} onCancel={() => setImportDialog({ open: false, fileName: "", project: null, errorMessage: null })} onConfirm={confirmImportProject} onExportCurrent={() => { handleExportFloorProject(); }} />
    </>
  );
}
