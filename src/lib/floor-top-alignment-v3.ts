import type { FloorRebarCalculationContextV3 } from "./floor-rebar-calculation-context-v3";
import type { FloorRebarDomain } from "./floor-rebar-domain";
import {
  type FloorRebarRoleContext,
} from "./floor-rebar-role";
import {
  countInheritedPositions,
  normalizeRebarPhase,
  type FloorTopAlignmentPlan,
} from "./floor-top-alignment";
import type {
  FloorTopIssue,
  FloorTopState,
  FloorTopThroughPath,
} from "./floor-top-calculator";
import {
  resolveFloorTopThroughPathGeometryV3,
  type FloorTopThroughGeometryV3,
} from "./floor-top-through-v3";
import { countBars } from "./slab-calculator";

const ALIGNMENT_EPSILON_MM = 1e-7;
const PHYSICAL_LINE_EPSILON_MM = 1e-6;

export type SharedRebarPhaseNode = {
  minMm: number;
  maxMm: number;
  spacingMm: number;
  targetCount: number;
  centeredPhase: number;
};

export type SharedRebarPhaseResult = {
  phaseMm: number;
};

export type FloorTopAlignmentV3Result = {
  plan: FloorTopAlignmentPlan;
  geometries: FloorTopThroughGeometryV3[];
};

type AlignmentNodeV3 = SharedRebarPhaseNode & {
  key: string;
  domainId: string;
  direction: "x" | "y";
  domain: FloorRebarDomain;
};

function circularDistance(left: number, right: number, spacingMm: number): number {
  const distance = Math.abs(left - right);
  return Math.min(distance, spacingMm - distance);
}

function stableCandidate(value: number, spacingMm: number): number {
  return Number(normalizeRebarPhase(value, spacingMm).toFixed(9));
}

/** Search all count-critical phase partitions, not only domain-centered phases. */
export function findSharedRebarPhase(
  nodes: readonly SharedRebarPhaseNode[],
  referencePhaseMm = nodes[0]?.centeredPhase ?? 0,
): SharedRebarPhaseResult | null {
  if (nodes.length === 0) return null;
  const spacingMm = nodes[0].spacingMm;
  if (!Number.isFinite(spacingMm) || spacingMm <= 0
    || nodes.some((node) =>
      !Number.isFinite(node.minMm)
      || !Number.isFinite(node.maxMm)
      || node.maxMm < node.minMm
      || !Number.isFinite(node.spacingMm)
      || Math.abs(node.spacingMm - spacingMm) > ALIGNMENT_EPSILON_MM
      || !Number.isInteger(node.targetCount)
      || node.targetCount < 0)) return null;

  const critical = [...new Set([
    0,
    ...nodes.flatMap((node) => [
      stableCandidate(node.minMm, spacingMm),
      stableCandidate(node.maxMm, spacingMm),
    ]),
  ])].sort((left, right) => left - right);
  const candidates = new Set<number>();
  const delta = 4 * PHYSICAL_LINE_EPSILON_MM;
  critical.forEach((phase, index) => {
    candidates.add(stableCandidate(phase, spacingMm));
    candidates.add(stableCandidate(phase - delta, spacingMm));
    candidates.add(stableCandidate(phase + delta, spacingMm));
    const next = index === critical.length - 1 ? critical[0] + spacingMm : critical[index + 1];
    candidates.add(stableCandidate((phase + next) / 2, spacingMm));
  });
  nodes.forEach((node) => candidates.add(stableCandidate(node.centeredPhase, spacingMm)));

  const reference = stableCandidate(referencePhaseMm, spacingMm);
  const valid = [...candidates].filter((phaseMm) => nodes.every((node) => {
    const resolved = countInheritedPositions(
      node.minMm,
      node.maxMm,
      spacingMm,
      phaseMm,
    );
    if (resolved.count !== node.targetCount) return false;
    if (resolved.count === 0) return true;
    const lastMm = resolved.firstMm + (resolved.count - 1) * spacingMm;
    // V3 physical slab membership is [min,max); never align a theoretical line onto max.
    return node.maxMm - lastMm > PHYSICAL_LINE_EPSILON_MM;
  }));
  valid.sort((left, right) =>
    circularDistance(left, reference, spacingMm)
    - circularDistance(right, reference, spacingMm)
    || left - right);
  return valid.length > 0 ? { phaseMm: valid[0] } : null;
}

