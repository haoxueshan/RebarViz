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

function isFloorPrintCoordinateModel(value: unknown): value is FloorPrintSnapshot["source"]["coordinateModel"] {
  return value === "net-layout-v1" || value === "clear-space-physical-v2";
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
    ["bottom", "top"].includes(String(value.layer)) && ["normal", "through"].includes(String(value.source)) &&
    (value.throughPathId === undefined || typeof value.throughPathId === "string") &&
    (value.throughPathName === undefined || typeof value.throughPathName === "string") &&
    (value.source !== "through" || typeof value.throughPathId === "string") &&
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
    ["bottom", "top"].includes(String(value.layer)) && ["normal", "through"].includes(String(value.source)) &&
    (value.throughPathId === undefined || typeof value.throughPathId === "string") &&
    (value.source !== "through" || typeof value.throughPathId === "string") &&
    ["main", "secondary"].includes(String(value.role)) &&
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

function validPhysicalBounds(value: unknown): boolean {
  return isObject(value) && [value.minX, value.minY, value.maxX, value.maxY]
    .every((item) => typeof item === "number" && Number.isFinite(item));
}

function validPhysicalLayout(value: unknown): boolean {
  if (!isObject(value) || !validPhysicalBounds(value.bounds) || !validPhysicalBounds(value.floorBounds) ||
    !Array.isArray(value.slabs) || !Array.isArray(value.openings) ||
    !Array.isArray(value.walls) || !Array.isArray(value.issues)) return false;
  const finite = (item: unknown) => typeof item === "number" && Number.isFinite(item);
  const validSlab = (item: unknown) => isObject(item) && typeof item.slabId === "string" &&
    [item.netX, item.netY, item.x, item.y, item.width, item.height, item.offsetX, item.offsetY].every(finite) &&
    Number(item.width) > 0 && Number(item.height) > 0;
  const validOpening = (item: unknown) => isObject(item) && typeof item.openingId === "string" &&
    [item.netX, item.netY, item.x, item.y, item.width, item.height, item.offsetX, item.offsetY].every(finite) &&
    Number(item.width) > 0 && Number(item.height) > 0;
  const validWall = (item: unknown) => isObject(item) && typeof item.id === "string" &&
    ["inner-wall", "outer-wall"].includes(String(item.kind)) &&
    ["horizontal", "vertical"].includes(String(item.orientation)) &&
    [item.x, item.y, item.width, item.height, item.lengthMm, item.thicknessMm].every(finite) &&
    [item.width, item.height, item.lengthMm, item.thicknessMm].every((number) => Number(number) >= 0) &&
    Array.isArray(item.slabIds) && item.slabIds.every((id) => typeof id === "string") &&
    Array.isArray(item.sourceAtomicIds) && item.sourceAtomicIds.every((id) => typeof id === "string") &&
    (item.side === undefined || ["west", "east", "south", "north"].includes(String(item.side)));
  const validIssue = (item: unknown) => isObject(item) &&
    ["warning", "error"].includes(String(item.level)) &&
    typeof item.code === "string" && typeof item.message === "string";
  return value.slabs.every(validSlab) && value.openings.every(validOpening) &&
    value.walls.every(validWall) && value.issues.every(validIssue);
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
  return value.slabs.every(validRect) && value.openings.every(validRect) && value.boundaries.every(validBoundary) &&
    (value.physical === undefined || value.physical === null || validPhysicalLayout(value.physical));
}

export function parseFloorPrintSnapshot(value: unknown): FloorPrintSnapshot | null {
  if (!isObject(value) || ![1, FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION].includes(Number(value.schemaVersion))) return null;
  const migrated = value.schemaVersion === 1 ? migrateFloorPrintSnapshotV1(value) : structuredClone(value);
  if (!isObject(migrated) || migrated.schemaVersion !== FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION) return null;
  value = migrated;
  if (!isObject(value)) return null;
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
    value.summary.topNormalPieceCount,
    value.summary.topThroughPieceCount,
    value.summary.bottomLengthM,
    value.summary.topLengthM,
    value.summary.bottomWeightKg,
    value.summary.topWeightKg,
    value.summary.totalPieceCount,
    value.summary.totalLengthM,
    value.summary.totalWeightKg,
  ].every(isFiniteNonNegative)) return null;
  if (!isObject(value.parameters) || !isFloorPrintCoordinateModel(value.parameters.coordinateModel) || ![
    value.parameters.innerWallThicknessMm,
    value.parameters.outerWallThicknessMm,
    value.parameters.bottomPhysicalDomainCount,
    value.parameters.topPhysicalDomainCount,
    value.parameters.roleDomainCount,
  ].every(isFiniteNonNegative)) return null;
  if (!isFloorPrintOptions(value.options)) return null;
  if (!isObject(value.source) || value.source.calculator !== "floor-rebar" ||
    !isFloorPrintCoordinateModel(value.source.coordinateModel) ||
    value.source.coordinateModel !== value.parameters.coordinateModel) return null;
  if (value.source.coordinateModel === "clear-space-physical-v2") {
    if (!isObject(value.geometry) || !validPhysicalLayout(value.geometry.physical)) return null;
    const physical = value.geometry.physical as Record<string, unknown>;
    if ((physical.issues as unknown[]).some((issue) => isObject(issue) && issue.level === "error")) return null;
  }
  return structuredClone(value as FloorPrintSnapshot);
}

function migrateFloorPrintSnapshotV1(value: Record<string, unknown>): Record<string, unknown> {
  const migrated = structuredClone(value);
  migrated.schemaVersion = FLOOR_PRINT_SNAPSHOT_SCHEMA_VERSION;
  (["bottom", "top"] as const).forEach((layerName) => {
    const layer = migrated[layerName];
    if (!isObject(layer)) return;
    if (Array.isArray(layer.rows)) {
      layer.rows = layer.rows.map((row) => isObject(row) ? { ...row, source: "normal" } : row);
    }
    if (Array.isArray(layer.pieces)) {
      layer.pieces = layer.pieces.map((piece) => isObject(piece) ? { ...piece, source: "normal" } : piece);
    }
  });
  if (Array.isArray(migrated.combinedRows)) {
    migrated.combinedRows = migrated.combinedRows.map((row) =>
      isObject(row) ? { ...row, source: "normal" } : row);
  }
  if (isObject(migrated.summary)) {
    migrated.summary = {
      ...migrated.summary,
      topNormalPieceCount: migrated.summary.topPieceCount,
      topThroughPieceCount: 0,
    };
  }
  return migrated;
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

/**
 * 只清理旧版打印快照（前缀 rebarviz:floor-print:snapshot: 与 last-id）。
 * 禁止触碰 Floor 工程数据（rebarviz:floor-rebar:*）与其他业务存储。
 */
export function clearLegacyFloorPrintSnapshots(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && (key.startsWith(FLOOR_PRINT_SNAPSHOT_KEY_PREFIX) || key === FLOOR_PRINT_LAST_ID_KEY)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
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
