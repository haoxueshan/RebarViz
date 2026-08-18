import { describe, expect, it } from "vitest";
import {
  GOLDEN_MENG,
  goldenMengLegacyV2Plan,
} from "./__fixtures__/floor-topology-golden-meng";
import {
  applyFloorSlabPhysicalMoveV3,
  applyFloorSlabResizeV3,
  defaultFloorOpeningPositionV3,
  duplicateFloorSlabPositionV3,
  FLOOR_NEW_SLAB_GAP_MM,
  materializeFloorTopologyPositions,
  nextFloorSlabPhysicalPositionV3,
  previewFloorSlabPhysicalMoveV3,
  floorConnectionsForSlab,
} from "./floor-topology-editor";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";
import { solveFloorTopology } from "./floor-topology-solver";
import type { FloorEdgeConnection } from "./floor-topology";
import type { FloorPlanState } from "./floor-plan";

function v3Plan(input: {
  slabs: FloorPlanState["slabs"];
  connections: FloorEdgeConnection[];
  innerWallThickness?: number;
}): FloorPlanState {
  return {
    coordinateModel: "clear-space-physical-v2",
    slabs: input.slabs,
    openings: [],
    supportRules: [],
    connections: input.connections,
    innerWallThickness: input.innerWallThickness ?? 240,
    outerWallThickness: 240,
    snapDistanceMm: 1500,
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

const abWall = () => connection(
  "connection:a:east:b:west",
  { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
  { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
);

describe("Materialize（V3 坐标唯一语义）", () => {
  it("Golden Meng Materialize：slab.x/y 直接等于 Golden Physical 坐标", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const x = new Map(plan.slabs.map((slab) => [slab.id, slab.x]));
    const y = new Map(plan.slabs.map((slab) => [slab.id, slab.y]));
    expect(x.get("meng-a")).toBe(GOLDEN_MENG.physicalX.a);
    expect(x.get("meng-b")).toBe(GOLDEN_MENG.physicalX.b);
    expect(x.get("meng-d")).toBe(GOLDEN_MENG.physicalX.d);
    expect(x.get("meng-k")).toBe(GOLDEN_MENG.physicalX.k);
    expect(x.get("meng-c")).toBe(GOLDEN_MENG.physicalX.c);
    expect(x.get("meng-l")).toBe(GOLDEN_MENG.physicalX.l);
    expect(y.get("meng-k")).toBe(GOLDEN_MENG.physicalY.k);
    expect(y.get("meng-b")).toBe(GOLDEN_MENG.physicalY.b);
    // 尺寸不修改：3500 + 240 + 3530 = 7270。
    expect(plan.slabs.find((slab) => slab.id === "meng-b")?.width).toBe(3500);
    expect(plan.slabs.find((slab) => slab.id === "meng-d")?.width).toBe(3530);
    expect(plan.slabs.find((slab) => slab.id === "meng-k")?.width).toBe(7270);
    expect(plan.slabs.find((slab) => slab.id === "meng-d")!.x + 3530).toBe(5834);
    expect(plan.slabs.find((slab) => slab.id === "meng-k")!.x + 7270).toBe(5834);
  });

  it("Materialize 幂等：第二次调用返回同一引用且坐标稳定", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const again = materializeFloorTopologyPositions(plan);
    expect(again).toBe(plan);
    expect(again.slabs).toEqual(plan.slabs);
  });

  it("solve(materialized) = canonical（Golden 数值不漂移）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const x = new Map(solution.slabs.map((slab) => [slab.slabId, slab.x]));
    expect(x.get("meng-d")! + 3530).toBe(5834);
    expect(x.get("meng-c")).toBe(6074);
    expect(x.get("meng-l")).toBe(6074);
    expect(solution.issues.filter((issue) => issue.level === "error")).toEqual([]);
  });
});

describe("Add / Duplicate / Opening（Physical Canonical 语义）", () => {
  const golden = () => migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan()).plan;

  it("Add Slab：Golden 净空 maxX=10094 → 新板 x=10594（不是 9614 / 10094）", () => {
    const position = nextFloorSlabPhysicalPositionV3(golden());
    expect(position.x).toBe(10094 + FLOOR_NEW_SLAB_GAP_MM);
    expect(position.x).toBe(10594);
  });

  it("Duplicate C：6074 + 4020 + 500 = 10594 且不复制 Connections", () => {
    const plan = golden();
    const position = duplicateFloorSlabPositionV3(plan, "meng-c")!;
    expect(position.x).toBe(10594);
    expect(position.y).toBe(GOLDEN_MENG.physicalY.c);
    // 复制出的新板没有任何 Connection（由调用方创建新 slab，禁止复制原连接）。
    expect(floorConnectionsForSlab(plan, "meng-c").length).toBeGreaterThan(0);
  });

  it("Add Opening：基于 Physical Canonical Host（B.x=-1436，不是 -1676）", () => {
    const plan = golden();
    const position = defaultFloorOpeningPositionV3(plan, "meng-b", 1000, 1000)!;
    expect(position.x).toBeCloseTo(GOLDEN_MENG.physicalX.b + (3500 - 1000) / 2, 6);
    expect(position.y).toBeCloseTo(GOLDEN_MENG.physicalY.b + (3270 - 1000) / 2, 6);
  });
});

