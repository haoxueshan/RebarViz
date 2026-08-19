import { buildFloorPrintMarkClusters } from "@/lib/floor-2d";
import {
  buildAreaCalloutCandidates,
  buildContainedSlabCandidates,
  buildExternalSlabCandidates,
  buildFloorPrintAnnotationLayout,
  buildMarkCandidates,
  estimatePrintTextWidth,
  type FloorPrintAnnotationRequest,
} from "@/lib/floor-print-annotation-layout";
import {
  buildFloorPrintAreaGroups,
  buildFloorPrintSlabRebarSummaries,
  buildFloorPrintSlabRefs,
  floorPrintMarks,
  type FloorPrintAreaGroup,
  type FloorPrintSlabRebarSummary,
} from "@/lib/floor-print-layout";
import { mapFloorNetAxisPoint } from "@/lib/floor-physical-layout";
import type { FloorSlab } from "@/lib/floor-plan";
import type {
  FloorPrintBomRow,
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
  rows?: readonly FloorPrintBomRow[];
  display: FloorPrintOptions["display"];
};

type LabelMode = "full" | "compact" | "tiny";
type DrawBox = { x: number; y: number; width: number; height: number };

function boundaryStyle(support: FloorPrintGeometry["boundaries"][number]["support"]) {
  if (support === "outer-wall") return { width: 2.4, dash: undefined };
  if (support === "inner-wall") return { width: 1.4, dash: undefined };
  if (support === "continuous") return { width: 1.7, dash: "10 7" };
  return { width: 2.1, dash: "5 6" };
}

function labelForMode(mode: FloorPrintPlanSvgProps["mode"]): string {
  if (mode === "bottom") return "地筋平铺图";
  if (mode === "top") return "面筋平铺图";
  return "整层楼板平面";
}

function directionLabel(direction: FloorPrintBomRow["direction"]): string {
  return direction === "x" ? "东西" : "南北";
}

function roleLabel(role: FloorPrintBomRow["role"]): string {
  return role === "main" ? "主" : "副";
}

function detailLines(rows: readonly FloorPrintBomRow[], role: FloorPrintBomRow["role"]): string[] {
  if (rows.length === 0) return [];
  const bySpecification = new Map<string, FloorPrintBomRow[]>();
  rows.forEach((row) => {
    const key = `${row.diameter}:${row.spacing}:${row.direction}`;
    const grouped = bySpecification.get(key) ?? [];
    grouped.push(row);
    bySpecification.set(key, grouped);
  });
  return [...bySpecification.values()].map((group, index) => {
    const first = group[0];
    const prefix = index === 0 ? roleLabel(role) : "";
    return `${prefix} ${floorPrintMarks(group)}  Φ${first.diameter}@${first.spacing} ${directionLabel(first.direction)}`.trim();
  });
}

function compactLine(rows: readonly FloorPrintBomRow[], role: FloorPrintBomRow["role"]): string | null {
  return rows.length > 0 ? `${roleLabel(role)} ${floorPrintMarks(rows)}` : null;
}

function labelModeFor(width: number, height: number, detailLineCount: number): LabelMode {
  if (width >= 190 && height >= 48 + detailLineCount * 16) return "full";
  if (width >= 98 && height >= 58) return "compact";
  return "tiny";
}

function labelDimensions(lines: readonly string[], labelMode: LabelMode): { width: number; height: number } {
  const lineHeight = labelMode === "full" ? 15 : 14;
  const titleSize = labelMode === "tiny" ? 13 : 16;
  const widest = Math.max(...lines.map((line, index) =>
    estimatePrintTextWidth(line, index === 0 ? titleSize : labelMode === "full" ? 10 : 11)), 30);
  return {
    width: Math.min(220, Math.max(44, widest + 18)),
    height: Math.max(26, lines.length * lineHeight + 12),
  };
}

