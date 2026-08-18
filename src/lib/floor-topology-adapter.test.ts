import { describe, expect, it } from "vitest";
import {
  GOLDEN_MENG,
  goldenMengLegacyV2Plan,
} from "./__fixtures__/floor-topology-golden-meng";
import {
  buildCanonicalFloorAtomicBoundarySegments,
  buildCanonicalFloorDisplayBoundarySegments,
  buildCanonicalFloorSlabAdjacency,
  findCanonicalFloorComponents,
  validateFloorPlanState,
  validateFloorPlanV3,
} from "./floor-topology-adapter";
import { buildFloorAssembly } from "./floor-assembly";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "./floor-bottom-calculator";
import {
  buildFloorPhysicalLayout,
} from "./floor-physical-layout";
import { validateFloorPlanV2 } from "./floor-plan";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
} from "./floor-top-calculator";
import { resolveFloorTopThroughPathGeometry } from "./floor-top-through";
import { subtractFloorRanges } from "./floor-topology";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";
import {
  buildFloorTopologyBoundarySegmentsV3,
  buildFloorTopologyExteriorRanges,
  solveFloorTopology,
} from "./floor-topology-solver";
import type { FloorEdgeConnection } from "./floor-topology";
import type { FloorPlanState } from "./floor-plan";
import { createFloorDraftRecord, parseFloorDraftRecord } from "./floor-plan-storage";
import { floorRoleDomainKey } from "./floor-rebar-role";

function v3Plan(input: {
  slabs: FloorPlanState["slabs"];
  connections: FloorEdgeConnection[];
  supportRules?: FloorPlanState["supportRules"];
  innerWallThickness?: number;
}): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: input.slabs,
    openings: [],
    supportRules: input.supportRules ?? [],
    connections: input.connections,
    innerWallThickness: input.innerWallThickness ?? 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function legacyPlan(slabs: FloorPlanState["slabs"]): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 240,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function room(id: string, x: number, y: number, width: number, height: number) {
  return { id, name: `板区${id.toUpperCase()}`, type: "room" as const, x, y, width, height };
}

function connection(
  id: string,
  a: FloorEdgeConnection["a"],
  b: FloorEdgeConnection["b"],
  tangent: FloorEdgeConnection["tangentConstraint"] = { mode: "none" },
): FloorEdgeConnection {
  return { id, a, b, source: "manual", confidence: "confirmed", tangentConstraint: tangent };
}

describe("Canonical Topology Adapter V1.4A.1", () => {
  it("Legacy Atomic 不退化：0mm 共边仍走 Legacy Rect Touch", () => {
    const plan = legacyPlan([
      room("a", 0, 0, 2000, 2000),
      room("b", 2000, 0, 2000, 2000),
    ]);
    const atomic = buildCanonicalFloorAtomicBoundarySegments(plan);
    expect(atomic.some((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.includes("a") && segment.slabIds.includes("b"))).toBe(true);
    const adjacency = buildCanonicalFloorSlabAdjacency(plan);
    expect(adjacency).toContainEqual(expect.objectContaining({ slabIds: ["a", "b"], supports: ["inner-wall"] }));
    expect(adjacency.find((item) => item.slabIds[0] === "a" && item.slabIds[1] === "b")?.sharedLengthMm).toBe(2000);
    expect(findCanonicalFloorComponents(plan)).toEqual([["a", "b"]]);
  });

  it("V3 Atomic 走 Connection：240 墙带连接生成 shared-slab atomic", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
    });
    const atomic = buildCanonicalFloorAtomicBoundarySegments(plan);
    const shared = atomic.find((segment) => segment.id === "atomic:v3:connection:a:east:b:west");
    expect(shared).toBeDefined();
    expect(shared).toMatchObject({
      geometryKind: "shared-slab",
      support: "inner-wall",
      thicknessMm: 240,
    });
    expect([...shared!.slabIds].sort()).toEqual(["a", "b"]);
  });

  it("V3 Adjacency 走 Connection：Clear Gap 240 仍有正长度邻接", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
    });
    const adjacency = buildCanonicalFloorSlabAdjacency(plan);
    expect(adjacency).toHaveLength(1);
    expect(adjacency[0]).toMatchObject({ slabIds: ["a", "b"], sharedLengthMm: 2000, supports: ["inner-wall"] });
    expect(findCanonicalFloorComponents(plan)).toEqual([["a", "b"]]);
  });

  it("validateFloorPlanState dispatch：V3 240 墙带不报 near miss，Legacy 近错位仍报", () => {
    const v3 = v3Plan({
      slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
    });
    const v3Issues = validateFloorPlanState(v3);
    expect(v3Issues.map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
    expect(v3Issues.filter((issue) => issue.level === "error")).toEqual([]);

    const legacy = legacyPlan([room("a", 0, 0, 2000, 2000), room("b", 2005, 0, 2000, 2000)]);
    expect(validateFloorPlanState(legacy).map((issue) => issue.code)).toContain("slab-edge-near-miss");
  });

  it("Display 走 Canonical：V3 段带 display 包装且 atomicIds 可回查", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
    });
    const display = buildCanonicalFloorDisplayBoundarySegments(plan);
    expect(display.some((segment) => segment.id === "display:atomic:v3:connection:a:east:b:west" && segment.type === "inner-wall")).toBe(true);
    expect(buildCanonicalFloorDisplayBoundarySegments(legacyPlan([room("a", 0, 0, 2000, 2000), room("b", 2000, 0, 2000, 2000)])).some((segment) => segment.type === "inner-wall")).toBe(true);
  });
});

