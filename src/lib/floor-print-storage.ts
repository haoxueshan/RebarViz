import {
  FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION,
  type FloorPrintOptions,
  type FloorPrintSnapshot,
} from "./floor-print";

export const FLOOR_PRINT_SNAPSHOT_KEY_PREFIX = "rebarviz:floor-print:snapshot:";
export const FLOOR_PRINT_LAST_ID_KEY = "rebarviz:floor-print:last-id";
export const FLOOR_PRINT_SETTINGS_KEY = "rebarviz:floor-print:settings:v1";
export const FLOOR_PRINT_SETTINGS_SCHEMA_VERSION = 1 as const;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type FloorPrintSettingsRecord = {
  schemaVersion: typeof FLOOR_PRINT_SETTINGS_SCHEMA_VERSION;
  savedAt: string;
  options: FloorPrintOptions;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasBooleanKeys(value: unknown, keys: readonly string[]): boolean {
  return isObject(value) && keys.every((key) => typeof value[key] === "boolean");
}

export function isFloorPrintOptions(value: unknown): value is FloorPrintOptions {
  if (!isObject(value)) return false;
  if (!["site", "full", "custom"].includes(String(value.preset))) return false;
  if (!["A3", "A4"].includes(String(value.paperSize))) return false;
  if (!["landscape", "portrait"].includes(String(value.orientation))) return false;
  if (!["mm", "m"].includes(String(value.lengthUnit))) return false;
  return hasBooleanKeys(value.sections, [
    "summary",
    "floorPlan",
    "bottomPlan",
    "bottomBom",
    "topPlan",
    "topBom",
    "combinedBom",
    "diameterSummary",
    "calculationParameters",
  ]) && hasBooleanKeys(value.display, [
    "slabNames",
    "openingNames",
    "barMarks",
    "barSpecification",
    "weights",
    "anchorDetails",
  ]);
}

function validBomRow(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.id === "string" && typeof value.mark === "string" &&
    ["bottom", "top"].includes(String(value.layer)) && value.source === "normal" &&
    ["main", "secondary"].includes(String(value.role)) && ["x", "y"].includes(String(value.direction)) &&
    isFiniteNonNegative(value.diameter) && isFiniteNonNegative(value.spacing) &&
    isFiniteNonNegative(value.singleLengthMm) && Number.isSafeInteger(value.count) && Number(value.count) > 0 &&
    isFiniteNonNegative(value.totalLengthM) && isFiniteNonNegative(value.unitWeightKgM) && isFiniteNonNegative(value.weightKg) &&
    Array.isArray(value.slabIds) && value.slabIds.every((item) => typeof item === "string") &&
    Array.isArray(value.slabNames) && value.slabNames.every((item) => typeof item === "string") &&
    Array.isArray(value.pieceIds) && value.pieceIds.every((item) => typeof item === "string");
}

function validPrintPiece(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.id === "string" && typeof value.mark === "string" &&
    ["bottom", "top"].includes(String(value.layer)) && ["main", "secondary"].includes(String(value.role)) &&
    ["x", "y"].includes(String(value.direction)) &&
    ["outer-wall", "inner-wall", "continuous", "opening-cut"].includes(String(value.startSupport)) &&
    ["outer-wall", "inner-wall", "continuous", "opening-cut"].includes(String(value.endSupport)) &&
    [value.diameter, value.spacing, value.positionMm, value.runStartMm, value.runEndMm, value.singleLengthMm]
      .every((item) => typeof item === "number" && Number.isFinite(item)) &&
    Number(value.diameter) > 0 && Number(value.spacing) > 0 && Number(value.singleLengthMm) >= 0 &&
    Array.isArray(value.slabIds) && value.slabIds.every((item) => typeof item === "string");
}

function validLayer(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.rows) && value.rows.every(validBomRow) &&
    Array.isArray(value.pieces) && value.pieces.every(validPrintPiece) &&
    Number.isSafeInteger(value.totalPieceCount) && Number(value.totalPieceCount) >= 0 &&
    isFiniteNonNegative(value.totalLengthM) && isFiniteNonNegative(value.totalWeightKg);
}

function validGeometry(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.bounds)) return false;
  const bounds = value.bounds;
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  if (!Array.isArray(value.slabs) || !Array.isArray(value.openings) || !Array.isArray(value.boundaries)) return false;
  const validRect = (item: unknown) => isObject(item) && typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.type === "string" && [item.x, item.y, item.width, item.height].every((number) => typeof number === "number" && Number.isFinite(number)) &&
    Number(item.width) > 0 && Number(item.height) > 0;
  const validBoundary = (item: unknown) => isObject(item) &&
    ["horizontal", "vertical"].includes(String(item.orientation)) &&
    ["outer-wall", "inner-wall", "continuous", "opening-cut"].includes(String(item.support)) &&
    [item.startX, item.startY, item.endX, item.endY].every((number) => typeof number === "number" && Number.isFinite(number));
  return value.slabs.every(validRect) && value.openings.every(validRect) && value.boundaries.every(validBoundary);
}