function slabLabelVariants(
  ref: { printId: string; name: string },
  summary: FloorPrintSlabRebarSummary | undefined,
  mode: FloorPrintPlanSvgProps["mode"],
  bounds: DrawBox,
  showName: boolean,
) {
  const fullDetails = mode === "bottom"
    ? [...detailLines(summary?.mainRows ?? [], "main"), ...detailLines(summary?.secondaryRows ?? [], "secondary")]
    : [];
  const preferred = labelModeFor(bounds.width, bounds.height, fullDetails.length);
  const modes: LabelMode[] = preferred === "full"
    ? ["full", "compact", "tiny"]
    : preferred === "compact" ? ["compact", "tiny"] : ["tiny"];
  return modes.map((labelMode) => {
    const lines = labelLines(ref, summary, mode, labelMode, showName);
    const { width, height } = labelDimensions(lines, labelMode);
    const contained = buildContainedSlabCandidates(bounds, width, height);
    return {
      id: labelMode,
      width,
      height,
      candidates: contained.length > 0
        ? contained
        : labelMode === "tiny"
          ? buildExternalSlabCandidates(bounds, width, height)
          : [],
    };
  });
}

function labelLines(
  ref: { printId: string; name: string },
  summary: FloorPrintSlabRebarSummary | undefined,
  mode: "geometry" | "bottom" | "top",
  labelMode: LabelMode,
  showName: boolean,
): string[] {
  const lines = [ref.printId];
  if (showName && labelMode !== "tiny") lines.push(ref.name);
  if (mode === "geometry" || !summary || labelMode === "tiny") return lines;
  if (labelMode === "compact") {
    const main = compactLine(summary.mainRows, "main");
    const secondary = compactLine(summary.secondaryRows, "secondary");
    return [...lines, ...(main ? [main] : []), ...(secondary ? [secondary] : [])];
  }
  return [
    ...lines,
    ...detailLines(summary.mainRows, "main"),
    ...detailLines(summary.secondaryRows, "secondary"),
  ];
}

