import {
  LENGTH_GROUP_EPSILON_MM,
  type FloorBottomCalculation,
  type FloorBottomBomGroup,
} from "./floor-bottom-calculator";
import {
  buildFloorAtomicBoundarySegments,
  validateFloorPlanV2,
  type FloorPlanState,
  type FloorResolvedSupport,
} from "./floor-plan";
import { calculateFloorCanvasBounds } from "./floor-2d";
import {
  buildFloorPhysicalLayout,
  type FloorPhysicalLayout,
} from "./floor-physical-layout";
import { validateFloorPlanState } from "./floor-topology-adapter";
import {
  buildFloorTopologyBoundarySegmentsV3,
  solveFloorTopology,
  type FloorTopologySolution,
} from "./floor-topology-solver";
import {
  buildFloorPrintSlabRefs,
  floorPrintAreaKey,
  floorPrintSlabRefMap,
  type FloorPrintSlabRef,
} from "./floor-print-layout";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import type { FloorBarRole } from "./floor-rebar-role";
import type {
  FloorTopBomGroup,
  FloorTopCalculation,
} from "./floor-top-calculator";

export const FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const FLOOR_PRINT_SUM_EPSILON = 1e-6;

export type FloorPrintStatus = "draft" | "official";
export type FloorPrintLayerName = "bottom" | "top";
export type FloorPrintDirection = "x" | "y";
export type FloorPrintCoordinateModel = FloorPlanState["coordinateModel"];

export type FloorPrintEligibilityIssue = {
  code: string;
  message: string;
};

export type FloorPrintEligibility = {
  eligible: boolean;
  errors: FloorPrintEligibilityIssue[];
  warnings: FloorPrintEligibilityIssue[];
};

export type FloorPrintProjectInfo = {
  projectName: string;
  floorName: string;
  remark: string;
};

export type FloorPrintOptions = {
  preset: "site" | "full" | "custom";
  paperSize: "A3" | "A4";
  orientation: "landscape" | "portrait";
  lengthUnit: "mm" | "m";
  sections: {
    summary: boolean;
    floorPlan: boolean;
    bottomPlan: boolean;
    bottomBom: boolean;
    topPlan: boolean;
    topBom: boolean;
    combinedBom: boolean;
    diameterSummary: boolean;
    calculationParameters: boolean;
  };
  display: {
    slabNames: boolean;
    openingNames: boolean;
    barMarks: boolean;
    barSpecification: boolean;
    weights: boolean;
    anchorDetails: boolean;
  };
};

const SITE_SECTIONS: FloorPrintOptions["sections"] = {
  summary: false,
  floorPlan: true,
  bottomPlan: true,
  bottomBom: true,
  topPlan: true,
  topBom: true,
  combinedBom: false,
  diameterSummary: true,
  calculationParameters: false,
};

const FULL_SECTIONS: FloorPrintOptions["sections"] = {
  summary: true,
  floorPlan: true,
  bottomPlan: true,
  bottomBom: true,
  topPlan: true,
  topBom: true,
  combinedBom: true,
  diameterSummary: true,
  calculationParameters: true,
};

export const DEFAULT_FLOOR_PRINT_OPTIONS: FloorPrintOptions = {
  preset: "site",
  paperSize: "A4",
  orientation: "landscape",
  lengthUnit: "mm",
  sections: SITE_SECTIONS,
  display: {
    slabNames: true,
    openingNames: true,
    barMarks: true,
    barSpecification: true,
    weights: true,
    anchorDetails: false,
  },
};

export function floorPrintOptionsForPreset(
  preset: "site" | "full",
): FloorPrintOptions {
  if (preset === "site") return structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS);
  return {
    ...structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
    preset: "full",
    paperSize: "A3",
    orientation: "landscape",
    lengthUnit: "mm",
    sections: structuredClone(FULL_SECTIONS),
    display: {
      slabNames: true,
      openingNames: true,
      barMarks: true,
      barSpecification: true,
      weights: true,
      anchorDetails: true,
    },
  };
}

