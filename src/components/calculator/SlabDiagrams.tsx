"use client";

import { useMemo } from "react";
import {
  buildSlabDiagramScene,
  type DiagramSelectionContext,
  type SlabDiagramBarGroup,
  type SlabDiagramScene,
  type SlabDiagramSegment,
} from "@/lib/slab-diagram";
import type { AnchorSource, SlabCalculation, SlabCalculatorState } from "@/lib/slab-calculator";

function segmentStroke(group: SlabDiagramBarGroup): string {
  return group.direction === "x" ? "#1d4ed8" : "#047857";
}

function SegmentLine({ segment, group }: { segment: SlabDiagramSegment; group: SlabDiagramBarGroup }) {
  const anchor = segment.kind === "anchor-start" || segment.kind === "anchor-end";
  return (
    <g>
      <line
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
        stroke={segmentStroke(group)}
        strokeWidth={group.throughWall ? 3.2 : anchor ? 2.5 : 2.1}
        strokeDasharray={group.layer === "top" ? (anchor ? "3 2" : "8 5") : undefined}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {segment.compressed && (
        <text
          x={segment.kind === "anchor-start" ? segment.start.x : segment.end.x}
          y={(segment.kind === "anchor-start" ? segment.start.y : segment.end.y) - 5}
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill="#7c2d12"
        >
          ≈
        </text>
      )}
    </g>
  );
}

