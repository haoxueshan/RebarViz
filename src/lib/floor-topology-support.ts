import {
  FLOOR_GEOMETRY_EPSILON_MM,
  resolveFloorBoundarySupportDetails,
  type FloorEdgeRange,
  type FloorEdgeSide,
  type FloorPlanState,
  type FloorResolvedSupport,
  type FloorSlab,
  type FloorSupportRule,
  type FloorSupportRuleTarget,
} from "./floor-plan";
import { subtractFloorRanges, type FloorEdgeConnection, type FloorRange } from "./floor-topology";

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

// ============================================================================
// V1.4A.2.2 Support Rule Range Split / Merge（纯函数，无 React / DOM）。
// 职责：Connection Support 切换 = 旧规则区间 − 选中 Connection 区间 = 残段保留旧 Support，
//       选中区间写新 Support。绝不整条删除会污染同 Side 其它 Connection 的 Whole 规则。
// 与 Detach 清理（cleanupFloorSupportRulesAfterConnectionRemoval）职责分离。
// ============================================================================

const REWRITE_EPSILON = FLOOR_GEOMETRY_EPSILON_MM;

/** Side 全长：west/east → slab.height；south/north → slab.width。 */
function supportSideLength(slab: FloorSlab, side: FloorEdgeSide): number {
  return side === "west" || side === "east" ? slab.height : slab.width;
}

/** 残段 ID（deterministic，禁止 Date.now / Math.random）。 */
function remainSupportRuleId(ruleId: string, start: number, end: number): string {
  const round = (value: number) => String(Math.round(value * 1000) / 1000);
  return `${ruleId}:remain:${round(start)}:${round(end)}`;
}

/** 残段 Canonicalize：覆盖整边（EPSILON 内）→ whole，否则 offset。 */
function canonicalRemainRange(range: FloorRange, sideLength: number): FloorEdgeRange {
  if (range.start <= REWRITE_EPSILON && range.end >= sideLength - REWRITE_EPSILON) {
    return { mode: "whole" };
  }
  return { mode: "offset", startMm: range.start, endMm: range.end };
}

/** 规则实际区间：whole 展开为 [0, sideLength]；offset clamp 到边内。 */
function supportRuleRangeOf(rule: FloorSupportRule, slab: FloorSlab): FloorRange {
  const sideLength = supportSideLength(slab, rule.target.side);
  if (rule.target.range.mode === "whole") return { start: 0, end: sideLength };
  return {
    start: Math.max(0, Math.min(rule.target.range.startMm, sideLength)),
    end: Math.max(0, Math.min(rule.target.range.endMm, sideLength)),
  };
}

/**
 * 单条 slab-edge 规则按 selected 区间拆分：
 * - opening-edge / 非 inner-wall|continuous / 无正长度重叠 → 原引用原样返回；
 * - 完全覆盖 → []（删除）；
 * - 部分覆盖 → 残段保持旧 Support，ID deterministic `${id}:remain:start:end`。
 */
export function splitFloorSupportRuleForRange(
  rule: FloorSupportRule,
  slab: FloorSlab,
  selectedStartMm: number,
  selectedEndMm: number,
): FloorSupportRule[] {
  const target = rule.target;
  if (target.kind !== "slab-edge") return [rule];
  if (rule.support !== "inner-wall" && rule.support !== "continuous") return [rule];
  const sideLength = supportSideLength(slab, target.side);
  const selectedStart = Math.max(0, Math.min(selectedStartMm, sideLength));
  const selectedEnd = Math.max(0, Math.min(selectedEndMm, sideLength));
  if (selectedEnd - selectedStart <= REWRITE_EPSILON) return [rule];
  const ruleRange = supportRuleRangeOf(rule, slab);
  const overlapStart = Math.max(ruleRange.start, selectedStart);
  const overlapEnd = Math.min(ruleRange.end, selectedEnd);
  if (overlapEnd - overlapStart <= REWRITE_EPSILON) return [rule];
  const remaining = subtractFloorRanges(ruleRange, [{ start: selectedStart, end: selectedEnd }]);
  return remaining
    .filter((range) => range.end - range.start > REWRITE_EPSILON)
    .map((range) => ({
      id: remainSupportRuleId(rule.id, range.start, range.end),
      target: {
        kind: "slab-edge" as const,
        slabId: target.slabId,
        side: target.side,
        range: canonicalRemainRange(range, sideLength),
      },
      support: rule.support,
    }));
}

/**
 * 相邻同 Support 规则合并（spec 24）：只在同 slabId + side + support 且 Range 相邻/重叠
 * （gap <= EPSILON）时合并；合并后覆盖整边则 Canonicalize 为 whole；ID 取组内字典序最小者。
 * 不同 Slab / 不同 Side / 不同 Support / opening-edge 绝不合并。
 */
