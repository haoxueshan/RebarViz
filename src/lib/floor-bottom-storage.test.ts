import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLOOR_BOTTOM_STATE,
  type FloorBottomState,
} from "./floor-bottom-calculator";
import {
  createFloorBottomStoredRecord,
  parseFloorBottomStoredRecord,
} from "./floor-bottom-storage";

describe("Floor Bottom设置存储", () => {
  it("保存和恢复三种算法、默认规格与有效板区覆盖", () => {
    const state: FloorBottomState = {
      countMode: "round",
      defaults: {
        mainDiameter: 14,
        secondaryDiameter: 12,
        xSpacing: 180,
        ySpacing: 160,
      },
      slabOverrides: {
        a: { mainDiameter: 10, xSpacing: 120 },
        stale: { secondaryDiameter: 8, ySpacing: 100 },
      },
    };
    const restored = parseFloorBottomStoredRecord(
      createFloorBottomStoredRecord(state, "2026-08-08T00:00:00.000Z"),
      new Set(["a"]),
    );
    expect(restored?.state).toMatchObject({ countMode: "round", defaults: state.defaults });
    expect(restored?.state.slabOverrides).toEqual({ a: state.slabOverrides.a });
    expect(restored).toMatchObject({ schemaVersion: 3, roleReviewRequired: false });
  });

  it("V1方向规格按数值迁移为主副筋规格", () => {
    const restored = parseFloorBottomStoredRecord({
      schemaVersion: 1,
      state: {
        countMode: "floor",
        defaults: {
          x: { diameter: 14, spacing: 180 },
          y: { diameter: 12, spacing: 160 },
        },
        slabOverrides: {
          a: { x: { diameter: 10, spacing: 120 } },
        },
      },
    }, new Set(["a"]));
    expect(restored?.state).toEqual({
      countMode: "floor",
      defaults: { mainDiameter: 14, secondaryDiameter: 12, xSpacing: 180, ySpacing: 160 },
      slabOverrides: { a: { mainDiameter: 10, xSpacing: 120 } },
    });
    expect(restored?.roleReviewRequired).toBe(true);
  });

  it("V2记录也必须复核，只有V3能明确保存确认状态", () => {
    const legacy = parseFloorBottomStoredRecord({
      schemaVersion: 2,
      state: DEFAULT_FLOOR_BOTTOM_STATE,
      roleReviewRequired: false,
    });
    expect(legacy?.roleReviewRequired).toBe(true);

    const confirmed = parseFloorBottomStoredRecord(
      createFloorBottomStoredRecord(DEFAULT_FLOOR_BOTTOM_STATE, "2026-08-08T00:00:00.000Z", false),
    );
    expect(confirmed).toMatchObject({ schemaVersion: 3, roleReviewRequired: false });
  });

  it("损坏版本被拒绝，损坏字段恢复安全默认", () => {
    expect(parseFloorBottomStoredRecord({ schemaVersion: 99, state: {} })).toBeNull();
    const restored = parseFloorBottomStoredRecord({
      schemaVersion: 1,
      state: { countMode: "bad", defaults: { x: {}, y: {} }, slabOverrides: {} },
    });
    expect(restored?.state).toEqual(DEFAULT_FLOOR_BOTTOM_STATE);
    expect(restored?.roleReviewRequired).toBe(true);
  });
});