function BarGroupLines({ group }: { group: SlabDiagramBarGroup }) {
  return (
    <g data-result-id={group.resultId}>
      <title>{`${group.resultNumber} ${group.specificationLabel} ${group.countLabel}`}</title>
      {group.startAnchorSegments.map((segment) => <SegmentLine key={segment.id} segment={segment} group={group} />)}
      {group.netSegments.map((segment) => <SegmentLine key={segment.id} segment={segment} group={group} />)}
      {group.endAnchorSegments.map((segment) => <SegmentLine key={segment.id} segment={segment} group={group} />)}
      {group.extraSegments.map((segment) => (
        <line
          key={segment.id}
          x1={segment.start.x}
          y1={segment.start.y}
          x2={segment.end.x}
          y2={segment.end.y}
          stroke="#c2410c"
          strokeWidth="4.2"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function BarGroupMarkers({ group }: { group: SlabDiagramBarGroup }) {
  return (
    <g data-result-markers={group.resultId}>
      {group.markers.map((marker) => {
        return (
          <g key={marker.id} aria-label={`${marker.label}图中编号`}>
            <rect
              x={marker.point.x - marker.width / 2}
              y={marker.point.y - marker.height / 2}
              width={marker.width}
              height={marker.height}
              rx="4"
              fill="#fff"
              fillOpacity="0.96"
              stroke={segmentStroke(group)}
              strokeWidth="0.9"
            />
            <text
              x={marker.point.x}
              y={marker.point.y + 3}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#0f172a"
            >
              {marker.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function WallAndRoomGeometry({ scene }: { scene: SlabDiagramScene }) {
  return (
    <>
      {scene.walls.map((wall) => (
        <rect
          key={wall.id}
          x={wall.rect.x}
          y={wall.rect.y}
          width={wall.rect.width}
          height={wall.rect.height}
          fill={wall.kind === "outer" ? "#cbd5e1" : "#94a3b8"}
          stroke="#64748b"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {scene.rooms.map((room) => (
        <rect
          key={room.id}
          x={room.rect.x}
          y={room.rect.y}
          width={room.rect.width}
          height={room.rect.height}
          fill="#fff"
          stroke="#64748b"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {scene.walls.filter((wall) => wall.showLabel).map((wall) => (
        <text
          key={`${wall.id}-label`}
          x={wall.labelPoint.x}
          y={wall.labelPoint.y}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fill="#334155"
        >
          {wall.label}
        </text>
      ))}
    </>
  );
}

function RoomLabels({ scene }: { scene: SlabDiagramScene }) {
  return scene.rooms.map((room) => {
    const { labelRect } = room;
    const centerX = labelRect.x + labelRect.width / 2;
    const centerY = labelRect.y + labelRect.height / 2;
    const compact = labelRect.width < 76 || labelRect.height < 34;
    const displayName = compact ? `${room.index + 1}` : room.shortName;
    const dimensions = `${Number.isFinite(room.spanX) && room.spanX > 0 ? room.spanX : "—"}×${Number.isFinite(room.spanY) && room.spanY > 0 ? room.spanY : "—"}mm`;
    const clipId = `slab-room-label-${room.index}`;
    return (
      <g key={`${room.id}-label`}>
        <title>{room.label}</title>
        {labelRect.width >= 8 && labelRect.height >= 10 && (
          <g clipPath={`url(#${clipId})`}>
            <defs>
              <clipPath id={clipId}>
                <rect x={labelRect.x} y={labelRect.y} width={labelRect.width} height={labelRect.height} rx="3" />
              </clipPath>
            </defs>
            <rect
              x={labelRect.x}
              y={labelRect.y}
              width={labelRect.width}
              height={labelRect.height}
              rx="4"
              fill="#fff"
              fillOpacity="0.94"
              stroke="#cbd5e1"
              strokeWidth="0.7"
            />
            <text x={centerX} y={compact ? centerY + 4 : centerY - 2} textAnchor="middle" fontSize={compact ? "10" : "12"} fontWeight="700" fill="#0f172a">
              {displayName}
            </text>
            {!compact && (
              <text x={centerX} y={centerY + 14} textAnchor="middle" fontSize="11" fill="#475569">
                {dimensions}
              </text>
            )}
          </g>
        )}
      </g>
    );
  });
}

function DirectionAxes({ scene }: { scene: SlabDiagramScene }) {
  const { xAxis, yAxis } = scene;
  return (
    <g aria-label="方向坐标">
      <line x1={xAxis.start.x} y1={xAxis.start.y} x2={xAxis.end.x} y2={xAxis.end.y} stroke="#334155" strokeWidth="1.6" />
      <polygon points={`${xAxis.end.x},${xAxis.end.y} ${xAxis.end.x - 10},${xAxis.end.y - 5} ${xAxis.end.x - 10},${xAxis.end.y + 5}`} fill="#334155" />
      <text x={xAxis.start.x} y={xAxis.start.y + 19} textAnchor="start" fontSize="12" fill="#334155">西</text>
      <text x={xAxis.end.x} y={xAxis.end.y + 19} textAnchor="end" fontSize="12" fill="#334155">东　X轴（西→东）</text>
      <line x1={yAxis.start.x} y1={yAxis.start.y} x2={yAxis.end.x} y2={yAxis.end.y} stroke="#334155" strokeWidth="1.6" />
      <polygon points={`${yAxis.end.x},${yAxis.end.y} ${yAxis.end.x - 5},${yAxis.end.y + 10} ${yAxis.end.x + 5},${yAxis.end.y + 10}`} fill="#334155" />
      <text x={yAxis.start.x - 8} y={yAxis.start.y} textAnchor="end" fontSize="12" fill="#334155">南</text>
      <text x={yAxis.end.x - 8} y={yAxis.end.y + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="#334155">北</text>
      <text
        x={yAxis.start.x - 27}
        y={(yAxis.start.y + yAxis.end.y) / 2}
        textAnchor="middle"
        fontSize="11"
        fill="#334155"
        transform={`rotate(-90 ${yAxis.start.x - 27} ${(yAxis.start.y + yAxis.end.y) / 2})`}
      >
        Y轴（南→北）
      </text>
    </g>
  );
}

export function SlabDiagramCanvas({
  scene,
  ariaLabel = "楼板钢筋计算二维示意图",
}: {
  scene: SlabDiagramScene;
  ariaLabel?: string;
}) {
  const orderedGroups = useMemo(() => [...scene.barGroups].sort((left, right) => {
    const priority = (group: SlabDiagramBarGroup) => group.throughWall ? 3 : group.layer === "top" ? 2 : 1;
    return priority(left) - priority(right);
  }), [scene.barGroups]);
  return (
    <svg
      data-testid="slab-diagram-canvas"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      className="block h-auto w-full"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={scene.width} height={scene.height} fill="#fff" />
      <WallAndRoomGeometry scene={scene} />
      {orderedGroups.map((group) => <BarGroupLines key={group.resultId} group={group} />)}
      <RoomLabels scene={scene} />
      {orderedGroups.map((group) => <BarGroupMarkers key={`${group.resultId}-markers`} group={group} />)}
      <DirectionAxes scene={scene} />
    </svg>
  );
}

function KeyLine({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className={`inline-block w-9 ${className}`} />
      <span>{label}</span>
    </span>
  );
}

export function SlabDiagramKey() {
  return (
    <div data-testid="slab-diagram-key" className="grid gap-x-5 gap-y-1 border-t border-slate-200 px-3 py-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
      <KeyLine className="border-t-2 border-blue-700" label="X向（西→东）" />
      <KeyLine className="border-t-2 border-emerald-700" label="Y向（南→北）" />
      <KeyLine className="border-t-2 border-slate-700" label="实线：地筋" />
      <KeyLine className="border-t-2 border-dashed border-slate-700" label="虚线：面筋" />
      <KeyLine className="border-t-[3px] border-slate-900" label="加粗：通墙筋" />
      <KeyLine className="border-t-4 border-orange-700" label="橙色：实际增加段" />
      <span className="inline-flex min-h-8 items-center gap-2"><strong className="text-sm text-orange-900">≈</strong><span>视觉压缩，数值以正式结果为准</span></span>
    </div>
  );
}

function anchorName(source: AnchorSource): string {
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

export function SlabDiagramResultLegend({ scene }: { scene: SlabDiagramScene }) {
  return (
    <div data-testid="slab-diagram-result-legend" className="mt-3 space-y-2 text-sm">
      {scene.barGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-slate-600">
          {scene.selectionContext ? "当前筛选或选择没有钢筋结果，图中仅保留房间与墙体。" : "没有可绘制的正式钢筋结果。"}
        </div>
      ) : scene.barGroups.map((group) => (
        <details key={group.resultId} data-result-id={group.resultId} className="rounded-lg border border-slate-200 bg-white" open={group.lengthMode === "zoned"}>
          <summary className="cursor-pointer list-none px-3 py-2 font-semibold text-slate-900">
            <span className="mr-2 inline-flex min-w-10 justify-center rounded bg-slate-900 px-2 py-0.5 text-xs text-white">{group.resultNumber}</span>
            {group.scopeName} · {group.specificationLabel} · {group.countLabel}
          </summary>
          <div className="grid gap-2 border-t border-slate-200 px-3 py-3 text-xs leading-5 text-slate-600 sm:grid-cols-2">
            <p>运行：{group.runLabel}</p>
            <p>单根长度：{group.singleLengthLabel}</p>
            <p className="sm:col-span-2">锚固：{group.anchorLabel}</p>
            <p>面筋增加：{group.extraLabel}</p>
            <p>总长度/重量：{group.totalLengthM.toFixed(3)}m / {group.weightKg.toFixed(2)}kg</p>
          </div>
          {group.lengthMode === "zoned" && (
            <div className="overflow-x-auto border-t border-slate-200">
              <table className="min-w-[760px] w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr><th className="px-3 py-2">分区</th><th className="px-3 py-2">范围</th><th className="px-3 py-2">正式/图示</th><th className="px-3 py-2">起点锚固</th><th className="px-3 py-2">终点锚固</th><th className="px-3 py-2">单根长度</th></tr>
                </thead>
                <tbody>
                  {group.variants.map((variant) => (
                    <tr key={variant.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold">{variant.label}</td>
                      <td className="px-3 py-2">{variant.perpendicularStartMm}–{variant.perpendicularEndMm}mm</td>
                      <td className="px-3 py-2">{variant.count}根 / {variant.representativeCount > 0 ? `${variant.representativeCount}条` : "未抽中代表线"}</td>
                      <td className="px-3 py-2">{anchorName(variant.startAnchorSource)}{variant.startAnchor}mm{variant.startAnchorSource === "manual" ? "（最终值）" : variant.startExtraApplied ? "（已增加）" : ""}</td>
                      <td className="px-3 py-2">{anchorName(variant.endAnchorSource)}{variant.endAnchor}mm{variant.endAnchorSource === "manual" ? "（最终值）" : variant.endExtraApplied ? "（已增加）" : ""}</td>
                      <td className="px-3 py-2">{variant.singleLengthM.toFixed(3)}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

function SceneNotes({ scene, preview }: { scene: SlabDiagramScene; preview: boolean }) {
  return (
    <div className="space-y-1 px-3 py-2 text-xs leading-5 text-slate-500">
      {preview && <p className="font-medium text-slate-700">当前为布局预览，不展示正式钢筋结果。</p>}
      {scene.notes.map((note) => <p key={note}>{note}</p>)}
    </div>
  );
}

export function SlabLayoutDiagram({ state }: { state: SlabCalculatorState }) {
  const scene = buildSlabDiagramScene(state);
  return (
    <div data-testid="slab-layout-diagram" className="rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]"><SlabDiagramCanvas scene={scene} ariaLabel="房间、墙体与方向布局预览" /></div>
      </div>
      <SceneNotes scene={scene} preview />
    </div>
  );
}

export function SlabResultsDiagram({
  state,
  calculation,
  visibleResultIds,
  selectionContext,
  showNote = true,
}: {
  state: SlabCalculatorState;
  calculation: SlabCalculation;
  visibleResultIds?: ReadonlySet<string>;
  selectionContext?: DiagramSelectionContext;
  showNote?: boolean;
}) {
  const scene = buildSlabDiagramScene(state, calculation, { visibleResultIds, selectionContext });
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]"><SlabDiagramCanvas scene={scene} /></div>
      </div>
      <SlabDiagramKey />
      {showNote && <SceneNotes scene={scene} preview={false} />}
      <SlabDiagramResultLegend scene={scene} />
    </div>
  );
}
