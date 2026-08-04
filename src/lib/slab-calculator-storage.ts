import {
  calculateSlabResults,
  normalizeSlabCalculatorState,
  type BarDirection,
  type BarLayer,
  type BarResult,
  type SlabCalculation,
  type SlabCalculatorState,
} from "./slab-calculator";

export const DRAFT_KEY = "rebarviz:slab-calculator:draft:v1";
export const RESULT_KEY = "rebarviz:slab-calculator:result:v1";
export const RESULT_UI_KEY = "rebarviz:slab-calculator:result-ui:v1";
export const RESULT_PRINT_SETTINGS_KEY =
  "rebarviz:slab-calculator:print-settings:v1";
export const RETURN_TO_INPUT_KEY = "rebarviz:slab-calculator:return-to-input:v1";

export const CALCULATOR_SCHEMA_VERSION = 1;
export const CALCULATOR_ALGORITHM_VERSION = "slab-calculator-2026-08-v2";

export type CalculationStatus =
  | "idle"
  | "dirty"
  | "calculating"
  | "valid"
  | "invalid";

export type CalculatorSectionId = "base" | "bottom" | "top" | "through";

export type CalculatorDraftUiState = {
  openSections: Record<CalculatorSectionId, boolean>;
  bottomDirection: BarDirection;
  topDirection: BarDirection;
};

export type CalculatorDraftRecord = {
  schemaVersion: number;
  savedAt: string;
  state: SlabCalculatorState;
  ui: CalculatorDraftUiState;
};

export type StoredCalculationRecord = {
  schemaVersion: number;
  algorithmVersion: string;
  calculatedAt: string;
  inputSnapshot: SlabCalculatorState;
  calculation: SlabCalculation;
};

export type ResultLayerFilter = "all" | BarLayer;
export type ResultDirectionFilter = "all" | BarDirection;
export type ResultThroughFilter = "all" | "normal" | "through";

export type ResultFilters = {
  layer: ResultLayerFilter;
  direction: ResultDirectionFilter;
  through: ResultThroughFilter;
};

export type ResultUiState = {
  page: number;
  pageSize: 2 | 5 | 10;
  filters: ResultFilters;
  selectedScopeId: string;
};

export type ResultGroup = {
  scopeId: string;
  scopeType: "room" | "through";
  roomId?: string;
  title: string;
  results: BarResult[];
  subtotalWeightKg: number;
};

export type SlabPrintRangeMode = "all" | "current-filters" | "custom";

export type SlabPrintDetailMode = "full" | "compact";

export type SlabPrintSections = {
  weightSummary: boolean;
  parameters: boolean;
  roomDimensions: boolean;
  diagram: boolean;
  specificationSummary: boolean;
  resultDetails: boolean;
  calculationNotes: boolean;
};

export type SlabPrintOptions = {
  rangeMode: SlabPrintRangeMode;
  selectedResultIds: string[];
  detailMode: SlabPrintDetailMode;
  sections: SlabPrintSections;
};

export type SlabPrintPreferences = Pick<
  SlabPrintOptions,
  "detailMode" | "sections"
>;

export const DEFAULT_DRAFT_UI_STATE: CalculatorDraftUiState = {
  openSections: {
    base: true,
    bottom: true,
    top: true,
    through: false,
  },
  bottomDirection: "x",
  topDirection: "x",
};

export const DEFAULT_RESULT_UI_STATE: ResultUiState = {
  page: 1,
  pageSize: 5,
  filters: { layer: "all", direction: "all", through: "all" },
  selectedScopeId: "",
};

export const DEFAULT_SLAB_PRINT_SECTIONS: SlabPrintSections = {
  weightSummary: true,
  parameters: true,
  roomDimensions: true,
  diagram: true,
  specificationSummary: true,
  resultDetails: true,
  calculationNotes: true,
};

export const DEFAULT_SLAB_PRINT_OPTIONS: SlabPrintOptions = {
  rangeMode: "all",
  selectedResultIds: [],
  detailMode: "full",
  sections: { ...DEFAULT_SLAB_PRINT_SECTIONS },
};