export function detectFloorPrintPreset(
  value: Omit<FloorPrintOptions, "preset"> | FloorPrintOptions,
): FloorPrintOptions["preset"] {
  const comparable = (options: Omit<FloorPrintOptions, "preset"> | FloorPrintOptions) =>
    JSON.stringify({
      paperSize: options.paperSize,
      orientation: options.orientation,
      lengthUnit: options.lengthUnit,
      sections: options.sections,
      display: options.display,
    });
  if (comparable(value) === comparable(floorPrintOptionsForPreset("site"))) return "site";
  if (comparable(value) === comparable(floorPrintOptionsForPreset("full"))) return "full";
  return "custom";
}

export type FloorPrintBoundary = {
  orientation: "horizontal" | "vertical";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  support: FloorResolvedSupport;
};

export type FloorPrintGeometry = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  slabs: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  openings: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  boundaries: FloorPrintBoundary[];
  /** Floor Physical V1.3：墙体真实物理几何（快照内派生副本）；旧快照无此字段时退化为线型绘制。 */
  physical?: FloorPhysicalLayout | null;
};

export type FloorPrintBomRow = {
  id: string;
  mark: string;
  layer: FloorPrintLayerName;
  source: "normal" | "through";
  throughPathId?: string;
  throughPathName?: string;
  role: FloorBarRole;
  direction: FloorPrintDirection;
  diameter: number;
  spacing: number;
  singleLengthMm: number;
  count: number;
  totalLengthM: number;
  unitWeightKgM: number;
  weightKg: number;
  slabIds: string[];
  slabNames: string[];
  pieceIds: string[];
};

export type FloorPrintPiece = {
  id: string;
  mark: string;
  layer: FloorPrintLayerName;
  source: "normal" | "through";
  throughPathId?: string;
  role: FloorBarRole;
  direction: FloorPrintDirection;
  diameter: number;
  spacing: number;
  positionMm: number;
  runStartMm: number;
  runEndMm: number;
  singleLengthMm: number;
  startSupport: FloorResolvedSupport;
  endSupport: FloorResolvedSupport;
  slabIds: string[];
};

export type FloorPrintLayer = {
  rows: FloorPrintBomRow[];
  pieces: FloorPrintPiece[];
  totalPieceCount: number;
  totalLengthM: number;
  totalWeightKg: number;
};

export type FloorPrintDiameterSummaryRow = {
  diameter: number;
  totalLengthM: number;
  weightKg: number;
  pieceCount: number;
};

export type FloorPrintSummary = {
  slabCount: number;
  openingCount: number;
  bottomPieceCount: number;
  topPieceCount: number;
  topNormalPieceCount: number;
  topThroughPieceCount: number;
  bottomLengthM: number;
  topLengthM: number;
  bottomWeightKg: number;
  topWeightKg: number;
  totalPieceCount: number;
  totalLengthM: number;
  totalWeightKg: number;
};

export type FloorPrintParameters = {
  coordinateModel: FloorPrintCoordinateModel;
  innerWallThicknessMm: number;
  outerWallThicknessMm: number;
  bottomPhysicalDomainCount: number;
  topPhysicalDomainCount: number;
  roleDomainCount: number;
};

export type FloorPrintSnapshot = {
  schemaVersion: typeof FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  status: FloorPrintStatus;
  project: FloorPrintProjectInfo;
  geometry: FloorPrintGeometry;
  summary: FloorPrintSummary;
  bottom: FloorPrintLayer;
  top: FloorPrintLayer;
  combinedRows: FloorPrintBomRow[];
  diameterSummary: FloorPrintDiameterSummaryRow[];
  parameters: FloorPrintParameters;
  options: FloorPrintOptions;
  source: {
    calculator: "floor-rebar";
    coordinateModel: FloorPrintCoordinateModel;
  };
};

export type FloorPrintEligibilityInput = {
  plan: FloorPlanState;
  bottom: FloorBottomCalculation;
  top: FloorTopCalculation;
  bottomRoleReviewRequired: boolean;
  topRoleReviewRequired: boolean;
  invalidDraftCount: number;
};

export type FloorPrintSnapshotInput = FloorPrintEligibilityInput & {
  project: FloorPrintProjectInfo;
  options: FloorPrintOptions;
  createdAt?: string;
  snapshotId?: string;
};

