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
    });
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
  });
});
