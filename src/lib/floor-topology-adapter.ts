import {
  buildFloorAtomicBoundarySegments,
  buildFloorDisplayBoundarySegments,
  buildFloorSlabAdjacency,
  findFloorComponents,
  validateFloorPlanBase,
  validateFloorPlanV2,
  type FloorAtomicBoundarySegment,
  type FloorBoundarySegment,
  type FloorPlanIssue,
  type FloorPlanState,
  type FloorSlabAdjacency,
} from "./floor-plan";
import {
  buildFloorTopologyBoundarySegmentsV3,
  buildFloorTopologyExteriorRanges,
  buildFloorTopologySlabAdjacency,
  solveFloorTopology,
  type FloorTopologyExteriorRange,
  type FloorTopologySolution,
} from "./floor-topology-solver";
import { resolveFloorConnectionSupportDetails } from "./floor-topology-support";

/**
 * Canonical Topology Adapter（V1.4A.1）：V1/V3 正式拓扑唯一 dispatch 点。
 *
 * 正式业务消费者（Canvas / Inspector / Assembly / Validation / 未来 Calculators）
 * 只调用本层，禁止各自 if (V3) ... else Legacy ...。
 *
 * - net-layout-v1 → Legacy Rect Touch（floor-plan）。
 * - clear-space-physical-v2 → FloorEdgeConnection + Solved Overlap（floor-topology-solver）。
 */
function isTopologyV3(plan: FloorPlanState): boolean {
  return plan.coordinateModel === "clear-space-physical-v2";
}

export function buildCanonicalFloorAtomicBoundarySegments(plan: FloorPlanState): FloorAtomicBoundarySegment[] {
  return isTopologyV3(plan)
    ? buildFloorTopologyBoundarySegmentsV3(plan)
    : buildFloorAtomicBoundarySegments(plan);
}

export function buildCanonicalFloorDisplayBoundarySegments(plan: FloorPlanState): FloorBoundarySegment[] {
  if (!isTopologyV3(plan)) return buildFloorDisplayBoundarySegments(plan);
  return buildFloorTopologyBoundarySegmentsV3(plan).map((segment) => ({
    ...segment,
    id: `display:${segment.id}`,
    type: segment.support,
    atomicIds: [segment.id],
  }));
}

export function buildCanonicalFloorSlabAdjacency(plan: FloorPlanState): FloorSlabAdjacency[] {
  if (!isTopologyV3(plan)) return buildFloorSlabAdjacency(plan);
  return buildFloorTopologySlabAdjacency(plan).map((group) => ({
    ...group,
    supports: [...group.supports],
  }));
}

export function findCanonicalFloorComponents(plan: FloorPlanState): string[][] {
  if (!isTopologyV3(plan)) return findFloorComponents(plan);
  return solveFloorTopology(plan).components
    .map((component) => [...component.slabIds])
    .sort((left, right) => left.join("|").localeCompare(right.join("|")));
}

/**
 * V3 独立 Validation：不再运行 Legacy Rect Touch（near miss / legacy adjacency / legacy cells）。
 * 基础字段校验复用 validateFloorPlanBase；连接语义来自 Solver 与精确 Support 解析。
 */
export function validateFloorPlanV3(plan: FloorPlanState): FloorPlanIssue[] {
  const issues: FloorPlanIssue[] = validateFloorPlanBase(plan);
  const solution = solveFloorTopology(plan);

  // Connection 引用 / Side Pair / Range：Solver 已是唯一权威（不重复二次推导）。
  solution.issues.forEach((issue) => {
    issues.push({
      level: issue.level,
      code: issue.code,
      message: issue.message,
      objectIds: issue.objectIds ?? issue.slabIds ?? issue.connectionIds,
    });
  });

  // Support conflict：与数组顺序无关的确定性报告（Solver 已按安全默认处理）。
  const connectionById = new Map((plan.connections ?? []).map((connection) => [connection.id, connection]));
  for (const solved of solution.solvedConnections) {
    if (!solved.valid) continue;
    const connection = connectionById.get(solved.connectionId);
    if (!connection) continue;
    const details = resolveFloorConnectionSupportDetails(
      connection,
      plan,
      { start: solved.rangeStartMm, end: solved.rangeEndMm },
      { start: solved.rangeStartMm, end: solved.rangeEndMm },
    );
    if (details.conflictingSupports.length > 1) {
      issues.push({
        level: "error",
        code: "support-rule-conflict",
        message: "同一连接实际区间同时命中相互冲突的支承规则（inner-wall / continuous），请重新设置。",
        objectIds: details.matchingRuleIds.length > 0 ? details.matchingRuleIds : solved.slabIds,
      });
    }
  }

  // Assembly / component warning：Connection Graph（不是 Rect Touch）。
  const components = findCanonicalFloorComponents(plan);
  if (components.length > 1) {
    issues.push({
      level: "warning",
      code: "floor-components",
      message: `当前楼层存在${components.length}个互不连接的楼板组合，请确认。`,
      objectIds: components.flat(),
    });
  }
  return issues;
}

/** Canonical Validator Dispatch：正式消费者唯一入口。 */
export function validateFloorPlanState(plan: FloorPlanState): FloorPlanIssue[] {
  return isTopologyV3(plan) ? validateFloorPlanV3(plan) : validateFloorPlanV2(plan);
}

/** 派生几何（单一求解）：atomic / display / adjacency / exterior 共用同一次 Solver 结果。 */
export type FloorTopologyGeometry = {
  solution: FloorTopologySolution;
  solvedConnections: FloorTopologySolution["solvedConnections"];
  atomic: FloorAtomicBoundarySegment[];
  display: FloorBoundarySegment[];
  adjacency: FloorSlabAdjacency[];
  exteriorRanges: FloorTopologyExteriorRange[];
};

export function buildFloorTopologyGeometry(plan: FloorPlanState): FloorTopologyGeometry {
  const solution = solveFloorTopology(plan);
  const atomic = buildFloorTopologyBoundarySegmentsV3(plan, solution);
  const display = atomic.map((segment) => ({
    ...segment,
    id: `display:${segment.id}`,
    type: segment.support,
    atomicIds: [segment.id],
  }));
  return {
    solution,
    solvedConnections: solution.solvedConnections,
    atomic,
    display,
    adjacency: buildFloorTopologySlabAdjacency(plan, solution),
    exteriorRanges: buildFloorTopologyExteriorRanges(plan, solution),
  };
}
