"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calculator,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  createDefaultRoomAnchorRules,
  resolveBottomAnchor,
  resolveTopAnchor,
  restoreRoomAnchorToAuto,
  shouldApplyTopExtra,
  synchronizeRoomAnchors,
  type AnchorRule,
  type AnchorSource,
  type BarDirection,
  type BarLayer,
  type BarResult,
  type BarSettings,
  type RoomArrangement,
  type SlabCalculation,
  type SlabCalculatorState,
  type SlabRoom,
  type TopExtraMode,
} from "@/lib/slab-calculator";

const fieldClass =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function toNumber(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceLabel(source: AnchorSource): string {
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

function directionLabel(direction: BarDirection): string {
  return direction === "x" ? "X向（西→东）" : "Y向（南→北）";
}

function endLabels(direction: BarDirection): [string, string] {
  return direction === "x" ? ["西端", "东端"] : ["南端", "北端"];
}

function topExtraEndpointLabels(
  direction: BarDirection,
  throughWall: boolean,
): [string, string] {
  const [start, end] = endLabels(direction);
  return throughWall ? [`最${start}`, `最${end}`] : [start, end];
}

function TopExtraModeSelector({
  direction,
  mode,
  throughWall = false,
  onChange,
}: {
  direction: BarDirection;
  mode: TopExtraMode;
  throughWall?: boolean;
  onChange: (mode: TopExtraMode) => void;
}) {
  const [start, end] = topExtraEndpointLabels(direction, throughWall);
  const options: Array<{ value: TopExtraMode; label: string }> = [
    { value: "start", label: `${start}增加` },
    { value: "end", label: `${end}增加` },
    { value: "both", label: "两端增加" },
  ];
  return (
    <fieldset>
      <legend className={labelClass}>面筋增加位置</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-medium transition sm:text-sm ${mode === option.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
};

function NumberField({
  label,
  value,
  onChange,
  suffix = "mm",
  min = 0,
  step = 1,
}: NumberFieldProps) {
  return (
    <label>
      <span className={labelClass}>{label}</span>
      <span className="relative block">
        <input
          className={`${fieldClass} pr-12`}
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(toNumber(event.target.value))}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          {suffix}
        </span>
      </span>
    </label>
  );
}

type AnchorRuleFieldProps = {
  label: string;
  rule: AnchorRule;
  layer: BarLayer;
  state: SlabCalculatorState;
  applyTopExtra?: boolean;
  onChange: (rule: AnchorRule) => void;
  onRestoreAuto?: () => void;
};

function AnchorRuleField({
  label,
  rule,
  layer,
  state,
  applyTopExtra = true,
  onChange,
  onRestoreAuto,
}: AnchorRuleFieldProps) {
  const resolved =
    layer === "bottom"
      ? resolveBottomAnchor(rule, state.slab)
      : resolveTopAnchor(rule, state.slab, applyTopExtra);
  const wall =
    rule.source === "inner-wall"
      ? state.slab.innerWallThickness
      : state.slab.outerWallThickness;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${rule.origin === "user" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
          {rule.origin === "user" ? "已自定义" : "自动拓扑"}
        </span>
        {rule.origin === "user" && onRestoreAuto && (
          <button
            type="button"
            onClick={onRestoreAuto}
            className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            恢复自动锚固
          </button>
        )}
      </div>
      <label>
        <span className={labelClass}>{label}锚固来源</span>
        <select
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
      </label>
      {rule.source === "manual" ? (
        <div className="mt-2">
          <NumberField
            label="最终锚固"
            value={rule.manualValue}
            onChange={(manualValue) =>
              onChange({ ...rule, manualValue, origin: "user" })
            }
          />
          <p className="mt-1 text-xs text-slate-500">手动值直接作为最终值，不叠加墙厚或增加值。</p>
        </div>
      ) : (
        <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-600">
          {layer === "top" ? (
            <>
              计算过程：{sourceLabel(rule.source)} {wall} + 增加{" "}
              {applyTopExtra ? state.slab.topAnchorExtra : 0} ={" "}
              <strong className="text-blue-700">
                {Number.isFinite(resolved) ? `${resolved}mm` : "--"}
              </strong>
            </>
          ) : (
            <>
              计算结果：{sourceLabel(rule.source)} {wall} ={" "}
              <strong className="text-blue-700">
                {Number.isFinite(resolved) ? `${resolved}mm` : "--"}
              </strong>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type BarSettingsCardProps = {
  title: string;
  direction: BarDirection;
  layer: BarLayer;
  settings: BarSettings;
  state: SlabCalculatorState;
  onChange: (settings: BarSettings) => void;
  extraMode?: TopExtraMode;
  onExtraModeChange?: (mode: TopExtraMode) => void;
  onAnchorChange: (
    roomId: string,
    endpoint: "start" | "end",
    rule: AnchorRule,
  ) => void;
  onRestoreAuto: (
    roomId: string,
    endpoint: "start" | "end",
  ) => void;
};

function BarSettingsCard({
  title,
  direction,
  layer,
  settings,
  state,
  onChange,
  extraMode,
  onExtraModeChange,
  onAnchorChange,
  onRestoreAuto,
}: BarSettingsCardProps) {
  const [startLabel, endLabel] = endLabels(direction);
  const effectiveExtraMode = extraMode ?? "both";
  return (
    <div
      data-testid={`${layer}-${direction}-settings`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        <span className={`rounded-full px-2 py-1 text-xs ${direction === "x" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>
          {directionLabel(direction)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="钢筋直径"
          value={settings.diameter}
          onChange={(diameter) => onChange({ ...settings, diameter })}
        />
        <NumberField
          label="钢筋间距"
          value={settings.spacing}
          onChange={(spacing) => onChange({ ...settings, spacing })}
        />
      </div>
      {layer === "top" && onExtraModeChange && (
        <div className="mt-3">
          <TopExtraModeSelector
            direction={direction}
            mode={effectiveExtraMode}
            onChange={onExtraModeChange}
          />
        </div>
      )}
      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium text-slate-500">各房间端部锚固</p>
        {state.slab.rooms.map((room) => {
          const rules = room.anchors[layer][direction];
          const customized =
            rules.start.origin === "user" || rules.end.origin === "user";
          return (
            <details
              key={room.id}
              data-testid={`anchors-${layer}-${direction}-${room.id}`}
              className="group rounded-xl border border-slate-200 bg-slate-50"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-slate-700">
                <span>
                  {room.name} · {startLabel}{sourceLabel(rules.start.source)} → {endLabel}{sourceLabel(rules.end.source)}
                </span>
                {customized && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                    已自定义
                  </span>
                )}
              </summary>
              <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                <AnchorRuleField
                  label={startLabel}
                  rule={rules.start}
                  layer={layer}
                  state={state}
                  applyTopExtra={
                    layer === "top"
                      ? shouldApplyTopExtra(effectiveExtraMode, "start")
                      : false
                  }
                  onChange={(rule) => onAnchorChange(room.id, "start", rule)}
                  onRestoreAuto={() => onRestoreAuto(room.id, "start")}
                />
                <AnchorRuleField
                  label={endLabel}
                  rule={rules.end}
                  layer={layer}
                  state={state}
                  applyTopExtra={
                    layer === "top"
                      ? shouldApplyTopExtra(effectiveExtraMode, "end")
                      : false
                  }
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

function Section({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:p-6">
      <div className="mb-5 flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {number}
        </span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
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
          className={`${fieldClass} min-w-32 flex-1 font-medium`}
          value={room.name}
          onChange={(event) => onChange({ ...room, name: event.target.value })}
        />
        {arrangement !== "single" && (
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="向前移动"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              aria-label="向后移动"
              disabled={index === roomCount - 1}
              onClick={() => onMove(1)}
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
            >
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              aria-label="删除房间"
              disabled={roomCount <= 2}
              onClick={onDelete}
              className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="东西向净掏空尺寸 X"
          value={room.spanX}
          onChange={(spanX) => onChange({ ...room, spanX })}
        />
        <NumberField
          label="南北向净掏空尺寸 Y"
          value={room.spanY}
          onChange={(spanY) => onChange({ ...room, spanY })}
        />
      </div>
    </div>
  );
}

function topExtraModeLabel(result: BarResult): string {
  if (result.layer === "bottom" || !result.topExtraMode) return "不适用";
  if (result.topExtraMode === "both") return "两端增加";
  const [start, end] = topExtraEndpointLabels(result.direction, result.throughWall);
  return `${result.topExtraMode === "start" ? start : end}增加`;
}

function anchorResultLabel(
  result: BarResult,
  endpoint: "start" | "end",
): string {
  const source = endpoint === "start" ? result.startAnchorSource : result.endAnchorSource;
  const value = endpoint === "start" ? result.startAnchor : result.endAnchor;
  if (result.layer === "bottom") return `${sourceLabel(source)} ${value.toFixed(0)}mm`;
  const applied = endpoint === "start" ? result.startExtraApplied : result.endExtraApplied;
  return `${sourceLabel(source)} ${value.toFixed(0)}mm（${applied ? `已增加${result.topExtraValue.toFixed(0)}mm` : "未增加"}）`;
}

function ResultFormula({
  result,
  state,
}: {
  result: BarResult;
  state: SlabCalculatorState;
}) {
  const lengthParts = [
    result.netRunSpanMm,
    ...(result.intermediateWallMm > 0 ? [result.intermediateWallMm] : []),
    result.startAnchor,
    result.endAnchor,
  ];
  const countFormula =
    state.slab.countMode === "cover"
      ? `ceil((${result.calculationWidthMm} - 2 × ${state.slab.cover}) / ${result.spacing}) + 1 = ${result.count}根`
      : `ceil(${result.calculationWidthMm} / ${result.spacing}) = ${result.count}根`;
  return (
    <div className="space-y-1 text-xs leading-5 text-slate-600">
      <p>单根长度：{lengthParts.join(" + ")} = {(result.singleLengthM * 1000).toFixed(0)}mm</p>
      <p>根数：{countFormula}</p>
      <p>总长度：{result.count} × {result.singleLengthM.toFixed(3)} = {result.totalLengthM.toFixed(3)}m</p>
      <p>单位重量：π × {result.diameter}² × 7850 ÷ 4 ÷ 1,000,000 = {result.unitWeightKgM.toFixed(4)}kg/m</p>
      <p>重量：{result.totalLengthM.toFixed(3)} × {result.unitWeightKgM.toFixed(4)} = {result.weightKg.toFixed(2)}kg</p>
    </div>
  );
}

function ResultsTable({
  results,
  state,
}: {
  results: BarResult[];
  state: SlabCalculatorState;
}) {
  return (
    <>
      <div className="space-y-3 xl:hidden" data-testid="mobile-result-cards">
        {results.map((result) => (
          <article key={result.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{result.scopeName}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {result.layer === "bottom" ? "地筋" : "面筋"} · {result.direction.toUpperCase()}向
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${result.throughWall ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                {result.throughWall ? "通墙" : "普通"}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-slate-500">钢筋直径</dt><dd className="mt-1 font-medium">Φ{result.diameter}</dd></div>
              <div><dt className="text-xs text-slate-500">根数</dt><dd className="mt-1 font-medium">{result.count}根</dd></div>
              <div><dt className="text-xs text-slate-500">单根长度</dt><dd className="mt-1 font-medium">{result.singleLengthM.toFixed(3)}m</dd></div>
              <div><dt className="text-xs text-slate-500">总长度</dt><dd className="mt-1 font-medium">{result.totalLengthM.toFixed(3)}m</dd></div>
              <div className="col-span-2"><dt className="text-xs text-slate-500">重量</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{result.weightKg.toFixed(2)}kg</dd></div>
              <div className="col-span-2"><dt className="text-xs text-slate-500">增加位置</dt><dd className="mt-1 font-medium">{topExtraModeLabel(result)}</dd></div>
              <div><dt className="text-xs text-slate-500">起点锚固</dt><dd className="mt-1 font-medium">{anchorResultLabel(result, "start")}</dd></div>
              <div><dt className="text-xs text-slate-500">终点锚固</dt><dd className="mt-1 font-medium">{anchorResultLabel(result, "end")}</dd></div>
              <div className="col-span-2 border-t border-slate-100 pt-3">
                <ResultFormula result={result} state={state} />
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white xl:block">
        <table className="min-w-[1280px] w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-3">房间/路径</th>
            <th className="px-3 py-3">类型</th>
            <th className="px-3 py-3">方向</th>
            <th className="px-3 py-3">通墙</th>
            <th className="px-3 py-3">直径</th>
            <th className="px-3 py-3">根数</th>
            <th className="px-3 py-3">单根长度</th>
            <th className="px-3 py-3">总长度</th>
            <th className="px-3 py-3">重量</th>
            <th className="px-3 py-3">增加位置</th>
            <th className="px-3 py-3">起点锚固</th>
            <th className="px-3 py-3">终点锚固</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {results.map((result) => (
            <tr key={result.id} className="text-slate-700 hover:bg-slate-50">
              <td className="px-3 py-3 font-medium text-slate-900">{result.scopeName}</td>
              <td className="px-3 py-3">{result.layer === "bottom" ? "地筋" : "面筋"}</td>
              <td className="px-3 py-3">{result.direction.toUpperCase()}向</td>
              <td className="px-3 py-3">
                {result.throughWall ? (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">通墙</span>
                ) : (
                  "否"
                )}
              </td>
              <td className="px-3 py-3">Φ{result.diameter}</td>
              <td className="px-3 py-3 font-semibold">{result.count}</td>
              <td className="px-3 py-3">{result.singleLengthM.toFixed(3)}m</td>
              <td className="px-3 py-3">{result.totalLengthM.toFixed(3)}m</td>
              <td className="px-3 py-3 font-semibold text-slate-900">{result.weightKg.toFixed(2)}kg</td>
              <td className="px-3 py-3">{topExtraModeLabel(result)}</td>
              <td className="px-3 py-3">{anchorResultLabel(result, "start")}</td>
              <td className="px-3 py-3">{anchorResultLabel(result, "end")}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="mt-4 hidden grid-cols-2 gap-3 xl:grid">
        {results.map((result) => (
          <details key={`formula-${result.id}`} className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {result.scopeName} · {result.layer === "bottom" ? "地筋" : "面筋"}{result.direction.toUpperCase()}向计算核查
            </summary>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <ResultFormula result={result} state={state} />
            </div>
          </details>
        ))}
      </div>
    </>
  );
}

function SlabDiagram({
  state,
  calculation,
}: {
  state: SlabCalculatorState;
  calculation: SlabCalculation;
}) {
  if (!calculation.isValid) {
    return (
      <div
        role="img"
        aria-label="楼板示意图输入无效"
        className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-rose-300 bg-rose-50 p-6 text-center text-sm font-medium text-rose-700"
      >
        输入无效，修正全部错误后显示钢筋计算示意图。
      </div>
    );
  }
  const results = calculation.results;
  const rooms = state.slab.rooms;
  const horizontal = state.slab.arrangement !== "y";
  const count = Math.max(rooms.length, 1);
  const gap = 12;
  const frameX = 60;
  const frameY = 58;
  const frameW = 580;
  const frameH = 270;
  const roomW = horizontal ? (frameW - gap * (count - 1)) / count : frameW;
  const roomH = horizontal ? frameH : (frameH - gap * (count - 1)) / count;
  const throughDirection = calculation.throughWall?.direction ?? null;
  const normalLines: React.ReactNode[] = [];
  const throughLines: React.ReactNode[] = [];

  rooms.forEach((room, roomIndex) => {
    const x = frameX + (horizontal ? roomIndex * (roomW + gap) : 0);
    const y = frameY + (horizontal ? 0 : roomIndex * (roomH + gap));
    const roomResults = results.filter((result) => result.roomId === room.id);
    const bottomXCount = roomResults.find((r) => r.layer === "bottom" && r.direction === "x")?.count ?? 4;
    const bottomYCount = roomResults.find((r) => r.layer === "bottom" && r.direction === "y")?.count ?? 4;
    const localLineCountX = Math.min(Math.max(bottomXCount, 1), 4);
    const localLineCountY = Math.min(Math.max(bottomYCount, 1), 4);

    for (let line = 1; line <= localLineCountX; line += 1) {
      const lineY = y + (line * roomH) / (localLineCountX + 1);
      normalLines.push(<line key={`bx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" />);
    }
    for (let line = 1; line <= localLineCountY; line += 1) {
      const lineX = x + (line * roomW) / (localLineCountY + 1);
      normalLines.push(<line key={`by-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + roomH - 8} stroke="#059669" strokeWidth="2" />);
    }

    if (throughDirection !== "x") {
      for (let line = 1; line <= 3; line += 1) {
        const lineY = y + (line * roomH) / 4 + 4;
        normalLines.push(<line key={`tx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
    if (throughDirection !== "y") {
      for (let line = 1; line <= 3; line += 1) {
        const lineX = x + (line * roomW) / 4 + 4;
        normalLines.push(<line key={`ty-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + roomH - 8} stroke="#059669" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
  });

  if (throughDirection === "x") {
    for (let line = 1; line <= 4; line += 1) {
      const y = frameY + (line * frameH) / 5;
      throughLines.push(<line key={`through-x-${line}`} data-through-line="x" x1={frameX + 5} y1={y} x2={frameX + frameW - 5} y2={y} stroke="#2563eb" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }
  if (throughDirection === "y") {
    for (let line = 1; line <= 4; line += 1) {
      const x = frameX + (line * frameW) / 5;
      throughLines.push(<line key={`through-y-${line}`} data-through-line="y" x1={x} y1={frameY + 5} x2={x} y2={frameY + frameH - 5} stroke="#059669" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }

  const visible = [...throughLines, ...normalLines].slice(0, 60);
  const throughBar = calculation.throughWall?.throughBar;
  const throughStart = throughBar?.startAnchorSource;
  const throughEnd = throughBar?.endAnchorSource;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox="0 0 700 410" className="h-auto w-full max-w-full" role="img" aria-label="楼板房间及钢筋方向示意图">
        <rect x="35" y="32" width="630" height="322" rx="8" fill="#f1f5f9" stroke="#64748b" strokeWidth="8" />
        {rooms.map((room, index) => {
          const x = frameX + (horizontal ? index * (roomW + gap) : 0);
          const y = frameY + (horizontal ? 0 : index * (roomH + gap));
          return (
            <g key={room.id}>
              <rect x={x} y={y} width={roomW} height={roomH} fill="#fff" stroke="#94a3b8" strokeWidth="2" />
              <text x={x + roomW / 2} y={y + 18} textAnchor="middle" fontSize="13" fill="#334155">
                {room.name} · {room.spanX}×{room.spanY}mm
              </text>
              {index < rooms.length - 1 && (
                horizontal ? (
                  <>
                    <rect x={x + roomW} y={frameY} width={gap} height={frameH} fill="#cbd5e1" />
                    <text x={x + roomW + gap / 2} y={frameY - 8} textAnchor="middle" fontSize="10" fill="#475569">
                      内墙{state.slab.innerWallThickness}mm
                    </text>
                  </>
                ) : (
                  <>
                    <rect x={frameX} y={y + roomH} width={frameW} height={gap} fill="#cbd5e1" />
                    <text x={frameX + frameW - 4} y={y + roomH + gap - 2} textAnchor="end" fontSize="10" fill="#475569">
                      内墙{state.slab.innerWallThickness}mm
                    </text>
                  </>
                )
              )}
            </g>
          );
        })}
        {visible}
        <text x="60" y="380" fontSize="12" fill="#2563eb">蓝色：X向</text>
        <text x="150" y="380" fontSize="12" fill="#059669">绿色：Y向</text>
        <text x="240" y="380" fontSize="12" fill="#475569">实线：地筋　虚线：面筋</text>
        {throughDirection && throughBar && throughStart && throughEnd && (
          <>
            <text x="60" y="25" fontSize="12" fill="#92400e">
              通墙路径起点：{sourceLabel(throughStart)}
            </text>
            <text x="640" y="25" textAnchor="end" fontSize="12" fill="#92400e">
              终点：{sourceLabel(throughEnd)}
            </text>
            <text x="640" y="397" textAnchor="end" fontSize="12" fill="#92400e">
              面筋增加：{topExtraModeLabel(throughBar)}
            </text>
          </>
        )}
      </svg>
      <p className="mt-2 text-xs text-slate-500">示意图不按比例；最多绘制60条代表线，实际根数始终使用完整计算结果。</p>
    </div>
  );
}

export function CalculatorClient() {
  const [state, setState] = useState<SlabCalculatorState>(() =>
    cloneDefaultSlabCalculatorState(),
  );
  const calculation = useMemo(() => calculateSlabResults(state), [state]);

  const setArrangement = (arrangement: RoomArrangement) => {
    if (
      arrangement === "single" &&
      state.slab.rooms.length > 1 &&
      !window.confirm("切换为单房间将移除其余房间，是否继续？")
    ) {
      return;
    }
    setState((current) => {
      const fallbackRoom: SlabRoom = {
        id: "room-a",
        name: "房间A",
        spanX: 4200,
        spanY: 3600,
        anchors: createDefaultRoomAnchorRules(arrangement, 0, 1),
      };
      let rooms = current.slab.rooms.length > 0 ? current.slab.rooms : [fallbackRoom];
      if (arrangement === "single") {
        rooms = [rooms[0]];
      } else if (rooms.length < 2) {
        const first = rooms[0];
        rooms = [
          first,
          {
            id: `room-${Date.now()}`,
            name: "房间B",
            spanX: arrangement === "y" ? first.spanX : 3600,
            spanY: arrangement === "x" ? first.spanY : 3600,
            anchors: createDefaultRoomAnchorRules(arrangement, 1, 2),
          },
        ];
      }
      rooms = synchronizeRoomAnchors(rooms, arrangement);
      return {
        ...current,
        slab: { ...current.slab, arrangement, rooms },
        through: {
          ...current.through,
          enabled: arrangement === "single" ? false : current.through.enabled,
          direction:
            arrangement === "single"
              ? "none"
              : current.through.enabled
                ? arrangement
                : current.through.direction,
        },
      };
    });
  };

  const updateRoom = (id: string, room: SlabRoom) => {
    setState((current) => ({
      ...current,
      slab: {
        ...current.slab,
        rooms: current.slab.rooms.map((item) => (item.id === id ? room : item)),
      },
    }));
  };

  const moveRoom = (index: number, offset: -1 | 1) => {
    setState((current) => {
      const rooms = [...current.slab.rooms];
      const target = index + offset;
      if (target < 0 || target >= rooms.length) return current;
      [rooms[index], rooms[target]] = [rooms[target], rooms[index]];
      return {
        ...current,
        slab: {
          ...current.slab,
          rooms: synchronizeRoomAnchors(rooms, current.slab.arrangement),
        },
      };
    });
  };

  const deleteRoom = (id: string) => {
    const room = state.slab.rooms.find((item) => item.id === id);
    if (!window.confirm(`删除${room?.name || "该房间"}及其锚固设置，是否继续？`)) {
      return;
    }
    setState((current) => {
      const rooms = current.slab.rooms.filter((room) => room.id !== id);
      return {
        ...current,
        slab: {
          ...current.slab,
          rooms: synchronizeRoomAnchors(rooms, current.slab.arrangement),
        },
      };
    });
  };

  const updateBar = (
    layer: BarLayer,
    direction: BarDirection,
    settings: BarSettings,
  ) => {
    setState((current) => ({
      ...current,
      [layer]: {
        ...current[layer],
        [direction]: { ...current[layer][direction], ...settings },
      },
    }));
  };

  const updateTopExtraMode = (
    direction: BarDirection,
    extraMode: TopExtraMode,
  ) => {
    setState((current) => ({
      ...current,
      top: {
        ...current.top,
        [direction]: { ...current.top[direction], extraMode },
      },
    }));
  };

  const updateRoomAnchor = (
    roomId: string,
    layer: BarLayer,
    direction: BarDirection,
    endpoint: "start" | "end",
    rule: AnchorRule,
  ) => {
    setState((current) => ({
      ...current,
      slab: {
        ...current.slab,
        rooms: current.slab.rooms.map((room) =>
          room.id === roomId
            ? {
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
              }
            : room,
        ),
      },
    }));
  };

  const restoreRoomAnchor = (
    roomId: string,
    layer: BarLayer,
    direction: BarDirection,
    endpoint: "start" | "end",
  ) => {
    setState((current) => ({
      ...current,
      slab: {
        ...current.slab,
        rooms: restoreRoomAnchorToAuto(
          current.slab.rooms,
          current.slab.arrangement,
          roomId,
          layer,
          direction,
          endpoint,
        ),
      },
    }));
  };

  const resetData = () => {
    if (window.confirm("重置将清除当前房间和锚固设置，是否继续？")) {
      setState(cloneDefaultSlabCalculatorState());
    }
  };

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
              <div className="mb-2 flex items-center gap-2 text-blue-300">
                <Calculator size={20} />
                <span className="text-sm font-semibold tracking-wide">RebarViz · 计算器</span>
              </div>
              <h1 className="text-2xl font-bold sm:text-3xl">楼板钢筋计算器</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                楼板基础参数统一驱动房间、墙厚、锚固、根数、重量与通墙示意，结果随输入实时更新。
              </p>
            </div>
            <button
              type="button"
              onClick={resetData}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
            >
              <RotateCcw size={16} />
              重置数据
            </button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)] xl:items-start">
          <div className="space-y-6">
          <Section
            number={1}
            title="楼板基础参数"
            description="这里是房间尺寸、墙厚、保护层和面筋增加值的唯一数据源。"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {arrangementOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setArrangement(option.value)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${state.slab.arrangement === option.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-300"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {state.slab.rooms.map((room, index) => (
                <RoomEditor
                  key={room.id}
                  room={room}
                  index={index}
                  roomCount={state.slab.rooms.length}
                  arrangement={state.slab.arrangement}
                  onChange={(next) => updateRoom(room.id, next)}
                  onMove={(offset) => moveRoom(index, offset)}
                  onDelete={() => deleteRoom(room.id)}
                />
              ))}
            </div>
            {state.slab.arrangement !== "single" && (
              <button
                type="button"
                onClick={() =>
                  setState((current) => {
                    const first = current.slab.rooms[0];
                    const nextIndex = current.slab.rooms.length;
                    const room: SlabRoom = {
                      id: `room-${Date.now()}`,
                      name: `房间${String.fromCharCode(65 + nextIndex)}`,
                      spanX: current.slab.arrangement === "y" ? (first?.spanX ?? 4200) : 3600,
                      spanY: current.slab.arrangement === "x" ? (first?.spanY ?? 3600) : 3600,
                      anchors: createDefaultRoomAnchorRules(
                        current.slab.arrangement,
                        nextIndex,
                        nextIndex + 1,
                      ),
                    };
                    const rooms = synchronizeRoomAnchors(
                      [...current.slab.rooms, room],
                      current.slab.arrangement,
                    );
                    return {
                      ...current,
                      slab: { ...current.slab, rooms },
                    };
                  })
                }
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                <Plus size={16} /> 添加房间
              </button>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <NumberField
                label="内墙厚度"
                value={state.slab.innerWallThickness}
                onChange={(innerWallThickness) =>
                  setState((current) => ({
                    ...current,
                    slab: { ...current.slab, innerWallThickness },
                  }))
                }
              />
              <NumberField
                label="外墙厚度"
                value={state.slab.outerWallThickness}
                onChange={(outerWallThickness) =>
                  setState((current) => ({
                    ...current,
                    slab: { ...current.slab, outerWallThickness },
                  }))
                }
              />
              <NumberField
                label="保护层"
                value={state.slab.cover}
                onChange={(cover) =>
                  setState((current) => ({ ...current, slab: { ...current.slab, cover } }))
                }
              />
              <NumberField
                label="面筋锚固增加值"
                value={state.slab.topAnchorExtra}
                onChange={(topAnchorExtra) =>
                  setState((current) => ({
                    ...current,
                    slab: { ...current.slab, topAnchorExtra },
                  }))
                }
              />
              <label>
                <span className={labelClass}>根数算法</span>
                <select
                  className={fieldClass}
                  value={state.slab.countMode}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      slab: {
                        ...current.slab,
                        countMode: event.target.value as "project" | "cover",
                      },
                    }))
                  }
                >
                  <option value="project">项目算法</option>
                  <option value="cover">保护层算法</option>
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              中间墙数量由房间数自动确定：当前 {Math.max(state.slab.rooms.length - 1, 0)} 道；无需也不能在房间末尾重复输入墙厚。
            </p>
          </Section>

          <Section number={2} title="地筋参数" description="地筋锚固直接取选中的墙厚，手动输入时直接采用最终值。">
            <div className="grid gap-4 xl:grid-cols-2">
              <BarSettingsCard
                title="地筋 X向"
                direction="x"
                layer="bottom"
                settings={state.bottom.x}
                state={state}
                onChange={(settings) => updateBar("bottom", "x", settings)}
                onAnchorChange={(roomId, endpoint, rule) =>
                  updateRoomAnchor(roomId, "bottom", "x", endpoint, rule)
                }
                onRestoreAuto={(roomId, endpoint) =>
                  restoreRoomAnchor(roomId, "bottom", "x", endpoint)
                }
              />
              <BarSettingsCard
                title="地筋 Y向"
                direction="y"
                layer="bottom"
                settings={state.bottom.y}
                state={state}
                onChange={(settings) => updateBar("bottom", "y", settings)}
                onAnchorChange={(roomId, endpoint, rule) =>
                  updateRoomAnchor(roomId, "bottom", "y", endpoint, rule)
                }
                onRestoreAuto={(roomId, endpoint) =>
                  restoreRoomAnchor(roomId, "bottom", "y", endpoint)
                }
              />
            </div>
          </Section>

          <Section
            number={3}
            title="面筋与通墙参数"
            description="面筋墙体模式为墙厚加统一增加值；通墙只设置方向和整条路径最外侧锚固。"
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <BarSettingsCard
                title="面筋 X向"
                direction="x"
                layer="top"
                settings={state.top.x}
                state={state}
                onChange={(settings) => updateBar("top", "x", settings)}
                extraMode={state.top.x.extraMode ?? "both"}
                onExtraModeChange={(mode) => updateTopExtraMode("x", mode)}
                onAnchorChange={(roomId, endpoint, rule) =>
                  updateRoomAnchor(roomId, "top", "x", endpoint, rule)
                }
                onRestoreAuto={(roomId, endpoint) =>
                  restoreRoomAnchor(roomId, "top", "x", endpoint)
                }
              />
              <BarSettingsCard
                title="面筋 Y向"
                direction="y"
                layer="top"
                settings={state.top.y}
                state={state}
                onChange={(settings) => updateBar("top", "y", settings)}
                extraMode={state.top.y.extraMode ?? "both"}
                onExtraModeChange={(mode) => updateTopExtraMode("y", mode)}
                onAnchorChange={(roomId, endpoint, rule) =>
                  updateRoomAnchor(roomId, "top", "y", endpoint, rule)
                }
                onRestoreAuto={(roomId, endpoint) =>
                  restoreRoomAnchor(roomId, "top", "y", endpoint)
                }
              />
            </div>

            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900">面筋通墙计算</h3>
                  <p className="mt-1 text-xs text-slate-600">房间尺寸、内墙厚、保护层和增加值均直接读取楼板基础参数。</p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={state.through.enabled}
                    disabled={state.slab.arrangement === "single"}
                    onChange={(event) =>
                      setState((current) => ({
                        ...current,
                        through: {
                          ...current.through,
                          enabled: event.target.checked,
                          direction: event.target.checked
                            ? current.slab.arrangement === "single"
                              ? "none"
                              : current.slab.arrangement
                            : "none",
                        },
                      }))
                    }
                    className="h-5 w-5 rounded border-slate-300 text-blue-600 disabled:opacity-40"
                  />
                  启用通墙
                </label>
              </div>

              {state.through.enabled && (
                <div className="mt-4">
                  <div className="rounded-lg border border-amber-300 bg-white px-4 py-3 text-sm text-slate-700">
                    通墙方向跟随房间排列：
                    <strong className="ml-1 text-amber-800">
                      {state.slab.arrangement === "x"
                        ? "X向（西→东）"
                        : "Y向（南→北）"}
                    </strong>
                  </div>
                  <div className="mt-3">
                    <TopExtraModeSelector
                      direction={state.through.direction === "y" ? "y" : "x"}
                      throughWall
                      mode={state.through.extraMode ?? "both"}
                      onChange={(extraMode) =>
                        setState((current) => ({
                          ...current,
                          through: { ...current.through, extraMode },
                        }))
                      }
                    />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <AnchorRuleField
                      label={state.through.direction === "y" ? "整条路径最南端" : "整条路径最西端"}
                      rule={state.through.startAnchor}
                      layer="top"
                      state={state}
                      applyTopExtra={shouldApplyTopExtra(
                        state.through.extraMode ?? "both",
                        "start",
                      )}
                      onChange={(startAnchor) =>
                        setState((current) => ({
                          ...current,
                          through: {
                            ...current.through,
                            startAnchor: { ...startAnchor, origin: "user" },
                          },
                        }))
                      }
                      onRestoreAuto={() =>
                        setState((current) => ({
                          ...current,
                          through: {
                            ...current.through,
                            startAnchor: {
                              source: "outer-wall",
                              manualValue: 0,
                              origin: "auto",
                            },
                          },
                        }))
                      }
                    />
                    <AnchorRuleField
                      label={state.through.direction === "y" ? "整条路径最北端" : "整条路径最东端"}
                      rule={state.through.endAnchor}
                      layer="top"
                      state={state}
                      applyTopExtra={shouldApplyTopExtra(
                        state.through.extraMode ?? "both",
                        "end",
                      )}
                      onChange={(endAnchor) =>
                        setState((current) => ({
                          ...current,
                          through: {
                            ...current.through,
                            endAnchor: { ...endAnchor, origin: "user" },
                          },
                        }))
                      }
                      onRestoreAuto={() =>
                        setState((current) => ({
                          ...current,
                          through: {
                            ...current.through,
                            endAnchor: {
                              source: "outer-wall",
                              manualValue: 0,
                              origin: "auto",
                            },
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </Section>

          </div>

          <aside className="space-y-4 xl:sticky xl:top-20">
            <section data-testid="validation-status" className={`rounded-2xl border p-4 shadow-sm ${calculation.isValid ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={17} />
                {calculation.isValid ? "校验通过" : "输入无效"}
              </div>
              {!calculation.isValid && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-800">
                  {calculation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </section>

            <section data-testid="total-weight" className={`rounded-2xl p-5 text-white shadow-sm ${calculation.isValid ? "bg-slate-900" : "bg-rose-800"}`}>
              <p className="text-sm text-slate-200">全部钢筋合计重量</p>
              <p className="mt-1 text-3xl font-bold">
                {calculation.totalWeightKg === null
                  ? "--"
                  : `${calculation.totalWeightKg.toFixed(2)} kg`}
              </p>
              {!calculation.isValid && (
                <p className="mt-2 text-sm text-rose-100">不生成长度、重量或普通面筋替代结果。</p>
              )}
            </section>

            {calculation.throughWall && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
                <h3 className="font-semibold">通墙关键公式</h3>
                <div className="mt-3 space-y-2 text-xs leading-5">
                  <p>净尺寸：{calculation.throughWall.netSpanTotal}mm</p>
                  <p>中间墙：{calculation.throughWall.intermediateWallTotal}mm</p>
                  <p>
                    单根长度：{calculation.throughWall.throughBar.netRunSpanMm} + {calculation.throughWall.intermediateWallTotal} + {calculation.throughWall.throughBar.startAnchor} + {calculation.throughWall.throughBar.endAnchor} = {(calculation.throughWall.throughBar.singleLengthM * 1000).toFixed(0)}mm
                  </p>
                  <p>
                    垂直筋根数：ceil({calculation.throughWall.netSpanTotal} / {calculation.throughWall.perpendicularBar.spacing}) = {calculation.throughWall.perpendicularBar.count}根
                  </p>
                </div>
              </section>
            )}

            <SlabDiagram state={state} calculation={calculation} />
          </aside>
        </div>

        <div className="mt-6">
          <Section
            number={4}
            title="详细计算结果"
            description="结果表、总重量和示意图均读取同一份已校验计算结果。"
          >
            {calculation.isValid ? (
              <ResultsTable results={calculation.results} state={state} />
            ) : (
              <div className="rounded-xl border border-dashed border-rose-300 bg-rose-50 p-6 text-center text-sm font-medium text-rose-700">
                输入无效，当前不显示任何长度、根数或重量结果。
              </div>
            )}
            <div className="mt-4 grid gap-3 text-xs leading-5 text-slate-600 md:grid-cols-2">
              <p className="rounded-lg bg-white p-3">
                X向沿西→东运行，根数按南北净尺寸；Y向沿南→北运行，根数按东西净尺寸。保护层算法仅在整个计算宽度最外侧扣减两次保护层。
              </p>
              <p className="rounded-lg bg-white p-3">
                中间墙厚只进入通墙方向面筋的单根运行长度，不进入任何根数计算，也不在中间墙位置增加锚固。
              </p>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}