describe("Connection Support 精确解析", () => {
  it("A 西边 continuous 不污染 A east ↔ B west 连接", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
      supportRules: [{ id: "r-west", target: { kind: "slab-edge", slabId: "a", side: "west", range: { mode: "whole" } }, support: "continuous" }],
    });
    const solution = solveFloorTopology(plan);
    const solved = solution.solvedConnections.find((item) => item.connectionId === "connection:a:east:b:west")!;
    expect(solved.support).toBe("inner-wall");
    expect(solved.gapMm).toBe(240);
    expect(solution.walls).toHaveLength(1);
    expect(validateFloorPlanState(plan).filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("Partial continuous 只作用对应 Range：K east 0~2000 continuous，K-C 仍是 inner-wall", () => {
    const plan = v3Plan({
      slabs: [
        room("k", 0, 0, 4000, 4000),
        room("l", 4000, 0, 2000, 2000),
        room("c", 4240, 2000, 2000, 2000),
      ],
      connections: [
        connection("connection:k:east:l:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "l", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:k:east:c:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
      supportRules: [{ id: "r-k-east-0-2000", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" }],
    });
    const solution = solveFloorTopology(plan);
    const kl = solution.solvedConnections.find((item) => item.connectionId === "connection:k:east:l:west")!;
    const kc = solution.solvedConnections.find((item) => item.connectionId === "connection:k:east:c:west")!;
    expect(kl.support).toBe("continuous");
    expect(kl.gapMm).toBe(0);
    expect(kc.support).toBe("inner-wall");
    expect(kc.gapMm).toBe(240);
    // L Clear Gap=0；C 有 240 墙。
    expect(solution.slabs.find((item) => item.slabId === "l")!.x).toBe(4000);
    expect(solution.slabs.find((item) => item.slabId === "c")!.x).toBe(4240);
    expect(solution.walls).toHaveLength(1);
    expect(solution.walls[0].connectionId).toBe("connection:k:east:c:west");
  });

  it("Whole continuous 作用整 Side：K east 全部 Connection 都 continuous", () => {
    const plan = v3Plan({
      slabs: [
        room("k", 0, 0, 4000, 4000),
        room("l", 4000, 0, 2000, 2000),
        room("c", 4000, 2000, 2000, 2000),
      ],
      connections: [
        connection("connection:k:east:l:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "l", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:k:east:c:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
      supportRules: [{ id: "r-k-east", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "whole" } }, support: "continuous" }],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.solvedConnections.every((item) => item.support === "continuous")).toBe(true);
    expect(solution.walls).toEqual([]);
  });

  it("冲突规则：同一实际 Range 同时命中 inner-wall 与 continuous → 确定性 inner-wall + support-rule-conflict", () => {
    const makePlan = (rules: FloorPlanState["supportRules"]) => v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
      supportRules: rules,
    });
    const rules = [
      { id: "r1", target: { kind: "slab-edge" as const, slabId: "a", side: "east" as const, range: { mode: "whole" as const } }, support: "continuous" as const },
      { id: "r2", target: { kind: "slab-edge" as const, slabId: "a", side: "east" as const, range: { mode: "whole" as const } }, support: "inner-wall" as const },
    ];
    const plan = makePlan(rules);
    const planReversed = makePlan([...rules].reverse());
    const solution = solveFloorTopology(plan);
    const solutionReversed = solveFloorTopology(planReversed);
    expect(solution.solvedConnections[0].support).toBe("inner-wall");
    expect(solutionReversed.solvedConnections[0].support).toBe("inner-wall");
    expect(solution.solvedConnections[0].gapMm).toBe(240);
    expect(validateFloorPlanV3(plan).map((issue) => issue.code)).toContain("support-rule-conflict");
    expect(validateFloorPlanV3(planReversed).map((issue) => issue.code)).toContain("support-rule-conflict");
  });
});

describe("双端点 Range 求交", () => {
  it("A 500~2500 ∩ B 1000~2800 → 1000~2500（长度 1500）", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "offset", startMm: 500, endMm: 2500 } },
        { slabId: "b", side: "west", range: { mode: "offset", startMm: 1000, endMm: 2800 } },
      )],
    });
    const solution = solveFloorTopology(plan);
    const solved = solution.solvedConnections[0];
    expect(solved.valid).toBe(true);
    expect(solved.rangeStartMm).toBe(1000);
    expect(solved.rangeEndMm).toBe(2500);
    expect(solved.lengthMm).toBe(1500);
    expect(solved.aOffsetStartMm).toBe(1000);
    expect(solved.aOffsetEndMm).toBe(2500);
    expect(solved.bOffsetStartMm).toBe(1000);
    expect(solved.bOffsetEndMm).toBe(2500);
    expect(solution.walls).toHaveLength(1);
    expect(solution.walls[0].lengthMm).toBe(1500);
    expect(solution.issues.filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("一个端点无交集：A 0~500、B 1000~1500 → connection-no-overlap，不生成墙", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 500 } },
        { slabId: "b", side: "west", range: { mode: "offset", startMm: 1000, endMm: 1500 } },
      )],
    });
    const solution = solveFloorTopology(plan);
    const solved = solution.solvedConnections[0];
    expect(solved.valid).toBe(false);
    expect(solved.lengthMm).toBe(0);
    expect(solution.walls).toEqual([]);
    expect(solution.issues.map((issue) => issue.code)).toContain("connection-no-overlap");
    expect(buildCanonicalFloorSlabAdjacency(plan)).toEqual([]);
  });

  it("Offset Range 超出 Side 长度 → connection-range-invalid（不 Clamp）", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "offset", startMm: 2800, endMm: 3200 } },
        { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
      )],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.issues.map((issue) => issue.code)).toContain("connection-range-invalid");
    expect(validateFloorPlanV3(plan).map((issue) => issue.code)).toContain("connection-range-invalid");
  });
});

