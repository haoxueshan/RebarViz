"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calculator,
  ChevronDown,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { SlabLayoutDiagram } from "@/components/calculator/SlabDiagrams";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  countModeLabel,
  createDefaultRoomAnchorRules,
  normalizeSlabCalculatorState,
  resolveBottomAnchor,
  resolveTopAnchor,
  restoreRoomAnchorToAuto,
  shouldApplyTopExtra,
  synchronizeRoomAnchors,
  validateSlabCalculator,
  type AnchorRule,
  type AnchorSource,
  type BarDirection,
  type BarLayer,
  type BarSettings,
  type CountMode,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
  type TopExtraMode,
} from "@/lib/slab-calculator";
import {
  DEFAULT_DRAFT_UI_STATE,
  DRAFT_KEY,
  RESULT_KEY,
  RETURN_TO_INPUT_KEY,
  CALCULATOR_SCHEMA_VERSION,
  createCalculationRecord,
  parseCalculationRecord,
  parseDraftRecord,
  type CalculationStatus,
  type CalculatorDraftUiState,
  type CalculatorSectionId,
} from "@/lib/slab-calculator-storage";
import {
  buildRoomBoundaryZones,
  type AutomaticWallSource,
} from "@/lib/slab-room-topology";
import {
  displayNumberDraft,
  hasInvalidNumberDrafts,
  numberValueToDraft,
  parseNumberDraft,
} from "@/lib/number-field-draft";

