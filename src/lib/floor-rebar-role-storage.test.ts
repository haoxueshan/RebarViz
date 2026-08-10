import { describe, expect, it } from "vitest";
import {
  createFloorRebarRoleStoredRecord,
  parseFloorRebarRoleStoredRecord,
} from "./floor-rebar-role-storage";

describe("Floor Rebar Role存储", () => {
  it("保存共享主方向并按当前稳定Role key清理失效项", () => {
    const record = createFloorRebarRoleStoredRecord({
      mainDirectionOverrides: { "role:a|b": "x", "role:stale": "y" },
    }, "2026-08-10T00:00:00.000Z");
    const parsed = parseFloorRebarRoleStoredRecord(record, new Set(["role:a|b"]));
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      savedAt: "2026-08-10T00:00:00.000Z",
      state: { mainDirectionOverrides: { "role:a|b": "x" } },
    });
  });

  it("损坏版本或方向不会进入共享Role State", () => {
    expect(parseFloorRebarRoleStoredRecord({ schemaVersion: 2, state: {} })).toBeNull();
    expect(parseFloorRebarRoleStoredRecord({
      schemaVersion: 1,
      state: { mainDirectionOverrides: { "role:a": "bad" } },
    })?.state.mainDirectionOverrides).toEqual({});
  });
});