describe("Range Subtraction 与局部外墙", () => {
  it("subtractFloorRanges：多 covered 区间合并后求余", () => {
    expect(subtractFloorRanges({ start: 0, end: 4000 }, [
      { start: 0, end: 1000 },
      { start: 900, end: 2000 },
      { start: 2500, end: 3000 },
    ])).toEqual([
      { start: 2000, end: 2500 },
      { start: 3000, end: 4000 },
    ]);
  });

  it("Partial Side 剩余外墙：A east 4000，covered 0~1500 与 2500~3500 → 两段 exterior", () => {
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 4000, 4000),
        room("b", 4240, 0, 1000, 1500),
        room("c", 4240, 2500, 1000, 1500),
      ],
      connections: [
        connection(
          "connection:a:east:b:west",
          { slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 1500 } },
          { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        ),
        connection(
          "connection:a:east:c:west",
          { slabId: "a", side: "east", range: { mode: "offset", startMm: 2500, endMm: 3500 } },
          { slabId: "c", side: "west", range: { mode: "auto-overlap" } },
        ),
      ],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.issues.filter((issue) => issue.level === "error")).toEqual([]);
    const exterior = buildFloorTopologyExteriorRanges(plan, solution)
      .filter((range) => range.slabId === "a" && range.side === "east")
      .map((range) => ({ start: range.startMm, end: range.endMm }));
    expect(exterior).toEqual([
      { start: 1500, end: 2500 },
      { start: 3500, end: 4000 },
    ]);
    const atomic = buildFloorTopologyBoundarySegmentsV3(plan, solution);
    const exteriorSegments = atomic.filter((segment) => segment.geometryKind === "building-exterior" && segment.slabIds.includes("a") && segment.id.includes(":east:"));
    expect(exteriorSegments).toHaveLength(2);
    const layout = buildFloorPhysicalLayout(plan);
    const outerWalls = layout.walls.filter((wall) => wall.kind === "outer-wall" && wall.slabIds.includes("a") && wall.side === "east");
    expect(outerWalls).toHaveLength(2);
    expect(outerWalls.map((wall) => ({ y: wall.y, height: wall.height }))).toEqual([
      { y: 1500, height: 1000 },
      { y: 3500, height: 500 },
    ]);
    // B west 整边被覆盖 → 不生成 B west 外墙。
    expect(layout.walls.filter((wall) => wall.kind === "outer-wall" && wall.slabIds.includes("b") && wall.side === "west")).toEqual([]);
  });

  it("Full Side Connection：剩余 Exterior 为空，不生成外墙", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
      connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
    });
    const solution = solveFloorTopology(plan);
    expect(buildFloorTopologyExteriorRanges(plan, solution).filter((range) => range.side === "east" && range.slabId === "a")).toEqual([]);
    expect(buildFloorTopologyExteriorRanges(plan, solution).filter((range) => range.side === "west" && range.slabId === "b")).toEqual([]);
  });
});

