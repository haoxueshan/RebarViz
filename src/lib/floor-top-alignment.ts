import type {
  FloorPlanState,
} from "./floor-plan";
import type {
  FloorRebarDomain,
} from "./floor-rebar-domain";
import {
  resolveFloorBarRole,
  resolveFloorRebarRoleContext,
  type FloorMainDirection,
  type FloorRebarRoleState,
} from "./floor-rebar-role";
import { countBars } from "./slab-calculator";
import type {
  FloorTopIssue,
  FloorTopState,
  FloorTopThroughPath,
} from "./floor-top-calculator";
import { resolveFloorTopThroughPathGeometry } from "./floor-top-through";

const ALIGNMENT_EPSILON_MM = 1e-7;

export type FloorTopAlignmentGroup = {
  id: string;
  direction: "x" | "y";
  spacingMm: number;
  domainIds: string[];
  slabIds: string[];
  /** 组共享相位（0 <= originMm < spacingMm），即 mod spacing 的统一相位。 */
  originMm: number;
  mode: "domain-centered" | "through-inherited" | "shared-phase";
  throughPathIds: string[];
};

export type FloorTopAlignmentConstraint = {
  id: string;
  throughPathId: string;
  direction: "x" | "y";
  spacingMm: number;
  domainIds: string[];
  bandStartMm: number;
  bandEndMm: number;
};

export type FloorTopAlignmentPlan = {
  groups: FloorTopAlignmentGroup[];
  phaseByDomainDirection: Map<string, number>;
  errors: FloorTopIssue[];
  warnings: FloorTopIssue[];
};

/** 结果始终落在 0 <= phase < spacingMm。 */
export function normalizeRebarPhase(originMm: number, spacingMm: number): number {
  const modulo = originMm % spacingMm;
  return modulo < 0 ? modulo + spacingMm : modulo;
}

/** 计算从min开始、满足 mod spacing = phase 的第一根位置与可布根数。 */
export function countInheritedPositions(
  minMm: number,
  maxMm: number,
  spacingMm: number,
  phaseMm: number,
): { firstMm: number; count: number } {
  const modulo = ((minMm % spacingMm) + spacingMm) % spacingMm;
  const offset = ((phaseMm - modulo) % spacingMm + spacingMm) % spacingMm;
  const firstMm = minMm + offset;
  if (firstMm > maxMm + ALIGNMENT_EPSILON_MM) return { firstMm, count: 0 };
  return {
    firstMm,
    count: Math.floor((maxMm - firstMm) / spacingMm + 1e-9) + 1,
  };
}

function topSettingsForSlab(
  top: FloorTopState,
  slabId: string,
  direction: "x" | "y",
  mainDirection: FloorMainDirection,
): { diameter: number; spacing: number } {
  const defaults = { ...top.defaults, ...(top.slabOverrides[slabId] ?? {}) };
  const role = resolveFloorBarRole(mainDirection, direction);
  return {
    diameter: role === "main" ? defaults.mainDiameter : defaults.secondaryDiameter,
    spacing: direction === "x" ? defaults.xSpacing : defaults.ySpacing,
  };
}

type AlignmentNode = {
  key: string;
  domainId: string;
  direction: "x" | "y";
  spacingMm: number;
  spanStartMm: number;
  spanEndMm: number;
  count: number;
  centeredPhase: number;
  domain: FloorRebarDomain;
};

/**
 * 在普通面筋生成之前，基于已启用的通墙路径建立跨 Physical Domain 的排筋相位约束。
 * 只协调 positionMm（mod spacing 相位），不改变 spacing、直径、根数算法与几何。
 */