const fieldClass =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function sourceLabel(source: AnchorSource): string {
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

function endpointLabels(direction: BarDirection): [string, string] {
  return direction === "x" ? ["西端", "东端"] : ["南端", "北端"];
}

function NumberField({
  label,
  value,
  onChange,
  suffix = "mm",
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = displayNumberDraft(draft, value);

  return (
    <label>
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          data-calculator-number-input="true"
          type="number"
          step={step}
          value={displayedValue}
          onFocus={(event) => {
            setDraft(numberValueToDraft(value));
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            const parsed = parseNumberDraft(nextDraft);
            if (parsed !== null) onChange(parsed);
          }}
          onBlur={() => {
            setDraft(null);
          }}
          className={`${fieldClass} pr-12`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          {suffix}
        </span>
      </div>
    </label>
  );
}

function TopExtraModeSelector({
  direction,
  mode,
  through = false,
  onChange,
}: {
  direction: BarDirection;
  mode: TopExtraMode;
  through?: boolean;
  onChange: (mode: TopExtraMode) => void;
}) {
  const [start, end] = endpointLabels(direction);
  const options: Array<{ value: TopExtraMode; label: string }> = [
    { value: "start", label: `${through ? "最" : ""}${start}增加` },
    { value: "end", label: `${through ? "最" : ""}${end}增加` },
    { value: "both", label: "两端增加" },
  ];
  return (
    <fieldset>
      <legend className={labelClass}>面筋增加位置（仅内墙端）</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-medium transition sm:text-sm ${
              mode === option.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AnchorRuleField({
  label,
  rule,
  layer,
  state,
  applyTopExtra = true,
  automaticSources,
  onChange,
  onRestoreAuto,
}: {
  label: string;
  rule: AnchorRule;
  layer: BarLayer;
  state: SlabCalculatorState;
  applyTopExtra?: boolean;
  automaticSources?: readonly AutomaticWallSource[];
  onChange: (rule: AnchorRule) => void;
  onRestoreAuto?: () => void;
}) {
  const resolved =
    layer === "bottom"
      ? resolveBottomAnchor(rule, state.slab)
      : resolveTopAnchor(rule, state.slab, applyTopExtra);
  const wall =
    rule.source === "inner-wall"
      ? state.slab.innerWallThickness
      : state.slab.outerWallThickness;
  const hasMixedAutomaticBoundary =
    rule.origin === "auto" && new Set(automaticSources).size > 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${rule.origin === "user" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
            {rule.origin === "user" ? "已自定义" : "自动"}
          </span>
          {rule.origin === "user" && onRestoreAuto && (
            <button type="button" onClick={onRestoreAuto} className="text-xs font-medium text-blue-700 hover:underline">
              恢复自动锚固
            </button>
          )}
        </div>
      </div>
      <select
        aria-label={`${label}锚固来源`}
        className={fieldClass}
        value={rule.source}
        onChange={(event) =>
          onChange({
            ...rule,
            source: event.target.value as AnchorSource,
            origin: "user",
          })
        }
      >
        <option value="inner-wall">内墙</option>
        <option value="outer-wall">外墙</option>
        <option value="manual">手动输入</option>
      </select>
      {hasMixedAutomaticBoundary ? (
        <p className="mt-2 rounded-md bg-blue-50 px-2 py-1.5 text-xs leading-5 text-blue-800">
          {layer === "top"
            ? "自动分区：此端同时包含内墙和外墙；启用增加时仅内墙区段增加，外墙区段不增加。"
            : "自动分区：此端边界同时包含内墙和外墙，正式计算会按实际区段分别解析锚固。"}
        </p>
      ) : rule.source === "manual" ? (
        <div className="mt-2">
          <NumberField
            label="最终锚固"
            value={rule.manualValue}
            onChange={(manualValue) => onChange({ ...rule, manualValue, origin: "user" })}
          />
          <p className="mt-2 text-xs text-slate-500">手动值直接作为最终值，不叠加墙厚或面筋增加值。</p>
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {layer === "top" && rule.source === "outer-wall"
            ? `外墙${wall}mm（外墙默认不增加）`
            : layer === "top" && applyTopExtra
              ? `内墙${wall} + 增加${state.slab.topAnchorExtra} = ${resolved}mm`
              : `${sourceLabel(rule.source)}${wall}mm${layer === "top" ? "（此端未启用增加）" : ""}`}
        </p>
      )}
    </div>
  );
}

function RoomEditor({
  room,
  index,
  roomCount,
  arrangement,
  onChange,
  onMove,
  onDelete,
}: {
  room: SlabRoom;
  index: number;
  roomCount: number;
  arrangement: RoomArrangement;
  onChange: (room: SlabRoom) => void;
  onMove: (offset: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          aria-label={`房间${index + 1}名称`}
          value={room.name}
          onChange={(event) => onChange({ ...room, name: event.target.value })}
          className={`${fieldClass} min-w-32 flex-1 font-medium`}
        />
        {arrangement !== "single" && (
          <div className="flex gap-1">
            <button type="button" aria-label="向前移动" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-lg border p-2 disabled:opacity-30"><ArrowUp size={16} /></button>
            <button type="button" aria-label="向后移动" disabled={index === roomCount - 1} onClick={() => onMove(1)} className="rounded-lg border p-2 disabled:opacity-30"><ArrowDown size={16} /></button>
            <button type="button" aria-label="删除房间" disabled={roomCount <= 2} onClick={onDelete} className="rounded-lg border border-rose-200 p-2 text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="东西向净掏空尺寸 X" value={room.spanX} onChange={(spanX) => onChange({ ...room, spanX })} />
        <NumberField label="南北向净掏空尺寸 Y" value={room.spanY} onChange={(spanY) => onChange({ ...room, spanY })} />
      </div>
    </div>
  );
}

function CollapsibleSection({
  number,
  title,
  description,
  open,
  onToggle,
  children,
}: {
  number: number;
  title: string;
  description: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)} className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-4 sm:px-6">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{number}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">{description}</p>
        </div>
        <ChevronDown size={18} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </summary>
      <div className="border-t border-slate-200 p-4 sm:p-6">{children}</div>
    </details>
  );
}

function DirectionTabs({ value, onChange }: { value: BarDirection; onChange: (direction: BarDirection) => void }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label="钢筋方向">
      {(["x", "y"] as const).map((direction) => (
        <button
          key={direction}
          type="button"
          role="tab"
          aria-selected={value === direction}
          onClick={() => onChange(direction)}
          className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold ${value === direction ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
        >
          {direction.toUpperCase()}向（{direction === "x" ? "西→东" : "南→北"}）
        </button>
      ))}
    </div>
  );
}

function BarSettingsPanel({
  layer,
  direction,
  state,
  onSettingsChange,
  onExtraModeChange,
  onAnchorChange,
  onRestoreAuto,
}: {
  layer: BarLayer;
  direction: BarDirection;
  state: SlabCalculatorState;
  onSettingsChange: (settings: BarSettings) => void;
  onExtraModeChange?: (mode: TopExtraMode) => void;
  onAnchorChange: (roomId: string, endpoint: "start" | "end", rule: AnchorRule) => void;
  onRestoreAuto: (roomId: string, endpoint: "start" | "end") => void;
}) {
  const settings = state[layer][direction];
  const extraMode = layer === "top" ? state.top[direction].extraMode : undefined;
  const [startLabel, endLabel] = endpointLabels(direction);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="钢筋直径" value={settings.diameter} suffix="mm" onChange={(diameter) => onSettingsChange({ ...settings, diameter })} />
        <NumberField label="钢筋间距" value={settings.spacing} suffix="mm" onChange={(spacing) => onSettingsChange({ ...settings, spacing })} />
      </div>
      {layer === "top" && extraMode && onExtraModeChange && (
        <div className="mt-4"><TopExtraModeSelector direction={direction} mode={extraMode} onChange={onExtraModeChange} /></div>
      )}
      <div className="mt-4 space-y-3">
        {state.slab.rooms.map((room, roomIndex) => {
          const rules = room.anchors[layer][direction];
          const boundaryZones = buildRoomBoundaryZones(
            state.slab.rooms,
            state.slab.arrangement,
            roomIndex,
            direction,
          );
          const automaticSources = (endpoint: "start" | "end") => [
            ...new Set(
              boundaryZones.map((zone) =>
                endpoint === "start" ? zone.startSource : zone.endSource,
              ),
            ),
          ];
          const endpointSummary = (
            rule: AnchorRule,
            endpoint: "start" | "end",
          ) => {
            const sources = automaticSources(endpoint);
            return rule.origin === "auto" && sources.length > 1
              ? "自动分区（内墙/外墙）"
              : sourceLabel(rule.source);
          };
          const summary = `${startLabel}${endpointSummary(rules.start, "start")} → ${endLabel}${endpointSummary(rules.end, "end")}`;
          const customized = rules.start.origin === "user" || rules.end.origin === "user";
          return (
            <details key={`${room.id}:${layer}:${direction}`} className="rounded-xl border border-slate-200 bg-white">
              <summary className="min-h-12 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-800">
                {room.name} · {summary}{customized ? " · 已自定义" : " · 自动"}
              </summary>
              <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                <AnchorRuleField
                  label={startLabel}
                  rule={rules.start}
                  layer={layer}
                  state={state}
                  applyTopExtra={extraMode ? shouldApplyTopExtra(extraMode, "start") : false}
                  automaticSources={automaticSources("start")}
                  onChange={(rule) => onAnchorChange(room.id, "start", rule)}
                  onRestoreAuto={() => onRestoreAuto(room.id, "start")}
                />
                <AnchorRuleField
                  label={endLabel}
                  rule={rules.end}
                  layer={layer}
                  state={state}
                  applyTopExtra={extraMode ? shouldApplyTopExtra(extraMode, "end") : false}
                  automaticSources={automaticSources("end")}
                  onChange={(rule) => onAnchorChange(room.id, "end", rule)}
                  onRestoreAuto={() => onRestoreAuto(room.id, "end")}
                />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function mergeDraftUi(value: Partial<CalculatorDraftUiState> | undefined): CalculatorDraftUiState {
  return {
    openSections: {
      ...DEFAULT_DRAFT_UI_STATE.openSections,
      ...(value?.openSections ?? {}),
    },
    bottomDirection: value?.bottomDirection === "y" ? "y" : "x",
    topDirection: value?.topDirection === "y" ? "y" : "x",
  };
}

export function CalculatorClient() {
  const router = useRouter();
  const [state, setState] = useState<SlabCalculatorState>(() => cloneDefaultSlabCalculatorState());
  const [ui, setUi] = useState<CalculatorDraftUiState>(() => structuredClone(DEFAULT_DRAFT_UI_STATE));
  const [status, setStatus] = useState<CalculationStatus>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const allowNavigationRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = parseDraftRecord(localStorage.getItem(DRAFT_KEY));
      const returning = sessionStorage.getItem(RETURN_TO_INPUT_KEY) === "1";
      sessionStorage.removeItem(RETURN_TO_INPUT_KEY);
      const restoredState = draft
        ? normalizeSlabCalculatorState(draft.state)
        : cloneDefaultSlabCalculatorState();
      setState(restoredState);
      if (draft) setUi(mergeDraftUi(draft.ui));

      const result = parseCalculationRecord(localStorage.getItem(RESULT_KEY));
      const sameSnapshot = result && JSON.stringify(result.inputSnapshot) === JSON.stringify(restoredState);
      if (returning && sameSnapshot) {
        setStatus("valid");
      } else {
        if (result) localStorage.removeItem(RESULT_KEY);
        setStatus(draft ? "dirty" : "idle");
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          schemaVersion: CALCULATOR_SCHEMA_VERSION,
          savedAt: new Date().toISOString(),
          state,
          ui,
        }),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydrated, state, ui]);

  useEffect(() => {
    if (status !== "invalid") return;
    const timer = window.setTimeout(() => {
      const numberDrafts = formRef.current
        ? Array.from(
            formRef.current.querySelectorAll<HTMLInputElement>(
              'input[data-calculator-number-input="true"]',
            ),
            (input) => input.value,
          )
        : [];
      if (hasInvalidNumberDrafts(numberDrafts)) return;
      const nextErrors = validateSlabCalculator(state);
      setErrors(nextErrors);
      if (nextErrors.length === 0) setStatus("dirty");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state, status]);

  useEffect(() => {
    if (status !== "dirty" && status !== "invalid") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const protectLinks = (event: MouseEvent) => {
      if (allowNavigationRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname) return;
      if (!window.confirm("参数尚未重新计算，离开后仍会保留草稿。是否继续？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", protectLinks, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", protectLinks, true);
    };
  }, [status]);

  const markBusinessChanged = useCallback(() => {
    localStorage.removeItem(RESULT_KEY);
    setStatus((current) => (current === "invalid" ? "invalid" : "dirty"));
  }, []);

  const updateBusinessState = useCallback(
    (updater: (current: SlabCalculatorState) => SlabCalculatorState) => {
      markBusinessChanged();
      setState(updater);
    },
    [markBusinessChanged],
  );

  const toggleSection = (section: CalculatorSectionId, open: boolean) => {
    setUi((current) => ({
      ...current,
      openSections: { ...current.openSections, [section]: open },
    }));
  };

  const setArrangement = (arrangement: RoomArrangement) => {
    if (arrangement === state.slab.arrangement) return;
    if (arrangement === "single" && state.slab.rooms.length > 1 && !window.confirm("切换为单房间将移除其余房间，是否继续？")) return;
    updateBusinessState((current) => {
      const throughDirectionChanged =
        current.through.enabled &&
        current.slab.arrangement !== "single" &&
        arrangement !== "single" &&
        current.slab.arrangement !== arrangement;
      let rooms = current.slab.rooms.length > 0 ? current.slab.rooms : [
        { id: "room-a", name: "房间A", spanX: 4200, spanY: 3600, anchors: createDefaultRoomAnchorRules(arrangement, 0, 1) },
      ];
      if (arrangement === "single") rooms = [rooms[0]];
      if (arrangement !== "single" && rooms.length < 2) {
        const first = rooms[0];
        rooms = [...rooms, {
          id: `room-${Date.now()}`,
          name: "房间B",
          spanX: arrangement === "y" ? first.spanX : 3600,
          spanY: arrangement === "x" ? first.spanY : 3600,
          anchors: createDefaultRoomAnchorRules(arrangement, 1, 2),
        }];
      }
      rooms = synchronizeRoomAnchors(rooms, arrangement);
      return {
        ...current,
        slab: { ...current.slab, arrangement, rooms },
        through: {
          ...current.through,
          enabled: arrangement === "single" ? false : current.through.enabled,
          direction: arrangement === "single" ? "none" : current.through.enabled ? arrangement : "none",
          startAnchor: throughDirectionChanged
            ? { source: "outer-wall", manualValue: 0, origin: "auto" }
            : current.through.startAnchor,
          endAnchor: throughDirectionChanged
            ? { source: "outer-wall", manualValue: 0, origin: "auto" }
            : current.through.endAnchor,
        },
      };
    });
  };

  const updateRoom = (id: string, room: SlabRoom) => updateBusinessState((current) => ({
    ...current,
    slab: { ...current.slab, rooms: current.slab.rooms.map((item) => item.id === id ? room : item) },
  }));

  const moveRoom = (index: number, offset: -1 | 1) => updateBusinessState((current) => {
    const rooms = [...current.slab.rooms];
    const target = index + offset;
    if (target < 0 || target >= rooms.length) return current;
    [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
    return { ...current, slab: { ...current.slab, rooms: synchronizeRoomAnchors(rooms, current.slab.arrangement) } };
  });

  const deleteRoom = (id: string) => {
    const room = state.slab.rooms.find((item) => item.id === id);
    if (!window.confirm(`删除${room?.name || "该房间"}及其锚固设置，是否继续？`)) return;
    updateBusinessState((current) => {
      const rooms = current.slab.rooms.filter((item) => item.id !== id);
      return { ...current, slab: { ...current.slab, rooms: synchronizeRoomAnchors(rooms, current.slab.arrangement) } };
    });
  };

  const updateBar = (layer: BarLayer, direction: BarDirection, settings: BarSettings) => updateBusinessState((current) => ({
    ...current,
    [layer]: { ...current[layer], [direction]: { ...current[layer][direction], ...settings } },
  }));

  const updateRoomAnchor = (roomId: string, layer: BarLayer, direction: BarDirection, endpoint: "start" | "end", rule: AnchorRule) => updateBusinessState((current) => ({
    ...current,
    slab: {
      ...current.slab,
      rooms: current.slab.rooms.map((room) => room.id === roomId ? {
        ...room,
        anchors: {
          ...room.anchors,
          [layer]: {
            ...room.anchors[layer],
            [direction]: {
              ...room.anchors[layer][direction],
              [endpoint]: { ...rule, origin: "user" },
            },
          },
        },
      } : room),
    },
  }));

  const restoreAnchor = (roomId: string, layer: BarLayer, direction: BarDirection, endpoint: "start" | "end") => updateBusinessState((current) => ({
    ...current,
    slab: {
      ...current.slab,
      rooms: restoreRoomAnchorToAuto(current.slab.rooms, current.slab.arrangement, roomId, layer, direction, endpoint),
    },
  }));

  const resetData = () => {
    if (!window.confirm("重置将清除当前草稿、房间和正式结果，是否继续？")) return;
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(RESULT_KEY);
    skipNextDraftSaveRef.current = true;
    setState(cloneDefaultSlabCalculatorState());
    setUi(structuredClone(DEFAULT_DRAFT_UI_STATE));
    setErrors([]);
    setStatus("idle");
  };

  const submitCalculation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numberDrafts = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>(
        'input[data-calculator-number-input="true"]',
      ),
      (input) => input.value,
    );
    if (hasInvalidNumberDrafts(numberDrafts)) {
      localStorage.removeItem(RESULT_KEY);
      setErrors(["存在空白或无效的数字输入，请完成当前输入后再计算。"]);
      setUi((current) => ({
        ...current,
        openSections: { base: true, bottom: true, top: true, through: true },
      }));
      setStatus("invalid");
      window.setTimeout(
        () => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
        0,
      );
      return;
    }
    setStatus("calculating");
    const normalized = normalizeSlabCalculatorState(state);
    const calculation = calculateSlabResults(normalized);
    setState(normalized);
    if (!calculation.isValid || calculation.totalWeightKg === null || calculation.results.length === 0) {
      localStorage.removeItem(RESULT_KEY);
      setErrors(calculation.errors);
      setUi((current) => ({
        ...current,
        openSections: { base: true, bottom: true, top: true, through: true },
      }));
      setStatus("invalid");
      window.setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    const record = createCalculationRecord(normalized, calculation);
    localStorage.setItem(RESULT_KEY, JSON.stringify(record));
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      schemaVersion: CALCULATOR_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      state: normalized,
      ui,
    }));
    setErrors([]);
    setStatus("valid");
    allowNavigationRef.current = true;
    router.push("/calculator/results");
  };

  if (!hydrated) {
    return <main className="min-h-screen bg-slate-100 px-4 py-16 text-center text-sm text-slate-500">正在恢复计算器草稿…</main>;
  }

  const buttonText = status === "calculating" ? "正在计算…" : status === "idle" ? "计算并查看结果" : status === "invalid" ? "修正后重新计算" : "重新计算并查看结果";
  const arrangementOptions: Array<{ value: RoomArrangement; label: string }> = [
    { value: "single", label: "单房间" },
    { value: "x", label: "沿X向排列" },
    { value: "y", label: "沿Y向排列" },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-white px-3 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl bg-slate-900 p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-blue-300"><Calculator size={20} /><span className="text-sm font-semibold">RebarViz · 计算器</span></div>
              <h1 className="text-2xl font-bold sm:text-3xl">楼板钢筋计算器</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">先完成参数和锚固设置，再点击计算。正式重量与钢筋结果仅在独立结果页生成。</p>
            </div>
            <button type="button" onClick={resetData} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"><RotateCcw size={16} />重置数据</button>
          </div>
        </header>

        <form
          ref={formRef}
          noValidate
          onSubmit={submitCalculation}
          onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
            if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }}
        >
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)] xl:items-start">
            <div className="space-y-4">
              <CollapsibleSection number={1} title="楼板基础参数" description="房间尺寸、墙厚和内墙面筋锚固增加值的唯一数据源。" open={ui.openSections.base} onToggle={(open) => toggleSection("base", open)}>
                <div className="grid gap-2 sm:grid-cols-3">
                  {arrangementOptions.map((option) => (
                    <button key={option.value} type="button" onClick={() => setArrangement(option.value)} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium ${state.slab.arrangement === option.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{option.label}</button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {state.slab.rooms.map((room, index) => <RoomEditor key={room.id} room={room} index={index} roomCount={state.slab.rooms.length} arrangement={state.slab.arrangement} onChange={(next) => updateRoom(room.id, next)} onMove={(offset) => moveRoom(index, offset)} onDelete={() => deleteRoom(room.id)} />)}
                </div>
                {state.slab.arrangement !== "single" && (
                  <button type="button" onClick={() => updateBusinessState((current) => {
                    const first = current.slab.rooms[0];
                    const index = current.slab.rooms.length;
                    const room: SlabRoom = {
                      id: `room-${Date.now()}`,
                      name: `房间${String.fromCharCode(65 + index)}`,
                      spanX: current.slab.arrangement === "y" ? (first?.spanX ?? 4200) : 3600,
                      spanY: current.slab.arrangement === "x" ? (first?.spanY ?? 3600) : 3600,
                      anchors: createDefaultRoomAnchorRules(current.slab.arrangement, index, index + 1),
                    };
                    return { ...current, slab: { ...current.slab, rooms: synchronizeRoomAnchors([...current.slab.rooms, room], current.slab.arrangement) } };
                  })} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700"><Plus size={16} />添加房间</button>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <NumberField label="内墙厚度" value={state.slab.innerWallThickness} onChange={(innerWallThickness) => updateBusinessState((current) => ({ ...current, slab: { ...current.slab, innerWallThickness } }))} />
                  <NumberField label="外墙厚度" value={state.slab.outerWallThickness} onChange={(outerWallThickness) => updateBusinessState((current) => ({ ...current, slab: { ...current.slab, outerWallThickness } }))} />
                  <NumberField label="内墙面筋锚固增加值" value={state.slab.topAnchorExtra} onChange={(topAnchorExtra) => updateBusinessState((current) => ({ ...current, slab: { ...current.slab, topAnchorExtra } }))} />
                  <label><span className={labelClass}>根数算法</span><select className={fieldClass} value={state.slab.countMode} onChange={(event) => updateBusinessState((current) => ({ ...current, slab: { ...current.slab, countMode: event.target.value as CountMode } }))}><option value="project">项目算法</option><option value="round">四舍五入算法</option><option value="floor">向下取整算法</option></select></label>
                </div>
                <p className="mt-3 text-xs text-slate-500">中间墙共 {Math.max(state.slab.rooms.length - 1, 0)} 道，由房间拓扑自动确定；普通多房间允许尺寸不同，只有通墙时才校验垂直尺寸一致。</p>
              </CollapsibleSection>

              <CollapsibleSection number={2} title="地筋参数" description="X/Y方向使用标签切换；每个房间端部锚固独立保存。" open={ui.openSections.bottom} onToggle={(open) => toggleSection("bottom", open)}>
                <DirectionTabs value={ui.bottomDirection} onChange={(bottomDirection) => setUi((current) => ({ ...current, bottomDirection }))} />
                <BarSettingsPanel layer="bottom" direction={ui.bottomDirection} state={state} onSettingsChange={(settings) => updateBar("bottom", ui.bottomDirection, settings)} onAnchorChange={(roomId, endpoint, rule) => updateRoomAnchor(roomId, "bottom", ui.bottomDirection, endpoint, rule)} onRestoreAuto={(roomId, endpoint) => restoreAnchor(roomId, "bottom", ui.bottomDirection, endpoint)} />
              </CollapsibleSection>

              <CollapsibleSection number={3} title="面筋参数" description="普通面筋X/Y各自保存增加位置和房间级锚固。" open={ui.openSections.top} onToggle={(open) => toggleSection("top", open)}>
                <DirectionTabs value={ui.topDirection} onChange={(topDirection) => setUi((current) => ({ ...current, topDirection }))} />
                <BarSettingsPanel layer="top" direction={ui.topDirection} state={state} onSettingsChange={(settings) => updateBar("top", ui.topDirection, settings)} onExtraModeChange={(extraMode) => updateBusinessState((current) => ({ ...current, top: { ...current.top, [ui.topDirection]: { ...current.top[ui.topDirection], extraMode } } }))} onAnchorChange={(roomId, endpoint, rule) => updateRoomAnchor(roomId, "top", ui.topDirection, endpoint, rule)} onRestoreAuto={(roomId, endpoint) => restoreAnchor(roomId, "top", ui.topDirection, endpoint)} />
              </CollapsibleSection>

              <CollapsibleSection number={4} title="通墙设置" description="通墙只作用于面筋，方向直接跟随多房间排列方向。" open={ui.openSections.through} onToggle={(open) => toggleSection("through", open)}>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={state.through.enabled} disabled={state.slab.arrangement === "single"} onChange={(event) => updateBusinessState((current) => ({ ...current, through: { ...current.through, enabled: event.target.checked, direction: event.target.checked && current.slab.arrangement !== "single" ? current.slab.arrangement : "none" } }))} className="h-5 w-5 rounded border-slate-300 text-blue-600" />启用面筋通墙</label>
                {state.slab.arrangement === "single" && <p className="mt-2 text-xs text-slate-500">至少两个房间且排列方向为X或Y时才能启用。</p>}
                {state.through.enabled && state.through.direction !== "none" && (
                  <div className="mt-4 space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-slate-700">当前通墙方向：<strong>{state.through.direction.toUpperCase()}向（{state.through.direction === "x" ? "西→东" : "南→北"}）</strong></p>
                    <TopExtraModeSelector direction={state.through.direction} through mode={state.through.extraMode} onChange={(extraMode) => updateBusinessState((current) => ({ ...current, through: { ...current.through, extraMode } }))} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <AnchorRuleField label={state.through.direction === "x" ? "最西端" : "最南端"} rule={state.through.startAnchor} layer="top" state={state} applyTopExtra={shouldApplyTopExtra(state.through.extraMode, "start")} onChange={(startAnchor) => updateBusinessState((current) => ({ ...current, through: { ...current.through, startAnchor: { ...startAnchor, origin: "user" } } }))} onRestoreAuto={() => updateBusinessState((current) => ({ ...current, through: { ...current.through, startAnchor: { source: "outer-wall", manualValue: 0, origin: "auto" } } }))} />
                      <AnchorRuleField label={state.through.direction === "x" ? "最东端" : "最北端"} rule={state.through.endAnchor} layer="top" state={state} applyTopExtra={shouldApplyTopExtra(state.through.extraMode, "end")} onChange={(endAnchor) => updateBusinessState((current) => ({ ...current, through: { ...current.through, endAnchor: { ...endAnchor, origin: "user" } } }))} onRestoreAuto={() => updateBusinessState((current) => ({ ...current, through: { ...current.through, endAnchor: { source: "outer-wall", manualValue: 0, origin: "auto" } } }))} />
                    </div>
                    <p className="text-xs leading-5 text-amber-900">面筋增加值仅作用于选中位置的内墙锚固；外墙锚固和手动锚固均不增加。</p>
                    <p className="text-xs leading-5 text-amber-900">通墙只替换当前方向的普通面筋；垂直方向面筋仍按各房间独立计算。通墙校验会检查垂直净尺寸一致性。</p>
                  </div>
                )}
              </CollapsibleSection>
            </div>

            <aside className="space-y-4 xl:sticky xl:top-20">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-bold text-slate-900">参数摘要</h2>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">排列</dt><dd className="font-semibold">{state.slab.arrangement === "single" ? "单房间" : `${state.slab.arrangement.toUpperCase()}向 · ${state.slab.rooms.length}间`}</dd></div>
                  <div><dt className="text-xs text-slate-500">墙厚</dt><dd className="font-semibold">内{state.slab.innerWallThickness} / 外{state.slab.outerWallThickness}mm</dd></div>
                  <div><dt className="text-xs text-slate-500">根数算法</dt><dd className="font-semibold">{countModeLabel(state.slab.countMode)}</dd></div>
                  <div><dt className="text-xs text-slate-500">通墙</dt><dd className="font-semibold">{state.through.enabled ? `${state.through.direction.toUpperCase()}向面筋` : "关闭"}</dd></div>
                </dl>
                <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">此处只核对输入参数，不显示任何正式长度、根数或工程重量。</p>
              </section>

              <SlabLayoutDiagram state={state} />

              <section ref={errorRef} data-testid="calculation-status" className={`rounded-2xl border p-4 shadow-sm ${status === "invalid" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center gap-2 font-semibold text-slate-900"><AlertCircle size={17} />{status === "invalid" ? "输入无效" : status === "valid" ? "上次结果仍有效" : status === "dirty" ? "参数已修改，需重新计算" : "等待计算"}</div>
                {errors.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-800">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
              </section>

              <button data-testid="calculate-button" type="submit" disabled={status === "calculating"} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-base font-bold text-white shadow hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"><Calculator size={19} />{buttonText}</button>
              <p className="text-center text-xs leading-5 text-slate-500">点击后先完整校验；仅有效结果会保存并进入结果页。页面不会主动刷新。</p>
            </aside>
          </div>
        </form>
      </div>
    </main>
  );
}
