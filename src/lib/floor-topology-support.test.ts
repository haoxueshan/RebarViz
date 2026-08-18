import { describe, expect, it } from "vitest";
import type { FloorEdgeRange, FloorPlanState, FloorSupportRule } from "./floor-plan";
import {
  mergeAdjacentFloorSupportRules,
  splitFloorSupportRuleForRange,
} from "./floor-topology-support";

/** K 板：width 4000、height 由参数决定（east/west 侧长度 = height）。 */
function kSlab(height: number): FloorPlanState["slabs"][number] {
  return { id: "k", name: "板区K", type: "room", x: 0, y: 0, width: 4000, height };
}

function slabRule(
  id: string,
  range: FloorEdgeRange,
  support: "inner-wall" | "continuous",
): FloorSupportRule {
  return { id, target: { kind: "slab-edge", slabId: "k", side: "east", range }, support };
}

function rangesOf(parts: FloorSupportRule[]): Array<{ mode: string; startMm?: number; endMm?: number }> {
  return parts.map((part) => {
    const range = part.target.range;
    return range.mode === "whole" ? { mode: "whole" } : { mode: "offset", startMm: range.startMm, endMm: range.endMm };
  });
}

describe("V1.4A.2.2 splitFloorSupportRuleForRange", () => {
  it("whole - full → 空（完全删除）", () => {
    expect(splitFloorSupportRuleForRange(slabRule("r", { mode: "whole" }, "continuous"), kSlab(4000), 0, 4000)).toEqual([]);
  });

  it("whole - start → 残段 2000~4000 保持旧 Support", () => {
    const parts = splitFloorSupportRuleForRange(slabRule("r", { mode: "whole" }, "continuous"), kSlab(4000), 0, 2000);
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe("r:remain:2000:4000");
    expect(parts[0].support).toBe("continuous");
    expect(rangesOf(parts)).toEqual([{ mode: "offset", startMm: 2000, endMm: 4000 }]);
  });

  it("whole - middle → 左右残段都保留（deterministic 升序）", () => {
    const parts = splitFloorSupportRuleForRange(slabRule("r", { mode: "whole" }, "continuous"), kSlab(4000), 1000, 2500);
    expect(rangesOf(parts)).toEqual([
      { mode: "offset", startMm: 0, endMm: 1000 },
      { mode: "offset", startMm: 2500, endMm: 4000 },
    ]);
    expect(parts.map((part) => part.support)).toEqual(["continuous", "continuous"]);
    expect(parts.map((part) => part.id)).toEqual(["r:remain:0:1000", "r:remain:2500:4000"]);
  });

  it("whole - end → 残段 0~2000", () => {
    const parts = splitFloorSupportRuleForRange(slabRule("r", { mode: "whole" }, "inner-wall"), kSlab(4000), 2000, 4000);
    expect(parts[0].support).toBe("inner-wall");
    expect(rangesOf(parts)).toEqual([{ mode: "offset", startMm: 0, endMm: 2000 }]);
  });

  it("offset - partial：0~2000 规则被 1500~3000 覆盖 → 只剩 0~1500", () => {
    const parts = splitFloorSupportRuleForRange(
      slabRule("r", { mode: "offset", startMm: 0, endMm: 2000 }, "continuous"),
      kSlab(4000),
      1500,
      3000,
    );
    expect(rangesOf(parts)).toEqual([{ mode: "offset", startMm: 0, endMm: 1500 }]);
  });

  it("offset - full → 空", () => {
    expect(splitFloorSupportRuleForRange(
      slabRule("r", { mode: "offset", startMm: 1000, endMm: 2500 }, "continuous"),
      kSlab(4000),
      1000,
      2500,
    )).toEqual([]);
  });

  it("non-overlap → 原引用原样返回", () => {
    const rule = slabRule("r", { mode: "offset", startMm: 0, endMm: 1000 }, "continuous");
    expect(splitFloorSupportRuleForRange(rule, kSlab(4000), 2000, 3000)).toEqual([rule]);
  });

  it("EPSILON 相触边界不切（不产生零长残段）", () => {
    const rule = slabRule("r", { mode: "offset", startMm: 0, endMm: 1000 }, "continuous");
    expect(splitFloorSupportRuleForRange(rule, kSlab(4000), 1000, 2000)).toEqual([rule]);
  });

  it("零长残段（< EPSILON）丢弃", () => {
    const parts = splitFloorSupportRuleForRange(
      slabRule("r", { mode: "whole" }, "continuous"),
      kSlab(2000),
      1000,
      2000 - 5e-8,
    );
    expect(rangesOf(parts)).toEqual([{ mode: "offset", startMm: 0, endMm: 1000 }]);
  });

  it("opening-edge 规则原样返回（绝不修改）", () => {
    const rule: FloorSupportRule = {
      id: "r-open",
      target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } },
      support: "opening-cut",
    };
    expect(splitFloorSupportRuleForRange(rule, kSlab(4000), 0, 4000)).toEqual([rule]);
  });
});

