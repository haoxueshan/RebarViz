import {
  buildFloorBottomRebarDomains,
  buildRawFloorLineIntervals,
  LENGTH_GROUP_EPSILON_MM,
  mergeFloorLineIntervalsBySupport,
  resolveFloorEndpointBoundary,
  stableLengthKey,
  type FloorRebarDomain,
} from "./floor-bottom-calculator";
import {
  buildFloorAtomicBoundarySegments,
  buildFloorTopologyCells,
  validateFloorPlanV2,
  type FloorAtomicBoundarySegment,
  type FloorPlanState,
} from "./floor-plan";
import type { FloorBarLine, FloorBarPiece } from "./floor-rebar-types";
import {
  DEFAULT_FLOOR_REBAR_ROLE_STATE,
  resolveFloorBarRole,
  resolveFloorRebarRoleContext,
  type FloorBarRole,
  type FloorMainDirection,
  type FloorRebarRoleDomain,
  type FloorRebarRoleState,
} from "./floor-rebar-role";
import {
  countBars,
  directionLabel,
  theoreticalUnitWeight,
  type CountMode,
  type TopExtraMode,
} from "./slab-calculator";

export type FloorTopBarSettings = {
  diameter: number;
  spacing: number;
  extraMode: TopExtraMode;
};

export type FloorTopDefaults = {
  mainDiameter: number;
  secondaryDiameter: number;
  xSpacing: number;
  ySpacing: number;
  xExtraMode: TopExtraMode;
  yExtraMode: TopExtraMode;
};

export type FloorTopState = {
  countMode: CountMode;
  topAnchorExtra: number;
  defaults: FloorTopDefaults;
  slabOverrides: Record<string, Partial<FloorTopDefaults>>;
};

export type FloorTopBomGroup = {
  id: string;
  domainId: string;
  slabIds: string[];
  direction: "x" | "y";
  role: FloorBarRole;
  diameter: number;
  spacing: number;
  extraMode: TopExtraMode;
  singleLengthMm: number;
  count: number;
  totalLengthM: number;
  unitWeightKgM: number;
  weightKg: number;
  pieceIds: string[];
};

export type FloorTopIssue = {
  code: string;
  message: string;
  objectIds?: string[];
};

export type FloorTopCalculation = {
  domains: FloorRebarDomain[];
  roleDomains: FloorRebarRoleDomain[];
  lines: FloorBarLine[];
  pieces: FloorBarPiece[];
  groups: FloorTopBomGroup[];
  totalBarLines: number;
  totalPieces: number;
  totalLengthM: number;
  totalWeightKg: number | null;
  errors: FloorTopIssue[];
  warnings: FloorTopIssue[];
  isValid: boolean;
};

export const DEFAULT_FLOOR_TOP_STATE: FloorTopState = {
  countMode: "project",
  topAnchorExtra: 250,
  defaults: {
    mainDiameter: 10,
    secondaryDiameter: 10,
    xSpacing: 200,
    ySpacing: 200,
    xExtraMode: "both",
    yExtraMode: "both",
  },
  slabOverrides: {},
};

const COUNT_MODES: readonly CountMode[] = ["project", "round", "floor"];
const EXTRA_MODES: readonly TopExtraMode[] = ["start", "end", "both"];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeDefaults(
  value: unknown,
  fallback: FloorTopDefaults,
): FloorTopDefaults {
  const source = isObject(value) ? value : {};
  const legacyX = isObject(source.x) ? source.x : {};
  const legacyY = isObject(source.y) ? source.y : {};
  return {
    mainDiameter: finiteNumber(source.mainDiameter, finiteNumber(legacyX.diameter, fallback.mainDiameter)),
    secondaryDiameter: finiteNumber(source.secondaryDiameter, finiteNumber(legacyY.diameter, fallback.secondaryDiameter)),
    xSpacing: finiteNumber(source.xSpacing, finiteNumber(legacyX.spacing, fallback.xSpacing)),
    ySpacing: finiteNumber(source.ySpacing, finiteNumber(legacyY.spacing, fallback.ySpacing)),
    xExtraMode: EXTRA_MODES.includes((source.xExtraMode ?? legacyX.extraMode) as TopExtraMode)
      ? (source.xExtraMode ?? legacyX.extraMode) as TopExtraMode
      : fallback.xExtraMode,
    yExtraMode: EXTRA_MODES.includes((source.yExtraMode ?? legacyY.extraMode) as TopExtraMode)
      ? (source.yExtraMode ?? legacyY.extraMode) as TopExtraMode
      : fallback.yExtraMode,
  };
}