describe("Solver Validation", () => {
  it("Wall-Slab正面积重叠由Solver进入Canonical Validation", () => {
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 100, 100),
        room("b", 120, 0, 100, 100),
        room("c", 105, 10, 10, 80),
      ],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
      )],
      innerWallThickness: 20,
    });
    expect(validateFloorPlanState(plan)).toContainEqual(expect.objectContaining({
      level: "error",
      code: "wall-slab-overlap",
      objectIds: ["solved-wall:connection:a:east:b:west"],
    }));
  });

  it("Solved Clear Slab 面积重叠 → solved-slab-overlap（含宽高面积）", () => {
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 1000, 1000),
        room("b", 0, -1240, 1000, 1000),
        room("c", 240, -1240, 1000, 1000),
      ],
      connections: [
        connection("connection:a:south:b:north", { slabId: "a", side: "south", range: { mode: "auto-overlap" } }, { slabId: "b", side: "north", range: { mode: "auto-overlap" } }),
        connection("connection:c:north:a:south", { slabId: "c", side: "north", range: { mode: "auto-overlap" } }, { slabId: "a", side: "south", range: { mode: "auto-overlap" } }),
      ],
    });
    const solution = solveFloorTopology(plan);
    const overlap = solution.issues.find((issue) => issue.code === "solved-slab-overlap");
    expect(overlap).toBeDefined();
    expect(overlap?.slabIds).toEqual(["b", "c"]);
    expect(overlap?.overlapWidthMm).toBe(760);
    expect(overlap?.overlapHeightMm).toBe(1000);
    expect(overlap?.overlapAreaMm2).toBe(760000);
  });

  it("T 型 Wall Rect 重叠不报 solved-slab-overlap（Golden）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    expect(solution.issues.map((issue) => issue.code)).not.toContain("solved-slab-overlap");
    expect(solution.issues.map((issue) => issue.code)).not.toContain("wall-slab-overlap");
    expect(solution.issues.map((issue) => issue.code)).not.toContain("topology-constraint-conflict");
    // T 节点墙允许交叉重叠：B-D 竖向墙与 B-K / D-K 水平墙确实物理相交。
    const bdWall = solution.walls.find((item) => item.slabIds.includes("meng-b") && item.slabIds.includes("meng-d"))!;
    const bK = solution.walls.find((item) => item.slabIds.includes("meng-b") && item.slabIds.includes("meng-k") && item.orientation === "horizontal")!;
    expect(bK.y + bK.height).toBeCloseTo(bdWall.y, 6);
  });
});

