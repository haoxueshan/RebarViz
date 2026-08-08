"use client";

import { Move } from "lucide-react";
import { useMemo, useRef } from "react";
import {
  buildFloorDisplayBoundarySegments,
  floorPlanObjectBounds,
  type FloorBoundarySegment,
  type FloorOpening,
  type FloorPlanState,
  type FloorSlab,
} from "@/lib/floor-plan";
import type { FloorBottomCalculation } from "@/lib/floor-bottom-calculator";

export type FloorSelection =
  | { kind: "slab"; id: string }
  | { kind: "opening"; id: string }
  | null;

type DragState = {
  pointerId: number;
  selection: Exclude<FloorSelection, null>;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  pixelsPerWorldX: number;
  pixelsPerWorldY: number;
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 650;
const PLOT = { x: 72, y: 54, width: 856, height: 520 };

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function wallStyle(segment: FloorBoundarySegment, scale: number) {
  if (segment.support === "outer-wall") return { stroke: "#0f172a", width: Math.max(4, Math.min(12, segment.thicknessMm * scale)), dash: undefined };
  if (segment.support === "inner-wall") return { stroke: "#2563eb", width: Math.max(4, Math.min(11, segment.thicknessMm * scale)), dash: undefined };
  if (segment.support === "continuous") return { stroke: "#64748b", width: 2.5, dash: "11 7" };
  return { stroke: "#94a3b8", width: 3, dash: "5 6" };
}

function slabFill(type: FloorSlab["type"], selected: boolean): string {
  if (selected) return "#dbeafe";
  if (type === "corridor") return "#ecfeff";
  if (type === "hall") return "#f5f3ff";
  if (type === "balcony") return "#f0fdf4";
  return "#f8fafc";
}

export function FloorCanvas({
  state,
  selection,
  selectedBoundaryId,
  onSelect,
  onSelectBoundary,
  onMove,
  bottomCalculation,
}: {
  state: FloorPlanState;
  selection: FloorSelection;
  selectedBoundaryId: string | null;
  onSelect: (selection: FloorSelection) => void;
  onSelectBoundary: (segment: FloorBoundarySegment) => void;
  onMove: (selection: Exclude<FloorSelection, null>, x: number, y: number, finished: boolean) => void;
  /** 仅消费正式Bottom计算结果；Canvas不计算根数、长度或重量。 */
  bottomCalculation?: FloorBottomCalculation;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const bounds = useMemo(() => floorPlanObjectBounds(state), [state]);
  const boundaries = useMemo(() => buildFloorDisplayBoundarySegments(state), [state]);
  const bottomLines = useMemo(
    () => new Map(bottomCalculation?.lines.map((line) => [line.id, line]) ?? []),
    [bottomCalculation],
  );
  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(state.outerWallThickness, 240) * 1.8;
  const scale = Math.min(PLOT.width / (worldWidth + padding * 2), PLOT.height / (worldHeight + padding * 2));
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = PLOT.x + (PLOT.width - drawnWidth) / 2 - bounds.minX * scale;
  const originY = PLOT.y + (PLOT.height - drawnHeight) / 2 + bounds.maxY * scale;
  const toX = (x: number) => originX + x * scale;
  const toY = (y: number) => originY - y * scale;

  const beginDrag = (
    event: React.PointerEvent<SVGRectElement>,
    nextSelection: Exclude<FloorSelection, null>,
    object: FloorSlab | FloorOpening,
  ) => {
    event.stopPropagation();
    onSelect(nextSelection);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      selection: nextSelection,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x,
      startY: object.y,
      pixelsPerWorldX: SVG_WIDTH / rect.width / scale,
      pixelsPerWorldY: SVG_HEIGHT / rect.height / scale,
    };
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const objects = drag.selection.kind === "slab" ? state.slabs : state.openings;
    const moved = objects.find((object) => object.id === drag.selection.id);
    if (moved) onMove(drag.selection, moved.x, moved.y, true);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">{bottomCalculation ? "整层地筋净跨路径" : "整层板区平面"}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{bottomCalculation ? "图中显示净跨钢筋路径；正式下料长度已包含端部墙厚。洞口会把同一理论线切成多个实物件。" : "板区表示存在水平楼板的区域；楼梯间等无板区域使用洞口建模。"}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"><Move size={13} /> 板区与洞口可拖动</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="block h-auto w-full touch-none bg-white"
        role="img"
        aria-label="整层板区、洞口和支承关系布局预览"
        onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const x = drag.startX + (event.clientX - drag.startClientX) * drag.pixelsPerWorldX;
          const y = drag.startY - (event.clientY - drag.startClientY) * drag.pixelsPerWorldY;
          onMove(drag.selection, Math.round(x), Math.round(y), false);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <defs>
          <pattern id="floor-grid-v2" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e2e8f0" strokeWidth="1" />
          </pattern>
          <pattern id="opening-hatch-v2" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="12" height="12" fill="#f8fafc" />
            <line x1="0" y1="0" x2="0" y2="12" stroke="#cbd5e1" strokeWidth="4" />
          </pattern>
        </defs>
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx="16" fill="url(#floor-grid-v2)" stroke="#cbd5e1" />

        {state.slabs.map((slab) => {
          const selected = selection?.kind === "slab" && selection.id === slab.id;
          return (
            <rect
              key={slab.id}
              x={toX(slab.x)}
              y={toY(slab.y + slab.height)}
              width={Math.max(slab.width * scale, 1)}
              height={Math.max(slab.height * scale, 1)}
              fill={slabFill(slab.type, selected)}
              stroke={selected ? "#2563eb" : "#94a3b8"}
              strokeWidth={selected ? 4 : 1.5}
              className="cursor-move"
              role="button"
              aria-label={`选择板区 ${slab.name}`}
              tabIndex={0}
              onPointerDown={(event) => beginDrag(event, { kind: "slab", id: slab.id }, slab)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect({ kind: "slab", id: slab.id }); }}
            >
              <title>{`${slab.name}：${formatMm(slab.width)} × ${formatMm(slab.height)}mm`}</title>
            </rect>
          );
        })}

        {state.openings.map((opening) => {
          const selected = selection?.kind === "opening" && selection.id === opening.id;
          return (
            <rect
              key={`opening-fill-${opening.id}`}
              x={toX(opening.x)}
              y={toY(opening.y + opening.height)}
              width={Math.max(opening.width * scale, 1)}
              height={Math.max(opening.height * scale, 1)}
              fill="url(#opening-hatch-v2)"
              stroke="transparent"
              className="cursor-move"
              role="button"
              aria-label={`选择洞口 ${opening.name}`}
              tabIndex={0}
              onPointerDown={(event) => beginDrag(event, { kind: "opening", id: opening.id }, opening)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect({ kind: "opening", id: opening.id }); }}
            >
              <title>{`${opening.name} VOID：${formatMm(opening.width)} × ${formatMm(opening.height)}mm${selected ? "（已选择）" : ""}`}</title>
            </rect>
          );
        })}

        {bottomCalculation?.isValid && bottomCalculation.pieces.map((piece) => {
          const line = bottomLines.get(piece.lineId);
          if (!line) return null;
          const xDirection = piece.direction === "x";
          return (
            <line
              key={piece.id}
              x1={toX(xDirection ? piece.runStartMm : line.positionMm)}
              y1={toY(xDirection ? line.positionMm : piece.runStartMm)}
              x2={toX(xDirection ? piece.runEndMm : line.positionMm)}
              y2={toY(xDirection ? line.positionMm : piece.runEndMm)}
              stroke={xDirection ? "#dc2626" : "#7c3aed"}
              strokeWidth="2.4"
              strokeLinecap="round"
              pointerEvents="none"
            >
              <title>{`${xDirection ? "东西向" : "南北向"}地筋净跨 ${formatMm(piece.netLengthMm)}mm；下料 ${formatMm(piece.singleLengthMm)}mm`}</title>
            </line>
          );
        })}

        {boundaries.map((segment) => {
          const style = wallStyle(segment, scale);
          const selected = selectedBoundaryId === segment.id || segment.atomicIds.includes(selectedBoundaryId ?? "");
          return (
            <g key={segment.id}>
              <line
                x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)}
                stroke="transparent" strokeWidth="18" className="cursor-pointer"
                onPointerDown={(event) => { event.stopPropagation(); onSelectBoundary(segment); }}
              />
              <line
                x1={toX(segment.startX)} y1={toY(segment.startY)} x2={toX(segment.endX)} y2={toY(segment.endY)}
                stroke={selected ? "#f97316" : style.stroke}
                strokeWidth={selected ? style.width + 3 : style.width}
                strokeDasharray={style.dash}
                strokeLinecap="square"
                pointerEvents="none"
              />
            </g>
          );
        })}

        {state.openings.map((opening) => {
          const selected = selection?.kind === "opening" && selection.id === opening.id;
          return (
            <g key={`opening-outline-${opening.id}`} pointerEvents="none">
              <rect
                x={toX(opening.x)}
                y={toY(opening.y + opening.height)}
                width={Math.max(opening.width * scale, 1)}
                height={Math.max(opening.height * scale, 1)}
                fill="none"
                stroke={selected ? "#e11d48" : "#64748b"}
                strokeWidth={selected ? 4 : 2.5}
                strokeDasharray="9 6"
              />
            </g>
          );
        })}

        {state.slabs.map((slab) => {
          const centerX = toX(slab.x + slab.width / 2);
          const centerY = toY(slab.y + slab.height / 2);
          const shortName = slab.name.length > 10 ? `${slab.name.slice(0, 9)}…` : slab.name;
          return (
            <g key={`label-${slab.id}`} pointerEvents="none">
              <rect x={centerX - 72} y={centerY - 27} width="144" height="54" rx="8" fill="white" fillOpacity="0.9" />
              <text x={centerX} y={centerY - 4} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">{shortName}</text>
              <text x={centerX} y={centerY + 16} textAnchor="middle" fontSize="12" fill="#475569">{`${formatMm(slab.width)} × ${formatMm(slab.height)} mm`}</text>
            </g>
          );
        })}

        {state.openings.map((opening) => {
          const centerX = toX(opening.x + opening.width / 2);
          const centerY = toY(opening.y + opening.height / 2);
          return (
            <g key={`opening-label-${opening.id}`} pointerEvents="none">
              <rect x={centerX - 66} y={centerY - 28} width="132" height="56" rx="7" fill="white" fillOpacity="0.92" />
              <text x={centerX} y={centerY - 7} textAnchor="middle" fontSize="14" fontWeight="700" fill="#881337">{opening.name}</text>
              <text x={centerX} y={centerY + 9} textAnchor="middle" fontSize="11" fontWeight="700" fill="#64748b">VOID</text>
              <text x={centerX} y={centerY + 23} textAnchor="middle" fontSize="10" fill="#64748b">{`${formatMm(opening.width)} × ${formatMm(opening.height)}`}</text>
            </g>
          );
        })}

        <g aria-label="方向标识" fontSize="13" fill="#334155">
          <line x1="92" y1="608" x2="198" y2="608" stroke="#2563eb" strokeWidth="3" /><path d="M198 608 l-12 -6 v12 z" fill="#2563eb" />
          <text x="92" y="630">西</text><text x="202" y="630">东 · X</text>
          <line x1="48" y1="555" x2="48" y2="445" stroke="#dc2626" strokeWidth="3" /><path d="M48 445 l-6 12 h12 z" fill="#dc2626" />
          <text x="30" y="558">南</text><text x="24" y="432">北 · Y</text>
        </g>
        <g transform="translate(560 600)" fontSize="11" fill="#475569">
          <line x1="0" y1="0" x2="35" y2="0" stroke="#0f172a" strokeWidth="7" /><text x="42" y="4">建筑外边</text>
          <line x1="120" y1="0" x2="155" y2="0" stroke="#2563eb" strokeWidth="7" /><text x="162" y="4">内墙</text>
          <line x1="225" y1="0" x2="260" y2="0" stroke="#64748b" strokeWidth="2.5" strokeDasharray="9 6" /><text x="267" y="4">连续</text>
          <line x1="330" y1="0" x2="365" y2="0" stroke="#94a3b8" strokeWidth="3" strokeDasharray="5 6" /><text x="372" y="4">洞口裁断</text>
        </g>
        {bottomCalculation && (
          <g transform="translate(560 625)" fontSize="11" fill="#475569">
            <line x1="0" y1="0" x2="35" y2="0" stroke="#dc2626" strokeWidth="2.4" /><text x="42" y="4">东西向地筋Piece</text>
            <line x1="150" y1="0" x2="185" y2="0" stroke="#7c3aed" strokeWidth="2.4" /><text x="192" y="4">南北向地筋Piece</text>
          </g>
        )}
      </svg>
    </div>
  );
}