function groupBounds(slabIds: readonly string[], boxesById: ReadonlyMap<string, DrawBox>): DrawBox | null {
  const boxes = slabIds.flatMap((slabId) => {
    const box = boxesById.get(slabId);
    return box ? [box] : [];
  });
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function groupCalloutLines(group: FloorPrintAreaGroup, through = false): string[] {
  const rows = [...group.mainRows, ...group.secondaryRows];
  if (through) {
    const first = rows[0];
    return [
      `${floorPrintMarks(rows)} ${first?.throughPathName ?? "通墙路径"}`,
      group.slabRefs.map((ref) => ref.printId).join(" + "),
    ];
  }
  return [
    `${group.slabRefs.map((ref) => ref.printId).join(" + ")} 联合`,
    ...detailLines(group.mainRows, "main").map((line) => line.replace(/ Φ.*$/, "")),
    ...detailLines(group.secondaryRows, "secondary").map((line) => line.replace(/ Φ.*$/, "")),
  ];
}

function compactGroupCalloutLines(group: FloorPrintAreaGroup, through: boolean): string[] {
  if (through) {
    return [
      floorPrintMarks([...group.mainRows, ...group.secondaryRows]),
      `${group.slabRefs[0]?.printId ?? ""} → ${group.slabRefs.at(-1)?.printId ?? ""}`,
    ];
  }
  return [
    `${group.slabRefs.map((ref) => ref.printId).join("+")} 联合`,
    [floorPrintMarks(group.mainRows), floorPrintMarks(group.secondaryRows)].filter(Boolean).join(" / "),
  ];
}

export function FloorPrintPlanSvg({
  geometry,
  coordinateModel,
  mode,
  pieces = [],
  rows = [],
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
  const slabBox = (slab: FloorPrintGeometry["slabs"][number]): DrawBox => {
    const item = physical?.slabs.find((entry) => entry.slabId === slab.id);
    return item
      ? { x: item.x, y: item.y, width: item.width, height: item.height }
      : { x: slab.x, y: slab.y, width: slab.width, height: slab.height };
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
  const slabRefs = buildFloorPrintSlabRefs(geometry);
  const slabRefsById = new Map(slabRefs.map((ref) => [ref.slabId, ref]));
  const normalRows = rows.filter((row) => row.source === "normal" && row.layer === mode);
  const throughRows = rows.filter((row) => row.source === "through" && row.layer === mode);
  const summaries = buildFloorPrintSlabRebarSummaries(normalRows, slabRefs);
  const summariesBySlab = new Map(summaries.map((summary) => [summary.slabRef.slabId, summary]));
  const jointGroups = buildFloorPrintAreaGroups(normalRows, slabRefs).filter((group) => group.slabIds.length > 1);
  const throughGroups = buildFloorPrintAreaGroups(throughRows, slabRefs).filter((group) => group.slabIds.length > 1);
  const screenSlabsById = new Map(geometry.slabs.map((slab) => {
    const box = slabBox(slab);
    return [slab.id, {
      x: toX(box.x),
      y: toY(box.y + box.height),
      width: box.width * scale,
      height: box.height * scale,
    }] as const;
  }));
  const annotationRequests: FloorPrintAnnotationRequest[] = [];
  slabRefs.forEach((ref) => {
    const bounds = screenSlabsById.get(ref.slabId);
    if (!bounds) return;
    annotationRequests.push({
      id: `slab-label:${ref.slabId}`,
      kind: "slab-label",
      priority: 1,
      variants: slabLabelVariants(ref, summariesBySlab.get(ref.slabId), mode, bounds, display.slabNames),
    });
  });
  if (display.barMarks) {
    markClusters.forEach((cluster) => {
      const piece = cluster.pieceIds.flatMap((id) => {
        const found = pieceById.get(id);
        return found ? [found] : [];
      })[0];
      if (!piece) return;
      const text = display.barSpecification ? `${cluster.mark}  桅${piece.diameter}@${piece.spacing}` : cluster.mark;
      const width = Math.max(48, estimatePrintTextWidth(text, 13) + 16);
      const height = 25;
      annotationRequests.push({
        id: `mark:${cluster.mark}:${cluster.pieceIds.join("|")}`,
        kind: "bar-mark",
        priority: 2,
        variants: [{
          id: "standard",
          width,
          height,
          candidates: buildMarkCandidates({
            x: toX(mapCoordinate("x", cluster.centerX, piece.slabIds)),
            y: toY(mapCoordinate("y", cluster.centerY, piece.slabIds)),
          }, piece.direction, width, height),
        }],
      });
    });
  }
  [...jointGroups.map((group) => ({ group, through: false })), ...throughGroups.map((group) => ({ group, through: true }))]
    .forEach(({ group, through }) => {
      const bounds = groupBounds(group.slabIds, screenSlabsById);
      if (!bounds) return;
      const variants = [false, true].map((compact) => {
        const lines = compact ? compactGroupCalloutLines(group, through) : groupCalloutLines(group, through);
        const width = Math.min(205, Math.max(92, Math.max(...lines.map((line) => estimatePrintTextWidth(line, compact ? 10 : 11))) + 18));
        const height = lines.length * 14 + 10;
        return {
          id: compact ? "compact" : "full",
          width,
          height,
          candidates: buildAreaCalloutCandidates(bounds, width, height),
        };
      });
      annotationRequests.push({
        id: `${through ? "through" : "joint"}:${group.areaKey}`,
        kind: through ? "through-callout" : "joint-callout",
        priority: through ? 4 : 3,
        variants,
      });
    });
  const annotationLayout = buildFloorPrintAnnotationLayout(
    annotationRequests,
    { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
  );
  const annotationsById = new Map(annotationLayout.boxes.map((box) => [box.id, box]));
  const openingPatternId = `floor-print-opening-${mode}`;
  const innerWallPatternId = `floor-print-inner-wall-${mode}`;
  const outerWallPatternId = `floor-print-outer-wall-${mode}`;

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
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={labelForMode(mode)} data-floor-print-plan={mode} className="block h-auto w-full bg-white">
      <defs>
        <pattern id={openingPatternId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="12" height="12" fill="#fff" /><line x1="0" y1="0" x2="0" y2="12" stroke="#737373" strokeWidth="2" /></pattern>
        <pattern id={innerWallPatternId} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="#f5f5f5" /><line x1="0" y1="0" x2="0" y2="9" stroke="#737373" strokeWidth="2" /></pattern>
        <pattern id={outerWallPatternId} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="#fff" /><line x1="0" y1="0" x2="0" y2="14" stroke="#d4d4d4" strokeWidth="2" /></pattern>
      </defs>
      <rect x="1" y="1" width={VIEW_WIDTH - 2} height={VIEW_HEIGHT - 2} fill="#fff" stroke="#737373" strokeWidth="2" />

      {geometry.slabs.map((slab) => {
        const box = slabBox(slab);
        return <rect key={slab.id} x={toX(box.x)} y={toY(box.y + box.height)} width={Math.max(box.width * scale, 0.5)} height={Math.max(box.height * scale, 0.5)} fill="#fafafa" stroke="#a3a3a3" strokeWidth="1" />;
      })}

      {normalPieces.map((piece) => <line key={piece.id} {...pieceLine(piece)} stroke="#171717" strokeWidth={piece.role === "main" ? 2.3 : 1.45} strokeDasharray={piece.role === "secondary" ? "6 3" : undefined} strokeLinecap="round" data-print-piece-id={piece.id} data-mark={piece.mark} data-layer={piece.layer} data-direction={piece.direction} data-source="normal"><title>{`${piece.mark} · ${piece.layer === "top" ? "普通面筋" : "地筋"} · ${piece.role === "main" ? "主筋" : "副筋"}（${piece.direction === "x" ? "东西向" : "南北向"}）· Φ${piece.diameter}@${piece.spacing} · ${piece.singleLengthMm.toFixed(0)}mm`}</title></line>)}

      {physical && physical.walls.map((wall) => <rect key={wall.id} x={toX(wall.x)} y={toY(wall.y + wall.height)} width={Math.max(wall.width * scale, 0)} height={Math.max(wall.height * scale, 0)} fill={`url(#${wall.kind === "outer-wall" ? outerWallPatternId : innerWallPatternId})`} stroke="#171717" strokeWidth={wall.kind === "outer-wall" ? "2.4" : "1.35"} data-print-wall-id={wall.id} data-wall-kind={wall.kind} data-wall-presentation={wall.kind === "outer-wall" ? "outline-hatch" : "hatch"} data-wall-thickness-mm={wall.thicknessMm} />)}

      {geometry.openings.map((opening) => {
        const draw = openingDraw(opening);
        return <rect key={opening.id} x={toX(draw.x)} y={toY(draw.y + opening.height)} width={Math.max(opening.width * scale, 0.5)} height={Math.max(opening.height * scale, 0.5)} fill={`url(#${openingPatternId})`} stroke="#404040" strokeWidth="2.1" strokeDasharray="7 5" />;
      })}

      {!physical && geometry.boundaries.map((boundary, index) => {
        const style = boundaryStyle(boundary.support);
        return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${boundary.endX}:${boundary.endY}:${index}`} x1={toX(boundary.startX)} y1={toY(boundary.startY)} x2={toX(boundary.endX)} y2={toY(boundary.endY)} stroke="#171717" strokeWidth={style.width} strokeDasharray={style.dash} strokeLinecap="square" />;
      })}

      {physical && geometry.boundaries.filter((boundary) => boundary.support === "continuous" || boundary.support === "opening-cut").map((boundary, index) => {
        const prefer = boundary.orientation === "vertical" ? netSlabs.filter((slab) => Math.abs(slab.x - boundary.startX) <= 1e-4 || Math.abs(slab.x + slab.width - boundary.startX) <= 1e-4).map((slab) => slab.id) : netSlabs.filter((slab) => Math.abs(slab.y - boundary.startY) <= 1e-4 || Math.abs(slab.y + slab.height - boundary.startY) <= 1e-4).map((slab) => slab.id);
        if (boundary.orientation === "vertical") {
          const x = toX(mapCoordinate("x", boundary.startX, prefer));
          return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${index}`} x1={x} y1={toY(mapCoordinate("y", boundary.startY, prefer))} x2={x} y2={toY(mapCoordinate("y", boundary.endY, prefer))} stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" strokeLinecap="square" />;
        }
        const y = toY(mapCoordinate("y", boundary.startY, prefer));
        return <line key={`${boundary.orientation}:${boundary.startX}:${boundary.startY}:${index}`} x1={toX(mapCoordinate("x", boundary.startX, prefer))} y1={y} x2={toX(mapCoordinate("x", boundary.endX, prefer))} y2={y} stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" strokeLinecap="square" />;
      })}

      {throughPieces.map((piece) => <g key={piece.id} data-print-piece-id={piece.id} data-mark={piece.mark} data-layer={piece.layer} data-direction={piece.direction} data-source="through"><line {...pieceLine(piece)} stroke="#171717" strokeWidth="5" strokeLinecap="round" data-through-outer="true" /><line {...pieceLine(piece)} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" data-through-inner="true" /><title>{`${piece.mark} · 通墙面筋 · ${piece.role === "main" ? "主筋" : "副筋"}（${piece.direction === "x" ? "东西向" : "南北向"}）· Φ${piece.diameter}@${piece.spacing} · ${piece.singleLengthMm.toFixed(0)}mm`}</title></g>)}

      {geometry.slabs.map((slab) => {
        const ref = slabRefsById.get(slab.id);
        if (!ref) return null;
        const annotation = annotationsById.get(`slab-label:${slab.id}`);
        if (!annotation) return null;
        const summary = summariesBySlab.get(slab.id);
        const variant = annotation.variant as LabelMode;
        const lines = labelLines(ref, summary, mode, variant, display.slabNames);
        const lineHeight = variant === "full" ? 15 : 14;
        const centerX = annotation.x + annotation.width / 2;
        const centerY = annotation.y + annotation.height / 2;
        return <g key={`slab-label:${slab.id}`} data-slab-label={ref.printId} data-slab-label-mode={variant} data-slab-construction-summary={mode === "bottom" ? "true" : undefined} data-annotation-x={annotation.x} data-annotation-y={annotation.y} data-annotation-width={annotation.width} data-annotation-height={annotation.height} pointerEvents="none">{annotation.external && annotation.leaderTo && <line x1={annotation.leaderTo.x} y1={annotation.leaderTo.y} x2={centerX} y2={centerY} stroke="#525252" strokeWidth="1" />}{<rect x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} rx="2" fill="#fff" fillOpacity="0.9" stroke="#737373" strokeWidth={variant === "tiny" ? "0.8" : "1"} />}{lines.map((line, index) => <text key={`${line}:${index}`} x={centerX} y={annotation.y + 15 + index * lineHeight} textAnchor="middle" fontSize={index === 0 ? (variant === "tiny" ? 13 : 16) : variant === "full" ? 10 : 11} fontWeight={index === 0 ? 900 : index === 1 ? 700 : 600} fill="#171717">{line}</text>)}</g>;
      })}

      {display.openingNames && geometry.openings.map((opening) => {
        const draw = openingDraw(opening);
        return <g key={`opening-label:${opening.id}`} pointerEvents="none"><rect x={toX(draw.x + opening.width / 2) - 55} y={toY(draw.y + opening.height / 2) - 22} width="110" height="44" rx="2" fill="#fff" fillOpacity="0.92" stroke="#737373" /><text x={toX(draw.x + opening.width / 2)} y={toY(draw.y + opening.height / 2) - 3} textAnchor="middle" fontSize="13" fontWeight="700" fill="#171717">{opening.name}</text><text x={toX(draw.x + opening.width / 2)} y={toY(draw.y + opening.height / 2) + 14} textAnchor="middle" fontSize="11" fill="#525252">VOID</text></g>;
      })}

      {[...jointGroups.map((group) => ({ group, through: false })), ...throughGroups.map((group) => ({ group, through: true }))].map(({ group, through }) => {
        const annotation = annotationsById.get(`${through ? "through" : "joint"}:${group.areaKey}`);
        if (!annotation) return null;
        const compact = annotation.variant === "compact";
        const lines = compact ? compactGroupCalloutLines(group, through) : groupCalloutLines(group, through);
        const x = annotation.x + annotation.width / 2;
        return <g key={`${through ? "through" : "joint"}:${group.areaKey}`} data-area-callout={group.areaKey} data-area-callout-kind={through ? "through" : "joint"} data-annotation-x={annotation.x} data-annotation-y={annotation.y} data-annotation-width={annotation.width} data-annotation-height={annotation.height} pointerEvents="none"><rect x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} rx="2" fill="#fff" fillOpacity="0.94" stroke="#171717" strokeWidth="1.2" strokeDasharray={through ? "4 2" : undefined} />{lines.map((line, index) => <text key={`${line}:${index}`} x={x} y={annotation.y + 15 + index * 14} textAnchor="middle" fontSize={index === 0 ? 11 : 10} fontWeight={index === 0 ? 900 : 700} fill="#171717">{line}</text>)}</g>;
      })}

      {display.barMarks && markClusters.map((cluster) => {
        const piece = cluster.pieceIds.flatMap((id) => {
          const found = pieceById.get(id);
          return found ? [found] : [];
        })[0];
        if (!piece) return null;
        const annotation = annotationsById.get(`mark:${cluster.mark}:${cluster.pieceIds.join("|")}`);
        if (!annotation) return null;
        const x = annotation.x + annotation.width / 2;
        const y = annotation.y + annotation.height / 2;
        const text = display.barSpecification ? `${cluster.mark}  Φ${piece.diameter}@${piece.spacing}` : cluster.mark;
        return <g key={`mark:${cluster.mark}:${cluster.pieceIds.join("|")}`} data-mark-label={cluster.mark} data-mark-cluster-size={cluster.pieceIds.length} data-annotation-x={annotation.x} data-annotation-y={annotation.y} data-annotation-width={annotation.width} data-annotation-height={annotation.height} pointerEvents="none"><rect x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} rx="2" fill="#fff" stroke="#171717" strokeWidth="1" /><text x={x} y={y + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#171717">{text}</text></g>;
      })}

      <g transform={`translate(${VIEW_PADDING} ${VIEW_HEIGHT - 28})`} fontSize="11" fill="#262626"><rect x="0" y="-8" width="34" height="10" fill={`url(#${outerWallPatternId})`} stroke="#171717" strokeWidth="2" /><text x="41" y="4">外墙</text><rect x="90" y="-8" width="34" height="10" fill={`url(#${innerWallPatternId})`} stroke="#171717" strokeWidth="1.2" /><text x="131" y="4">内墙</text><line x1="180" y1="0" x2="214" y2="0" stroke="#171717" strokeWidth="1.7" strokeDasharray="10 7" /><text x="221" y="4">连续板边</text>{mode !== "geometry" && <><line x1="310" y1="0" x2="344" y2="0" stroke="#171717" strokeWidth="2.3" /><text x="351" y="4">主筋Piece</text><line x1="445" y1="0" x2="479" y2="0" stroke="#171717" strokeWidth="1.45" strokeDasharray="6 3" /><text x="486" y="4">副筋Piece</text>{mode === "top" && <><g data-through-legend="true"><line x1="580" y1="0" x2="614" y2="0" stroke="#171717" strokeWidth="5" /><line x1="580" y1="0" x2="614" y2="0" stroke="#fff" strokeWidth="1.5" /></g><text x="621" y="4">通墙Piece（双轨）</text></>}</>}</g>
    </svg>
  );
}
