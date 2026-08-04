import {
  type BarDirection,
  type BarLayer,
  type BarResult,
  type CountMode,
  type RoomArrangement,
} from "./slab-calculator";
import {
  createResultGroups,
  filterResultGroups,
  type ResultFilters,
  type SlabPrintOptions,
  type SlabPrintRangeMode,
  type SlabPrintSections,
  type StoredCalculationRecord,
} from "./slab-calculator-storage";

export type SlabPrintRow = {
  sequence: number;
  resultId: string;
  scopeId: string;
  scopeName: string;
  scopeType: "room" | "through";
  roomId?: string;
  layer: BarLayer;
  direction: BarDirection;
  throughWall: boolean;
  typeDirectionText: string;
  extraModeText: string;
  diameter: number;
  spacing: number;
  count: number;
  singleLengthM: number;
  totalLengthM: number;
  startAnchorText: string;
  endAnchorText: string;
  weightKg: number;
};

export type SlabPrintGroup = {
  scopeId: string;
  scopeName: string;
  scopeType: "room" | "through";
  roomId?: string;
  rows: SlabPrintRow[];
  subtotalWeightKg: number;
};

export type SlabSpecificationSummary = {
  key: string;
  layer: BarLayer;
  direction: BarDirection;
  diameter: number;
  spacing: number;
  totalCount: number;
  totalLengthM: number;
  totalWeightKg: number;
};

export type SlabPrintReportModel = {
  groups: SlabPrintGroup[];
  rows: SlabPrintRow[];
  specifications: SlabSpecificationSummary[];
  fullRowCount: number;
  selectedRowCount: number;
  isFullSelection: boolean;
  fullTotalWeightKg: number;
  selectedTotalWeightKg: number;
  selectedBottomWeightKg: number;
  selectedTopWeightKg: number;
};

function anchorSourceLabel(result: BarResult, endpoint: "start" | "end") {
  const source = endpoint === "start" ? result.startAnchorSource : result.endAnchorSource;
  if (source === "inner-wall") return "内墙";
  if (source === "outer-wall") return "外墙";
  return "手动";
}

export function formatAnchorLabel(
  result: BarResult,
  endpoint: "start" | "end",
): string {
  const source = endpoint === "start" ? result.startAnchorSource : result.endAnchorSource;
  const value = endpoint === "start" ? result.startAnchor : result.endAnchor;
  const label = anchorSourceLabel(result, endpoint);
  if (result.layer === "bottom" || source === "manual") {
    return `${label}${value.toFixed(0)}mm${source === "manual" ? "（最终值）" : ""}`;
  }
  const applied = endpoint === "start" ? result.startExtraApplied : result.endExtraApplied;
  return `${label}${value.toFixed(0)}mm（${applied ? `已增加${result.topExtraValue.toFixed(0)}mm` : "未增加"}）`;
}

export function formatExtraModeLabel(result: BarResult): string {
  if (result.layer === "bottom" || !result.topExtraMode) return "不适用";
  if (result.topExtraMode === "both") return "两端增加";
  const start = result.direction === "x" ? "西端" : "南端";
  const end = result.direction === "x" ? "东端" : "北端";
  const prefix = result.throughWall ? "最" : "";
  return `${prefix}${result.topExtraMode === "start" ? start : end}增加`;
}

export function formatCountFormula(
  calculationWidth: number,
  spacing: number,
  countMode: CountMode,
): string {
  if (countMode === "round") {
    return `max(1, round(${calculationWidth} / ${spacing}))`;
  }
  if (countMode === "floor") {
    return `max(1, floor(${calculationWidth} / ${spacing}))`;
  }
  return `ceil(${calculationWidth} / ${spacing})`;
}

export function countModeFormulaText(countMode: CountMode): string {
  if (countMode === "round") {
    return "max(1, round(计算宽度 / 间距))";
  }
  if (countMode === "floor") {
    return "max(1, floor(计算宽度 / 间距))";
  }
  return "ceil(计算宽度 / 间距)";
}

export function arrangementLabel(arrangement: RoomArrangement): string {
  if (arrangement === "x") return "沿X向（西→东）排列";
  if (arrangement === "y") return "沿Y向（南→北）排列";
  return "单房间";
}

export function barTypeDirectionLabel(result: BarResult): string {
  const layer = result.layer === "bottom" ? "地筋" : "面筋";
  const direction = `${result.direction.toUpperCase()}向`;
  if (result.throughWall) return `${layer}·${direction}通墙`;
  if (result.scopeType === "through") return `${layer}·${direction}组合区`;
  return `${layer}·${direction}`;
}

export function isPrintableCalculationRecord(
  record: StoredCalculationRecord,
): boolean {
  const total = record.calculation.totalWeightKg;
  return (
    record.calculation.isValid === true &&
    record.calculation.results.length > 0 &&
    total !== null &&
    Number.isFinite(total) &&
    total > 0
  );
}

export function allPrintResultIds(
  record: StoredCalculationRecord,
): string[] {
  return record.calculation.results.map((result) => result.id);
}