function normalizeOverride(value: unknown): Partial<FloorTopDefaults> {
  if (!isObject(value)) return {};
  const legacyX = isObject(value.x) ? value.x : {};
  const legacyY = isObject(value.y) ? value.y : {};
  const result: Partial<FloorTopDefaults> = {};
  const assignNumber = (key: "mainDiameter" | "secondaryDiameter" | "xSpacing" | "ySpacing", candidate: unknown) => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) result[key] = candidate;
  };
  const assignMode = (key: "xExtraMode" | "yExtraMode", candidate: unknown) => {
    if (EXTRA_MODES.includes(candidate as TopExtraMode)) result[key] = candidate as TopExtraMode;
  };
  assignNumber("mainDiameter", value.mainDiameter ?? legacyX.diameter);
  assignNumber("secondaryDiameter", value.secondaryDiameter ?? legacyY.diameter);
  assignNumber("xSpacing", value.xSpacing ?? legacyX.spacing);
  assignNumber("ySpacing", value.ySpacing ?? legacyY.spacing);
  assignMode("xExtraMode", value.xExtraMode ?? legacyX.extraMode);
  assignMode("yExtraMode", value.yExtraMode ?? legacyY.extraMode);
  return result;
}

export function normalizeFloorTopState(
  value: unknown,
  slabIds?: ReadonlySet<string>,
): FloorTopState {
  if (!isObject(value)) return structuredClone(DEFAULT_FLOOR_TOP_STATE);
  const defaults = normalizeDefaults(value.defaults, DEFAULT_FLOOR_TOP_STATE.defaults);
  const slabOverrides: FloorTopState["slabOverrides"] = {};
  if (isObject(value.slabOverrides)) {
    Object.entries(value.slabOverrides).forEach(([slabId, override]) => {
      if (slabIds && !slabIds.has(slabId)) return;
      const next = normalizeOverride(override);
      if (Object.keys(next).length > 0) slabOverrides[slabId] = next;
    });
  }
  return {
    countMode: COUNT_MODES.includes(value.countMode as CountMode)
      ? value.countMode as CountMode
      : DEFAULT_FLOOR_TOP_STATE.countMode,
    topAnchorExtra: finiteNumber(
      value.topAnchorExtra,
      DEFAULT_FLOOR_TOP_STATE.topAnchorExtra,
    ),
    defaults,
    slabOverrides,
  };
}

export function resolveFloorTopDefaults(
  state: FloorTopState,
  slabId: string,
): FloorTopDefaults {
  return { ...state.defaults, ...(state.slabOverrides[slabId] ?? {}) };
}

export function resolveFloorTopDirectionalSettings(
  state: FloorTopState,
  slabId: string,
  direction: "x" | "y",
  mainDirection: FloorMainDirection,
): FloorTopBarSettings {
  const defaults = resolveFloorTopDefaults(state, slabId);
  const role = resolveFloorBarRole(mainDirection, direction);
  return {
    diameter: role === "main" ? defaults.mainDiameter : defaults.secondaryDiameter,
    spacing: direction === "x" ? defaults.xSpacing : defaults.ySpacing,
    extraMode: direction === "x" ? defaults.xExtraMode : defaults.yExtraMode,
  };
}

export function shouldApplyTopExtra(
  extraMode: TopExtraMode,
  endpoint: "start" | "end",
): boolean {
  return extraMode === "both" || extraMode === endpoint;
}

export type FloorTopEndpointAnchor = {
  anchorMm: number | null;
  extraApplied: boolean;
};

export function resolveFloorTopEndpointAnchor(
  segment: Pick<FloorAtomicBoundarySegment, "support" | "thicknessMm">,
  endpoint: "start" | "end",
  extraMode: TopExtraMode,
  topAnchorExtra: number,
): FloorTopEndpointAnchor {
  if (segment.support === "outer-wall") {
    return { anchorMm: segment.thicknessMm, extraApplied: false };
  }
  if (segment.support === "inner-wall") {
    const extraApplied = shouldApplyTopExtra(extraMode, endpoint);
    return {
      anchorMm: segment.thicknessMm + (extraApplied ? topAnchorExtra : 0),
      extraApplied,
    };
  }
  if (segment.support === "opening-cut") {
    return { anchorMm: 0, extraApplied: false };
  }
  return { anchorMm: null, extraApplied: false };
}

function sameSettings(
  left: FloorTopBarSettings,
  right: FloorTopBarSettings,
): boolean {
  return left.diameter === right.diameter &&
    left.spacing === right.spacing &&
    left.extraMode === right.extraMode;
}

