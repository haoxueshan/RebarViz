import { buildFloorPrintMarkClusters } from "@/lib/floor-2d";
import {
  mapFloorNetAxisPoint,
} from "@/lib/floor-physical-layout";
import type { FloorSlab } from "@/lib/floor-plan";
import type {
  FloorPrintCoordinateModel,
  FloorPrintGeometry,
  FloorPrintOptions,
  FloorPrintPiece,
} from "@/lib/floor-print";

const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 720;
const VIEW_PADDING = 70;

type FloorPrintPlanSvgProps = {
  geometry: FloorPrintGeometry;
  coordinateModel: FloorPrintCoordinateModel;
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
  coordinateModel,
  mode,
  pieces = [],
  display,
}: FloorPrintPlanSvgProps) {
  const physical = geometry.physical ?? null;
  const worldBounds = physical ? physical.floorBounds : geometry.bounds;
  const netSlabs = geometry.slabs as unknown as FloorSlab[];
  const worldWidth = Math.max(worldBounds.maxX - worldBounds.minX, 1);
  const worldHeight = Math.max(worldBounds.maxY - worldBounds.minY, 1);
  const scale = Math.min(
    (VIEW_WIDTH - VIEW_PADDING * 2) / worldWidth,
    (VIEW_HEIGHT - VIEW_PADDING * 2) / worldHeight,
  );
  const drawnWidth = worldWidth * scale;
  const drawnHeight = worldHeight * scale;
  const originX = (VIEW_WIDTH - drawnWidth) / 2 - worldBounds.minX * scale;
  const originY = (VIEW_HEIGHT - drawnHeight) / 2 + worldBounds.maxY * scale;
  const toX = (value: number) => originX + value * scale;
  const toY = (value: number) => originY - value * scale;
  const mapCoordinate = (axis: "x" | "y", value: number, slabIds: readonly string[] = []) =>
    physical && coordinateModel === "net-layout-v1"
      ? mapFloorNetAxisPoint(axis, value, { slabs: netSlabs }, physical, slabIds)
      : value;
  const slabDraw = (slab: { id: string; x: number; y: number }) => {
    if (!physical) return { x: slab.x, y: slab.y };
    const item = physical.slabs.find((entry) => entry.slabId === slab.id);
    return { x: item?.x ?? slab.x, y: item?.y ?? slab.y };
  };
  const openingDraw = (opening: { id: string; x: number; y: number }) => {
    if (!physical) return { x: opening.x, y: opening.y };
    const item = physical.openings.find((entry) => entry.openingId === opening.id);
    return { x: item?.x ?? opening.x, y: item?.y ?? opening.y };
  };
  const visiblePieces = mode === "geometry" ? [] : pieces.filter((piece) => piece.layer === mode);
  const normalPieces = visiblePieces.filter((piece) => piece.source === "normal");
  const throughPieces = visiblePieces.filter((piece) => piece.source === "through");
  const markClusters = buildFloorPrintMarkClusters(visiblePieces);
  const pieceById = new Map(visiblePieces.map((piece) => [piece.id, piece]));
  const patternId = `floor-print-opening-${mode}`;

  const pieceLine = (piece: FloorPrintPiece) => {
    const xDirection = piece.direction === "x";
    const prefer = piece.slabIds;
    return {
      x1: toX(mapCoordinate("x", xDirection ? piece.runStartMm : piece.positionMm, prefer)),
      y1: toY(mapCoordinate("y", xDirection ? piece.positionMm : piece.runStartMm, prefer)),
      x2: toX(mapCoordinate("x", xDirection ? piece.runEndMm : piece.positionMm, prefer)),
      y2: toY(mapCoordinate("y", xDirection ? piece.positionMm : piece.runEndMm, prefer)),
    };
  };

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

      {geometry.slabs.map((slab) => {
        const draw = slabDraw(slab);
        return <rect key={slab.id} x={toX(draw.x)} y={toY(draw.y + slab.height)} width={Math.max(slab.width * scale, 0.5)} height={Math.max(slab.height * scale, 0.5)} fill="#fafafa" stroke="#d4d4d4" strokeWidth="1" />;
      })}

      {normalPieces.map((piece) => (
        <line
          key={piece.id}
          {...pieceLine(piece)}
          stroke="#111827"
          strokeWidth={piece.role === "main" ? 2.3 : 1.45}
          strokeDasharray={piece.role === "secondary" ? "6 3" : undefined}
          strokeLinecap="round"
          data-print-piece-id={piece.id}
          data-mark={piece.mark}
          data-layer={piece.layer}
          data-direction={piece.direction}
          data-source="normal"
        >
          <title>{`${piece.mark} · ${piece.layer === "top" ? "普通面筋" : "地筋"} · ${piece.role === "main" ? "主筋" : "副筋"}（${piece.direction === "x" ? "东西向" : "南北向"}）· Φ${piece.diameter}@${piece.spacing} · ${piece.singleLengthMm.toFixed(0)}mm`}</title>
        </line>
      ))}

      {physical && physical.walls.map((wall) => (
        <rect
          key={wall.id}
          x={toX(wall.x)} y={toY(wall.y + wall.height)}
          width={Math.max(wall.width * scale, 0)} height={Math.max(wall.height * scale, 0)}
          fill={wall.kind === "outer-wall" ? "#171717" : "#2563eb"}
          stroke={wall.kind === "outer-wall" ? "#171717" : "#2563eb"}
          strokeWidth="0.75"
          data-print-wall-id={wall.id}
          data-wall-kind={wall.kind}
          data-wall-thickness-mm={wall.thicknessMm}
        />
      ))}

      {geometry.openings.map((opening) => {
        const draw = openingDraw(opening);
        return <rect key={opening.id} x={toX(draw.x)} y={toY(draw.y + opening.height)} width={Math.max(opening.width * scale, 0.5)} height={Math.max(opening.height * scale, 0.5)} fill={`url(#${patternId})`} stroke="#404040" strokeWidth="2.3" strokeDasharray="7 5" />;
      })}

      {!physical && geometry.boundaries.map((boundary, index) => {
        const style = boundaryStyle(boundary.support);
        return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${boundary.endX}:${boundary.endY}:${index}`} x1={toX(boundary.startX)} y1={toY(boundary.startY)} x2={toX(boundary.endX)} y2={toY(boundary.endY)} stroke="#171717" strokeWidth={style.width} strokeDasharray={style.dash} strokeLinecap="square" />;
      })}

      {physical && geometry.boundaries.filter((boundary) => boundary.support === "continuous" || boundary.support === "opening-cut").map((boundary, index) => {
        const prefer = boundary.orientation === "vertical"
          ? netSlabs.filter((slab) => Math.abs(slab.x - boundary.startX) <= 1e-4 || Math.abs(slab.x + slab.width - boundary.startX) <= 1e-4).map((slab) => slab.id)
          : netSlabs.filter((slab) => Math.abs(slab.y - boundary.startY) <= 1e-4 || Math.abs(slab.y + slab.height - boundary.startY) <= 1e-4).map((slab) => slab.id);
        if (boundary.orientation === "vertical") {
          const x = toX(mapCoordinate("x", boundary.startX, prefer));
          return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${index}`} x1={x} y1={toY(mapCoordinate("y", boundary.startY, prefer))} x2={x} y2={toY(mapCoordinate("y", boundary.endY, prefer))} stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" strokeLinecap="square" />;
        }
        const y = toY(mapCoordinate("y", boundary.startY, prefer));
        return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${index}`} x1={toX(mapCoordinate("x", boundary.startX, prefer))} y1={y} x2={toX(mapCoordinate("x", boundary.endX, prefer))} y2={y} stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" strokeLinecap="square" />;
      })}

      {throughPieces.map((piece) => (
        <g key={piece.id} data-print-piece-id={piece.id} data-mark={piece.mark} data-layer={piece.layer} data-direction={piece.direction} data-source="through">
          <line {...pieceLine(piece)} stroke="#111827" strokeWidth="5" strokeLinecap="round" data-through-outer="true" />
          <line {...pieceLine(piece)} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" data-through-inner="true" />
          <title>{`${piece.mark} · 通墙面筋 · ${piece.role === "main" ? "主筋" : "副筋"}（${piece.direction === "x" ? "东西向" : "南北向"}）· Φ${piece.diameter}@${piece.spacing} · ${piece.singleLengthMm.toFixed(0)}mm`}</title>
        </g>
      ))}

      {display.slabNames && geometry.slabs.map((slab) => {
        const draw = slabDraw(slab);
        return <text key={`slab-label:${slab.id}`} x={toX(draw.x + slab.width / 2)} y={toY(draw.y + slab.height / 2) + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#171717" pointerEvents="none" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 4, strokeLinejoin: "round" }}>{slab.name}</text>;
      })}

      {display.openingNames && geometry.openings.map((opening) => {
        const draw = openingDraw(opening);
        return (
          <g key={`opening-label:${opening.id}`} pointerEvents="none">
            <rect x={toX(draw.x + opening.width / 2) - 55} y={toY(draw.y + opening.height / 2) - 22} width="110" height="44" rx="4" fill="#fff" fillOpacity="0.92" />
            <text x={toX(draw.x + opening.width / 2)} y={toY(draw.y + opening.height / 2) - 3} textAnchor="middle" fontSize="13" fontWeight="700" fill="#171717">{opening.name}</text>
            <text x={toX(draw.x + opening.width / 2)} y={toY(draw.y + opening.height / 2) + 14} textAnchor="middle" fontSize="11" fill="#525252">VOID</text>
          </g>
        );
      })}

      {display.barMarks && markClusters.map((cluster) => {
        const piece = cluster.pieceIds.flatMap((id) => {
          const found = pieceById.get(id);
          return found ? [found] : [];
        })[0];
        if (!piece) return null;
        const x = toX(mapCoordinate("x", cluster.centerX, piece.slabIds));
        const y = toY(mapCoordinate("y", cluster.centerY, piece.slabIds));
        const text = display.barSpecification ? `${cluster.mark}  Φ${piece.diameter}@${piece.spacing}` : cluster.mark;
        return (
          <g key={`mark:${cluster.mark}:${cluster.pieceIds.join("|")}`} data-mark-label={cluster.mark} data-mark-cluster-size={cluster.pieceIds.length} pointerEvents="none">
            <rect x={x - 55} y={y - 13} width="110" height="25" rx="4" fill="#fff" stroke="#171717" strokeWidth="1" />
            <text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#111827">{text}</text>
          </g>
        );
      })}

      <g transform={`translate(${VIEW_PADDING} ${VIEW_HEIGHT - 28})`} fontSize="11" fill="#262626">
        <rect x="0" y="-7" width="34" height="8" fill="#171717" /><text x="41" y="4">外墙</text>
        <rect x="90" y="-7" width="34" height="8" fill="#2563eb" /><text x="131" y="4">内墙</text>
        <line x1="180" y1="0" x2="214" y2="0" stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" /><text x="221" y="4">连续板边</text>
        {mode !== "geometry" && <><line x1="310" y1="0" x2="344" y2="0" stroke="#171717" strokeWidth="2.3" /><text x="351" y="4">主筋Piece</text><line x1="445" y1="0" x2="479" y2="0" stroke="#171717" strokeWidth="1.45" strokeDasharray="6 3" /><text x="486" y="4">副筋Piece</text>{mode === "top" && <><g data-through-legend="true"><line x1="580" y1="0" x2="614" y2="0" stroke="#171717" strokeWidth="5" /><line x1="580" y1="0" x2="614" y2="0" stroke="#fff" strokeWidth="1.5" /></g><text x="621" y="4">通墙Piece（双轨）</text></>}</>}
      </g>
    </svg>
  );
}
