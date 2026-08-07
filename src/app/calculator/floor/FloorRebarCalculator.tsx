"use client";

import {
  Copy,
  Grid2X2,
  House,
  Info,
  Move,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalculatorModeNav } from "@/components/calculator/CalculatorModeNav";
import {
  buildFloorBoundarySegments,
  DEFAULT_FLOOR_PLAN_STATE,
  floorPlanBounds,
  normalizeFloorPlanState,
  snapFloorSlab,
  validateFloorPlan,
  type FloorPlanState,
  type FloorSlab,
} from "@/lib/floor-plan";

const FLOOR_DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 650;
const PLOT = { x: 72, y: 54, width: 856, height: 520 };

type DragState = {
  pointerId: number;
  slabId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  pixelsPerWorldX: number;
  pixelsPerWorldY: number;
};

function cloneDefaultState(): FloorPlanState {
  return structuredClone(DEFAULT_FLOOR_PLAN_STATE);
}

function nextRoomName(slabs: FloorSlab[]): string {
  const alphabetIndex = slabs.length;
  return alphabetIndex < 26 ? `房间${String.fromCharCode(65 + alphabetIndex)}` : `房间${alphabetIndex + 1}`;
}

function nextRoomId(): string {
  return `floor-room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function DraftNumberField({
  label,
  value,
  onChange,
  min,
  suffix = "mm",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const displayedValue = draft ?? String(value);

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="decimal"
          value={displayedValue}
          min={min}
          onFocus={(event) => {
            setDraft(String(value));
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw.trim() === "") return;
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          onBlur={() => {
            setDraft(null);
          }}
          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{suffix}</span>
      </span>
    </label>
  );
}

function WorkflowTabs() {
  const items = ["楼层", "地筋", "面筋", "屋檐", "料单"];
  return (
    <div className="mb-5 grid grid-cols-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="整层计算步骤">
      {items.map((item, index) => (
        <div
          key={item}
          className={`min-w-0 px-1 py-3 text-center text-xs font-semibold sm:text-sm ${index === 0 ? "bg-blue-600 text-white" : "border-l border-slate-200 bg-slate-50 text-slate-400"}`}
          aria-current={index === 0 ? "step" : undefined}
        >
          <span className="hidden sm:inline">{index + 1}. </span>{item}
          {index > 0 && <span className="ml-1 hidden text-[10px] font-normal lg:inline">后续阶段</span>}
        </div>
      ))}
    </div>
  );
}

function FloorCanvas({
  state,
  selectedId,
  onSelect,
  onMove,
}: {
  state: FloorPlanState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number, finished: boolean) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const bounds = useMemo(() => floorPlanBounds(state.slabs), [state.slabs]);
  const walls = useMemo(() => buildFloorBoundarySegments(state), [state]);
  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(state.outerWallThickness, 240) * 1.6;
  const scale = Math.min(PLOT.width / (worldWidth + padding * 2), PLOT.height / (worldHeight + padding * 2));
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = PLOT.x + (PLOT.width - drawnWidth) / 2 - bounds.minX * scale;
  const originY = PLOT.y + (PLOT.height - drawnHeight) / 2 + bounds.maxY * scale;
  const toX = (x: number) => originX + x * scale;
  const toY = (y: number) => originY - y * scale;

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = state.slabs.find((slab) => slab.id === drag.slabId);
    if (moved) onMove(moved.id, moved.x, moved.y, true);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">整层房间拼图</h2>
          <p className="mt-0.5 text-xs text-slate-500">拖动房间自动吸附；坐标以西南角为原点，X向东、Y向北。</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"><Move size={13} /> 可拖动</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="block h-auto w-full touch-none bg-white"
        role="img"
        aria-label="整层房间和内外墙布局预览"
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const x = drag.startX + (event.clientX - drag.startClientX) * drag.pixelsPerWorldX;
          const y = drag.startY - (event.clientY - drag.startClientY) * drag.pixelsPerWorldY;
          onMove(drag.slabId, Math.round(x), Math.round(y), false);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <defs>
          <pattern id="floor-grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e2e8f0" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" fill="url(#floor-grid)" stroke="#cbd5e1" />

        {state.slabs.map((slab, index) => {
          const x = toX(slab.x);
          const y = toY(slab.y + slab.height);
          const width = Math.max(slab.width * scale, 1);
          const height = Math.max(slab.height * scale, 1);
          const selected = selectedId === slab.id;
          return (
            <g key={slab.id}>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={selected ? "#dbeafe" : index % 2 === 0 ? "#f8fafc" : "#f1f5f9"}
                stroke={selected ? "#2563eb" : "#94a3b8"}
                strokeWidth={selected ? 4 : 2}
                className="cursor-move"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(slab.id);
                  const svg = svgRef.current;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    pointerId: event.pointerId,
                    slabId: slab.id,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startX: slab.x,
                    startY: slab.y,
                    pixelsPerWorldX: SVG_WIDTH / rect.width / scale,
                    pixelsPerWorldY: SVG_HEIGHT / rect.height / scale,
                  };
                }}
              />
              <title>{`${slab.name}：${formatMm(slab.width)} × ${formatMm(slab.height)}mm；坐标 (${formatMm(slab.x)}, ${formatMm(slab.y)})`}</title>
            </g>
          );
        })}

        {walls.map((wall) => {
          const strokeWidth = Math.max(3, Math.min(12, wall.thicknessMm * scale));
          return (
            <line
              key={wall.id}
              x1={toX(wall.startX)}
              y1={toY(wall.startY)}
              x2={toX(wall.endX)}
              y2={toY(wall.endY)}
              stroke={wall.type === "inner-wall" ? "#2563eb" : "#0f172a"}
              strokeWidth={strokeWidth}
              strokeLinecap="square"
              strokeDasharray={wall.type === "inner-wall" ? "12 7" : undefined}
              pointerEvents="none"
            />
          );
        })}

        {state.slabs.map((slab, index) => {
          const centerX = toX(slab.x + slab.width / 2);
          const centerY = toY(slab.y + slab.height / 2);
          const shortName = slab.name.length > 10 ? `${slab.name.slice(0, 9)}…` : slab.name;
          return (
            <g key={`label-${slab.id}`} pointerEvents="none">
              <rect x={centerX - 72} y={centerY - 27} width="144" height="54" rx="8" fill="white" fillOpacity="0.9" />
              <text x={centerX} y={centerY - 4} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">{shortName}</text>
              <text x={centerX} y={centerY + 16} textAnchor="middle" fontSize="12" fill="#475569">{`${formatMm(slab.width)} × ${formatMm(slab.height)} mm`}</text>
              <title>{`${index + 1}. ${slab.name}`}</title>
            </g>
          );
        })}

        <g aria-label="方向标识" fontSize="13" fill="#334155">
          <line x1="92" y1="608" x2="198" y2="608" stroke="#2563eb" strokeWidth="3" markerEnd="url(#none)" />
          <path d="M198 608 l-12 -6 v12 z" fill="#2563eb" />
          <text x="92" y="630">西</text><text x="202" y="630">东 · X</text>
          <line x1="48" y1="555" x2="48" y2="445" stroke="#dc2626" strokeWidth="3" />
          <path d="M48 445 l-6 12 h12 z" fill="#dc2626" />
          <text x="30" y="558">南</text><text x="24" y="432">北 · Y</text>
        </g>
        <g transform="translate(700 600)" fontSize="12" fill="#475569">
          <line x1="0" y1="0" x2="42" y2="0" stroke="#0f172a" strokeWidth="7" /><text x="50" y="4">外墙 {formatMm(state.outerWallThickness)}mm</text>
          <line x1="150" y1="0" x2="192" y2="0" stroke="#2563eb" strokeWidth="7" strokeDasharray="10 6" /><text x="200" y="4">内墙 {formatMm(state.innerWallThickness)}mm</text>
        </g>
      </svg>
    </div>
  );
}

export default function FloorRebarCalculator() {
  const [state, setState] = useState<FloorPlanState>(cloneDefaultState);
  const [selectedId, setSelectedId] = useState<string | null>(DEFAULT_FLOOR_PLAN_STATE.slabs[0].id);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FLOOR_DRAFT_KEY);
      if (saved) {
        const restored = normalizeFloorPlanState(JSON.parse(saved));
        setState(restored);
        setSelectedId(restored.slabs[0]?.id ?? null);
      }
    } catch {
      // 损坏草稿使用默认布局，避免阻塞页面。
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(FLOOR_DRAFT_KEY, JSON.stringify(state));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [hydrated, state]);

  const walls = useMemo(() => buildFloorBoundarySegments(state), [state]);
  const errors = useMemo(() => validateFloorPlan(state), [state]);
  const selected = state.slabs.find((slab) => slab.id === selectedId) ?? null;
  const innerWalls = walls.filter((wall) => wall.type === "inner-wall");
  const outerWalls = walls.filter((wall) => wall.type === "outer-wall");

  const updateSelected = (patch: Partial<FloorSlab>) => {
    if (!selectedId) return;
    setState((current) => ({
      ...current,
      slabs: current.slabs.map((slab) => slab.id === selectedId ? { ...slab, ...patch } : slab),
    }));
  };

  const addRoom = () => {
    const bounds = floorPlanBounds(state.slabs);
    const room: FloorSlab = {
      id: nextRoomId(),
      name: nextRoomName(state.slabs),
      x: bounds.maxX,
      y: bounds.minY,
      width: 3600,
      height: 3600,
    };
    setState((current) => ({ ...current, slabs: [...current.slabs, room] }));
    setSelectedId(room.id);
  };

  const duplicateRoom = () => {
    if (!selected) return;
    const room: FloorSlab = {
      ...selected,
      id: nextRoomId(),
      name: `${selected.name}副本`,
      x: selected.x + selected.width,
    };
    setState((current) => ({ ...current, slabs: [...current.slabs, room] }));
    setSelectedId(room.id);
  };

  const deleteRoom = () => {
    if (!selected || state.slabs.length <= 1) return;
    if (!window.confirm(`确定删除“${selected.name}”吗？`)) return;
    const next = state.slabs.filter((slab) => slab.id !== selected.id);
    setState((current) => ({ ...current, slabs: next }));
    setSelectedId(next[0]?.id ?? null);
  };

  const moveRoom = (id: string, x: number, y: number, finished: boolean) => {
    setState((current) => {
      const slab = current.slabs.find((item) => item.id === id);
      if (!slab) return current;
      const moved = { ...slab, x, y };
      const finalSlab = finished
        ? snapFloorSlab(moved, current.slabs.filter((item) => item.id !== id), current.snapDistanceMm)
        : moved;
      return { ...current, slabs: current.slabs.map((item) => item.id === id ? finalSlab : item) };
    });
  };

  if (!hydrated) {
    return <main className="mx-auto min-h-[60vh] max-w-7xl px-4 py-10 text-sm text-slate-500">正在恢复整层平面草稿…</main>;
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-blue-600">FloorRebarCalculator · 第一阶段</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">整层钢筋平铺计算</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">先拼出整层房间平面，并由共享边自动识别内墙和外墙。本阶段只建立几何与墙体拓扑，不生成钢筋工程量。</p>
      </header>

      <CalculatorModeNav />
      <WorkflowTabs />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.75fr)]">
        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addRoom} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={17} />添加房间</button>
            <button type="button" onClick={duplicateRoom} disabled={!selected} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Copy size={16} />复制房间</button>
            <button type="button" onClick={deleteRoom} disabled={!selected || state.slabs.length <= 1} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"><Trash2 size={16} />删除房间</button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("确定恢复整层平面默认数据吗？当前草稿将被替换。")) return;
                const next = cloneDefaultState();
                setState(next);
                setSelectedId(next.slabs[0].id);
                window.localStorage.removeItem(FLOOR_DRAFT_KEY);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            ><RotateCcw size={16} />重置平面</button>
          </div>

          <FloorCanvas state={state} selectedId={selectedId} onSelect={setSelectedId} onMove={moveRoom} />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><span className="text-xs text-slate-500">房间板块</span><strong className="mt-1 block text-2xl text-slate-950">{state.slabs.length}</strong></div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><span className="text-xs text-blue-700">共享内墙段</span><strong className="mt-1 block text-2xl text-blue-950">{innerWalls.length}</strong></div>
            <div className="rounded-2xl border border-slate-300 bg-slate-100 p-4"><span className="text-xs text-slate-600">外墙轮廓段</span><strong className="mt-1 block text-2xl text-slate-950">{outerWalls.length}</strong></div>
          </div>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><House size={18} className="text-blue-600" /><h2 className="font-semibold text-slate-900">整层设置</h2></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <DraftNumberField label="内墙厚度" value={state.innerWallThickness} min={1} onChange={(value) => setState((current) => ({ ...current, innerWallThickness: value }))} />
              <DraftNumberField label="外墙厚度" value={state.outerWallThickness} min={1} onChange={(value) => setState((current) => ({ ...current, outerWallThickness: value }))} />
              <DraftNumberField label="自动吸附距离" value={state.snapDistanceMm} min={0} onChange={(value) => setState((current) => ({ ...current, snapDistanceMm: value }))} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Grid2X2 size={18} className="text-blue-600" /><h2 className="font-semibold text-slate-900">房间精确参数</h2></div>
            {selected ? (
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">房间名称</span><input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
                <div className="grid grid-cols-2 gap-3">
                  <DraftNumberField label="西南角 X" value={selected.x} onChange={(value) => updateSelected({ x: value })} />
                  <DraftNumberField label="西南角 Y" value={selected.y} onChange={(value) => updateSelected({ y: value })} />
                  <DraftNumberField label="东西向净尺寸" value={selected.width} min={1} onChange={(value) => updateSelected({ width: value })} />
                  <DraftNumberField label="南北向净尺寸" value={selected.height} min={1} onChange={(value) => updateSelected({ height: value })} />
                </div>
                <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">坐标与尺寸单位统一为 mm。拖动结束后，房间边缘会在 {formatMm(state.snapDistanceMm)}mm 范围内自动吸附。</p>
              </div>
            ) : <p className="mt-4 text-sm text-slate-500">请在图中选择一个房间。</p>}
          </section>

          <section className={`rounded-2xl border p-5 ${errors.length === 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <h2 className={`font-semibold ${errors.length === 0 ? "text-emerald-900" : "text-rose-900"}`}>{errors.length === 0 ? "平面拓扑有效" : "需要修正平面"}</h2>
            {errors.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-emerald-800">房间未重叠，共享边已识别为内墙，其余暴露边界已识别为外墙。</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-rose-800">{errors.map((error) => <li key={error}>• {error}</li>)}</ul>
            )}
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
            <div className="flex items-start gap-2"><Info size={18} className="mt-0.5 shrink-0" /><div><strong>阶段范围</strong><p className="mt-1">当前仅完成整层拼图、吸附和墙体拓扑。地筋、面筋、通墙路径、屋檐和整层料单会在后续阶段基于这份平面继续实现。</p></div></div>
          </section>
        </aside>
      </div>
    </main>
  );
}