export function buildFloorTopAlignmentPlan(
  plan: FloorPlanState,
  top: FloorTopState,
  domains: readonly FloorRebarDomain[],
  throughPaths: readonly FloorTopThroughPath[],
  roleState: FloorRebarRoleState,
): FloorTopAlignmentPlan {
  const errors: FloorTopIssue[] = [];
  const warnings: FloorTopIssue[] = [];
  const roleContext = resolveFloorRebarRoleContext(plan, domains, roleState);
  const domainById = new Map(domains.map((domain) => [domain.id, domain]));
  const domainBySlab = new Map<string, FloorRebarDomain>();
  domains.forEach((domain) => domain.slabIds.forEach((slabId) => domainBySlab.set(slabId, domain)));

  const nodes = new Map<string, AlignmentNode>();
  const adjacency = new Map<string, Set<string>>();
  const pathNodeKeys = new Map<string, string[]>();

  const ensureNode = (domainId: string, direction: "x" | "y", spacingMm: number): string | null => {
    const key = `${domainId}:${direction}`;
    const existing = nodes.get(key);
    if (existing) {
      if (Math.abs(existing.spacingMm - spacingMm) > ALIGNMENT_EPSILON_MM) return null;
      return key;
    }
    const domain = domainById.get(domainId);
    if (!domain) return null;
    const spanStartMm = direction === "x" ? domain.minY : domain.minX;
    const spanEndMm = direction === "x" ? domain.maxY : domain.maxX;
    const count = countBars(spanEndMm - spanStartMm, spacingMm, top.countMode);
    const offset = Math.max(0, ((spanEndMm - spanStartMm) - (count - 1) * spacingMm) / 2);
    nodes.set(key, {
      key,
      domainId,
      direction,
      spacingMm,
      spanStartMm,
      spanEndMm,
      count,
      centeredPhase: normalizeRebarPhase(spanStartMm + offset, spacingMm),
      domain,
    });
    adjacency.set(key, new Set());
    return key;
  };

  const enabledPaths = throughPaths.filter((path) => path.enabled);
  enabledPaths.forEach((path) => {
    const geometry = resolveFloorTopThroughPathGeometry(plan, path);
    if (geometry.errors.length > 0) return; // 几何错误由Through层统一报告。
    const missingSlab = geometry.orderedSlabIds.filter((slabId) => !domainBySlab.has(slabId));
    if (missingSlab.length > 0) {
      errors.push({
        code: "through-alignment-domain-invalid",
        message: `“${path.name}”存在无法映射到实际钢筋区域的板区，无法建立统一通墙排筋相位。`,
        objectIds: [path.id, ...missingSlab],
      });
      return;
    }
    const orderedDomainIds = [...new Set(
      geometry.orderedSlabIds.map((slabId) => domainBySlab.get(slabId)!.id),
    )];
    const spacings = new Map<string, number>();
    orderedDomainIds.forEach((domainId) => {
      const mainDirection = roleContext.mainDirectionByPhysicalDomain.get(domainId);
      if (!mainDirection) return; // 主筋未确认等错误由上层报告。
      const settings = topSettingsForSlab(
        top,
        domainById.get(domainId)!.slabIds[0],
        path.direction,
        mainDirection,
      );
      spacings.set(domainId, settings.spacing);
    });
    const distinctSpacings = [...new Set([...spacings.values()])];
    if (distinctSpacings.length !== 1) {
      errors.push({
        code: "through-alignment-spacing-conflict",
        message: `“${path.name}”参与板区的${path.direction === "x" ? "南北向" : "东西向"}面筋间距不一致，无法建立统一通墙排筋相位。`,
        objectIds: [path.id, ...orderedDomainIds],
      });
      return;
    }
    const spacingMm = distinctSpacings[0];
    const keys: string[] = [];
    for (const domainId of orderedDomainIds) {
      const key = ensureNode(domainId, path.direction, spacingMm);
      if (!key) {
        errors.push({
          code: "through-alignment-constraint-conflict",
          message: `“${path.name}”要求“${domainId}”同时使用不同间距的通墙相位，请统一${path.direction === "x" ? "南北向" : "东西向"}面筋间距。`,
          objectIds: [path.id, domainId],
        });
        return;
      }
      keys.push(key);
    }
    for (let index = 0; index < keys.length - 1; index += 1) {
      adjacency.get(keys[index])!.add(keys[index + 1]);
      adjacency.get(keys[index + 1])!.add(keys[index]);
    }
    pathNodeKeys.set(path.id, keys);
  });

  // 按direction+spacing分组的连通分量。
  const visited = new Set<string>();
  const components: string[][] = [];
  [...nodes.keys()].sort().forEach((key) => {
    if (visited.has(key)) return;
    const component: string[] = [];
    const queue = [key];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      adjacency.get(current)!.forEach((next) => {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    components.push(component);
  });

  const groups: FloorTopAlignmentGroup[] = [];
  const phaseByDomainDirection = new Map<string, number>();
  components.forEach((component) => {
    const componentNodes = component.map((key) => nodes.get(key)!);
    const reference = [...componentNodes].sort((left, right) =>
      (right.spanEndMm - right.spanStartMm) - (left.spanEndMm - left.spanStartMm) ||
      left.domainId.localeCompare(right.domainId))[0];
    const candidates = [...new Set([
      reference.centeredPhase,
      ...componentNodes.map((node) => node.centeredPhase),
    ])].sort((left, right) => {
      const leftReference = left === reference.centeredPhase ? 0 : 1;
      const rightReference = right === reference.centeredPhase ? 0 : 1;
      return leftReference - rightReference || left - right;
    });
    const chosen = candidates.find((phase) => componentNodes.every((node) =>
      countInheritedPositions(
        node.spanStartMm,
        node.spanEndMm,
        node.spacingMm,
        phase,
      ).count === node.count));
    const relatedPathIds = [...pathNodeKeys.entries()]
      .filter(([, keys]) => keys.some((key) => component.includes(key)))
      .map(([pathId]) => pathId);
    if (chosen === undefined) {
      const pathNames = relatedPathIds
        .map((pathId) => enabledPaths.find((path) => path.id === pathId)?.name)
        .filter(Boolean);
      errors.push({
        code: "through-alignment-phase-unsatisfied",
        message: `“${pathNames.join("、") || "通墙路径"}”参与板区无法在保持当前根数算法的同时建立统一排筋相位。请检查板区尺寸、间距或根数算法。`,
        objectIds: relatedPathIds,
      });
      return;
    }
    const domainIds = [...new Set(componentNodes.map((node) => node.domainId))].sort();
    const slabIds = [...new Set(componentNodes.flatMap((node) => node.domain.slabIds))].sort();
    groups.push({
      id: `top-alignment-group:${component.sort().join("|")}`,
      direction: componentNodes[0].direction,
      spacingMm: componentNodes[0].spacingMm,
      domainIds,
      slabIds,
      originMm: chosen,
      mode: "shared-phase",
      throughPathIds: relatedPathIds,
    });
    componentNodes.forEach((node) => {
      phaseByDomainDirection.set(`${node.domainId}:${node.direction}`, chosen);
    });
  });

  return { groups, phaseByDomainDirection, errors, warnings };
}

export const EMPTY_FLOOR_TOP_ALIGNMENT_PLAN: FloorTopAlignmentPlan = {
  groups: [],
  phaseByDomainDirection: new Map(),
  errors: [],
  warnings: [],
};