function settingsForSlab(
  top: FloorTopState,
  slabId: string,
  direction: "x" | "y",
): { spacing: number } {
  const defaults = { ...top.defaults, ...(top.slabOverrides[slabId] ?? {}) };
  return { spacing: direction === "x" ? defaults.xSpacing : defaults.ySpacing };
}

function sortedIssue(
  code: string,
  message: string,
  objectIds: readonly string[],
): FloorTopIssue {
  const firstObjectId = objectIds[0];
  const remaining = [...new Set(objectIds.slice(1).filter((id) => id !== firstObjectId))].sort();
  return { code, message, objectIds: firstObjectId ? [firstObjectId, ...remaining] : undefined };
}

function sortIssues(issues: readonly FloorTopIssue[]): FloorTopIssue[] {
  return [...issues].sort((left, right) =>
    (left.objectIds?.[0] ?? "").localeCompare(right.objectIds?.[0] ?? "")
    || left.code.localeCompare(right.code)
    || (left.objectIds?.join("|") ?? "").localeCompare(right.objectIds?.join("|") ?? "")
    || left.message.localeCompare(right.message));
}

/** Build V3 alignment from pre-solved formal geometry without another topology solve. */
export function buildFloorTopAlignmentPlanV3(
  context: FloorRebarCalculationContextV3,
  top: FloorTopState,
  domains: readonly FloorRebarDomain[],
  throughPaths: readonly FloorTopThroughPath[],
  roleContext: FloorRebarRoleContext,
): FloorTopAlignmentV3Result {
  const enabledPaths = throughPaths.filter((path) => path.enabled).sort((left, right) =>
    left.id.localeCompare(right.id));
  if (enabledPaths.length === 0) {
    return {
      plan: { groups: [], phaseByDomainDirection: new Map(), errors: [], warnings: [] },
      geometries: [],
    };
  }

  const geometries = enabledPaths.map((path) =>
    resolveFloorTopThroughPathGeometryV3(context, path));
  const errors: FloorTopIssue[] = geometries.flatMap((geometry) => geometry.errors);
  const domainById = new Map(domains.map((domain) => [domain.id, domain]));
  const domainBySlabId = new Map<string, FloorRebarDomain>();
  domains.forEach((domain) => domain.slabIds.forEach((slabId) => domainBySlabId.set(slabId, domain)));
  const nodes = new Map<string, AlignmentNodeV3>();
  const adjacency = new Map<string, Set<string>>();
  const nodeKeysByPathId = new Map<string, string[]>();

  const ensureNode = (
    domainId: string,
    direction: "x" | "y",
    spacingMm: number,
  ): string | null => {
    const key = `${domainId}:${direction}`;
    const existing = nodes.get(key);
    if (existing) {
      return Math.abs(existing.spacingMm - spacingMm) <= ALIGNMENT_EPSILON_MM ? key : null;
    }
    const domain = domainById.get(domainId);
    if (!domain) return null;
    const minMm = direction === "x" ? domain.minY : domain.minX;
    const maxMm = direction === "x" ? domain.maxY : domain.maxX;
    const targetCount = countBars(maxMm - minMm, spacingMm, top.countMode);
    const centeredOffset = Math.max(0, ((maxMm - minMm) - (targetCount - 1) * spacingMm) / 2);
    nodes.set(key, {
      key,
      domainId,
      direction,
      domain,
      minMm,
      maxMm,
      spacingMm,
      targetCount,
      centeredPhase: normalizeRebarPhase(minMm + centeredOffset, spacingMm),
    });
    adjacency.set(key, new Set());
    return key;
  };

  enabledPaths.forEach((path, pathIndex) => {
    const geometry = geometries[pathIndex];
    if (geometry.errors.length > 0) return;
    const missingDomains = geometry.orderedSlabIds.filter((slabId) => !domainBySlabId.has(slabId));
    if (missingDomains.length > 0) {
      errors.push(sortedIssue(
        "through-alignment-domain-invalid",
        `“${path.name}”存在无法映射到正式钢筋Domain的板区。`,
        [path.id, ...missingDomains],
      ));
      return;
    }
    const orderedDomainIds = [...new Set(geometry.orderedSlabIds.map((slabId) =>
      domainBySlabId.get(slabId)!.id))];
    const spacingByDomain = orderedDomainIds.flatMap((domainId) => {
      const mainDirection = roleContext.mainDirectionByPhysicalDomain.get(domainId);
      const domain = domainById.get(domainId);
      if (!mainDirection || !domain) return [];
      return [{
        domainId,
        spacingMm: settingsForSlab(
          top,
          domain.slabIds[0],
          path.direction,
        ).spacing,
      }];
    });
    if (spacingByDomain.length !== orderedDomainIds.length) return;
    const referenceSpacing = spacingByDomain[0]?.spacingMm;
    if (referenceSpacing === undefined || spacingByDomain.some((item) =>
      Math.abs(item.spacingMm - referenceSpacing) > ALIGNMENT_EPSILON_MM)) {
      errors.push(sortedIssue(
        "through-alignment-spacing-conflict",
        `“${path.name}”参与Domain的通墙方向面筋间距不一致。`,
        [path.id, ...orderedDomainIds],
      ));
      return;
    }
    const keys: string[] = [];
    for (const domainId of orderedDomainIds) {
      const key = ensureNode(domainId, path.direction, referenceSpacing);
      if (!key) {
        errors.push(sortedIssue(
          "through-alignment-constraint-conflict",
          `“${path.name}”要求同一Domain方向同时继承不同间距。`,
          [path.id, domainId],
        ));
        return;
      }
      keys.push(key);
    }
    for (let index = 0; index < keys.length - 1; index += 1) {
      adjacency.get(keys[index])!.add(keys[index + 1]);
      adjacency.get(keys[index + 1])!.add(keys[index]);
    }
    nodeKeysByPathId.set(path.id, keys);
  });

  const components: string[][] = [];
  const visited = new Set<string>();
  [...nodes.keys()].sort().forEach((key) => {
    if (visited.has(key)) return;
    const component: string[] = [];
    const queue = [key];
    visited.add(key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      [...(adjacency.get(current) ?? [])].sort().forEach((next) => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push(next);
      });
    }
    components.push(component.sort());
  });

  const groups: FloorTopAlignmentPlan["groups"] = [];
  const phaseByDomainDirection = new Map<string, number>();
  components.forEach((component) => {
    const componentNodes = component.map((key) => nodes.get(key)!);
    const reference = [...componentNodes].sort((left, right) =>
      (right.maxMm - right.minMm) - (left.maxMm - left.minMm)
      || left.domainId.localeCompare(right.domainId))[0];
    const orderedForSolver = [
      reference,
      ...componentNodes.filter((node) => node !== reference).sort((left, right) =>
        left.domainId.localeCompare(right.domainId)),
    ];
    const solved = findSharedRebarPhase(orderedForSolver, reference.centeredPhase);
    const relatedPathIds = [...nodeKeysByPathId.entries()]
      .filter(([, keys]) => keys.some((key) => component.includes(key)))
      .map(([pathId]) => pathId)
      .sort();
    if (!solved) {
      errors.push(sortedIssue(
        "through-alignment-phase-unsatisfied",
        "参与通墙路径的Domain无法在保持当前根数算法的同时建立共享排筋相位。",
        relatedPathIds,
      ));
      return;
    }
    const domainIds = [...new Set(componentNodes.map((node) => node.domainId))].sort();
    groups.push({
      id: `top-alignment-group:${component.join("|")}`,
      direction: componentNodes[0].direction,
      spacingMm: componentNodes[0].spacingMm,
      domainIds,
      slabIds: [...new Set(componentNodes.flatMap((node) => node.domain.slabIds))].sort(),
      originMm: solved.phaseMm,
      mode: "shared-phase",
      throughPathIds: relatedPathIds,
    });
    componentNodes.forEach((node) => {
      phaseByDomainDirection.set(`${node.domainId}:${node.direction}`, solved.phaseMm);
    });
  });

  return {
    plan: {
      groups: groups.sort((left, right) => left.id.localeCompare(right.id)),
      phaseByDomainDirection,
      errors: sortIssues(errors),
      warnings: [],
    },
    geometries,
  };
}
