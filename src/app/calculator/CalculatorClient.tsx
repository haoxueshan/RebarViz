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
  resolveBottomAnchor,
  resolveTopAnchor,
  type AnchorRule,
  type AnchorSource,
  type BarDirection,
  type BarLayer,
  type BarResult,
  type BarSettings,
  type RoomArrangement,
  type SlabCalculatorState,
  type SlabRoom,
} from "@/lib/slab-calculator";

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
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
  onChange: (rule: AnchorRule) => void;
};

function AnchorRuleField({
  label,
  rule,
  layer,
  state,
  onChange,
}: AnchorRuleFieldProps) {
  const resolved =
    layer === "bottom"
      ? resolveBottomAnchor(rule, state.slab)
      : resolveTopAnchor(rule, state.slab);
  const wall =
    rule.source === "inner-wall"
      ? state.slab.innerWallThickness
      : state.slab.outerWallThickness;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label>
        <span className={labelClass}>{label}锚固来源</span>
        <select
          className={fieldClass}
          value={rule.source}
          onChange={(event) =>
            onChange({ ...rule, source: event.target.value as AnchorSource })
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
            onChange={(manualValue) => onChange({ ...rule, manualValue })}
          />
          <p className="mt-1 text-xs text-slate-500">手动值直接作为最终值，不叠加墙厚或增加值。</p>
        </div>
      ) : (
        <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-600">
          {layer === "top" ? (
            <>
              计算过程：{sourceLabel(rule.source)} {wall} + 增加 {state.slab.topAnchorExtra} ={" "}
              <strong className="text-blue-700">{resolved}mm</strong>
            </>
          ) : (
            <>
              计算结果：{sourceLabel(rule.source)} {wall} ={" "}
              <strong className="text-blue-700">{resolved}mm</strong>
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
};

function BarSettingsCard({
  title,
  direction,
  layer,
  settings,
  state,
  onChange,
}: BarSettingsCardProps) {
  const [startLabel, endLabel] = endLabels(direction);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AnchorRuleField
          label={startLabel}
          rule={settings.startAnchor}
          layer={layer}
          state={state}
          onChange={(startAnchor) => onChange({ ...settings, startAnchor })}
        />
        <AnchorRuleField
          label={endLabel}
          rule={settings.endAnchor}
          layer={layer}
          state={state}
          onChange={(endAnchor) => onChange({ ...settings, endAnchor })}
        />
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

function anchorResultLabel(source: AnchorSource, value: number): string {
  return `${sourceLabel(source)} ${value.toFixed(0)}mm`;
}

function ResultsTable({ results }: { results: BarResult[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-[1120px] w-full text-left text-sm">
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
              <td className="px-3 py-3">{anchorResultLabel(result.startAnchorSource, result.startAnchor)}</td>
              <td className="px-3 py-3">{anchorResultLabel(result.endAnchorSource, result.endAnchor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlabDiagram({
  state,
  results,
}: {
  state: SlabCalculatorState;
  results: BarResult[];
}) {
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
  const throughDirection =
    state.through.enabled && state.through.direction !== "none"
      ? state.through.direction
      : null;
  const visible: React.ReactNode[] = [];
  const pushLine = (node: React.ReactNode) => {
    if (visible.length < 60) visible.push(node);
  };

  rooms.forEach((room, roomIndex) => {
    const x = frameX + (horizontal ? roomIndex * (roomW + gap) : 0);
    const y = frameY + (horizontal ? 0 : roomIndex * (roomH + gap));
    const roomResults = results.filter((result) => result.scopeName === room.name);
    const bottomXCount = roomResults.find((r) => r.layer === "bottom" && r.direction === "x")?.count ?? 4;
    const bottomYCount = roomResults.find((r) => r.layer === "bottom" && r.direction === "y")?.count ?? 4;
    const localLineCountX = Math.min(Math.max(bottomXCount, 1), 4);
    const localLineCountY = Math.min(Math.max(bottomYCount, 1), 4);

    for (let line = 1; line <= localLineCountX; line += 1) {
      const lineY = y + (line * roomH) / (localLineCountX + 1);
      pushLine(<line key={`bx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" />);
    }
    for (let line = 1; line <= localLineCountY; line += 1) {
      const lineX = x + (line * roomW) / (localLineCountY + 1);
      pushLine(<line key={`by-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + roomH - 8} stroke="#059669" strokeWidth="2" />);
    }

    if (throughDirection !== "x") {
      for (let line = 1; line <= 3; line += 1) {
        const lineY = y + (line * roomH) / 4 + 4;
        pushLine(<line key={`tx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
    if (throughDirection !== "y") {
      for (let line = 1; line <= 3; line += 1) {
        const lineX = x + (line * roomW) / 4 + 4;
        pushLine(<line key={`ty-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + roomH - 8} stroke="#059669" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
  });

  if (throughDirection === "x") {
    for (let line = 1; line <= 4; line += 1) {
      const y = frameY + (line * frameH) / 5;
      pushLine(<line key={`through-x-${line}`} x1={frameX + 5} y1={y} x2={frameX + frameW - 5} y2={y} stroke="#2563eb" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }
  if (throughDirection === "y") {
    for (let line = 1; line <= 4; line += 1) {
      const x = frameX + (line * frameW) / 5;
      pushLine(<line key={`through-y-${line}`} x1={x} y1={frameY + 5} x2={x} y2={frameY + frameH - 5} stroke="#059669" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }

  const throughStart = state.through.startAnchor.source;
  const throughEnd = state.through.endAnchor.source;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox="0 0 700 410" className="min-w-[620px] w-full" role="img" aria-label="楼板房间及钢筋方向示意图">
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
                  <rect x={x + roomW} y={frameY} width={gap} height={frameH} fill="#cbd5e1" />
                ) : (
                  <rect x={frameX} y={y + roomH} width={frameW} height={gap} fill="#cbd5e1" />
                )
              )}
            </g>
          );
        })}
        {visible}
        <text x="60" y="380" fontSize="12" fill="#2563eb">蓝色：X向</text>
        <text x="150" y="380" fontSize="12" fill="#059669">绿色：Y向</text>
        <text x="240" y="380" fontSize="12" fill="#475569">实线：地筋　虚线：面筋</text>
        {throughDirection && (
          <>
            <text x="60" y="25" fontSize="12" fill="#92400e">
              通墙路径起点：{sourceLabel(throughStart)}
            </text>
            <text x="640" y="25" textAnchor="end" fontSize="12" fill="#92400e">
              终点：{sourceLabel(throughEnd)}
            </text>
          </>
        )}
      </svg>
      <p className="mt-2 text-xs text-slate-500">图示最多绘制60条代表线；实际根数始终使用完整计算结果。</p>
    </div>
  );
}

export function CalculatorClient() {
  const [state, setState] = useState<SlabCalculatorState>(() =>
    cloneDefaultSlabCalculatorState(),
  );
  const calculation = useMemo(() => calculateSlabResults(state), [state]);

  const setArrangement = (arrangement: RoomArrangement) => {
    setState((current) => {
      let rooms = current.slab.rooms;
      if (arrangement === "single") {
        rooms = [rooms[0] ?? { id: "room-a", name: "房间A", spanX: 4200, spanY: 3600 }];
      } else if (rooms.length < 2) {
        const first = rooms[0] ?? { id: "room-a", name: "房间A", spanX: 4200, spanY: 3600 };
        rooms = [
          first,
          {
            id: `room-${Date.now()}`,
            name: "房间B",
            spanX: 3600,
            spanY: arrangement === "x" ? first.spanY : 3600,
          },
        ];
        if (arrangement === "y") rooms[1].spanX = first.spanX;
      }
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
      return { ...current, slab: { ...current.slab, rooms } };
    });
  };

  const updateBar = (
    layer: BarLayer,
    direction: BarDirection,
    settings: BarSettings,
  ) => {
    setState((current) => ({
      ...current,
      [layer]: { ...current[layer], [direction]: settings },
    }));
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
              onClick={() => setState(cloneDefaultSlabCalculatorState())}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
            >
              <RotateCcw size={16} />
              重置数据
            </button>
          </div>
        </header>

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
                  onDelete={() =>
                    setState((current) => ({
                      ...current,
                      slab: {
                        ...current.slab,
                        rooms: current.slab.rooms.filter((item) => item.id !== room.id),
                      },
                    }))
                  }
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
                    };
                    return {
                      ...current,
                      slab: { ...current.slab, rooms: [...current.slab.rooms, room] },
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
              />
              <BarSettingsCard
                title="地筋 Y向"
                direction="y"
                layer="bottom"
                settings={state.bottom.y}
                state={state}
                onChange={(settings) => updateBar("bottom", "y", settings)}
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
              />
              <BarSettingsCard
                title="面筋 Y向"
                direction="y"
                layer="top"
                settings={state.top.y}
                state={state}
                onChange={(settings) => updateBar("top", "y", settings)}
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
                    className="h-5 w-5 rounded border-slate-300 text-blue-600"
                  />
                  启用通墙
                </label>
              </div>

              {state.through.enabled && (
                <div className="mt-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["x", "y"] as const).map((direction) => (
                      <button
                        key={direction}
                        type="button"
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            through: { ...current.through, direction },
                          }))
                        }
                        className={`rounded-lg border px-4 py-2 text-sm font-medium ${state.through.direction === direction ? "border-amber-600 bg-amber-600 text-white" : "border-amber-300 bg-white text-slate-700"}`}
                      >
                        {direction === "x" ? "X向通墙（西→东）" : "Y向通墙（南→北）"}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <AnchorRuleField
                      label={state.through.direction === "y" ? "整条路径最南端" : "整条路径最西端"}
                      rule={state.through.startAnchor}
                      layer="top"
                      state={state}
                      onChange={(startAnchor) =>
                        setState((current) => ({
                          ...current,
                          through: { ...current.through, startAnchor },
                        }))
                      }
                    />
                    <AnchorRuleField
                      label={state.through.direction === "y" ? "整条路径最北端" : "整条路径最东端"}
                      rule={state.through.endAnchor}
                      layer="top"
                      state={state}
                      onChange={(endAnchor) =>
                        setState((current) => ({
                          ...current,
                          through: { ...current.through, endAnchor },
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section
            number={4}
            title="计算结果和示意图"
            description="地筋始终按房间分别计算；通墙启用且校验通过时，通墙方向面筋直接替换普通面筋。"
          >
            {calculation.errors.length > 0 && (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertCircle size={17} /> 请修正以下输入
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {calculation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
                {state.through.enabled && (
                  <p className="mt-2 text-xs">通墙校验失败时暂按各房间普通面筋显示，避免使用错误的连续区结果。</p>
                )}
              </div>
            )}

            {calculation.throughWall && (
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                  净尺寸合计 <strong>{calculation.throughWall.netSpanTotal}mm</strong>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  中间墙合计 <strong>{calculation.throughWall.intermediateWallTotal}mm</strong>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                  通墙方向 <strong>{calculation.throughWall.direction.toUpperCase()}向</strong>
                </div>
              </div>
            )}

            <ResultsTable results={calculation.results} />
            <div className="mt-4 rounded-xl bg-slate-900 p-5 text-white">
              <p className="text-sm text-slate-300">全部钢筋合计重量</p>
              <p className="mt-1 text-3xl font-bold">{calculation.totalWeightKg.toFixed(2)} kg</p>
            </div>

            <div className="mt-5">
              <SlabDiagram state={state} results={calculation.results} />
            </div>

            <div className="mt-4 grid gap-3 text-xs leading-5 text-slate-600 md:grid-cols-2">
              <p className="rounded-lg bg-white p-3">
                X向沿西→东运行，根数按南北净尺寸；Y向沿南→北运行，根数按东西净尺寸。保护层算法仅在整个计算宽度最外侧扣减两次保护层。
              </p>
              <p className="rounded-lg bg-white p-3">
                中间墙厚只进入通墙方向面筋的单根运行长度，不进入通墙方向或垂直方向的任何根数计算，也不在中间墙位置增加锚固。
              </p>
            </div>
          </Section>
        </div>
      </div>
    </main>
  );
}