export function mergeAdjacentFloorSupportRules(plan: FloorPlanState): FloorSupportRule[] {
  const result: FloorSupportRule[] = [];
  const slabsById = new Map(plan.slabs.map((slab) => [slab.id, slab]));
  type GroupItem = { rule: FloorSupportRule; slab: FloorSlab; start: number; end: number };
  const groups = new Map<string, GroupItem[]>();
  for (const rule of plan.supportRules) {
    if (rule.target.kind !== "slab-edge") { result.push(rule); continue; }
    if (rule.support !== "inner-wall" && rule.support !== "continuous") { result.push(rule); continue; }
    const slab = slabsById.get(rule.target.slabId);
    if (!slab) { result.push(rule); continue; }
    const range = supportRuleRangeOf(rule, slab);
    const key = `${rule.target.slabId}:${rule.target.side}:${rule.support}`;
    const items = groups.get(key) ?? [];
    items.push({ rule, slab, start: range.start, end: range.end });
    groups.set(key, items);
  }
  for (const items of groups.values()) {
    const slab = items[0].slab;
    const targetRef = items[0].rule.target as Extract<FloorSupportRuleTarget, { kind: "slab-edge" }>;
    const support = items[0].rule.support;
    const sideLength = supportSideLength(slab, targetRef.side);
    const sorted = [...items].sort((left, right) =>
      left.start - right.start || left.end - right.end || left.rule.id.localeCompare(right.rule.id));
    const segments: Array<{ start: number; end: number; ids: string[] }> = [];
    for (const item of sorted) {
      const previous = segments.at(-1);
      if (previous && item.start <= previous.end + REWRITE_EPSILON) {
        previous.end = Math.max(previous.end, item.end);
        previous.ids.push(item.rule.id);
        continue;
      }
      segments.push({ start: item.start, end: item.end, ids: [item.rule.id] });
    }
    for (const segment of segments) {
      const ids = [...segment.ids].sort();
      result.push({
        id: ids[0],
        target: {
          kind: "slab-edge",
          slabId: targetRef.slabId,
          side: targetRef.side,
          range: canonicalRemainRange({ start: segment.start, end: segment.end }, sideLength),
        },
        support,
      });
    }
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export type FloorSupportRewriteEndpoint = {
  slabId: string;
  side: FloorEdgeSide;
  startMm: number;
  endMm: number;
};

export type FloorSupportRuleRewriteResult = {
  supportRules: FloorSupportRule[];
  /** 被删除或拆分替换的原始规则 ID（确定性排序）。 */
  removedRuleIds: string[];
  addedRuleId: string;
};

/**
 * V1.4A.2.2 Connection Support 切换的规则重写（Range Split，spec 47/48）：
 * - 对每个端点（A、B 各自的 slabId/side/offset 区间）把重叠的 slab-edge 规则按区间拆分；
 * - 先移除与新规则同 ID 的旧规则（替换语义，防 ID 堆积）；
 * - 在 A 端点追加新规则（whole 或 offset 由调用方给出）；
 * - 最后合并相邻同 Support 规则并排序（deterministic）。
 * 只动 slab-edge；opening-edge 规则绝不修改。
 */
export function rewriteFloorSupportRulesForConnectionSupport(
  plan: FloorPlanState,
  endpoints: readonly FloorSupportRewriteEndpoint[],
  newRuleTarget: FloorSupportRuleTarget,
  newRuleId: string,
  newSupport: "inner-wall" | "continuous",
): FloorSupportRuleRewriteResult {
  const slabsById = new Map(plan.slabs.map((slab) => [slab.id, slab]));
  const removedRuleIds = new Set<string>();
  const working: FloorSupportRule[] = [];
  for (const rule of plan.supportRules) {
    if (rule.id === newRuleId) { removedRuleIds.add(rule.id); continue; }
    const target = rule.target;
    if (target.kind !== "slab-edge") { working.push(rule); continue; }
    const endpoint = endpoints.find((item) => item.slabId === target.slabId && item.side === target.side);
    if (!endpoint) { working.push(rule); continue; }
    const slab = slabsById.get(target.slabId);
    if (!slab) { working.push(rule); continue; }
    const splitResult = splitFloorSupportRuleForRange(rule, slab, endpoint.startMm, endpoint.endMm);
    const untouched = splitResult.length === 1 && splitResult[0] === rule;
    if (untouched) working.push(rule);
    else {
      removedRuleIds.add(rule.id);
      working.push(...splitResult);
    }
  }
  working.push({
    id: newRuleId,
    target: newRuleTarget,
    support: newSupport,
  });
  const mergedPlan: FloorPlanState = { ...plan, supportRules: working };
  return {
    supportRules: mergeAdjacentFloorSupportRules(mergedPlan),
    removedRuleIds: [...removedRuleIds].sort(),
    addedRuleId: newRuleId,
  };
}