function validateTopState(
  plan: FloorPlanState,
  top: FloorTopState,
  domains: readonly FloorRebarDomain[],
  mainDirectionByPhysicalDomain: ReadonlyMap<string, FloorMainDirection>,
): FloorTopIssue[] {
  const errors: FloorTopIssue[] = [];
  if (!COUNT_MODES.includes(top.countMode)) {
    errors.push({ code: "top-count-mode-invalid", message: "面筋根数算法无效。" });
  }
  if (!Number.isFinite(top.topAnchorExtra) || top.topAnchorExtra < 0) {
    errors.push({
      code: "top-anchor-extra-invalid",
      message: "面筋内墙端增加值必须是大于或等于0的有限数。",
    });
  }
  const validateDefaults = (
    settings: Partial<FloorTopDefaults>,
    prefix: string,
    objectIds?: string[],
  ) => {
    (["mainDiameter", "secondaryDiameter"] as const).forEach((key) => {
      const value = settings[key];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        errors.push({
          code: "top-diameter-invalid",
          message: `${prefix}${key === "mainDiameter" ? "主筋" : "副筋"}直径必须大于0。`,
          objectIds,
        });
      }
    });
    (["xSpacing", "ySpacing"] as const).forEach((key) => {
      const value = settings[key];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        errors.push({
          code: "top-spacing-invalid",
          message: `${prefix}${key === "xSpacing" ? "东西向" : "南北向"}间距必须大于0。`,
          objectIds,
        });
      }
    });
    (["xExtraMode", "yExtraMode"] as const).forEach((key) => {
      const value = settings[key];
      if (value !== undefined && !EXTRA_MODES.includes(value)) {
        errors.push({
          code: "top-extra-mode-invalid",
          message: `${prefix}${key === "xExtraMode" ? "东西向" : "南北向"}增加位置无效。`,
          objectIds,
        });
      }
    });
  };
  validateDefaults(top.defaults, "整层面筋");
  plan.slabs.forEach((slab) => {
    const override = top.slabOverrides[slab.id];
    if (override) validateDefaults(override, `“${slab.name}”面筋`, [slab.id]);
  });
  domains.forEach((domain) => {
    const mainDirection = mainDirectionByPhysicalDomain.get(domain.id);
    if (!mainDirection) return;
    (["x", "y"] as const).forEach((direction) => {
      const settings = domain.slabIds.map((slabId) =>
        resolveFloorTopDirectionalSettings(top, slabId, direction, mainDirection));
      if (settings.length <= 1 || settings.every((item) => sameSettings(item, settings[0]))) {
        return;
      }
      const details = domain.slabIds.map((slabId) => {
        const slab = plan.slabs.find((item) => item.id === slabId);
        const item = resolveFloorTopDirectionalSettings(top, slabId, direction, mainDirection);
        return `${slab?.name ?? slabId} Φ${item.diameter}@${item.spacing} ${item.extraMode}`;
      });
      errors.push({
        code: "top-continuous-settings-conflict",
        message: `连续楼板区域中的${directionLabel(direction)}面筋规格或增加位置不一致（${details.join("；")}），请统一设置，或将对应边改为内墙分界。`,
        objectIds: domain.slabIds,
      });
    });
  });
  return errors;
}

function emptyCalculation(
  domains: FloorRebarDomain[],
  roleDomains: FloorRebarRoleDomain[],
  errors: FloorTopIssue[],
  warnings: FloorTopIssue[],
): FloorTopCalculation {
  return {
    domains,
    roleDomains,
    lines: [],
    pieces: [],
    groups: [],
    totalBarLines: 0,
    totalPieces: 0,
    totalLengthM: 0,
    totalWeightKg: null,
    errors,
    warnings,
    isValid: false,
  };
}

function mapCoreIssue(issue: FloorTopIssue): FloorTopIssue {
  return {
    ...issue,
    code: issue.code.replace(/^bottom-/, "top-"),
    message: issue.message.replaceAll("地筋", "面筋"),
  };
}

