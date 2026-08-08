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
        x: { diameter: 14, spacing: 180 },
        y: { diameter: 12, spacing: 160 },
      },
      slabOverrides: {
        a: { x: { diameter: 10, spacing: 120 } },
        stale: { y: { diameter: 8, spacing: 100 } },
      },
    };
    const restored = parseFloorBottomStoredRecord(
      createFloorBottomStoredRecord(state, "2026-08-08T00:00:00.000Z"),
      new Set(["a"]),
    );
    expect(restored?.state).toMatchObject({ countMode: "round", defaults: state.defaults });
    expect(restored?.state.slabOverrides).toEqual({ a: state.slabOverrides.a });
  });

  it("损坏版本被拒绝，损坏字段恢复安全默认", () => {
    expect(parseFloorBottomStoredRecord({ schemaVersion: 99, state: {} })).toBeNull();
    const restored = parseFloorBottomStoredRecord({
      schemaVersion: 1,
      state: { countMode: "bad", defaults: { x: {}, y: {} }, slabOverrides: {} },
    });
    expect(restored?.state).toEqual(DEFAULT_FLOOR_BOTTOM_STATE);
  });
});