const RESULT_PRINT_SETTINGS_SCHEMA_VERSION = 1;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function copyPrintSections(sections: SlabPrintSections): SlabPrintSections {
  return { ...sections };
}

function defaultPrintPreferences(): SlabPrintPreferences {
  return {
    detailMode: DEFAULT_SLAB_PRINT_OPTIONS.detailMode,
    sections: copyPrintSections(DEFAULT_SLAB_PRINT_SECTIONS),
  };
}

function isPrintSections(value: unknown): value is SlabPrintSections {
  if (!isObject(value)) return false;
  return (Object.keys(DEFAULT_SLAB_PRINT_SECTIONS) as Array<keyof SlabPrintSections>)
    .every((key) => typeof value[key] === "boolean");
}

export function createDefaultSlabPrintOptions(
  record: StoredCalculationRecord,
  preferences: SlabPrintPreferences = defaultPrintPreferences(),
): SlabPrintOptions {
  return {
    rangeMode: "all",
    selectedResultIds: record.calculation.results.map((result) => result.id),
    detailMode: preferences.detailMode,
    sections: copyPrintSections(preferences.sections),
  };
}

export function parseResultPrintSettings(
  raw: string | null,
): SlabPrintPreferences {
  if (!raw) return defaultPrintPreferences();
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.schemaVersion !== RESULT_PRINT_SETTINGS_SCHEMA_VERSION ||
      (value.detailMode !== "full" && value.detailMode !== "compact") ||
      !isPrintSections(value.sections)
    ) {
      return defaultPrintPreferences();
    }
    return {
      detailMode: value.detailMode,
      sections: copyPrintSections(value.sections),
    };
  } catch {
    return defaultPrintPreferences();
  }
}

export function serializeResultPrintSettings(
  options: SlabPrintOptions,
): string {
  return JSON.stringify({
    schemaVersion: RESULT_PRINT_SETTINGS_SCHEMA_VERSION,
    detailMode: options.detailMode,
    sections: copyPrintSections(options.sections),
  });
}

export function createCalculationRecord(
  inputSnapshot: SlabCalculatorState,
  calculation: SlabCalculation,
  calculatedAt = new Date().toISOString(),
): StoredCalculationRecord {
  const normalizedInputSnapshot = normalizeSlabCalculatorState(inputSnapshot);
  return {
    schemaVersion: CALCULATOR_SCHEMA_VERSION,
    algorithmVersion: CALCULATOR_ALGORITHM_VERSION,
    calculatedAt,
    inputSnapshot: structuredClone(normalizedInputSnapshot),
    calculation: structuredClone(calculation),
  };
}

export function parseDraftRecord(raw: string | null): CalculatorDraftRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.schemaVersion !== CALCULATOR_SCHEMA_VERSION ||
      typeof value.savedAt !== "string" ||
      !isObject(value.state) ||
      !isObject(value.ui)
    ) {
      return null;
    }
    const state = normalizeSlabCalculatorState(value.state as SlabCalculatorState);
    const ui = value.ui as CalculatorDraftUiState;
    if (!isObject(state.slab) || !Array.isArray(state.slab.rooms)) return null;
    return { schemaVersion: CALCULATOR_SCHEMA_VERSION, savedAt: value.savedAt, state, ui };
  } catch {
    return null;
  }
}

export function parseCalculationRecord(
  raw: string | null,
): StoredCalculationRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isObject(value) ||
      value.schemaVersion !== CALCULATOR_SCHEMA_VERSION ||
      value.algorithmVersion !== CALCULATOR_ALGORITHM_VERSION ||
      typeof value.calculatedAt !== "string" ||
      !isObject(value.inputSnapshot) ||
      !isObject(value.calculation)
    ) {
      return null;
    }
    const record = value as unknown as StoredCalculationRecord;
    if (
      record.calculation.isValid !== true ||
      record.calculation.results.length === 0 ||
      record.calculation.totalWeightKg === null ||
      !Number.isFinite(record.calculation.totalWeightKg) ||
      record.calculation.totalWeightKg <= 0
    ) {
      return null;
    }
    const normalizedInputSnapshot = normalizeSlabCalculatorState(
      record.inputSnapshot,
    );
    const recalculated = calculateSlabResults(normalizedInputSnapshot);
    if (
      !recalculated.isValid ||
      recalculated.totalWeightKg === null ||
      recalculated.results.length !== record.calculation.results.length ||
      Math.abs(recalculated.totalWeightKg - record.calculation.totalWeightKg) > 1e-8
    ) {
      return null;
    }
    return { ...record, inputSnapshot: normalizedInputSnapshot };
  } catch {
    return null;
  }
}

