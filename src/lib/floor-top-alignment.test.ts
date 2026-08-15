import { describe, expect, it } from "vitest";
import type {
  FloorOpening,
  FloorPlanState,
  FloorSlab,
  FloorSupportRule,
} from "./floor-plan";
import {
  buildFloorTopAlignmentPlan,
  countInheritedPositions,
  normalizeRebarPhase,
} from "./floor-top-alignment";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
  type FloorTopState,
  type FloorTopThroughPath,
} from "./floor-top-calculator";
import type { FloorRebarRoleState } from "./floor-rebar-role";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
}

function plan(
  slabs: FloorSlab[],
  openings: FloorOpening[] = [],
  supportRules: FloorSupportRule[] = [],
): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings,
    supportRules,
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function top(throughPaths: FloorTopThroughPath[], patch: Partial<FloorTopState> = {}): FloorTopState {
  return { ...structuredClone(DEFAULT_FLOOR_TOP_STATE), ...patch, throughPaths };
}

function path(id: string, slabIds: string[], direction: "x" | "y" = "y", band: [number, number] = [0, 4200], enabled = true): FloorTopThroughPath {
  return {
    id,
    name: `通墙${id}`,
    direction,
    slabIds,
    bandStartMm: band[0],
    bandEndMm: band[1],
    enabled,
  };
}

function roleState(overrides: Record<string, "x" | "y"> = {}): FloorRebarRoleState {
  return { mainDirectionOverrides: overrides };
}

describe("Floor Top Alignment相位helper", () => {
  it("normalizeRebarPhase恒落在0<=phase<spacing", () => {
    expect(normalizeRebarPhase(6150, 200)).toBe(150);
    expect(normalizeRebarPhase(5950, 200)).toBe(150);
    expect(normalizeRebarPhase(0, 200)).toBe(0);
    expect(normalizeRebarPhase(200, 200)).toBe(0);
    expect(normalizeRebarPhase(-50, 200)).toBe(150);
  });

  it("countInheritedPositions给出first与根数", () => {
    expect(countInheritedPositions(0, 3600, 200, 100)).toEqual({ firstMm: 100, count: 18 });
    expect(countInheritedPositions(600, 3950, 200, 75)).toEqual({ firstMm: 675, count: 17 });
    expect(countInheritedPositions(90, 4190, 200, 5)).toEqual({ firstMm: 205, count: 20 });
  });
});