export function filteredPrintResultIds(
  record: StoredCalculationRecord,
  filters: ResultFilters,
): string[] {
  return filterResultGroups(createResultGroups(record), filters).flatMap(
    (group) => group.results.map((result) => result.id),
  );
}

export function normalizePrintResultIds(
  record: StoredCalculationRecord,
  selectedResultIds: readonly string[],
): string[] {
  const requestedIds = new Set(selectedResultIds);
  return record.calculation.results
    .filter((result) => requestedIds.has(result.id))
    .map((result) => result.id);
}

export function hasSelectedPrintSection(
  sections: SlabPrintSections,
): boolean {
  return Object.values(sections).some(Boolean);
}

export function printRangeLabel(rangeMode: SlabPrintRangeMode): string {
  if (rangeMode === "current-filters") return "结果页当前筛选";
  if (rangeMode === "custom") return "自定义选择";
  return "全部正式结果";
}

export function canPrintSlabReport(
  model: SlabPrintReportModel,
  options: SlabPrintOptions,
): boolean {
  return model.selectedRowCount > 0 && hasSelectedPrintSection(options.sections);
}

export function buildSlabPrintReport(
  record: StoredCalculationRecord,
  options: SlabPrintOptions,
): SlabPrintReportModel {
  const fullTotalWeightKg = record.calculation.totalWeightKg;
  if (!isPrintableCalculationRecord(record) || fullTotalWeightKg === null) {
    throw new Error("正式计算记录无效，无法生成打印报表");
  }

  const validResultIds = new Set(
    record.calculation.results.map((result) => result.id),
  );
  const selectedIds = new Set(
    options.selectedResultIds.filter((id) => validResultIds.has(id)),
  );
  const selectedGroups = createResultGroups(record)
    .map((group) => {
      const results = group.results.filter((result) => selectedIds.has(result.id));
      return {
        ...group,
        results,
        subtotalWeightKg: results.reduce(
          (sum, result) => sum + result.weightKg,
          0,
        ),
      };
    })
    .filter((group) => group.results.length > 0);

  let sequence = 0;
  const groups = selectedGroups.map((group): SlabPrintGroup => ({
    scopeId: group.scopeId,
    scopeName: group.title,
    scopeType: group.scopeType,
    roomId: group.roomId,
    subtotalWeightKg: group.subtotalWeightKg,
    rows: group.results.map((result): SlabPrintRow => ({
      sequence: ++sequence,
      resultId: result.id,
      scopeId: group.scopeId,
      scopeName: result.scopeName,
      scopeType: group.scopeType,
      roomId: group.roomId,
      layer: result.layer,
      direction: result.direction,
      throughWall: result.throughWall,
      typeDirectionText: barTypeDirectionLabel(result),
      extraModeText: formatExtraModeLabel(result),
      diameter: result.diameter,
      spacing: result.spacing,
      count: result.count,
      singleLengthM: result.singleLengthM,
      totalLengthM: result.totalLengthM,
      startAnchorText: formatAnchorLabel(result, "start"),
      endAnchorText: formatAnchorLabel(result, "end"),
      weightKg: result.weightKg,
    })),
  }));
  const rows = groups.flatMap((group) => group.rows);

  const summaryMap = new Map<string, SlabSpecificationSummary>();
  rows.forEach((row) => {
    const key = `${row.layer}:${row.direction}:${row.diameter}:${row.spacing}`;
    const existing = summaryMap.get(key);
    if (existing) {
      existing.totalCount += row.count;
      existing.totalLengthM += row.totalLengthM;
      existing.totalWeightKg += row.weightKg;
      return;
    }
    summaryMap.set(key, {
      key,
      layer: row.layer,
      direction: row.direction,
      diameter: row.diameter,
      spacing: row.spacing,
      totalCount: row.count,
      totalLengthM: row.totalLengthM,
      totalWeightKg: row.weightKg,
    });
  });

  const specifications = [...summaryMap.values()].sort(
    (a, b) =>
      (a.layer === b.layer ? 0 : a.layer === "bottom" ? -1 : 1) ||
      a.direction.localeCompare(b.direction) ||
      a.diameter - b.diameter ||
      a.spacing - b.spacing,
  );
  const selectedBottomWeightKg = rows
    .filter((row) => row.layer === "bottom")
    .reduce((sum, row) => sum + row.weightKg, 0);
  const selectedTopWeightKg = rows
    .filter((row) => row.layer === "top")
    .reduce((sum, row) => sum + row.weightKg, 0);
  const selectedTotalWeightKg = rows
    .reduce((sum, result) => sum + result.weightKg, 0);
  const fullRowCount = record.calculation.results.length;
  const selectedRowCount = rows.length;
  const isFullSelection =
    selectedIds.size === validResultIds.size &&
    [...validResultIds].every((id) => selectedIds.has(id));

  return {
    groups,
    rows,
    specifications,
    fullRowCount,
    selectedRowCount,
    isFullSelection,
    fullTotalWeightKg,
    selectedTotalWeightKg,
    selectedBottomWeightKg,
    selectedTopWeightKg,
  };
}