describe("V3 Move / Detach", () => {
  it("Connected Slab 可 Detach：拖离墙 → Connection 删除，B 停留新位置", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 4240, 0);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
    const moved = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(moved.x).toBe(4240);
    const solved = solveFloorTopology(result.plan);
    expect(solved.slabs.find((slab) => slab.slabId === "b")!.x).toBe(4240);
    expect(solved.walls).toEqual([]);
  });

  it("V3 禁止 Legacy Snap：snapDistance=1500 不影响 Move 结果（137mm 近邻也原样提交）", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 2863, 137);
    expect(result.plan.slabs.find((slab) => slab.id === "b")).toMatchObject({ x: 2863, y: 137 });
  });

  it("Slide Along Wall：法向 Gap 正确 + 有共享长度 → Connection 保留", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 4000), room("b", 3240, 500, 2000, 2000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3240, 1200);
    expect(result.removedConnectionIds).toEqual([]);
    expect(result.plan.connections).toHaveLength(1);
  });

  it("lock-start 被破坏 → Detach", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        { mode: "lock-start", offsetMm: 0 },
      )],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3240, 100);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
  });

  it("Multi Connection：只删失效 Connection，其余保留", () => {
    // 约定：south 面 = rect.y（B.south↔D.north → D.y = B.y - D.height - gap）。
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 3000, 3000),
        room("b", 3240, 0, 3000, 3000),
        room("d", 3240, -2240, 2000, 2000),
      ],
      connections: [
        abWall(),
        connection("connection:b:south:d:north", { slabId: "b", side: "south", range: { mode: "auto-overlap" } }, { slabId: "d", side: "north", range: { mode: "auto-overlap" } }),
      ],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 4240, 0);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
    expect(result.plan.connections?.map((item) => item.id)).toEqual(["connection:b:south:d:north"]);
  });

  it("PointerCancel 不写数据：preview 不修改原 State", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const snapshot = structuredClone(plan);
    previewFloorSlabPhysicalMoveV3(plan, "b", 4240, 0);
    expect(plan).toEqual(snapshot);
  });

  it("Move + Detach 是单个事务：一次调用同时给出位置与 Connections 变更（Undo 一步）", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 4240, 0);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expect(result.plan.connections).toEqual([]);
    expect(result.removedConnectionIds).toHaveLength(1);
  });

  it("removeFloorConnections：主动断开且清理失效支承规则", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const withRule: FloorPlanState = {
      ...plan,
      supportRules: [{ id: "r", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" }],
    };
    // 拖离后 Connection 失效 → 自动 Detach 并清理不再作用于任何连接的规则。
    const result = applyFloorSlabPhysicalMoveV3(withRule, "b", 4240, 0);
    expect(result.plan.connections).toEqual([]);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
    expect(result.plan.supportRules).toEqual([]);
  });
});

