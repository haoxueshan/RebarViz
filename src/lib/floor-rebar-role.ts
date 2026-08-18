import { buildFloorRebarDomains, type FloorRebarDomain } from "./floor-rebar-domain";
import type { FloorPlanState } from "./floor-plan";
import type { FloorTopologySolution } from "./floor-topology-solver";

export type FloorBarRole = "main" | "secondary";
export type FloorMainDirection = "x" | "y";
export type FloorRebarRoleShape = "rectangle" | "square" | "irregular";

export type FloorRebarRoleDomain = FloorRebarDomain & {
  areaMm2: number;
  shape: FloorRebarRoleShape;
};

export type FloorRebarRoleState = {
  mainDirectionOverrides: Record<string, FloorMainDirection>;
};

export type ResolvedFloorRole = {
  mainDirection: FloorMainDirection | null;
  source: "auto" | "manual" | "required";
  shape: FloorRebarRoleShape;
};

export type FloorRoleDomainMapping = {
  roleDomain?: FloorRebarRoleDomain;
  errorCode?: "role-domain-mapping-invalid";
};

export type FloorRebarRoleIssue = {
  code: "rebar-main-direction-required" | "role-domain-mapping-invalid";
  message: string;
  objectIds?: string[];
};

export type FloorRebarRoleContext = {
  roleDomains: FloorRebarRoleDomain[];
  mainDirectionByPhysicalDomain: Map<string, FloorMainDirection>;
  errors: FloorRebarRoleIssue[];
};

export const DEFAULT_FLOOR_REBAR_ROLE_STATE: FloorRebarRoleState = {
  mainDirectionOverrides: {},
};

export const FLOOR_ROLE_SPAN_TOLERANCE_MM = 1;
export const ROLE_AREA_EPSILON_MM2 = 1;
export const ROLE_AREA_RELATIVE_EPSILON = 1e-9;

export function floorRoleDomainKey(slabIds: readonly string[]): string {
  return `role:${[...slabIds].sort().join("|")}`;
}

function rolePlan(plan: FloorPlanState): FloorPlanState {
  return {
    ...plan,
    openings: [],
    supportRules: plan.supportRules.filter((rule) => rule.target.kind === "slab-edge"),
  };
}

export function buildFloorRebarRoleDomains(
  plan: FloorPlanState,
  precomputedSolution?: FloorTopologySolution,
): FloorRebarRoleDomain[] {
  const withoutOpenings = rolePlan(plan);
  // Role plan没有Opening，因此各Slab完整面积之和就是参考域实际面积。
  return buildFloorRebarDomains(withoutOpenings, "role-cell-domain", precomputedSolution).map((domain) => {
    const areaMm2 = domain.slabIds.reduce((sum, slabId) => {
      const slab = withoutOpenings.slabs.find((item) => item.id === slabId);
      return sum + (slab ? slab.width * slab.height : 0);
    }, 0);
    const spanX = domain.maxX - domain.minX;
    const spanY = domain.maxY - domain.minY;
    const boundingArea = spanX * spanY;
    const areaTolerance = Math.max(ROLE_AREA_EPSILON_MM2, Math.abs(boundingArea) * ROLE_AREA_RELATIVE_EPSILON);
    const rectangular = Math.abs(areaMm2 - boundingArea) <= areaTolerance;
    const shape: FloorRebarRoleShape = !rectangular
      ? "irregular"
      : Math.abs(spanX - spanY) <= FLOOR_ROLE_SPAN_TOLERANCE_MM
        ? "square"
        : "rectangle";
    return {
      ...domain,
      id: floorRoleDomainKey(domain.slabIds),
      areaMm2,
      shape,
    };
  });
}