describe("Floor Top Alignment跨Domain共享相位", () => {
  it("两个Domain@200统一共享phase并生成一致Band位置", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
    ]);
    const alignment = buildFloorTopAlignmentPlan(
      state,
      top([path("01", ["a", "b"], "y", [0, 3350])]),
      calculateFloorTopRebar(state, top([])).domains,
      [path("01", ["a", "b"], "y", [0, 3350])],
      roleState({ "role:a": "x" }),
    );
    expect(alignment.errors).toEqual([]);
    expect(alignment.groups).toHaveLength(1);
    expect(alignment.groups[0]).toMatchObject({
      direction: "y",
      spacingMm: 200,
      originMm: 100,
      mode: "shared-phase",
    });
    expect(alignment.phaseByDomainDirection.size).toBe(2);
    expect([...alignment.phaseByDomainDirection.values()]).toEqual([100, 100]);

    const calculation = calculateFloorTopRebar(
      state,
      top([path("01", ["a", "b"], "y", [0, 3350])]),
      roleState({ "role:a": "x" }),
    );
    expect(calculation.errors.map((item) => item.code)).not.toContain("through-path-line-phase-conflict");
    expect(calculation.throughPieceCount).toBe(17);
    expect(calculation.resolvedThroughPaths[0]?.linePositionsMm[0]).toBe(100);
    expect(calculation.resolvedThroughPaths[0]?.linePositionsMm.at(-1)).toBe(3300);
    // Normal被Claim替换，不重复存在。
    const claimedPositionLines = calculation.lines.filter((line) => line.positionMm === 100 && line.direction === "y" && line.slabIds.includes("a"));
    expect(claimedPositionLines).toHaveLength(1);
    expect(claimedPositionLines[0].source).toBe("through");
  });

  it("整个Domain根数可不同，只要Band内完全一致", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 1550, 4000),
    ]);
    const calculation = calculateFloorTopRebar(
      state,
      top([path("01", ["a", "b"], "y", [0, 1550])]),
      roleState({ "role:a": "x" }),
    );
    expect(calculation.errors.map((item) => item.code)).not.toContain("through-path-line-phase-conflict");
    const normalOnly = calculateFloorTopRebar(state, top([]), roleState({ "role:a": "x" }));
    const aDomain = normalOnly.domains.find((domain) => domain.slabIds.includes("a"))!;
    const bDomain = normalOnly.domains.find((domain) => domain.slabIds.includes("b"))!;
    expect(normalOnly.lines.filter((line) => line.domainId === aDomain.id && line.direction === "y")).toHaveLength(18);
    expect(normalOnly.lines.filter((line) => line.domainId === bDomain.id && line.direction === "y")).toHaveLength(8);
    expect(calculation.resolvedThroughPaths[0]?.linePositionsMm).toHaveLength(8);
  });

  it("Spacing冲突报through-alignment-spacing-conflict", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
    ]);
    const input = top([path("01", ["a", "b"], "y", [0, 3350])]);
    input.slabOverrides.b = { ySpacing: 150 };
    const calculation = calculateFloorTopRebar(state, input, roleState({ "role:a": "x" }));
    expect(calculation.errors.map((item) => item.code)).toContain("through-alignment-spacing-conflict");
  });

  it("Diameter冲突不影响Alignment，但Through正式验证仍失败", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
    ]);
    const input = top([path("01", ["a", "b"], "y", [0, 3350])]);
    input.slabOverrides.b = { secondaryDiameter: 12 };
    const calculation = calculateFloorTopRebar(state, input, roleState({ "role:a": "x" }));
    expect(calculation.errors.map((item) => item.code)).not.toContain("through-alignment-spacing-conflict");
    expect(calculation.errors.map((item) => item.code)).toContain("through-path-settings-conflict");
  });

  it("关闭Through后恢复domain-centered", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
    ]);
    const alignment = buildFloorTopAlignmentPlan(
      state,
      top([path("01", ["a", "b"], "y", [0, 3350], false)]),
      calculateFloorTopRebar(state, top([])).domains,
      [path("01", ["a", "b"], "y", [0, 3350], false)],
      roleState({ "role:a": "x" }),
    );
    expect(alignment.groups).toEqual([]);
    expect(alignment.phaseByDomainDirection.size).toBe(0);
  });

  it("三个Domain两条Path合并为一个Alignment Group", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
      slab("c", 0, 7600, 3400, 4000),
    ]);
    const paths = [
      path("01", ["a", "b"], "y", [0, 3350]),
      path("02", ["b", "c"], "y", [0, 3350]),
    ];
    const alignment = buildFloorTopAlignmentPlan(
      state,
      top(paths),
      calculateFloorTopRebar(state, top([])).domains,
      paths,
      roleState({ "role:a": "x" }),
    );
    expect(alignment.errors).toEqual([]);
    expect(alignment.groups).toHaveLength(1);
    expect(alignment.groups[0].domainIds).toHaveLength(3);
  });

  it("两个独立Through组形成两个Group", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
      slab("c", 5000, 0, 3600, 3600),
      slab("d", 5000, 3600, 3400, 4000),
    ]);
    const paths = [
      path("01", ["a", "b"], "y", [0, 3350]),
      path("02", ["c", "d"], "y", [5000, 8350]),
    ];
    const alignment = buildFloorTopAlignmentPlan(
      state,
      top(paths),
      calculateFloorTopRebar(state, top([])).domains,
      paths,
      roleState({ "role:a": "x", "role:c": "x" }),
    );
    expect(alignment.groups).toHaveLength(2);
  });

  it("X/Y方向Phase完全独立", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 0, 3600, 3350, 4000),
      slab("c", 3600, 0, 3600, 3600),
    ]);
    const paths = [
      path("01", ["a", "b"], "y", [0, 3350]),
      path("02", ["a", "c"], "x", [0, 3600]),
    ];
    const alignment = buildFloorTopAlignmentPlan(
      state,
      top(paths),
      calculateFloorTopRebar(state, top([]), roleState({ "role:a": "x" })).domains,
      paths,
      roleState({ "role:a": "x", "role:c": "x" }),
    );
    expect(alignment.errors).toEqual([]);
    expect(alignment.groups).toHaveLength(2);
    const keys = [...alignment.phaseByDomainDirection.keys()];
    expect(keys.some((key) => key.endsWith(":x"))).toBe(true);
    expect(keys.some((key) => key.endsWith(":y"))).toBe(true);
  });

  it("L/T型板区尺寸不同不产生phase conflict", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 0, 3600, 3350, 3000),
    ]);
    const calculation = calculateFloorTopRebar(
      state,
      top([path("01", ["a", "b"], "y", [0, 3350])]),
    );
    expect(calculation.errors.map((item) => item.code)).not.toContain("through-path-line-phase-conflict");
    expect(calculation.throughPieceCount).toBeGreaterThan(0);
  });

  it("无可满足相位时报through-alignment-phase-unsatisfied", () => {
    const state = plan([
      slab("a", 90, 0, 4100, 3600),
      slab("b", 0, 3600, 4010, 4000),
    ]);
    const calculation = calculateFloorTopRebar(
      state,
      top([path("01", ["a", "b"], "y", [90, 4010])]),
    );
    expect(calculation.errors.map((item) => item.code)).toContain("through-alignment-phase-unsatisfied");
    expect(calculation.isValid).toBe(false);
  });
});
