import { describe, expect, it } from "vitest";
import { DEFAULT_FLOOR_PLAN_STATE } from "./floor-plan";
import { createFloorDraftRecord, FLOOR_DRAFT_SCHEMA_VERSION, parseFloorDraftRecord } from "./floor-plan-storage";

describe("Floor Geometry V2草稿", () => {
  it("保存schemaVersion 2 wrapper且不修改输入state", () => {
    const input = structuredClone(DEFAULT_FLOOR_PLAN_STATE);
    const record = createFloorDraftRecord(input, "2026-08-08T00:00:00.000Z");
    expect(record).toMatchObject({ schemaVersion: FLOOR_DRAFT_SCHEMA_VERSION, savedAt: "2026-08-08T00:00:00.000Z" });
    record.state.slabs[0].name = "changed";
    expect(input.slabs[0].name).toBe("板区A");
  });

  it("读取V1直接state并迁移板区、洞口、规则和坐标模型", () => {
    const record = parseFloorDraftRecord({
      slabs: [{ id: "old-a", name: "旧房间", x: 0, y: 0, width: 4200, height: 3600 }],
      innerWallThickness: 240,
      outerWallThickness: 370,
      snapDistanceMm: 150,
    });
    expect(record?.schemaVersion).toBe(2);
    expect(record?.state).toMatchObject({ coordinateModel: "net-layout-v1", openings: [], supportRules: [] });
    expect(record?.state.slabs[0].type).toBe("room");
  });

  it("读取V2时恢复Opening与Support Rule", () => {
    const state = structuredClone(DEFAULT_FLOOR_PLAN_STATE);
    state.openings.push({ id: "floor-opening-a", name: "楼梯间", type: "stair", x: 500, y: 500, width: 1000, height: 1000 });
    state.supportRules.push({ id: "r", target: { kind: "opening-edge", openingId: "floor-opening-a", side: "west", range: { mode: "whole" } }, support: "inner-wall" });
    expect(parseFloorDraftRecord(createFloorDraftRecord(state))?.state).toEqual(state);
  });
});