export function normalizeFloorRebarRoleState(
  value: unknown,
  validKeys?: ReadonlySet<string>,
): FloorRebarRoleState {
  const source = value && typeof value === "object"
    ? value as { mainDirectionOverrides?: unknown }
    : {};
  const overrides: Record<string, FloorMainDirection> = {};
  if (source.mainDirectionOverrides && typeof source.mainDirectionOverrides === "object") {
    Object.entries(source.mainDirectionOverrides).forEach(([key, direction]) => {
      if ((direction === "x" || direction === "y") && (!validKeys || validKeys.has(key))) {
        overrides[key] = direction;
      }
    });
  }
  return { mainDirectionOverrides: overrides };
}

export function resolveFloorRoleDomainMainDirection(
  domain: FloorRebarRoleDomain,
  state: FloorRebarRoleState,
): ResolvedFloorRole {
  if (domain.shape === "rectangle") {
    const spanX = domain.maxX - domain.minX;
    const spanY = domain.maxY - domain.minY;
    return {
      mainDirection: spanX < spanY ? "x" : "y",
      source: "auto",
      shape: domain.shape,
    };
  }
  const manual = state.mainDirectionOverrides[domain.id];
  if (manual === "x" || manual === "y") {
    return { mainDirection: manual, source: "manual", shape: domain.shape };
  }
  return { mainDirection: null, source: "required", shape: domain.shape };
}

export function resolveRoleDomainForPhysicalDomain(
  physicalDomain: FloorRebarDomain,
  roleDomains: readonly FloorRebarRoleDomain[],
): FloorRoleDomainMapping {
  const physicalSlabs = new Set(physicalDomain.slabIds);
  const matches = roleDomains.filter((domain) =>
    [...physicalSlabs].every((slabId) => domain.slabIds.includes(slabId)));
  if (matches.length !== 1) return { errorCode: "role-domain-mapping-invalid" };
  return { roleDomain: matches[0] };
}

export function resolveFloorRebarRoleContext(
  plan: FloorPlanState,
  physicalDomains: readonly FloorRebarDomain[],
  state: FloorRebarRoleState,
  precomputedSolution?: FloorTopologySolution,
): FloorRebarRoleContext {
  const roleDomains = buildFloorRebarRoleDomains(plan, precomputedSolution);
  const errors: FloorRebarRoleIssue[] = [];
  const resolvedByRoleId = new Map<string, ResolvedFloorRole>();
  roleDomains.forEach((domain) => {
    const resolved = resolveFloorRoleDomainMainDirection(domain, state);
    resolvedByRoleId.set(domain.id, resolved);
    if (!resolved.mainDirection) {
      errors.push({
        code: "rebar-main-direction-required",
        message: domain.shape === "square"
          ? "当前连续板区域两个方向净跨相同，请人工选择主筋方向后再生成料单。"
          : "当前连续板区域为非矩形形状，系统无法可靠自动判断主副筋，请人工选择主筋方向。",
        objectIds: domain.slabIds,
      });
    }
  });

  const mainDirectionByPhysicalDomain = new Map<string, FloorMainDirection>();
  physicalDomains.forEach((physicalDomain) => {
    const mapping = resolveRoleDomainForPhysicalDomain(physicalDomain, roleDomains);
    const mainDirection = mapping.roleDomain
      ? resolvedByRoleId.get(mapping.roleDomain.id)?.mainDirection
      : null;
    if (!mapping.roleDomain) {
      errors.push({
        code: "role-domain-mapping-invalid",
        message: "实际钢筋区域无法唯一映射到主副筋参考区域，已停止正式计算。",
        objectIds: physicalDomain.slabIds,
      });
    } else if (mainDirection) {
      mainDirectionByPhysicalDomain.set(physicalDomain.id, mainDirection);
    }
  });
  return { roleDomains, mainDirectionByPhysicalDomain, errors };
}

export function resolveFloorBarRole(
  mainDirection: FloorMainDirection,
  direction: "x" | "y",
): FloorBarRole {
  return direction === mainDirection ? "main" : "secondary";
}

export function floorBarRoleLabel(role: FloorBarRole): string {
  return role === "main" ? "主筋" : "副筋";
}
