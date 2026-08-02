"use client";

import type { ReactNode } from "react";
import type {
  BarResult,
  SlabCalculation,
  SlabCalculatorState,
} from "@/lib/slab-calculator";

function frame(state: SlabCalculatorState) {
  const rooms = state.slab.rooms;
  const horizontal = state.slab.arrangement !== "y";
  const count = Math.max(rooms.length, 1);
  const gap = 12;
  const frameX = 60;
  const frameY = 58;
  const frameW = 580;
  const frameH = 270;
  return {
    rooms,
    horizontal,
    gap,
    frameX,
    frameY,
    frameW,
    frameH,
    roomW: horizontal ? (frameW - gap * (count - 1)) / count : frameW,
    roomH: horizontal ? frameH : (frameH - gap * (count - 1)) / count,
  };
}

function RoomFrames({ state }: { state: SlabCalculatorState }) {
  const layout = frame(state);
  return layout.rooms.map((room, index) => {
    const x = layout.frameX + (layout.horizontal ? index * (layout.roomW + layout.gap) : 0);
    const y = layout.frameY + (layout.horizontal ? 0 : index * (layout.roomH + layout.gap));
    return (
      <g key={room.id}>
        <rect x={x} y={y} width={layout.roomW} height={layout.roomH} fill="#fff" stroke="#94a3b8" strokeWidth="2" />
        <text x={x + layout.roomW / 2} y={y + 22} textAnchor="middle" fontSize="13" fill="#334155">
          {room.name} · {room.spanX}×{room.spanY}mm
        </text>
        {index < layout.rooms.length - 1 &&
          (layout.horizontal ? (
            <>
              <rect x={x + layout.roomW} y={layout.frameY} width={layout.gap} height={layout.frameH} fill="#cbd5e1" />
              <text x={x + layout.roomW + layout.gap / 2} y={layout.frameY - 8} textAnchor="middle" fontSize="10" fill="#475569">
                内墙{state.slab.innerWallThickness}mm
              </text>
            </>
          ) : (
            <>
              <rect x={layout.frameX} y={y + layout.roomH} width={layout.frameW} height={layout.gap} fill="#cbd5e1" />
              <text x={layout.frameX + layout.frameW - 4} y={y + layout.roomH + layout.gap - 2} textAnchor="end" fontSize="10" fill="#475569">
                内墙{state.slab.innerWallThickness}mm
              </text>
            </>
          ))}
      </g>
    );
  });
}

export function SlabLayoutDiagram({ state }: { state: SlabCalculatorState }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox="0 0 700 380" className="h-auto w-full max-w-full" role="img" aria-label="房间和墙体布局草图">
        <rect x="35" y="32" width="630" height="322" rx="8" fill="#f1f5f9" stroke="#64748b" strokeWidth="8" />
        <RoomFrames state={state} />
        <text x="60" y="375" fontSize="12" fill="#475569">
          布局草图仅表达房间顺序和墙体位置，不代表正式钢筋计算结果
        </text>
      </svg>
    </div>
  );
}

function lineCounts(results: BarResult[], roomId: string, direction: "x" | "y") {
  return (
    results.find(
      (result) =>
        result.roomId === roomId &&
        result.layer === "bottom" &&
        result.direction === direction,
    )?.count ?? 1
  );
}

export function SlabResultsDiagram({
  state,
  calculation,
}: {
  state: SlabCalculatorState;
  calculation: SlabCalculation;
}) {
  const layout = frame(state);
  const normalLines: ReactNode[] = [];
  const throughLines: ReactNode[] = [];
  const throughDirection = calculation.throughWall?.direction ?? null;
  const throughBar = calculation.throughWall?.throughBar;
  const throughExtraLabel = throughBar
    ? throughBar.topExtraMode === "both"
      ? "两端增加"
      : `${throughBar.throughWall ? "最" : ""}${
          throughBar.direction === "x"
            ? throughBar.topExtraMode === "start" ? "西端" : "东端"
            : throughBar.topExtraMode === "start" ? "南端" : "北端"
        }增加`
    : null;

  layout.rooms.forEach((room, roomIndex) => {
    const x = layout.frameX + (layout.horizontal ? roomIndex * (layout.roomW + layout.gap) : 0);
    const y = layout.frameY + (layout.horizontal ? 0 : roomIndex * (layout.roomH + layout.gap));
    const countX = Math.min(Math.max(lineCounts(calculation.results, room.id, "x"), 1), 4);
    const countY = Math.min(Math.max(lineCounts(calculation.results, room.id, "y"), 1), 4);
    for (let line = 1; line <= countX; line += 1) {
      const lineY = y + (line * layout.roomH) / (countX + 1);
      normalLines.push(<line key={`bx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + layout.roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" />);
    }
    for (let line = 1; line <= countY; line += 1) {
      const lineX = x + (line * layout.roomW) / (countY + 1);
      normalLines.push(<line key={`by-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + layout.roomH - 8} stroke="#059669" strokeWidth="2" />);
    }
    if (throughDirection !== "x") {
      for (let line = 1; line <= 3; line += 1) {
        const lineY = y + (line * layout.roomH) / 4 + 4;
        normalLines.push(<line key={`tx-${room.id}-${line}`} x1={x + 8} y1={lineY} x2={x + layout.roomW - 8} y2={lineY} stroke="#2563eb" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
    if (throughDirection !== "y") {
      for (let line = 1; line <= 3; line += 1) {
        const lineX = x + (line * layout.roomW) / 4 + 4;
        normalLines.push(<line key={`ty-${room.id}-${line}`} x1={lineX} y1={y + 8} x2={lineX} y2={y + layout.roomH - 8} stroke="#059669" strokeWidth="2" strokeDasharray="7 5" />);
      }
    }
  });

  if (throughDirection === "x") {
    for (let line = 1; line <= 4; line += 1) {
      const y = layout.frameY + (line * layout.frameH) / 5;
      throughLines.push(<line key={`through-x-${line}`} x1={layout.frameX + 5} y1={y} x2={layout.frameX + layout.frameW - 5} y2={y} stroke="#2563eb" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }
  if (throughDirection === "y") {
    for (let line = 1; line <= 4; line += 1) {
      const x = layout.frameX + (line * layout.frameW) / 5;
      throughLines.push(<line key={`through-y-${line}`} x1={x} y1={layout.frameY + 5} x2={x} y2={layout.frameY + layout.frameH - 5} stroke="#059669" strokeWidth="3" strokeDasharray="8 5" />);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <svg viewBox="0 0 700 410" className="h-auto w-full max-w-full" role="img" aria-label="正式楼板钢筋计算示意图">
        <rect x="35" y="32" width="630" height="322" rx="8" fill="#f1f5f9" stroke="#64748b" strokeWidth="8" />
        <RoomFrames state={state} />
        {[...throughLines, ...normalLines].slice(0, 60)}
        <text x="60" y="380" fontSize="12" fill="#2563eb">蓝色：X向</text>
        <text x="150" y="380" fontSize="12" fill="#059669">绿色：Y向</text>
        <text x="240" y="380" fontSize="12" fill="#475569">实线：地筋　虚线：面筋</text>
        {throughExtraLabel && <text x="640" y="400" textAnchor="end" fontSize="12" fill="#92400e">通墙面筋增加：{throughExtraLabel}</text>}
      </svg>
      <p className="mt-2 text-xs text-slate-500">最多绘制60条代表线；真实根数始终读取完整计算记录。</p>
    </div>
  );
}
