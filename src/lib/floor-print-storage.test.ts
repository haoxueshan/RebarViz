import { describe, expect, it } from "vitest";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "./floor-bottom-calculator";
import type { FloorPlanState } from "./floor-plan";
import {
  buildFloorPrintSnapshot,
  DEFAULT_FLOOR_PRINT_OPTIONS,
  type FloorPrintOptions,
} from "./floor-print";
import {
  createFloorPrintSettingsRecord,
  FLOOR_PRINT_LAST_ID_KEY,
  FLOOR_PRINT_SETTINGS_KEY,
  loadFloorPrintSettings,
  loadFloorPrintSnapshot,
  parseFloorPrintSettingsRecord,
  parseFloorPrintSnapshot,
  saveFloorPrintSettings,
  saveFloorPrintSnapshot,
} from "./floor-print-storage";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
} from "./floor-top-calculator";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function fixture() {
  const plan: FloorPlanState = {
    coordinateModel: "net-layout-v1",
    slabs: [{ id: "a", name: "客厅", type: "hall", x: 0, y: 0, width: 4200, height: 3600 }],
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
  const bottom = calculateFloorBottomRebar(plan, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE));
  const top = calculateFloorTopRebar(plan, structuredClone(DEFAULT_FLOOR_TOP_STATE));
  return buildFloorPrintSnapshot({
    plan,
    bottom,
    top,
    bottomRoleReviewRequired: false,
    topRoleReviewRequired: false,
    invalidDraftCount: 0,
    project: { projectName: "测试项目", floorName: "二层", remark: "" },
    options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
    snapshotId: "floor-print-storage-test",
    createdAt: "2026-08-10T12:00:00.000Z",
  });
}

describe("Floor Print Snapshot Storage", () => {
  it("按ID保存和恢复完整结果快照，刷新不依赖当前计算草稿", () => {
    const storage = new MemoryStorage();
    const snapshot = fixture();
    saveFloorPrintSnapshot(storage, snapshot);
    expect(storage.getItem(FLOOR_PRINT_LAST_ID_KEY)).toBe(snapshot.id);
    expect(loadFloorPrintSnapshot(storage, snapshot.id)).toEqual(snapshot);
  });

  it("损坏或错误schema快照返回null且不做计算fallback", () => {
    const snapshot = fixture();
    expect(parseFloorPrintSnapshot({ ...snapshot, schemaVersion: 99 })).toBeNull();
    expect(parseFloorPrintSnapshot({ ...snapshot, bottom: { ...snapshot.bottom, rows: null } })).toBeNull();
    expect(parseFloorPrintSnapshot({ ...snapshot, summary: { ...snapshot.summary, totalWeightKg: Number.NaN } })).toBeNull();
  });

  it("Schema 1快照迁移为Schema 2并把旧Top/Bottom统一标记为normal", () => {
    const current = fixture();
    const legacy = structuredClone(current) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 1;
    const bottom = legacy.bottom as { rows: Array<Record<string, unknown>>; pieces: Array<Record<string, unknown>> };
    const top = legacy.top as { rows: Array<Record<string, unknown>>; pieces: Array<Record<string, unknown>> };
    [...bottom.rows, ...top.rows].forEach((row) => { delete row.source; });
    [...bottom.pieces, ...top.pieces].forEach((piece) => { delete piece.source; });
    (legacy.combinedRows as Array<Record<string, unknown>>).forEach((row) => { delete row.source; });
    const summary = legacy.summary as Record<string, unknown>;
    delete summary.topNormalPieceCount;
    delete summary.topThroughPieceCount;

    const migrated = parseFloorPrintSnapshot(legacy);
    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.bottom.rows.every((row) => row.source === "normal")).toBe(true);
    expect(migrated?.top.pieces.every((piece) => piece.source === "normal")).toBe(true);
    expect(migrated?.summary).toMatchObject({
      topNormalPieceCount: current.summary.topPieceCount,
      topThroughPieceCount: 0,
    });
  });
});

describe("Floor Print Settings Storage", () => {
  it("只持久化打印偏好并校验schema", () => {
    const storage = new MemoryStorage();
    const options: FloorPrintOptions = {
      ...structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
      preset: "custom",
      paperSize: "A4",
      orientation: "portrait",
      sections: { ...DEFAULT_FLOOR_PRINT_OPTIONS.sections, floorPlan: true },
    };
    saveFloorPrintSettings(storage, options);
    expect(storage.getItem(FLOOR_PRINT_SETTINGS_KEY)).not.toBeNull();
    expect(loadFloorPrintSettings(storage)?.options).toEqual(options);
    expect(parseFloorPrintSettingsRecord(createFloorPrintSettingsRecord(options))).not.toBeNull();
    expect(parseFloorPrintSettingsRecord({ schemaVersion: 1, savedAt: "x", options: {} })).toBeNull();
  });
});