describe("V1.4A.2.2 mergeAdjacentFloorSupportRules", () => {
  it("相邻同 Support 合并为 whole，ID 取组内最小", () => {
    const plan: FloorPlanState = {
      coordinateModel: "clear-space-physical-v2",
      slabs: [kSlab(4000)],
      openings: [],
      supportRules: [
        slabRule("r-b", { mode: "offset", startMm: 2000, endMm: 4000 }, "continuous"),
        slabRule("r-a", { mode: "offset", startMm: 0, endMm: 2000 }, "continuous"),
      ],
      connections: [],
      innerWallThickness: 240,
      outerWallThickness: 240,
      snapDistanceMm: 1500,
      overlapToleranceMm: 10,
    };
    const merged = mergeAdjacentFloorSupportRules(plan);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("r-a");
    expect(merged[0].target.range).toEqual({ mode: "whole" });
    expect(merged[0].support).toBe("continuous");
  });

  it("不同 Support 不合并", () => {
    const plan: FloorPlanState = {
      coordinateModel: "clear-space-physical-v2",
      slabs: [kSlab(4000)],
      openings: [],
      supportRules: [
        slabRule("r1", { mode: "offset", startMm: 0, endMm: 2000 }, "continuous"),
        slabRule("r2", { mode: "offset", startMm: 2000, endMm: 4000 }, "inner-wall"),
      ],
      connections: [],
      innerWallThickness: 240,
      outerWallThickness: 240,
      snapDistanceMm: 1500,
      overlapToleranceMm: 10,
    };
    const merged = mergeAdjacentFloorSupportRules(plan);
    expect(merged.map((rule) => rule.id).sort()).toEqual(["r1", "r2"]);
  });

  it("不同 Side / 不同 Slab / opening-edge 不合并", () => {
    const plan: FloorPlanState = {
      coordinateModel: "clear-space-physical-v2",
      slabs: [kSlab(4000), { id: "d", name: "板区D", type: "room", x: 0, y: 0, width: 4000, height: 4000 }],
      openings: [],
      supportRules: [
        slabRule("r-east", { mode: "whole" }, "continuous"),
        { id: "r-south", target: { kind: "slab-edge", slabId: "k", side: "south", range: { mode: "whole" } }, support: "continuous" },
        { id: "r-d", target: { kind: "slab-edge", slabId: "d", side: "east", range: { mode: "whole" } }, support: "continuous" },
        { id: "r-open", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "opening-cut" },
      ],
      connections: [],
      innerWallThickness: 240,
      outerWallThickness: 240,
      snapDistanceMm: 1500,
      overlapToleranceMm: 10,
    };
    const merged = mergeAdjacentFloorSupportRules(plan);
    expect(merged.map((rule) => rule.id).sort()).toEqual(["r-d", "r-east", "r-open", "r-south"]);
  });

  it("Epsilon 相邻 gap 也合并", () => {
    const plan: FloorPlanState = {
      coordinateModel: "clear-space-physical-v2",
      slabs: [kSlab(4000)],
      openings: [],
      supportRules: [
        slabRule("r-a", { mode: "offset", startMm: 0, endMm: 2000 }, "inner-wall"),
        slabRule("r-b", { mode: "offset", startMm: 2000 + 5e-8, endMm: 4000 }, "inner-wall"),
      ],
      connections: [],
      innerWallThickness: 240,
      outerWallThickness: 240,
      snapDistanceMm: 1500,
      overlapToleranceMm: 10,
    };
    const merged = mergeAdjacentFloorSupportRules(plan);
    expect(merged).toHaveLength(1);
    expect(merged[0].target.range).toEqual({ mode: "whole" });
    expect(merged[0].support).toBe("inner-wall");
  });
});