export function parseFloorPrintSnapshot(value: unknown): FloorPrintSnapshot | null {
  if (!isObject(value) || value.schemaVersion !== FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION) return null;
  if (typeof value.id !== "string" || !value.id || typeof value.createdAt !== "string") return null;
  if (!["draft", "official"].includes(String(value.status))) return null;
  if (!isObject(value.project) || ![value.project.projectName, value.project.floorName, value.project.remark].every((item) => typeof item === "string")) return null;
  if (!validGeometry(value.geometry) || !validLayer(value.bottom) || !validLayer(value.top)) return null;
  if (!Array.isArray(value.combinedRows) || !value.combinedRows.every(validBomRow)) return null;
  if (!Array.isArray(value.diameterSummary) || !value.diameterSummary.every((item) => isObject(item) &&
    isFiniteNonNegative(item.diameter) && isFiniteNonNegative(item.totalLengthM) &&
    isFiniteNonNegative(item.weightKg) && Number.isSafeInteger(item.pieceCount) && Number(item.pieceCount) >= 0)) return null;
  if (!isObject(value.summary) || ![
    value.summary.slabCount,
    value.summary.openingCount,
    value.summary.bottomPieceCount,
    value.summary.topPieceCount,
    value.summary.bottomLengthM,
    value.summary.topLengthM,
    value.summary.bottomWeightKg,
    value.summary.topWeightKg,
    value.summary.totalPieceCount,
    value.summary.totalLengthM,
    value.summary.totalWeightKg,
  ].every(isFiniteNonNegative)) return null;
  if (!isObject(value.parameters) || value.parameters.coordinateModel !== "net-layout-v1" || ![
    value.parameters.innerWallThicknessMm,
    value.parameters.outerWallThicknessMm,
    value.parameters.bottomPhysicalDomainCount,
    value.parameters.topPhysicalDomainCount,
    value.parameters.roleDomainCount,
  ].every(isFiniteNonNegative)) return null;
  if (!isFloorPrintOptions(value.options)) return null;
  if (!isObject(value.source) || value.source.calculator !== "floor-rebar" || value.source.coordinateModel !== "net-layout-v1") return null;
  return structuredClone(value as FloorPrintSnapshot);
}

export function floorPrintSnapshotStorageKey(id: string): string {
  return `${FLOOR_PRINT_SNAPSHOT_KEY_PREFIX}${id}`;
}

export function saveFloorPrintSnapshot(storage: WritableStorage, snapshot: FloorPrintSnapshot): void {
  storage.setItem(floorPrintSnapshotStorageKey(snapshot.id), JSON.stringify(snapshot));
  storage.setItem(FLOOR_PRINT_LAST_ID_KEY, snapshot.id);
}

export function loadFloorPrintSnapshot(storage: ReadableStorage, id: string): FloorPrintSnapshot | null {
  if (!id) return null;
  const raw = storage.getItem(floorPrintSnapshotStorageKey(id));
  if (!raw) return null;
  try {
    return parseFloorPrintSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function removeFloorPrintSnapshot(storage: WritableStorage, id: string): void {
  storage.removeItem(floorPrintSnapshotStorageKey(id));
  if (storage.getItem(FLOOR_PRINT_LAST_ID_KEY) === id) storage.removeItem(FLOOR_PRINT_LAST_ID_KEY);
}

export function createFloorPrintSettingsRecord(
  options: FloorPrintOptions,
  savedAt = new Date().toISOString(),
): FloorPrintSettingsRecord {
  return {
    schemaVersion: FLOOR_PRINT_SETTINGS_SCHEMA_VERSION,
    savedAt,
    options: structuredClone(options),
  };
}

export function parseFloorPrintSettingsRecord(value: unknown): FloorPrintSettingsRecord | null {
  if (!isObject(value) || value.schemaVersion !== FLOOR_PRINT_SETTINGS_SCHEMA_VERSION ||
    typeof value.savedAt !== "string" || !isFloorPrintOptions(value.options)) return null;
  return structuredClone(value as FloorPrintSettingsRecord);
}

export function loadFloorPrintSettings(storage: ReadableStorage): FloorPrintSettingsRecord | null {
  const raw = storage.getItem(FLOOR_PRINT_SETTINGS_KEY);
  if (!raw) return null;
  try {
    return parseFloorPrintSettingsRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveFloorPrintSettings(storage: WritableStorage, options: FloorPrintOptions): void {
  storage.setItem(FLOOR_PRINT_SETTINGS_KEY, JSON.stringify(createFloorPrintSettingsRecord(options)));
}