type LayerCalculation = FloorBottomCalculation | FloorTopCalculation;
type LayerGroup = FloorBottomBomGroup | FloorTopBomGroup;

function groupSource(group: LayerGroup): "normal" | "through" {
  return "source" in group ? group.source : "normal";
}

function groupThroughPathId(group: LayerGroup): string | undefined {
  return "throughPathId" in group ? group.throughPathId : undefined;
}

function closeEnough(left: number, right: number, epsilon = FLOOR_PRINT_SUM_EPSILON): boolean {
  return Math.abs(left - right) <= epsilon;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function issueKey(issue: FloorPrintEligibilityIssue): string {
  return `${issue.code}:${issue.message}`;
}

function uniqueIssues(issues: FloorPrintEligibilityIssue[]): FloorPrintEligibilityIssue[] {
  return [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
}

function validateLayerBomConsistency(
  layer: FloorPrintLayerName,
  calculation: LayerCalculation,
): FloorPrintEligibilityIssue[] {
  const errors: FloorPrintEligibilityIssue[] = [];
  const pieceById = new Map(calculation.pieces.map((piece) => [piece.id, piece]));
  const assigned = new Set<string>();
  const prefix = layer === "bottom" ? "地筋" : "面筋";

  calculation.groups.forEach((group) => {
    if (groupSource(group) === "through" && !groupThroughPathId(group)) {
      errors.push({
        code: "floor-print-bom-consistency-error",
        message: `${prefix}通墙分组“${group.id}”缺少稳定的通墙路径引用。`,
      });
    }
    const pieces = group.pieceIds.flatMap((pieceId) => {
      const piece = pieceById.get(pieceId);
      if (!piece) {
        errors.push({
          code: "floor-print-bom-consistency-error",
          message: `${prefix}分组“${group.id}”引用了不存在的实物钢筋件。`,
        });
        return [];
      }
      if (assigned.has(pieceId)) {
        errors.push({
          code: "floor-print-bom-consistency-error",
          message: `${prefix}实物钢筋件“${pieceId}”被重复计入料单。`,
        });
      }
      assigned.add(pieceId);
      return [piece];
    });
    if (!Number.isSafeInteger(group.count) || group.count <= 0 || group.count !== pieces.length) {
      errors.push({
        code: "floor-print-bom-consistency-error",
        message: `${prefix}分组“${group.id}”的根数与实物钢筋件数量不一致。`,
      });
    }
    const totalLengthM = pieces.reduce((sum, piece) => sum + piece.singleLengthMm / 1000, 0);
    const weightKg = pieces.reduce(
      (sum, piece) => sum + piece.singleLengthMm / 1000 * group.unitWeightKgM,
      0,
    );
    if (!closeEnough(group.totalLengthM, totalLengthM) || !closeEnough(group.weightKg, weightKg)) {
      errors.push({
        code: "floor-print-bom-consistency-error",
        message: `${prefix}分组“${group.id}”的长度或重量与实物钢筋件不一致。`,
      });
    }
    pieces.forEach((piece) => {
      if (
        piece.layer !== layer ||
        piece.source !== groupSource(group) ||
        piece.throughPathId !== groupThroughPathId(group) ||
        piece.direction !== group.direction ||
        piece.role !== group.role ||
        piece.diameter !== group.diameter ||
        piece.spacing !== group.spacing ||
        Math.abs(piece.singleLengthMm - group.singleLengthMm) > LENGTH_GROUP_EPSILON_MM
      ) {
        errors.push({
          code: "floor-print-bom-consistency-error",
          message: `${prefix}分组“${group.id}”与其钢筋件的规格或长度不一致。`,
        });
      }
      if (piece.source === "through" && !piece.throughPathId) {
        errors.push({
          code: "floor-print-bom-consistency-error",
          message: `${prefix}通墙钢筋件“${piece.id}”缺少通墙路径引用。`,
        });
      }
    });
  });

  if (assigned.size !== calculation.pieces.length) {
    errors.push({
      code: "floor-print-bom-consistency-error",
      message: `${prefix}料单没有完整覆盖全部实物钢筋件。`,
    });
  }
  const pieceLengthM = calculation.pieces.reduce(
    (sum, piece) => sum + piece.singleLengthMm / 1000,
    0,
  );
  if (
    calculation.totalPieces !== calculation.pieces.length ||
    !closeEnough(calculation.totalLengthM, pieceLengthM) ||
    calculation.totalWeightKg === null ||
    !finiteNonNegative(calculation.totalWeightKg) ||
    !closeEnough(
      calculation.groups.reduce((sum, group) => sum + group.weightKg, 0),
      calculation.totalWeightKg,
    )
  ) {
    errors.push({
      code: "floor-print-bom-consistency-error",
      message: `${prefix}计算汇总与实物钢筋件或正式分组不一致。`,
    });
  }
  return uniqueIssues(errors);
}

export function validateFloorPrintBomConsistency(
  bottom: FloorBottomCalculation,
  top: FloorTopCalculation,
): FloorPrintEligibilityIssue[] {
  return uniqueIssues([
    ...validateLayerBomConsistency("bottom", bottom),
    ...validateLayerBomConsistency("top", top),
  ]);
}

export function getFloorPrintEligibility(
  input: FloorPrintEligibilityInput,
  precomputedSolution?: FloorTopologySolution,
): FloorPrintEligibility {
  const topologySolution = input.plan.coordinateModel === "clear-space-physical-v2"
    ? precomputedSolution ?? solveFloorTopology(input.plan)
    : undefined;
  const geometryIssues = input.plan.coordinateModel === "clear-space-physical-v2"
    ? validateFloorPlanState(input.plan, topologySolution)
    : validateFloorPlanV2(input.plan);
  const physicalIssues = topologySolution
    ? buildFloorPhysicalLayout(input.plan, topologySolution).issues
    : [];
  const geometryIssueCodes = new Set(geometryIssues.map((issue) => issue.code));
  const physicalOnlyIssues = physicalIssues.filter((issue) => !geometryIssueCodes.has(issue.code));
  const errors: FloorPrintEligibilityIssue[] = geometryIssues
    .filter((issue) => issue.level === "error")
    .map(({ code, message }) => ({ code, message }));
  const warnings: FloorPrintEligibilityIssue[] = geometryIssues
    .filter((issue) => issue.level === "warning")
    .map(({ code, message }) => ({ code, message }));
  errors.push(...physicalOnlyIssues
    .filter((issue) => issue.level === "error")
    .map(({ code, message }) => ({ code, message })));
  warnings.push(...physicalOnlyIssues
    .filter((issue) => issue.level === "warning")
    .map(({ code, message }) => ({ code, message })));

  if (!input.bottom.isValid) {
    errors.push(...input.bottom.errors.map(({ code, message }) => ({ code, message })));
  }
  if (!input.top.isValid) {
    errors.push(...input.top.errors.map(({ code, message }) => ({ code, message })));
  }
  warnings.push(
    ...input.bottom.warnings.map(({ code, message }) => ({ code, message })),
    ...input.top.warnings.map(({ code, message }) => ({ code, message })),
  );
  if (!Number.isSafeInteger(input.invalidDraftCount) || input.invalidDraftCount < 0) {
    errors.push({ code: "floor-print-invalid-draft-count", message: "打印资格中的无效输入数量不合法。" });
  } else if (input.invalidDraftCount > 0) {
    errors.push({
      code: "floor-print-draft-invalid",
      message: `仍有 ${input.invalidDraftCount} 个数字输入为空或非法，不能生成正式下料单。`,
    });
  }
  if (input.bottomRoleReviewRequired || input.topRoleReviewRequired) {
    errors.push({
      code: "floor-print-role-review-required",
      message: "旧版本方向规格已迁移为主/副筋语义，请先确认地筋和面筋的主副筋规格后再生成正式下料单。",
    });
  }
  if (input.bottom.isValid && input.top.isValid) {
    errors.push(...validateFloorPrintBomConsistency(input.bottom, input.top));
  }
  const uniqueErrors = uniqueIssues(errors);
  return {
    eligible: uniqueErrors.length === 0,
    errors: uniqueErrors,
    warnings: uniqueIssues(warnings),
  };
}

export type FloorPrintBomCandidate = Omit<FloorPrintBomRow, "mark"> & {
  sortPositionMm: number;
  sortRunStartMm: number;
};

const ROLE_ORDER: Record<FloorBarRole, number> = { main: 0, secondary: 1 };
const DIRECTION_ORDER: Record<FloorPrintDirection, number> = { x: 0, y: 1 };

function compareCandidateRows(left: FloorPrintBomCandidate, right: FloorPrintBomCandidate): number {
  const sourceOrder = (left.source === "normal" ? 0 : 1) - (right.source === "normal" ? 0 : 1);
  if (sourceOrder !== 0) return sourceOrder;
  if (left.source === "through" && right.source === "through") {
    const pathOrder = (left.throughPathName ?? "").localeCompare(
      right.throughPathName ?? "",
      "zh-CN",
    );
    if (pathOrder !== 0) return pathOrder;
  }
  return ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    DIRECTION_ORDER[left.direction] - DIRECTION_ORDER[right.direction] ||
    right.diameter - left.diameter ||
    left.singleLengthMm - right.singleLengthMm ||
    left.spacing - right.spacing ||
    left.slabNames.join("|").localeCompare(right.slabNames.join("|"), "zh-CN") ||
    left.sortPositionMm - right.sortPositionMm ||
    left.sortRunStartMm - right.sortRunStartMm ||
    left.slabIds.join("|").localeCompare(right.slabIds.join("|"));
}

function compareBottomPrintCandidateRows(
  left: FloorPrintBomCandidate,
  right: FloorPrintBomCandidate,
  refs: readonly FloorPrintSlabRef[],
): number {
  const refsById = floorPrintSlabRefMap(refs);
  const areaSort = (row: FloorPrintBomCandidate) => {
    const matched = row.slabIds
      .flatMap((slabId) => {
        const ref = refsById.get(slabId);
        return ref ? [ref] : [];
      })
      .sort((first, second) => first.sortIndex - second.sortIndex || first.slabId.localeCompare(second.slabId));
    return {
      sortIndex: matched[0]?.sortIndex ?? Number.MAX_SAFE_INTEGER,
      key: floorPrintAreaKey(row.slabIds),
    };
  };
  const leftArea = areaSort(left);
  const rightArea = areaSort(right);
  return leftArea.sortIndex - rightArea.sortIndex ||
    leftArea.key.localeCompare(rightArea.key) ||
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    DIRECTION_ORDER[left.direction] - DIRECTION_ORDER[right.direction] ||
    right.diameter - left.diameter ||
    left.singleLengthMm - right.singleLengthMm ||
    left.spacing - right.spacing ||
    left.sortPositionMm - right.sortPositionMm ||
    left.sortRunStartMm - right.sortRunStartMm ||
    left.id.localeCompare(right.id);
}

export function assignFloorPrintMarks(
  rows: readonly FloorPrintBomCandidate[],
  layer: FloorPrintLayerName,
  slabRefs: readonly FloorPrintSlabRef[] = [],
): FloorPrintBomRow[] {
  let bottomIndex = 0;
  let normalTopIndex = 0;
  let throughTopIndex = 0;
  const compare = layer === "bottom" && slabRefs.length > 0
    ? (left: FloorPrintBomCandidate, right: FloorPrintBomCandidate) =>
      compareBottomPrintCandidateRows(left, right, slabRefs)
    : compareCandidateRows;
  return [...rows].sort(compare).map((row) => {
    const prefix = layer === "bottom" ? "D" : row.source === "through" ? "T" : "M";
    const index = layer === "bottom"
      ? ++bottomIndex
      : row.source === "through"
        ? ++throughTopIndex
        : ++normalTopIndex;
    const mark = `${prefix}${String(index).padStart(2, "0")}`;
    return {
      id: `${layer}:${mark}`,
      mark,
      layer: row.layer,
      source: row.source,
      throughPathId: row.throughPathId,
      throughPathName: row.throughPathName,
      role: row.role,
      direction: row.direction,
      diameter: row.diameter,
      spacing: row.spacing,
      singleLengthMm: row.singleLengthMm,
      count: row.count,
      totalLengthM: row.totalLengthM,
      unitWeightKgM: row.unitWeightKgM,
      weightKg: row.weightKg,
      slabIds: [...row.slabIds],
      slabNames: [...row.slabNames],
      pieceIds: [...row.pieceIds],
    };
  });
}

function slabNamesFor(ids: readonly string[], plan: FloorPlanState): string[] {
  const names = new Map(plan.slabs.map((slab) => [slab.id, slab.name]));
  return [...ids].map((id) => names.get(id) ?? id).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function groupToCandidate(
  layer: FloorPrintLayerName,
  group: LayerGroup,
  plan: FloorPlanState,
  pieceById: ReadonlyMap<string, FloorBarPiece>,
  lineById: ReadonlyMap<string, FloorBarLine>,
  throughPathNames: ReadonlyMap<string, string>,
): FloorPrintBomCandidate {
  const pieces = group.pieceIds.flatMap((id) => {
    const piece = pieceById.get(id);
    return piece ? [piece] : [];
  });
  const positions = pieces.flatMap((piece) => {
    const line = lineById.get(piece.lineId);
    return line ? [line.positionMm] : [];
  });
  return {
    id: group.id,
    layer,
    source: groupSource(group),
    throughPathId: groupThroughPathId(group),
    throughPathName: groupThroughPathId(group)
      ? throughPathNames.get(groupThroughPathId(group)!)
      : undefined,
    role: group.role,
    direction: group.direction,
    diameter: group.diameter,
    spacing: group.spacing,
    singleLengthMm: group.singleLengthMm,
    count: group.count,
    totalLengthM: group.totalLengthM,
    unitWeightKgM: group.unitWeightKgM,
    weightKg: group.weightKg,
    slabIds: [...group.slabIds].sort(),
    slabNames: slabNamesFor(group.slabIds, plan),
    pieceIds: [...group.pieceIds].sort(),
    sortPositionMm: positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER,
    sortRunStartMm: pieces.length > 0 ? Math.min(...pieces.map((piece) => piece.runStartMm)) : Number.MAX_SAFE_INTEGER,
  };
}

function buildPrintLayer(
  layer: FloorPrintLayerName,
  calculation: LayerCalculation,
  plan: FloorPlanState,
  slabRefs: readonly FloorPrintSlabRef[] = [],
): FloorPrintLayer {
  const pieceById = new Map(calculation.pieces.map((piece) => [piece.id, piece]));
  const lineById = new Map(calculation.lines.map((line) => [line.id, line]));
  const throughPathNames = new Map(
    "resolvedThroughPaths" in calculation
      ? calculation.resolvedThroughPaths.map((path) => [path.id, path.name] as const)
      : [],
  );
  const rows = assignFloorPrintMarks(
    calculation.groups.map((group) => groupToCandidate(
      layer,
      group,
      plan,
      pieceById,
      lineById,
      throughPathNames,
    )),
    layer,
    slabRefs,
  );
  const markByPiece = new Map<string, string>();
  rows.forEach((row) => row.pieceIds.forEach((pieceId) => markByPiece.set(pieceId, row.mark)));
  const pieces: FloorPrintPiece[] = calculation.pieces.map((piece) => {
    const line = lineById.get(piece.lineId);
    const mark = markByPiece.get(piece.id);
    if (!line || !mark) {
      throw new FloorPrintBuildError("floor-print-bom-consistency-error", "打印钢筋件无法关联正式理论线或料单编号。");
    }
    return {
      id: piece.id,
      mark,
      layer,
      source: piece.source,
      throughPathId: piece.throughPathId,
      role: piece.role,
      direction: piece.direction,
      diameter: piece.diameter,
      spacing: piece.spacing,
      positionMm: line.positionMm,
      runStartMm: piece.runStartMm,
      runEndMm: piece.runEndMm,
      singleLengthMm: piece.singleLengthMm,
      startSupport: piece.startSupport,
      endSupport: piece.endSupport,
      slabIds: [...piece.slabIds].sort(),
    };
  });
  return {
    rows,
    pieces,
    totalPieceCount: calculation.totalPieces,
    totalLengthM: calculation.totalLengthM,
    totalWeightKg: calculation.totalWeightKg ?? 0,
  };
}

export type FloorPrintContent = {
  geometry: FloorPrintGeometry;
  summary: FloorPrintSummary;
  bottom: FloorPrintLayer;
  top: FloorPrintLayer;
  combinedRows: FloorPrintBomRow[];
  diameterSummary: FloorPrintDiameterSummaryRow[];
  parameters: FloorPrintParameters;
};

function buildDiameterSummary(rows: readonly FloorPrintBomRow[]): FloorPrintDiameterSummaryRow[] {
  const groups = new Map<number, FloorPrintDiameterSummaryRow>();
  rows.forEach((row) => {
    const current = groups.get(row.diameter) ?? {
      diameter: row.diameter,
      totalLengthM: 0,
      weightKg: 0,
      pieceCount: 0,
    };
    current.totalLengthM += row.totalLengthM;
    current.weightKg += row.weightKg;
    current.pieceCount += row.count;
    groups.set(row.diameter, current);
  });
  return [...groups.values()].sort((left, right) => left.diameter - right.diameter);
}

function validateSnapshotNumbers(content: FloorPrintContent): void {
  const nonNegativeValues = [
    content.summary.bottomPieceCount,
    content.summary.topPieceCount,
    content.summary.topNormalPieceCount,
    content.summary.topThroughPieceCount,
    content.summary.bottomLengthM,
    content.summary.topLengthM,
    content.summary.bottomWeightKg,
    content.summary.topWeightKg,
    content.summary.totalPieceCount,
    content.summary.totalLengthM,
    content.summary.totalWeightKg,
    ...content.combinedRows.flatMap((row) => [
      row.diameter,
      row.spacing,
      row.singleLengthMm,
      row.count,
      row.totalLengthM,
      row.unitWeightKgM,
      row.weightKg,
    ]),
    ...content.bottom.pieces.map((piece) => piece.singleLengthMm),
    ...content.top.pieces.map((piece) => piece.singleLengthMm),
  ];
  const coordinates = [...content.bottom.pieces, ...content.top.pieces].flatMap((piece) => [
    piece.positionMm,
    piece.runStartMm,
    piece.runEndMm,
  ]);
  if (
    nonNegativeValues.some((value) => !finiteNonNegative(value)) ||
    coordinates.some((value) => !Number.isFinite(value))
  ) {
    throw new FloorPrintBuildError(
      "floor-print-data-invalid",
      "正式计算结果含NaN、Infinity或负值，已拒绝生成打印快照。",
    );
  }
  if (content.combinedRows.some((row) => !Number.isSafeInteger(row.count) || row.count <= 0)) {
    throw new FloorPrintBuildError(
      "floor-print-data-invalid",
      "正式料单包含非法根数，已拒绝生成打印快照。",
    );
  }
}

export function buildFloorPrintContent(
  plan: FloorPlanState,
  bottomCalculation: FloorBottomCalculation,
  topCalculation: FloorTopCalculation,
  precomputedSolution?: FloorTopologySolution,
): FloorPrintContent {
  const consistency = validateFloorPrintBomConsistency(bottomCalculation, topCalculation);
  if (consistency.length > 0) {
    throw new FloorPrintBuildError(consistency[0].code, consistency[0].message);
  }
  const topologySolution = plan.coordinateModel === "clear-space-physical-v2"
    ? precomputedSolution ?? solveFloorTopology(plan)
    : undefined;
  const physical = buildFloorPhysicalLayout(plan, topologySolution);
  const physicalError = plan.coordinateModel === "clear-space-physical-v2"
    ? physical.issues.find((issue) => issue.level === "error")
    : undefined;
  if (physicalError) {
    throw new FloorPrintBuildError(physicalError.code, physicalError.message);
  }
  const boundarySegments = topologySolution
    ? buildFloorTopologyBoundarySegmentsV3(plan, topologySolution)
    : buildFloorAtomicBoundarySegments(plan);
  const geometry: FloorPrintGeometry = {
    // 未覆盖楼板的远端洞口仍保留在快照中供报告提示，但不能压缩正式楼板图。
    bounds: calculateFloorCanvasBounds(plan, "floor"),
    slabs: plan.slabs.map((slab) => ({ ...slab })),
    openings: plan.openings.map((opening) => ({ ...opening })),
    // V3 uses the formal Solved Connection / Exterior Range adapter. Legacy
    // remains on Atomic Boundary. Physical walls are authoritative in V3.
    boundaries: boundarySegments.map((segment) => ({
      orientation: segment.orientation,
      startX: segment.startX,
      startY: segment.startY,
      endX: segment.endX,
      endY: segment.endY,
      support: segment.support,
    })),
    physical,
  };
  // S references are presentation-only, but their physical order governs Bottom print marks.
  const slabRefs = buildFloorPrintSlabRefs(geometry);
  const bottom = buildPrintLayer("bottom", bottomCalculation, plan, slabRefs);
  const top = buildPrintLayer("top", topCalculation, plan);
  const combinedRows = [...bottom.rows, ...top.rows];
  const summary: FloorPrintSummary = {
    slabCount: plan.slabs.length,
    openingCount: plan.openings.length,
    bottomPieceCount: bottom.totalPieceCount,
    topPieceCount: top.totalPieceCount,
    topNormalPieceCount: topCalculation.normalPieceCount,
    topThroughPieceCount: topCalculation.throughPieceCount,
    bottomLengthM: bottom.totalLengthM,
    topLengthM: top.totalLengthM,
    bottomWeightKg: bottom.totalWeightKg,
    topWeightKg: top.totalWeightKg,
    totalPieceCount: bottom.totalPieceCount + top.totalPieceCount,
    totalLengthM: bottom.totalLengthM + top.totalLengthM,
    totalWeightKg: bottom.totalWeightKg + top.totalWeightKg,
  };
  const content: FloorPrintContent = {
    geometry,
    summary,
    bottom,
    top,
    combinedRows,
    diameterSummary: buildDiameterSummary(combinedRows),
    parameters: {
      // Snapshot records the Plan's real geometry semantics: Legacy Net or V3 Physical Clear Space.
      coordinateModel: plan.coordinateModel,
      innerWallThicknessMm: plan.innerWallThickness,
      outerWallThicknessMm: plan.outerWallThickness,
      bottomPhysicalDomainCount: bottomCalculation.domains.length,
      topPhysicalDomainCount: topCalculation.domains.length,
      roleDomainCount: bottomCalculation.roleDomains.length,
    },
  };
  validateSnapshotNumbers(content);
  return content;
}

export class FloorPrintBuildError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FloorPrintBuildError";
  }
}

export function createFloorPrintSnapshotId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `floor-print-${stamp}-${suffix}`;
}

