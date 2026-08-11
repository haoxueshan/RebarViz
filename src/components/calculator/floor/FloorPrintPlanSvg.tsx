import type {
  FloorPrintGeometry,
  FloorPrintOptions,
  FloorPrintPiece,
} from "@/lib/floor-print";

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 720;
const VIEW_PADDING = 70;

type FloorPrintPlanSvgProps = {
  geometry: FloorPrintGeometry;
  mode: "geometry" | "bottom" | "top";
  pieces?: readonly FloorPrintPiece[];
  display: FloorPrintOptions["display"];
};

function boundaryStyle(support: FloorPrintGeometry["boundaries"][number]["support"]) {
  if (support === "outer-wall") return { width: 7, dash: undefined };
  if (support === "inner-wall") return { width: 4.5, dash: undefined };
  if (support === "continuous") return { width: 1.7, dash: "10 7" };
  return { width: 2.6, dash: "5 6" };
}

function labelForMode(mode: FloorPrintPlanSvgProps["mode"]): string {
  if (mode === "bottom") return "地筋平铺图";
  if (mode === "top") return "面筋平铺图";
  return "整层楼板平面";
}

export function FloorPrintPlanSvg({
  geometry,
  mode,
  pieces = [],
  display,
}: FloorPrintPlanSvgProps) {
  const worldWidth = Math.max(geometry.bounds.maxX - geometry.bounds.minX, 1);
  const worldHeight = Math.max(geometry.bounds.maxY - geometry.bounds.minY, 1);
  const scale = Math.min(
    (VIEW_WIDTH - VIEW_PADDING * 2) / worldWidth,
    (VIEW_HEIGHT - VIEW_PADDING * 2) / worldHeight,
  );
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = (VIEW_WIDTH - drawnWidth) / 2 - geometry.bounds.minX * scale;
  const originY = (VIEW_HEIGHT - drawnHeight) / 2 + geometry.bounds.maxY * scale;
  const toX = (value: number) => originX + value * scale;
  const toY = (value: number) => originY - value * scale;
  const visiblePieces = mode === "geometry" ? [] : pieces.filter((piece) => piece.layer === mode);
  const firstPieceByMark = new Map<string, FloorPrintPiece>();
  visiblePieces.forEach((piece) => {
    if (!firstPieceByMark.has(piece.mark)) firstPieceByMark.set(piece.mark, piece);
  });
  const patternId = `floor-print-opening-${mode}`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={labelForMode(mode)}
      data-floor-print-plan={mode}
      className="block h-auto w-full bg-white"
    >
      <defs>
        <pattern id={patternId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="12" height="12" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="12" stroke="#a3a3a3" strokeWidth="3" />
        </pattern>
      </defs>
      <rect x="1" y="1" width={VIEW_WIDTH - 2} height={VIEW_HEIGHT - 2} fill="#fff" stroke="#a3a3a3" strokeWidth="2" />

      {geometry.slabs.map((slab) => (
        <rect
          key={slab.id}
          x={toX(slab.x)}
          y={toY(slab.y + slab.height)}
          width={Math.max(slab.width * scale, 0.5)}
          height={Math.max(slab.height * scale, 0.5)}
          fill="#fafafa"
          stroke="#d4d4d4"
          strokeWidth="1"
        />
      ))}

      {visiblePieces.map((piece) => {
        const xDirection = piece.direction === "x";
        const through = piece.source === "through";
        return (
          <line
            key={piece.id}
            x1={toX(xDirection ? piece.runStartMm : piece.positionMm)}
            y1={toY(xDirection ? piece.positionMm : piece.runStartMm)}
            x2={toX(xDirection ? piece.runEndMm : piece.positionMm)}
            y2={toY(xDirection ? piece.positionMm : piece.runEndMm)}
            stroke="#111827"
            strokeWidth={through ? 3.6 : piece.role === "main" ? 2.3 : 1.45}
            strokeDasharray={through ? undefined : piece.role === "secondary" ? "6 3" : undefined}
            strokeLinecap="round"
            data-print-piece-id={piece.id}
            data-mark={piece.mark}
            data-layer={piece.layer}
            data-direction={piece.direction}
            data-source={piece.source}
          >
            <title>{`${piece.mark} · ${through ? "通墙面筋" : piece.layer === "top" ? "普通面筋" : "地筋"} · ${piece.role === "main" ? "主筋" : "副筋"}（${piece.direction === "x" ? "东西向" : "南北向"}）· Φ${piece.diameter}@${piece.spacing} · ${piece.singleLengthMm.toFixed(0)}mm`}</title>
          </line>
        );
      })}

      {geometry.openings.map((opening) => (
        <rect
          key={opening.id}
          x={toX(opening.x)}
          y={toY(opening.y + opening.height)}
          width={Math.max(opening.width * scale, 0.5)}
          height={Math.max(opening.height * scale, 0.5)}
          fill={`url(#${patternId})`}
          stroke="#404040"
          strokeWidth="2.3"
          strokeDasharray="7 5"
        />
      ))}

      {geometry.boundaries.map((boundary, index) => {
        const style = boundaryStyle(boundary.support);
        return (
          <line
            key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${boundary.endX}:${boundary.endY}:${index}`}
            x1={toX(boundary.startX)}
            y1={toY(boundary.startY)}
            x2={toX(boundary.endX)}
            y2={toY(boundary.endY)}
            stroke="#171717"
            strokeWidth={style.width}
            strokeDasharray={style.dash}
            strokeLinecap="square"
          />
        );
      })}

      {display.slabNames && geometry.slabs.map((slab) => (
        <g key={`slab-label:${slab.id}`} pointerEvents="none">
          <rect
            x={toX(slab.x + slab.width / 2) - 60}
            y={toY(slab.y + slab.height / 2) - 14}
            width="120"
            height="28"
            rx="4"
            fill="#fff"
            fillOpacity="0.88"
          />
          <text x={toX(slab.x + slab.width / 2)} y={toY(slab.y + slab.height / 2) + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#171717">
            {slab.name}
          </text>
        </g>
      ))}

      {display.openingNames && geometry.openings.map((opening) => (
        <g key={`opening-label:${opening.id}`} pointerEvents="none">
          <rect
            x={toX(opening.x + opening.width / 2) - 55}
            y={toY(opening.y + opening.height / 2) - 22}
            width="110"
            height="44"
            rx="4"
            fill="#fff"
            fillOpacity="0.92"
          />
          <text x={toX(opening.x + opening.width / 2)} y={toY(opening.y + opening.height / 2) - 3} textAnchor="middle" fontSize="13" fontWeight="700" fill="#171717">
            {opening.name}
          </text>
          <text x={toX(opening.x + opening.width / 2)} y={toY(opening.y + opening.height / 2) + 14} textAnchor="middle" fontSize="11" fill="#525252">VOID</text>
        </g>
      ))}

      {display.barMarks && [...firstPieceByMark.values()].map((piece) => {
        const xDirection = piece.direction === "x";
        const centerRun = (piece.runStartMm + piece.runEndMm) / 2;
        const x = toX(xDirection ? centerRun : piece.positionMm);
        const y = toY(xDirection ? piece.positionMm : centerRun);
        const text = display.barSpecification
          ? `${piece.mark}  Φ${piece.diameter}@${piece.spacing}`
          : piece.mark;
        return (
          <g key={`mark:${piece.mark}`} data-mark-label={piece.mark} pointerEvents="none">
            <rect x={x - 55} y={y - 13} width="110" height="25" rx="4" fill="#fff" stroke="#171717" strokeWidth="1" />
            <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#111827">{text}</text>
          </g>
        );
      })}

      <g transform={`translate(${VIEW_PADDING} ${VIEW_HEIGHT - 28})`} fontSize="11" fill="#262626">
        <line x1="0" y1="0" x2="34" y2="0" stroke="#171717" strokeWidth="7" /><text x="41" y="4">外墙</text>
        <line x1="90" y1="0" x2="124" y2="0" stroke="#171717" strokeWidth="4.5" /><text x="131" y="4">内墙</text>
        <line x1="180" y1="0" x2="214" y2="0" stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" /><text x="221" y="4">连续板边</text>
        {mode !== "geometry" && <><line x1="310" y1="0" x2="344" y2="0" stroke="#171717" strokeWidth="2.3" /><text x="351" y="4">主筋Piece</text><line x1="445" y1="0" x2="479" y2="0" stroke="#171717" strokeWidth="1.45" strokeDasharray="6 3" /><text x="486" y="4">副筋Piece</text>{mode === "top" && <><line x1="580" y1="0" x2="614" y2="0" stroke="#171717" strokeWidth="3.6" /><text x="621" y="4">通墙Piece</text></>}</>}
      </g>
    </svg>
  );
}
