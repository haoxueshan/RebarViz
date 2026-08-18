import { describe, expect, it } from "vitest";
import { buildFloorPhysicalLayout } from "./floor-physical-layout";
import { parseFloorConnections, type FloorEdgeConnection } from "./floor-topology";
import { solveFloorTopology } from "./floor-topology-solver";
import type { FloorPlanState } from "./floor-plan";

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

const slabA = { id: "a", name: "板区A", type: "room" as const, x: 0, y: 0, width: 4200, height: 3600 };
const slabB = { id: "b", name: "板区B", type: "room" as const, x: 4200, y: 0, width: 3600, height: 3600 };

function abConnection(source: "manual" | "legacy-shared-edge" = "manual"): FloorEdgeConnection {
  return {
    id: "connection:a:east:b:west",
    a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
    b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
    source,
    confidence: "confirmed",
    tangentConstraint: { mode: "lock-start", offsetMm: 0 },
  };
}

describe("Floor Topology V1.4A Solver", () => {
  it("Inner Wall 默认：B.x = A.east + 240，墙 240", () => {
    const plan = v3Plan({ slabs: [slabA, slabB], connections: [abConnection()] });
    const solution = solveFloorTopology(plan);
    const b = solution.slabs.find((item) => item.slabId === "b")!;
    expect(b.x).toBe(4200 + 240);
    const wall = solution.walls[0];
    expect(wall.orientation).toBe("vertical");
    expect(wall.thicknessMm).toBe(240);
    expect(wall.x).toBe(4200);
    expect(wall.lengthMm).toBe(3600);
    expect(solution.issues).toEqual([]);
  });

  it("Continuous：Clear Gap=0，不生成 Inner Wall Rect", () => {
    const plan = v3Plan({
      slabs: [slabA, slabB],
      connections: [abConnection()],
      supportRules: [{ id: "r", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" }],
    });
    const solution = solveFloorTopology(plan);
    const b = solution.slabs.find((item) => item.slabId === "b")!;
    expect(b.x).toBe(4200);
    expect(solution.walls).toEqual([]);
  });

  it("globally blocks positive-area wall overlap with a third-party clear slab", () => {
    const plan = v3Plan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
        { id: "c", name: "C", type: "room", x: 105, y: 10, width: 10, height: 80 },
      ],
      connections: [{
        id: "connection:a:east:b:west",
        a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        source: "manual",
        confidence: "confirmed",
        tangentConstraint: { mode: "none" },
      }],
      innerWallThickness: 20,
    });
    expect(solveFloorTopology(plan).issues).toContainEqual(expect.objectContaining({
      level: "error",
      code: "wall-slab-overlap",
      slabIds: ["a", "b", "c"],
      connectionIds: ["connection:a:east:b:west"],
      objectIds: ["solved-wall:connection:a:east:b:west"],
      overlapWidthMm: 10,
      overlapHeightMm: 80,
      overlapAreaMm2: 800,
    }));
  });

  it("keeps zero-area third-party wall touch legal", () => {
    const plan = v3Plan({
      slabs: [
        { id: "a", name: "A", type: "room", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", name: "B", type: "room", x: 120, y: 0, width: 100, height: 100 },
        { id: "c", name: "C", type: "room", x: 90, y: 10, width: 10, height: 80 },
      ],
      connections: [{
        id: "connection:a:east:b:west",
        a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        source: "manual",
        confidence: "confirmed",
        tangentConstraint: { mode: "none" },
      }],
      innerWallThickness: 20,
    });
    expect(solveFloorTopology(plan).issues.map((issue) => issue.code)).not.toContain("wall-slab-overlap");
  });

  it("不同墙厚：innerWallThickness=300 → B.x = A.east + 300（不硬编码240）", () => {
    const plan = v3Plan({ slabs: [slabA, slabB], connections: [abConnection()], innerWallThickness: 300 });
    const solution = solveFloorTopology(plan);
    expect(solution.slabs.find((item) => item.slabId === "b")!.x).toBe(4500);
    expect(solution.walls[0].thicknessMm).toBe(300);
  });

  it("Constraint Cycle：闭合误差不平均分摊 → topology-constraint-conflict", () => {
    const a = { id: "a", name: "板区A", type: "room" as const, x: 0, y: 0, width: 1000, height: 1000 };
    const b = { id: "b", name: "板区B", type: "room" as const, x: 0, y: 1240, width: 1000, height: 1000 };
    const c = { id: "c", name: "板区C", type: "room" as const, x: 0, y: 2480, width: 1000, height: 1000 };
    const d = { id: "d", name: "板区D", type: "room" as const, x: 0, y: 3720, width: 1000, height: 1000 };
    const vertical = (leftId: string, rightId: string, id: string): FloorEdgeConnection => ({
      id,
      a: { slabId: leftId, side: "south", range: { mode: "auto-overlap" } },
      b: { slabId: rightId, side: "north", range: { mode: "auto-overlap" } },
      source: "manual",
      confidence: "confirmed",
      tangentConstraint: { mode: "none" },
    });
    const plan = v3Plan({
      slabs: [a, b, c, d],
      connections: [
        vertical("a", "b", "connection:a:b"),
        vertical("b", "c", "connection:b:c"),
        vertical("c", "d", "connection:c:d"),
        // D.south ↔ A.north：形成闭合环，闭合误差不能平均分摊。
        {
          id: "connection:d:a",
          a: { slabId: "d", side: "south", range: { mode: "auto-overlap" } },
          b: { slabId: "a", side: "north", range: { mode: "auto-overlap" } },
          source: "manual",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
      ],
    });
    const solution = solveFloorTopology(plan);
    const conflict = solution.issues.find((issue) => issue.code === "topology-constraint-conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.errorMm).toBeGreaterThan(0);
    // 尺寸不能被静默修改。
    const solved = new Map(solution.slabs.map((item) => [item.slabId, item]));
    expect(solved.get("a")!.width).toBe(1000);
    expect(solved.get("b")!.width).toBe(1000);
    expect(solved.get("c")!.width).toBe(1000);
    expect(solved.get("d")!.width).toBe(1000);
  });

  it("Corner Touch：Connection 实际 Overlap=0 → connection-no-overlap，无墙", () => {
    const plan = v3Plan({
      slabs: [
        slabA,
        { id: "b", name: "板区B", type: "room", x: 4200, y: 3600, width: 2000, height: 2000 },
      ],
      connections: [
        {
          id: "connection:a:north:b:south",
          a: { slabId: "a", side: "north", range: { mode: "auto-overlap" } },
          b: { slabId: "b", side: "south", range: { mode: "auto-overlap" } },
          source: "manual",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
      ],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.walls).toEqual([]);
    expect(solution.issues.some((issue) => issue.code === "connection-no-overlap")).toBe(true);
  });

  it("Invalid Side Pair：west ↔ north 被 Parser 拒绝", () => {
    const parsed = parseFloorConnections([
      {
        id: "bad",
        a: { slabId: "a", side: "west", range: { mode: "auto-overlap" } },
        b: { slabId: "b", side: "north", range: { mode: "auto-overlap" } },
        source: "manual",
      },
    ], new Set(["a", "b"]));
    expect(parsed).toEqual([]);
  });

  it("Multiple Partial Connections：K west 连 F + E（范围不重叠）合法", () => {
    const plan = v3Plan({
      slabs: [
        { id: "e", name: "板区E", type: "room", x: -4000, y: 0, width: 4000, height: 2000 },
        { id: "f", name: "板区F", type: "room", x: -4000, y: 2000, width: 4000, height: 2000 },
        { id: "k", name: "板区K", type: "room", x: 0, y: 0, width: 4000, height: 4000 },
      ],
      connections: [
        {
          id: "connection:e:east:k:west",
          a: { slabId: "e", side: "east", range: { mode: "auto-overlap" } },
          b: { slabId: "k", side: "west", range: { mode: "auto-overlap" } },
          source: "legacy-shared-edge",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
        {
          id: "connection:f:east:k:west",
          a: { slabId: "f", side: "east", range: { mode: "auto-overlap" } },
          b: { slabId: "k", side: "west", range: { mode: "auto-overlap" } },
          source: "legacy-shared-edge",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
      ],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.walls).toHaveLength(2);
    expect(solution.issues.some((issue) => issue.code === "connection-overlap-conflict")).toBe(false);
  });

  it("同侧范围重叠且指向不同 Slab → connection-overlap-conflict", () => {
    const plan = v3Plan({
      slabs: [
        { id: "e", name: "板区E", type: "room", x: -4000, y: 0, width: 4000, height: 3000 },
        { id: "f", name: "板区F", type: "room", x: -4000, y: 1000, width: 4000, height: 3000 },
        { id: "k", name: "板区K", type: "room", x: 0, y: 0, width: 4000, height: 4000 },
      ],
      connections: [
        {
          id: "connection:e:east:k:west",
          a: { slabId: "e", side: "east", range: { mode: "auto-overlap" } },
          b: { slabId: "k", side: "west", range: { mode: "auto-overlap" } },
          source: "manual",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
        {
          id: "connection:f:east:k:west",
          a: { slabId: "f", side: "east", range: { mode: "auto-overlap" } },
          b: { slabId: "k", side: "west", range: { mode: "auto-overlap" } },
          source: "manual",
          confidence: "confirmed",
          tangentConstraint: { mode: "none" },
        },
      ],
    });
    const solution = solveFloorTopology(plan);
    expect(solution.issues.some((issue) => issue.code === "connection-overlap-conflict")).toBe(true);
  });

  it("Full-Full lock-start：切向等式保持 A/B 对齐", () => {
    const plan = v3Plan({
      slabs: [
        slabA,
        { ...slabB, y: 500 },
      ],
      connections: [abConnection()],
    });
    const solution = solveFloorTopology(plan);
    const a = solution.slabs.find((item) => item.slabId === "a")!;
    const b = solution.slabs.find((item) => item.slabId === "b")!;
    expect(b.y).toBe(a.y);
  });

  it("Physical Layout V3：Slab 直接使用 Solved 位置，不二次加墙偏移", () => {
    const plan = v3Plan({ slabs: [slabA, slabB], connections: [abConnection()] });
    const layout = buildFloorPhysicalLayout(plan);
    const b = layout.slabs.find((item) => item.slabId === "b")!;
    expect(b.x).toBe(4440);
    expect(layout.walls.filter((wall) => wall.kind === "inner-wall")).toHaveLength(1);
    const wall = layout.walls.find((item) => item.kind === "inner-wall")!;
    expect(wall.thicknessMm).toBe(240);
  });

  it("Parser：损坏 connections 被归一化（非法 side / 未知 slab / 自连接拒绝）", () => {
    const parsed = parseFloorConnections([
      { id: "ok", a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } }, source: "legacy-shared-edge", confidence: "confirmed", tangentConstraint: { mode: "lock-start", offsetMm: 0 } },
      { id: "self", a: { slabId: "a", side: "west", range: { mode: "auto-overlap" } }, b: { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, source: "manual" },
      { id: "unknown", a: { slabId: "ghost", side: "east", range: { mode: "auto-overlap" } }, b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } }, source: "manual" },
      { id: "bad-range", a: { slabId: "a", side: "south", range: { mode: "offset", startMm: 900, endMm: 100 } }, b: { slabId: "b", side: "north", range: { mode: "auto-overlap" } }, source: "manual" },
    ], new Set(["a", "b"]));
    expect(parsed).toHaveLength(2);
    const badRange = parsed.find((connection) => connection.id === "bad-range");
    expect(badRange?.a.range).toEqual({ mode: "auto-overlap" });
  });
});