describe("Golden Meng 端到端（V1.4A.1）", () => {
  const migrated = () => migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan()).plan;

  it("Golden D-C 全链路一致：Validation / Atomic / Adjacency / Assembly / Solver / Physical", () => {
    const plan = migrated();
    // Validation：无 near miss / 无 exterior 误报 / 无 disconnected。
    const issues = validateFloorPlanState(plan);
    expect(issues.map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);

    const dcAtomic = buildCanonicalFloorAtomicBoundarySegments(plan)
      .find((segment) => segment.geometryKind === "shared-slab" && segment.slabIds.includes("meng-d") && segment.slabIds.includes("meng-c"));
    expect(dcAtomic).toMatchObject({ geometryKind: "shared-slab", support: "inner-wall", thicknessMm: 240 });
    expect(dcAtomic!.slabIds.sort()).toEqual(["meng-c", "meng-d"]);

    const dcAdjacency = buildCanonicalFloorSlabAdjacency(plan)
      .find((item) => item.slabIds.includes("meng-d") && item.slabIds.includes("meng-c"));
    expect(dcAdjacency).toBeDefined();
    expect(dcAdjacency!.sharedLengthMm).toBeGreaterThan(0);
    expect(dcAdjacency!.supports).toEqual(["inner-wall"]);

    const assembly = buildFloorAssembly(plan);
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.primarySlabIds).toHaveLength(8);

    const solution = solveFloorTopology(plan);
    const dcSolved = solution.solvedConnections.find((item) => item.slabIds.includes("meng-d") && item.slabIds.includes("meng-c"))!;
    expect(dcSolved.valid).toBe(true);
    expect(dcSolved.support).toBe("inner-wall");
    expect(dcSolved.gapMm).toBe(240);
    expect(dcSolved.lengthMm).toBeGreaterThan(0);

    const layout = buildFloorPhysicalLayout(plan);
    const dcWall = layout.walls.find((wall) => wall.kind === "inner-wall" && wall.slabIds.includes("meng-d") && wall.slabIds.includes("meng-c"))!;
    expect(dcWall.thicknessMm).toBe(240);
  });

  it("Golden 数值不退化（3500+240+3530=7270，D.east=K.east=5834，C.x=L.x=6074）", () => {
    const plan = migrated();
    expect(GOLDEN_MENG.equation.bWidth + GOLDEN_MENG.equation.wall + GOLDEN_MENG.equation.dWidth).toBe(GOLDEN_MENG.equation.kWidth);
    const solution = solveFloorTopology(plan);
    const x = new Map(solution.slabs.map((slab) => [slab.slabId, slab.x]));
    expect(x.get("meng-d")! + 3530).toBe(GOLDEN_MENG.physicalX.dEast);
    expect(x.get("meng-k")! + 7270).toBe(GOLDEN_MENG.physicalX.kEast);
    expect(x.get("meng-c")).toBe(GOLDEN_MENG.physicalX.c);
    expect(x.get("meng-l")).toBe(GOLDEN_MENG.physicalX.l);
    const y = new Map(solution.slabs.map((slab) => [slab.slabId, slab.y]));
    expect(y.get("meng-k")).toBe(GOLDEN_MENG.physicalY.k);
    expect(y.get("meng-b")).toBe(GOLDEN_MENG.physicalY.b);
  });

  it("Golden 局部 Connection Side 仍有外墙区间（未被覆盖的实际 Side Range → building-exterior）", () => {
    const plan = migrated();
    const solution = solveFloorTopology(plan);
    const exterior = buildFloorTopologyExteriorRanges(plan, solution);
    expect(exterior.length).toBeGreaterThan(0);
    // K west 连 E+F：K west 高 6090，E(2160)+F(3680)=5840，未被覆盖区间必须生成外墙。
    const kWallCovered = solution.solvedConnections
      .filter((solved) => solved.valid && solved.sideA === "west" && solved.slabIds[0] === "meng-k" || solved.valid && solved.sideB === "west" && solved.slabIds[1] === "meng-k")
      .reduce((sum, solved) => sum + solved.lengthMm, 0);
    expect(kWallCovered).toBeLessThan(6090);
    const kWestExterior = exterior.filter((range) => range.slabId === "meng-k" && range.side === "west");
    expect(kWestExterior.length).toBeGreaterThan(0);
    expect(kWestExterior.reduce((sum, range) => sum + (range.endMm - range.startMm), 0) + kWallCovered).toBeCloseTo(6090, 6);
    // Atomic 与 Physical 使用同一外墙区间：段数与墙数一致。
    const atomicExterior = buildFloorTopologyBoundarySegmentsV3(plan, solution)
      .filter((segment) => segment.geometryKind === "building-exterior" && segment.slabIds.includes("meng-k"));
    const layout = buildFloorPhysicalLayout(plan);
    const physicalOuter = layout.walls.filter((wall) => wall.kind === "outer-wall" && wall.slabIds.includes("meng-k"));
    expect(atomicExterior.length).toBe(physicalOuter.length);
    expect(atomicExterior.length).toBeGreaterThan(0);
  });

  it("Golden V3 Validator：D-C 不报 near miss / exterior / disconnected", () => {
    const plan = migrated();
    const issues = validateFloorPlanState(plan);
    expect(issues.map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(validateFloorPlanV2(goldenMengLegacyV2Plan()).map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
  });
});