export function buildFloorPrintSnapshot(
  input: FloorPrintSnapshotInput,
  precomputedSolution?: FloorTopologySolution,
): FloorPrintSnapshot {
  const topologySolution = input.plan.coordinateModel === "clear-space-physical-v2"
    ? precomputedSolution ?? solveFloorTopology(input.plan)
    : undefined;
  const eligibility = getFloorPrintEligibility(input, topologySolution);
  if (!eligibility.eligible) {
    const first = eligibility.errors[0] ?? {
      code: "floor-print-ineligible",
      message: "当前整层计算不具备正式打印资格。",
    };
    throw new FloorPrintBuildError(first.code, first.message);
  }
  const content = buildFloorPrintContent(input.plan, input.bottom, input.top, topologySolution);
  const snapshot: FloorPrintSnapshot = {
    schemaVersion: FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION,
    id: input.snapshotId ?? createFloorPrintSnapshotId(
      input.createdAt ? new Date(input.createdAt) : new Date(),
    ),
    createdAt: input.createdAt ?? new Date().toISOString(),
    status: "official",
    project: {
      projectName: input.project.projectName.trim(),
      floorName: input.project.floorName.trim(),
      remark: input.project.remark.trim(),
    },
    ...content,
    options: structuredClone(input.options),
    source: {
      calculator: "floor-rebar",
      coordinateModel: input.plan.coordinateModel,
    },
  };
  return structuredClone(snapshot);
}
