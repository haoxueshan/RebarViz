"use client";

import {
  buildSlabDiagramScene,
  type SlabDiagramBarGroup,
  type SlabDiagramScene,
  type SlabDiagramSegment,
} from "@/lib/slab-diagram";
import type {
  SlabCalculation,
  SlabCalculatorState,
} from "@/lib/slab-calculator";

function segmentStroke(group: SlabDiagramBarGroup): string {
  return group.direction === "x" ? "#1d4ed8" : "#047857";
}

function SegmentLine({
  segment,
  group,
}: {
  segment: SlabDiagramSegment;
  group: SlabDiagramBarGroup;
}) {
  const anchor = segment.kind === "anchor-start" || segment.kind === "anchor-end";
  return (
    <g>
      <line
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
        stroke={segmentStroke(group)}
        strokeWidth={group.throughWall ? 3 : anchor ? 2.4 : 2}
        strokeDasharray={
          group.layer === "top" ? (anchor ? "3 2" : "8 5") : undefined
        }
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {segment.compressed && (
        <text
          x={segment.kind === "anchor-start" ? segment.start.x : segment.end.x}
          y={(segment.kind === "anchor-start" ? segment.start.y : segment.end.y) - 4}
          textAnchor="middle"
          fontSize="12"
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
      {group.startAnchorSegments.map((segment) => (
        <SegmentLine key={segment.id} segment={segment} group={group} />
      ))}
      {group.netSegments.map((segment) => (
        <SegmentLine key={segment.id} segment={segment} group={group} />
      ))}
      {group.endAnchorSegments.map((segment) => (
        <SegmentLine key={segment.id} segment={segment} group={group} />
      ))}
      {group.extraSegments.map((segment) => (
        <line
          key={segment.id}
          x1={segment.start.x}
          y1={segment.start.y}
          x2={segment.end.x}
          y2={segment.end.y}
          stroke="#c2410c"
          strokeWidth="4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function WallAndRoomGeometry({ scene }: { scene: SlabDiagramScene }) {
  const outerLabelWall = scene.walls.find((wall) => wall.id === "outer-north");
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
          key={`${room.id}-${room.index}`}
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
      {outerLabelWall && (
        <text
          x={outerLabelWall.labelPoint.x}
          y={outerLabelWall.labelPoint.y}
          textAnchor="middle"
          fontSize="10"
          fill="#334155"
        >
          {outerLabelWall.label}
        </text>
      )}
      {scene.walls
        .filter((wall) => wall.kind === "inner")
        .map((wall) => (
          <text
            key={`${wall.id}-label`}
            x={wall.labelPoint.x}
            y={wall.labelPoint.y}
            textAnchor="middle"
            fontSize="10"
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
    const width = Math.min(Math.max(room.rect.width - 6, 34), 190);
    const height = 32;
    const centerX = room.rect.x + room.rect.width / 2;
    const centerY = room.rect.y + room.rect.height / 2;
    const labelX = Math.min(
      Math.max(centerX - width / 2, scene.plotRect.x),
      scene.plotRect.x + scene.plotRect.width - width,
    );
    const name = room.name || `房间${room.index + 1}`;
    const dimensions = `${Number.isFinite(room.spanX) && room.spanX > 0 ? room.spanX : "—"}×${Number.isFinite(room.spanY) && room.spanY > 0 ? room.spanY : "—"}mm`;
    const availableTextWidth = Math.max(width - 6, 24);
    return (
      <g key={`${room.id}-${room.index}-label`}>
        <rect
          x={labelX}
          y={centerY - height / 2}
          width={width}
          height={height}
          rx="4"
          fill="#fff"
          fillOpacity="0.92"
          stroke="#cbd5e1"
          strokeWidth="0.6"
        />
        <text
          x={labelX + width / 2}
          y={centerY - 2}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#0f172a"
          textLength={Math.min(availableTextWidth, Math.max(name.length * 11, 20))}
          lengthAdjust="spacingAndGlyphs"
        >
          {name}
        </text>
        <text
          x={labelX + width / 2}
          y={centerY + 12}
          textAnchor="middle"
          fontSize="9.5"
          fill="#475569"
          textLength={Math.min(availableTextWidth, Math.max(dimensions.length * 6, 24))}
          lengthAdjust="spacingAndGlyphs"
        >
          {dimensions}
        </text>
      </g>
    );
  });
}

function DirectionAxes({ scene }: { scene: SlabDiagramScene }) {
  const { xAxis, yAxis } = scene;
  return (
    <g aria-label="方向坐标">
      <line
        x1={xAxis.start.x}
        y1={xAxis.start.y}
        x2={xAxis.end.x}
        y2={xAxis.end.y}
        stroke="#334155"
        strokeWidth="1.5"
      />
      <polygon
        points={`${xAxis.end.x},${xAxis.end.y} ${xAxis.end.x - 10},${xAxis.end.y - 5} ${xAxis.end.x - 10},${xAxis.end.y + 5}`}
        fill="#334155"
      />
      <text x={xAxis.start.x} y={xAxis.start.y + 17} textAnchor="start" fontSize="11" fill="#334155">
        西
      </text>
      <text x={xAxis.end.x} y={xAxis.end.y + 17} textAnchor="end" fontSize="11" fill="#334155">
        东　X轴（西→东）
      </text>
      <line
        x1={yAxis.start.x}
        y1={yAxis.start.y}
        x2={yAxis.end.x}
        y2={yAxis.end.y}
        stroke="#334155"
        strokeWidth="1.5"
      />
      <polygon
        points={`${yAxis.end.x},${yAxis.end.y} ${yAxis.end.x - 5},${yAxis.end.y + 10} ${yAxis.end.x + 5},${yAxis.end.y + 10}`}
        fill="#334155"
      />
      <text x={yAxis.start.x - 8} y={yAxis.start.y} textAnchor="end" fontSize="11" fill="#334155">
        南
      </text>
      <text x={yAxis.end.x - 8} y={yAxis.end.y + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="#334155">
        北
      </text>
      <text
        x={yAxis.start.x - 25}
        y={(yAxis.start.y + yAxis.end.y) / 2}
        textAnchor="middle"
        fontSize="10"
        fill="#334155"
        transform={`rotate(-90 ${yAxis.start.x - 25} ${(yAxis.start.y + yAxis.end.y) / 2})`}
      >
        Y轴（南→北）
      </text>
    </g>
  );
}

function DiagramLegend({ scene }: { scene: SlabDiagramScene }) {
  const notesStart = 560;
  const legendStart = notesStart + scene.notes.length * 16 + 12;
  const fitText = (text: string, maxWidth: number, averageWidth = 5.8) =>
    text.length * averageWidth > maxWidth ? maxWidth : undefined;
  return (
    <g>
      <g aria-label="图例">
        <line x1="110" y1="532" x2="140" y2="532" stroke="#1d4ed8" strokeWidth="2" />
        <text x="148" y="536" fontSize="11" fill="#1d4ed8">X向</text>
        <line x1="210" y1="532" x2="240" y2="532" stroke="#047857" strokeWidth="2" />
        <text x="248" y="536" fontSize="11" fill="#047857">Y向</text>
        <line x1="310" y1="532" x2="340" y2="532" stroke="#334155" strokeWidth="2" />
        <text x="348" y="536" fontSize="11" fill="#334155">实线：地筋</text>
        <line x1="445" y1="532" x2="475" y2="532" stroke="#334155" strokeWidth="2" strokeDasharray="8 5" />
        <text x="483" y="536" fontSize="11" fill="#334155">虚线：面筋</text>
        <line x1="590" y1="532" x2="620" y2="532" stroke="#c2410c" strokeWidth="4" />
        <text x="628" y="536" fontSize="11" fill="#7c2d12">橙色：实际增加段</text>
        <text x="800" y="536" fontSize="11" fill="#7c2d12">≈：视觉压缩</text>
      </g>
      {scene.notes.map((note, index) => (
        <text key={note} x="110" y={notesStart + index * 16} fontSize="10.5" fill="#475569">
          {note}
        </text>
      ))}
      {scene.barGroups.map((group, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = 40 + column * 480;
        const y = legendStart + row * 68;
        const heading = `${group.specificationLabel} · ${group.countLabel}`;
        return (
          <g key={`${group.resultId}-legend`} data-result-label={group.resultId}>
            <rect x={x} y={y - 14} width="452" height="62" rx="5" fill="#f8fafc" stroke="#cbd5e1" />
            <line
              x1={x + 8}
              y1={y - 3}
              x2={x + 38}
              y2={y - 3}
              stroke={segmentStroke(group)}
              strokeWidth={group.throughWall ? 3 : 2}
              strokeDasharray={group.layer === "top" ? "8 5" : undefined}
            />
            <text
              x={x + 45}
              y={y}
              fontSize="10.5"
              fontWeight="700"
              fill="#0f172a"
              textLength={fitText(heading, 397)}
              lengthAdjust="spacingAndGlyphs"
            >
              {heading}
            </text>
            <text x={x + 8} y={y + 14} fontSize="9.5" fill="#475569">
              {group.runLabel}
            </text>
            <text
              x={x + 8}
              y={y + 28}
              fontSize="9.5"
              fill="#475569"
              textLength={fitText(group.anchorLabel, 436, 5.3)}
              lengthAdjust="spacingAndGlyphs"
            >
              {group.anchorLabel}
            </text>
            <text x={x + 8} y={y + 42} fontSize="9.5" fill="#7c2d12">
              {group.extraLabel}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function SlabDiagramSvg({
  state,
  calculation,
  visibleResultIds,
  ariaLabel,
}: {
  state: SlabCalculatorState;
  calculation?: SlabCalculation | null;
  visibleResultIds?: ReadonlySet<string>;
  ariaLabel: string;
}) {
  const scene = buildSlabDiagramScene(state, calculation, { visibleResultIds });
  const orderedGroups = [...scene.barGroups].sort((left, right) => {
    const priority = (group: SlabDiagramBarGroup) =>
      group.throughWall ? 3 : group.layer === "top" ? 2 : 1;
    return priority(left) - priority(right);
  });
  return (
    <svg
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      className="h-auto w-full max-w-full"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width={scene.width} height={scene.height} fill="#fff" />
      <WallAndRoomGeometry scene={scene} />
      {orderedGroups.map((group) => (
        <BarGroupLines key={group.resultId} group={group} />
      ))}
      <RoomLabels scene={scene} />
      <DirectionAxes scene={scene} />
      <DiagramLegend scene={scene} />
    </svg>
  );
}

export function SlabLayoutDiagram({ state }: { state: SlabCalculatorState }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <SlabDiagramSvg state={state} ariaLabel="房间、内外墙和方向布局预览" />
    </div>
  );
}

export function SlabResultsDiagram({
  state,
  calculation,
  visibleResultIds,
  showNote = true,
}: {
  state: SlabCalculatorState;
  calculation: SlabCalculation;
  visibleResultIds?: ReadonlySet<string>;
  showNote?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <SlabDiagramSvg
        state={state}
        calculation={calculation}
        visibleResultIds={visibleResultIds}
        ariaLabel="基于正式计算结果的楼板钢筋二维图"
      />
      {showNote && (
        <p className="mt-2 text-xs text-slate-500">
          每项正式钢筋结果独立抽样绘制代表线，规格、实际根数、锚固与面筋实际增加端均读取正式计算记录。
        </p>
      )}
    </div>
  );
}