describe("Plan V3 Schema / Round Trip / Import", () => {
  it("Plan3 Round Trip：connections id / side / range / source / confidence / tangentConstraint 保持", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [{
        id: "connection:a:east:b:west",
        a: { slabId: "a", side: "east", range: { mode: "offset", startMm: 500, endMm: 2500 } },
        b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        source: "manual",
        confidence: "confirmed",
        tangentConstraint: { mode: "lock-start", offsetMm: 0 },
      }],
    });
    const roundTrip = parseFloorDraftRecord(JSON.parse(JSON.stringify(createFloorDraftRecord(plan))))!;
    expect(roundTrip.state.coordinateModel).toBe("clear-space-physical-v2");
    expect(roundTrip.state.connections).toEqual(plan.connections);
  });

  it("Plan2 Import：localStorage V2 草稿自动迁移为 V3（connections 存在）", () => {
    const legacy = goldenMengLegacyV2Plan();
    const record = parseFloorDraftRecord({ schemaVersion: 2, savedAt: new Date().toISOString(), state: legacy })!;
    expect(record.state.coordinateModel).toBe("clear-space-physical-v2");
    expect(record.state.connections?.length).toBeGreaterThanOrEqual(12);
    const dc = record.state.connections?.find((item) =>
      (item.a.slabId === "meng-d" && item.b.slabId === "meng-c") || (item.a.slabId === "meng-c" && item.b.slabId === "meng-d"));
    expect(dc).toBeDefined();
    expect(dc?.source).toBe("legacy-wall-gap");
  });
});

describe("正式计算 V3 Safety Guard", () => {
  const v3 = () => v3Plan({
    slabs: [room("a", 0, 0, 2000, 2000), room("b", 2240, 0, 2000, 2000)],
    connections: [connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } })],
  });

  it("Bottom V3：无洞口合法路径正式出料，不回退 generic guard", () => {
    const calculation = calculateFloorBottomRebar(v3(), DEFAULT_FLOOR_BOTTOM_STATE, {
      mainDirectionOverrides: {
        [floorRoleDomainKey(["a"])]: "x",
        [floorRoleDomainKey(["b"])]: "x",
      },
    });
    expect(calculation.errors.map((issue) => issue.code)).not.toContain("topology-v3-calculation-not-ready");
    expect(calculation.isValid).toBe(true);
    expect(calculation.groups.length).toBeGreaterThan(0);
    expect(calculation.pieces.length).toBeGreaterThan(0);
    expect(calculation.totalLengthM).toBeGreaterThan(0);
  });

  it("Top V3：Blocking Issue，不产生任何 BOM", () => {
    const calculation = calculateFloorTopRebar(v3(), DEFAULT_FLOOR_TOP_STATE);
    expect(calculation.errors.map((issue) => issue.code)).toContain("topology-v3-calculation-not-ready");
    expect(calculation.isValid).toBe(false);
    expect(calculation.groups).toEqual([]);
    expect(calculation.totalLengthM).toBe(0);
  });

  it("Through V3：几何解析返回 Blocking Error（不抛异常）", () => {
    const geometry = resolveFloorTopThroughPathGeometry(v3(), {
      id: "path-a-b",
      name: "通墙01",
      direction: "x",
      slabIds: ["a", "b"],
      bandStartMm: 0,
      bandEndMm: 2000,
      enabled: true,
    });
    expect(geometry.errors.map((issue) => issue.code)).toContain("topology-v3-calculation-not-ready");
    expect(geometry.validBandIntervals).toEqual([]);
  });

  it("Legacy 正式计算不退化：net-layout-v1 仍正常出料单", () => {
    const plan = legacyPlan([room("a", 0, 0, 4000, 3000)]);
    const bottom = calculateFloorBottomRebar(plan, DEFAULT_FLOOR_BOTTOM_STATE);
    expect(bottom.errors.map((issue) => issue.code)).not.toContain("topology-v3-calculation-not-ready");
    expect(bottom.isValid).toBe(true);
    expect(bottom.groups.length).toBeGreaterThan(0);
  });
});