export function buildFloorTopBomGroups(
  pieces: readonly FloorBarPiece[],
  settingsByDomainDirection: ReadonlyMap<string, FloorTopBarSettings>,
): FloorTopBomGroup[] {
  const grouped = new Map<string, FloorTopBomGroup>();
  pieces.forEach((piece) => {
    const settings = settingsByDomainDirection.get(`${piece.domainId}:${piece.direction}`);
    if (!settings) return;
    const key = [
      piece.domainId,
      piece.direction,
      piece.role,
      piece.diameter,
      piece.spacing,
      settings.extraMode,
      stableLengthKey(piece.singleLengthMm),
    ].join(":");
    const unitWeightKgM = theoreticalUnitWeight(piece.diameter);
    const current = grouped.get(key) ?? {
      id: `top-bom:${key}`,
      domainId: piece.domainId,
      slabIds: [...piece.slabIds],
      direction: piece.direction,
      role: piece.role,
      diameter: piece.diameter,
      spacing: piece.spacing,
      extraMode: settings.extraMode,
      singleLengthMm: piece.singleLengthMm,
      count: 0,
      totalLengthM: 0,
      unitWeightKgM,
      weightKg: 0,
      pieceIds: [],
    };
    if (Math.abs(piece.singleLengthMm - current.singleLengthMm) > LENGTH_GROUP_EPSILON_MM) {
      throw new Error("Floor Top BOM长度分组超出容差。");
    }
    current.count += 1;
    current.totalLengthM += piece.singleLengthMm / 1000;
    current.weightKg += (piece.singleLengthMm / 1000) * unitWeightKgM;
    current.pieceIds.push(piece.id);
    current.slabIds = [...new Set([...current.slabIds, ...piece.slabIds])].sort();
    grouped.set(key, current);
  });
  return [...grouped.values()].sort((left, right) =>
    left.domainId.localeCompare(right.domainId) ||
    left.direction.localeCompare(right.direction) ||
    left.singleLengthMm - right.singleLengthMm);
}

