import {
  resolveFloorBoundarySupportDetails,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSupportRuleTarget,
} from "./floor-plan";
import type { FloorEdgeConnection } from "./floor-topology";

/**
 * Floor Topology V1.4A.1 Connection Support Resolver（唯一真值）。
 *
 * Support 必须精确到 Slab ID + Side + 实际 Connection 覆盖 Range：
 * - “A west 有 continuous”绝不能把“A east ↔ B west”变成 continuous；
 * - “K east 0~2000 continuous”只作用于 0~2000 段，2000~4000 段仍是 inner-wall；
 * - “K east whole continuous”作用于该 Side 全部合法 Connection；
 * - 冲突（同一实际 Range 同时命中 inner-wall 与 continuous）→ 保守默认 inner-wall
 *   + conflictingSupports 上报（Validation 报 support-rule-conflict），与数组顺序无关。
 *
 * 内部复用 resolveFloorBoundarySupportDetails（Host + Side + Range overlap），
 * 不重新写第二套 supportRules.some(...)。
 */

export type FloorConnectionSupportDetails = {
  support: "inner-wall" | "continuous";
  matchingRuleIds: string[];
  conflictingSupports: FloorResolvedSupport[];
};

/** 把某端点实际覆盖的世界切向区间转换成该端点 Side 的 offset target。 */
function worldRangeToTarget(
  slabId: string,
  side: FloorEdgeSide,
  worldRange: { start: number; end: number },
  plan: FloorPlanState,
): FloorSupportRuleTarget | null {
  const slab = plan.slabs.find((item) => item.id === slabId);
  if (!slab) return null;
  const base = side === "west" || side === "east" ? slab.y : slab.x;
  const startMm = Math.max(0, Math.min(worldRange.start, worldRange.end) - base);
  const endMm = Math.max(0, Math.max(worldRange.start, worldRange.end) - base);
  const length = side === "west" || side === "east" ? slab.height : slab.width;
  const clampedStart = Math.max(0, Math.min(startMm, length));
  const clampedEnd = Math.max(0, Math.min(endMm, length));
  if (clampedEnd - clampedStart <= 0) return null;
  return {
    kind: "slab-edge",
    slabId,
    side,
    range: { mode: "offset", startMm: clampedStart, endMm: clampedEnd },
  };
}

/**
 * 解析连接的正式支承：需要两侧端点的“实际覆盖世界切向区间”（来自 Solved Overlap ∩ 双端点 Range）。
 */
export function resolveFloorConnectionSupportDetails(
  connection: FloorEdgeConnection,
  plan: FloorPlanState,
  worldRangeA: { start: number; end: number },
  worldRangeB: { start: number; end: number },
): FloorConnectionSupportDetails {
  const targetA = worldRangeToTarget(connection.a.slabId, connection.a.side, worldRangeA, plan);
  const targetB = worldRangeToTarget(connection.b.slabId, connection.b.side, worldRangeB, plan);
  const targets = [targetA, targetB].filter((target): target is FloorSupportRuleTarget => target !== null);
  const resolution = resolveFloorBoundarySupportDetails("shared-slab", targets, plan);
  return {
    // 冲突时使用保守且与数组顺序无关的安全值（inner-wall）；Validation 阻止正式计算。
    support: resolution.support === "continuous" ? "continuous" : "inner-wall",
    matchingRuleIds: resolution.matchingRuleIds,
    conflictingSupports: resolution.conflictingSupports,
  };
}