export function parseResultUiState(raw: string | null): ResultUiState {
  if (!raw) return structuredClone(DEFAULT_RESULT_UI_STATE);
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || !isObject(value.filters)) {
      return structuredClone(DEFAULT_RESULT_UI_STATE);
    }
    const pageSize = value.pageSize === 2 || value.pageSize === 10 ? value.pageSize : 5;
    const layer = ["all", "bottom", "top"].includes(String(value.filters.layer))
      ? (value.filters.layer as ResultLayerFilter)
      : "all";
    const direction = ["all", "x", "y"].includes(String(value.filters.direction))
      ? (value.filters.direction as ResultDirectionFilter)
      : "all";
    const through = ["all", "normal", "through"].includes(String(value.filters.through))
      ? (value.filters.through as ResultThroughFilter)
      : "all";
    return {
      page: Number.isInteger(value.page) && Number(value.page) > 0 ? Number(value.page) : 1,
      pageSize,
      filters: { layer, direction, through },
      selectedScopeId:
        typeof value.selectedScopeId === "string" ? value.selectedScopeId : "",
    };
  } catch {
    return structuredClone(DEFAULT_RESULT_UI_STATE);
  }
}

function subtotal(results: BarResult[]): number {
  return results.reduce((sum, result) => sum + result.weightKg, 0);
}

export function createResultGroups(
  record: StoredCalculationRecord,
): ResultGroup[] {
  const { calculation, inputSnapshot } = record;
  const groups: ResultGroup[] = [];

  if (calculation.throughWall) {
    const results = calculation.results.filter((result) => result.layer === "top");
    groups.push({
      scopeId: `through:${calculation.throughWall.direction}`,
      scopeType: "through",
      title: `${calculation.throughWall.throughBar.scopeName}通墙组合区`,
      results,
      subtotalWeightKg: subtotal(results),
    });
  }

  inputSnapshot.slab.rooms.forEach((room) => {
    const results = calculation.results.filter(
      (result) => result.roomId === room.id && result.layer === "bottom",
    );
    if (results.length > 0) {
      groups.push({
        scopeId: `${room.id}:bottom`,
        scopeType: "room",
        roomId: room.id,
        title: `${room.name} · 地筋`,
        results,
        subtotalWeightKg: subtotal(results),
      });
    }
  });

  if (!calculation.throughWall) {
    inputSnapshot.slab.rooms.forEach((room) => {
      const results = calculation.results.filter(
        (result) => result.roomId === room.id && result.layer === "top",
      );
      if (results.length > 0) {
        groups.push({
          scopeId: `${room.id}:top`,
          scopeType: "room",
          roomId: room.id,
          title: `${room.name} · 面筋`,
          results,
          subtotalWeightKg: subtotal(results),
        });
      }
    });
  }

  return groups;
}

export function filterResultGroups(
  groups: ResultGroup[],
  filters: ResultFilters,
): ResultGroup[] {
  return groups
    .map((group) => {
      const results = group.results.filter((result) => {
        if (filters.layer !== "all" && result.layer !== filters.layer) return false;
        if (filters.direction !== "all" && result.direction !== filters.direction) return false;
        if (filters.through === "through" && result.scopeType !== "through") return false;
        if (filters.through === "normal" && result.scopeType === "through") return false;
        return true;
      });
      return { ...group, results, subtotalWeightKg: subtotal(results) };
    })
    .filter((group) => group.results.length > 0);
}

export function paginateResultGroups(
  groups: ResultGroup[],
  page: number,
  pageSize: 2 | 5 | 10,
): { page: number; pageCount: number; groups: ResultGroup[] } {
  const pageCount = Math.max(Math.ceil(groups.length / pageSize), 1);
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pageCount,
    groups: groups.slice(start, start + pageSize),
  };
}