export function calculateFloorTopRebar(
  plan: FloorPlanState,
  input: FloorTopState,
  roleState: FloorRebarRoleState = DEFAULT_FLOOR_REBAR_ROLE_STATE,
  roleReviewRequired = false,
): FloorTopCalculation {
  // normalize仅用于存储迁移；正式计算保留NaN、非法枚举等错误并阻止料单。
  const top = input;
  const geometryIssues = validateFloorPlanV2(plan);
  const warnings: FloorTopIssue[] = geometryIssues
    .filter((issue) => issue.level === "warning")
    .map(({ code, message, objectIds }) => ({ code, message, objectIds }));
  const geometryErrors: FloorTopIssue[] = geometryIssues
    .filter((issue) => issue.level === "error")
    .map(({ code, message, objectIds }) => ({ code, message, objectIds }));
  const domains = buildFloorBottomRebarDomains(plan);
  const roleContext = resolveFloorRebarRoleContext(plan, domains, roleState);
  const reviewErrors: FloorTopIssue[] = roleReviewRequired ? [{
    code: "top-role-review-required",
    message: "旧版本的东西/南北向直径已迁移为主/副筋语义，请确认当前面筋主筋、副筋直径后再生成正式料单。",
  }] : [];
  const errors = [
    ...geometryErrors,
    ...roleContext.errors,
    ...reviewErrors,
    ...validateTopState(plan, top, domains, roleContext.mainDirectionByPhysicalDomain),
  ];
  if (errors.length > 0) return emptyCalculation(domains, roleContext.roleDomains, errors, warnings);

  const allCells = buildFloorTopologyCells(plan);
  const cellsById = new Map(allCells.map((cell) => [cell.id, cell]));
  const atomic = buildFloorAtomicBoundarySegments(plan);
  const lines: FloorBarLine[] = [];
  const pieces: FloorBarPiece[] = [];
  const calculationErrors: FloorTopIssue[] = [];
  const settingsByDomainDirection = new Map<string, FloorTopBarSettings>();

  domains.forEach((domain) => {
    const mainDirection = roleContext.mainDirectionByPhysicalDomain.get(domain.id);
    if (!mainDirection) return;
    const domainCells = domain.cellIds.flatMap((id) => {
      const cell = cellsById.get(id);
      return cell ? [cell] : [];
    });
    (["x", "y"] as const).forEach((direction) => {
      const role = resolveFloorBarRole(mainDirection, direction);
      const settings = resolveFloorTopDirectionalSettings(
        top,
        domain.slabIds[0],
        direction,
        mainDirection,
      );
      settingsByDomainDirection.set(`${domain.id}:${direction}`, settings);
      const perpendicularStart = direction === "x" ? domain.minY : domain.minX;
      const perpendicularEnd = direction === "x" ? domain.maxY : domain.maxX;
      const count = countBars(
        perpendicularEnd - perpendicularStart,
        settings.spacing,
        top.countMode,
      );
      for (let index = 0; index < count; index += 1) {
        const positionMm = perpendicularStart +
          ((index + 0.5) * (perpendicularEnd - perpendicularStart)) / count;
        const line: FloorBarLine = {
          id: `top:${domain.id}:${direction}:line:${index + 1}`,
          domainId: domain.id,
          slabIds: [...domain.slabIds],
          layer: "top",
          direction,
          role,
          positionMm,
        };
        lines.push(line);
        const intervalResult = mergeFloorLineIntervalsBySupport(
          direction,
          positionMm,
          buildRawFloorLineIntervals(direction, positionMm, domainCells),
          atomic,
        );
        calculationErrors.push(...intervalResult.errors.map((error) => ({
          ...mapCoreIssue(error),
          objectIds: [line.id],
        })));
        intervalResult.intervals.forEach((interval, pieceIndex) => {
          const startBoundaryResult = resolveFloorEndpointBoundary(
            atomic,
            direction,
            interval.start,
            positionMm,
            interval.slabIds,
          );
          const endBoundaryResult = resolveFloorEndpointBoundary(
            atomic,
            direction,
            interval.end,
            positionMm,
            interval.slabIds,
          );
          if (!startBoundaryResult.segment || !endBoundaryResult.segment) {
            const ambiguous = startBoundaryResult.errorCode === "bottom-endpoint-boundary-ambiguous" ||
              endBoundaryResult.errorCode === "bottom-endpoint-boundary-ambiguous";
            calculationErrors.push({
              code: ambiguous ? "top-endpoint-boundary-ambiguous" : "top-endpoint-boundary-missing",
              message: ambiguous
                ? `面筋线“${line.id}”的端点同时命中不同支承类型，无法确定正式锚固。`
                : `面筋线“${line.id}”无法解析完整的原子边界端点。`,
              objectIds: [
                line.id,
                ...startBoundaryResult.candidateIds,
                ...endBoundaryResult.candidateIds,
              ],
            });
            return;
          }
          const startAnchor = resolveFloorTopEndpointAnchor(
            startBoundaryResult.segment,
            "start",
            settings.extraMode,
            top.topAnchorExtra,
          );
          const endAnchor = resolveFloorTopEndpointAnchor(
            endBoundaryResult.segment,
            "end",
            settings.extraMode,
            top.topAnchorExtra,
          );
          if (startAnchor.anchorMm === null || endAnchor.anchorMm === null) {
            calculationErrors.push({
              code: "top-continuous-endpoint",
              message: `面筋线“${line.id}”在连续板边结束，表示Domain或区间合并不完整。`,
              objectIds: [
                line.id,
                startBoundaryResult.segment.id,
                endBoundaryResult.segment.id,
              ],
            });
            return;
          }
          const netLengthMm = interval.end - interval.start;
          pieces.push({
            id: `${line.id}:piece:${pieceIndex + 1}:${interval.start}-${interval.end}`,
            lineId: line.id,
            domainId: domain.id,
            slabIds: [...interval.slabIds].sort(),
            layer: "top",
            direction,
            role: line.role,
            diameter: settings.diameter,
            spacing: settings.spacing,
            runStartMm: interval.start,
            runEndMm: interval.end,
            netLengthMm,
            startBoundaryId: startBoundaryResult.segment.id,
            endBoundaryId: endBoundaryResult.segment.id,
            startSupport: startBoundaryResult.segment.support,
            endSupport: endBoundaryResult.segment.support,
            startAnchorMm: startAnchor.anchorMm,
            endAnchorMm: endAnchor.anchorMm,
            startExtraApplied: startAnchor.extraApplied,
            endExtraApplied: endAnchor.extraApplied,
            topExtraValueMm: top.topAnchorExtra,
            singleLengthMm: netLengthMm + startAnchor.anchorMm + endAnchor.anchorMm,
            source: "normal",
          });
        });
      }
    });
  });
  if (calculationErrors.length > 0) {
    return emptyCalculation(domains, roleContext.roleDomains, calculationErrors, warnings);
  }

  const groups = buildFloorTopBomGroups(pieces, settingsByDomainDirection);
  const totalLengthM = pieces.reduce(
    (sum, piece) => sum + piece.singleLengthMm / 1000,
    0,
  );
  const totalWeightKg = pieces.reduce(
    (sum, piece) => sum +
      (piece.singleLengthMm / 1000) * theoreticalUnitWeight(piece.diameter),
    0,
  );
  return {
    domains,
    roleDomains: roleContext.roleDomains,
    lines,
    pieces,
    groups,
    totalBarLines: lines.length,
    totalPieces: pieces.length,
    totalLengthM,
    totalWeightKg,
    errors: [],
    warnings,
    isValid: true,
  };
}
