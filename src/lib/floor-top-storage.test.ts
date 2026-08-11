import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopState,
} from "./floor-top-calculator";
import {
  createFloorTopStoredRecord,
  parseFloorTopStoredRecord,
} from "./floor-top-storage";

describe("Floor Top设置存储", () => {
  it("保存并恢复算法、增加值、规格、增加位置及有效板区覆盖", () => {
    const state: FloorTopState = {
      countMode: "round",
      topAnchorExtra: 320,
      defaults: {
        mainDiameter: 12,
        secondaryDiameter: 10,
        xSpacing: 180,
        ySpacing: 160,
        xExtraMode: "end",
        yExtraMode: "start",
      },
      slabOverrides: {
        a: { mainDiameter: 10, xSpacing: 120, xExtraMode: "both" },
        stale: { secondaryDiameter: 8, ySpacing: 100, yExtraMode: "end" },
      },
      throughPaths: [{
        id: "path-a-b",
        name: "通墙01",
        direction: "x",
        slabIds: ["a"],
        bandStartMm: 100,
        bandEndMm: 1000,
        enabled: true,
      }],
    };
    const restored = parseFloorTopStoredRecord(
      createFloorTopStoredRecord(state, "2026-08-08T00:00:00.000Z"),
      new Set(["a"]),
    );
    expect(restored?.state).toMatchObject({
      countMode: "round",
      topAnchorExtra: 320,
      defaults: state.defaults,
    });
    expect(restored?.state.slabOverrides).toEqual({ a: state.slabOverrides.a });
    expect(restored?.state.throughPaths).toEqual(state.throughPaths);
    expect(restored).toMatchObject({ schemaVersion: 4, roleReviewRequired: false });
  });

  it("V1方向规格按数值迁移为主副筋规格并保留增加端", () => {
    const restored = parseFloorTopStoredRecord({
      schemaVersion: 1,
      state: {
        countMode: "floor",
        topAnchorExtra: 300,
        defaults: {
          x: { diameter: 12, spacing: 180, extraMode: "end" },
          y: { diameter: 10, spacing: 160, extraMode: "start" },
        },
        slabOverrides: {
          a: { y: { diameter: 8, spacing: 100, extraMode: "both" } },
        },
      },
    }, new Set(["a"]));
    expect(restored?.state).toEqual({
      countMode: "floor",
      topAnchorExtra: 300,
      defaults: {
        mainDiameter: 12,
        secondaryDiameter: 10,
        xSpacing: 180,
        ySpacing: 160,
        xExtraMode: "end",
        yExtraMode: "start",
      },
      slabOverrides: { a: { secondaryDiameter: 8, ySpacing: 100, yExtraMode: "both" } },
      throughPaths: [],
    });
    expect(restored?.roleReviewRequired).toBe(true);
  });

  it("V1/V2必须复核，V3迁移到V4时保留确认状态并补空Through", () => {
    const legacy = parseFloorTopStoredRecord({
      schemaVersion: 2,
      state: DEFAULT_FLOOR_TOP_STATE,
      roleReviewRequired: false,
    });
    expect(legacy?.roleReviewRequired).toBe(true);

    const confirmed = parseFloorTopStoredRecord({
      schemaVersion: 3,
      savedAt: "2026-08-08T00:00:00.000Z",
      state: { ...DEFAULT_FLOOR_TOP_STATE, throughPaths: undefined },
      roleReviewRequired: false,
    });
    expect(confirmed).toMatchObject({ schemaVersion: 4, roleReviewRequired: false });
    expect(confirmed?.state.throughPaths).toEqual([]);

    const stillRequired = parseFloorTopStoredRecord({
      schemaVersion: 3,
      state: DEFAULT_FLOOR_TOP_STATE,
      roleReviewRequired: true,
    });
    expect(stillRequired?.roleReviewRequired).toBe(true);
  });

  it("V4恢复Through并删除引用已不存在板区的整条Path", () => {
    const restored = parseFloorTopStoredRecord({
      schemaVersion: 4,
      savedAt: "2026-08-10T00:00:00.000Z",
      roleReviewRequired: false,
      state: {
        ...DEFAULT_FLOOR_TOP_STATE,
        throughPaths: [
          { id: "valid", name: "通墙01", direction: "x", slabIds: ["a", "b"], bandStartMm: 0, bandEndMm: 3000, enabled: true },
          { id: "stale", name: "通墙02", direction: "y", slabIds: ["a", "missing"], bandStartMm: 0, bandEndMm: 2000, enabled: true },
        ],
      },
    }, new Set(["a", "b"]));
    expect(restored?.state.throughPaths.map((item) => item.id)).toEqual(["valid"]);
    expect(restored?.roleReviewRequired).toBe(false);
  });

  it("损坏版本被拒绝，损坏字段和extraMode恢复安全默认", () => {
    expect(parseFloorTopStoredRecord({ schemaVersion: 99, state: {} })).toBeNull();
    const restored = parseFloorTopStoredRecord({
      schemaVersion: 1,
      state: {
        countMode: "bad",
        topAnchorExtra: "bad",
        defaults: {
          x: { extraMode: "bad" },
          y: { extraMode: "bad" },
        },
        slabOverrides: {},
      },
    });
    expect(restored?.state).toEqual(DEFAULT_FLOOR_TOP_STATE);
    expect(restored?.roleReviewRequired).toBe(true);
  });
});