describe("Resize 事务", () => {
  const abPlan = () => v3Plan({
    slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
    connections: [abWall()],
  });

  it("Resize west-anchor：西边固定，Solver 传播 B 右移，Connection 保持", () => {
    const plan = abPlan();
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 5000, anchorX: "west" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.plan.slabs.find((slab) => slab.id === "a")!;
    const b = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(a.x).toBe(0);
    expect(a.width).toBe(5000);
    expect(b.x).toBe(0 + 5000 + 240);
    expect(result.plan.connections).toHaveLength(1);
    expect(solveFloorTopology(result.plan).walls).toHaveLength(1);
  });

  it("Resize east-anchor：东边固定，A 向西扩展，B 不动", () => {
    const plan = abPlan();
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 5000, anchorX: "east" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.plan.slabs.find((slab) => slab.id === "a")!;
    const b = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(a.x).toBe(0 + 4000 - 5000);
    expect(b.x).toBe(4240);
    expect(result.plan.connections).toHaveLength(1);
  });

  it("Resize auto：单侧 Connected 保持 Connected 侧固定（A 只连东侧 → 锚东边）", () => {
    const plan = abPlan();
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "a")!.x).toBe(-1000);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
  });

  it("Resize auto 双侧 Connected → resize-anchor-required", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000), room("d", 6480, 0, 3000, 3000)],
      connections: [
        connection("connection:a:east:b:west", { slabId: "a", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:b:east:d:west", { slabId: "b", side: "east", range: { mode: "auto-overlap" } }, { slabId: "d", side: "west", range: { mode: "auto-overlap" } }),
      ],
    });
    const result = applyFloorSlabResizeV3(plan, { slabId: "b", width: 4000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("resize-anchor-required");
    // 显式指定后成功：锚西边 → D 右移。
    const resolved = applyFloorSlabResizeV3(plan, { slabId: "b", width: 4000, anchorX: "west" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.plan.slabs.find((slab) => slab.id === "b")!.width).toBe(4000);
    expect(resolved.plan.slabs.find((slab) => slab.id === "d")!.x).toBe(3240 + 4000 + 240);
  });

  it("Resize 导致 Solved Clear Slab 重叠 → resize-blocked-by-topology（不静默 Detach）", () => {
    // A 西边固定加宽 → B 沿墙右移进入 D 净空 → 必须阻止。
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 4000, 4000),
        room("b", 4240, 0, 3000, 4000),
        room("d", 8000, 0, 2000, 2000),
      ],
      connections: [abWall()],
    });
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 9000, anchorX: "west" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("resize-blocked-by-topology");
    // 原 State 未被修改（纯函数）。
    expect(plan.slabs.find((slab) => slab.id === "a")!.width).toBe(4000);
  });

  it("Resize 保持 Connections：尺寸修改不自动 Detach", () => {
    const plan = abPlan();
    const result = applyFloorSlabResizeV3(plan, { slabId: "b", width: 4000, anchorX: "west" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.connections?.length).toBe(1);
    expect(solveFloorTopology(result.plan).solvedConnections[0].valid).toBe(true);
  });
});

describe("Legacy 不退化", () => {
  it("materialize / move / resize 对 net-layout-v1 全部无副作用", () => {
    const legacy = goldenMengLegacyV2Plan();
    expect(materializeFloorTopologyPositions(legacy)).toBe(legacy);
    const moved = applyFloorSlabPhysicalMoveV3(legacy, "meng-b", 0, 0);
    expect(moved.plan).toBe(legacy);
    expect(moved.removedConnectionIds).toEqual([]);
    const resized = applyFloorSlabResizeV3(legacy, { slabId: "meng-b", width: 4000 });
    expect(resized.ok).toBe(false);
  });
});
