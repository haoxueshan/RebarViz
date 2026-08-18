import { describe, expect, it } from "vitest";
import {
  GOLDEN_MENG,
  goldenMengLegacyV2Plan,
} from "./__fixtures__/floor-topology-golden-meng";
import {
  applyFloorConnectionSupportV3,
  applyFloorInnerWallThicknessV3,
  applyFloorSlabPhysicalMoveV3,
  applyFloorSlabResizeV3,
  defaultFloorOpeningPositionV3,
  duplicateFloorSlabPositionV3,
  FLOOR_NEW_SLAB_GAP_MM,
  materializeFloorTopologyPositions,
  nextFloorSlabPhysicalPositionV3,
  previewFloorSlabPhysicalMoveV3,
  resolveFloorOpeningHost,
  floorConnectionsForSlab,
} from "./floor-topology-editor";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";
import { solveFloorTopology } from "./floor-topology-solver";
import type { FloorEdgeConnection } from "./floor-topology";
import type { FloorPlanState, FloorOpening } from "./floor-plan";

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
    // V1.4A.2.2：目标不得与其它 Clear Slab 正面积重叠；137mm 近邻（无重叠）仍原样提交、不 Snap。
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3137, 0);
    expect(result.ok).toBe(true);
    expect(result.plan.slabs.find((slab) => slab.id === "b")).toMatchObject({ x: 3137, y: 0 });
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

/** Canonical Invariant：plan.x/y 必须等于 solve(plan).x/y（所有 Mutation 之后）。 */
function expectCanonical(plan: FloorPlanState): void {
  const solution = solveFloorTopology(plan);
  const solved = new Map(solution.slabs.map((slab) => [slab.slabId, slab]));
  plan.slabs.forEach((slab) => {
    const target = solved.get(slab.id);
    expect(target, `板区 ${slab.id} 缺失 Solved 结果`).toBeDefined();
    expect(slab.x, `板区 ${slab.id} X 非 Canonical`).toBeCloseTo(target!.x, 6);
    expect(slab.y, `板区 ${slab.id} Y 非 Canonical`).toBeCloseTo(target!.y, 6);
  });
}

function opening(id: string, x: number, y: number, width: number, height: number): FloorOpening {
  return { id, name: `洞口${id.toUpperCase()}`, type: "stair", x, y, width, height };
}

describe("V1.4A.2.1 Opening 跟随", () => {
  it("Golden Opening Migration：V2→V3 后 Opening 与 Host 一起 Materialize（Local Offset 不变）", () => {
    const legacy = goldenMengLegacyV2Plan();
    const withOpening: FloorPlanState = {
      ...legacy,
      openings: [opening("stair-b", -1176, 13390, 1000, 1000)],
    };
    const before = resolveFloorOpeningHost(withOpening, withOpening.openings[0]);
    expect(before.status).toBe("confirmed");
    if (before.status !== "confirmed") return;
    expect(before.localX).toBe(500);
    expect(before.localY).toBe(500);
    const { plan } = migrateFloorPlanV2ToV3(withOpening);
    const b = plan.slabs.find((slab) => slab.id === "meng-b")!;
    expect(b.x).toBe(GOLDEN_MENG.physicalX.b);
    expect(b.y).toBe(GOLDEN_MENG.physicalY.b);
    const moved = plan.openings[0];
    expect(moved.x - b.x).toBeCloseTo(500, 6);
    expect(moved.y - b.y).toBeCloseTo(500, 6);
    expect(moved.width).toBe(1000);
    expect(moved.height).toBe(1000);
  });

  it("Drag Slab：Hosted Opening 一起移动，Detach 事务包含 Opening", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 4740, 500, 1000, 1000)],
    };
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 5240, 0);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
    expect(result.plan.openings[0].x).toBe(5740);
    expect(result.plan.openings[0].y).toBe(500);
    expect(result.plan.openings[0].width).toBe(1000);
    expectCanonical(result.plan);
  });

  it("Resize 传播 Opening：A 东边固定扩展，Opening 与 A 整体平移且不缩放", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 500, 500, 1000, 1000)],
    };
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 5000, anchorX: "east" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "a")!.x).toBe(-1000);
    expect(result.plan.openings[0].x).toBe(-500);
    expect(result.plan.openings[0].width).toBe(1000);
    expectCanonical(result.plan);
  });

  it("Solver 传播其它 Slab：C 被链式推移时 C 内 Opening 跟随", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [
          room("a", 0, 0, 4000, 3000),
          room("b", 4240, 0, 3000, 3000),
          room("c", 7540, 0, 3000, 3000),
        ],
        connections: [
          abWall(),
          connection("connection:b:east:c:west", { slabId: "b", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
        ],
      }),
      openings: [opening("o-c", 7940, 500, 1000, 1000)],
    };
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 5000, anchorX: "west" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(5240);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(8480);
    expect(result.plan.openings[0].x).toBe(8880);
    expectCanonical(result.plan);
  });

  it("Resize 使 Opening 越界 → resize-opening-outside（不自动缩小洞口）", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 500, 500, 1000, 1000)],
    };
    const result = applyFloorSlabResizeV3(plan, { slabId: "a", width: 800, anchorX: "east" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("resize-opening-outside");
    // 原 State 未被修改。
    expect(plan.slabs.find((slab) => slab.id === "a")!.width).toBe(4000);
    expect(plan.openings[0].width).toBe(1000);
  });
});

describe("V1.4A.2.1 墙厚事务", () => {
  it("240→300：A.x 不变、B.x=4300、Connection 保留、Opening 跟随 +60", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 4740, 500, 1000, 1000)],
    };
    const result = applyFloorInnerWallThicknessV3(plan, 300);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.plan.slabs.find((slab) => slab.id === "a")!;
    const b = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(a.x).toBe(0);
    expect(b.x).toBe(4300);
    expect(result.plan.connections).toHaveLength(1);
    expect(solveFloorTopology(result.plan).walls[0].thicknessMm).toBe(300);
    expect(result.plan.openings[0].x).toBe(4800);
    expectCanonical(result.plan);
  });

  it("非法墙厚（0 / 负数 / NaN）不提交", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = applyFloorInnerWallThicknessV3(plan, bad);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("wall-thickness-invalid");
    }
    expect(plan.innerWallThickness).toBe(240);
  });

  it("链式组件整体移动：A-B-C 240→300 → B +60、C +120，各自 Opening 跟随", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [
          room("a", 0, 0, 4000, 3000),
          room("b", 4240, 0, 3000, 3000),
          room("c", 7540, 0, 3000, 3000),
        ],
        connections: [
          abWall(),
          connection("connection:b:east:c:west", { slabId: "b", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
        ],
      }),
      openings: [opening("o-b", 4740, 500, 800, 800), opening("o-c", 7940, 500, 800, 800)],
    };
    const result = applyFloorInnerWallThicknessV3(plan, 300);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4300);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(7600);
    expect(result.plan.openings.find((item) => item.id === "o-b")!.x).toBe(4800);
    expect(result.plan.openings.find((item) => item.id === "o-c")!.x).toBe(8000);
    expectCanonical(result.plan);
  });
});

describe("V1.4A.2.1 Support 切换事务", () => {
  const planWithOpening = () => ({
    ...v3Plan({
      slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
      connections: [abWall()],
    }),
    openings: [opening("o", 4740, 500, 1000, 1000)],
  });

  it("Inner→Continuous：B.x 4240→4000、墙消失、Connection 保留、Opening 跟随 -240", () => {
    const plan = planWithOpening();
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:a:east:b:west", support: "continuous" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4000);
    expect(solveFloorTopology(result.plan).walls).toEqual([]);
    expect(result.plan.connections).toHaveLength(1);
    expect(result.plan.openings[0].x).toBe(4500);
    expect(result.addedRuleId).not.toBeNull();
    expectCanonical(result.plan);
  });

  it("Continuous→Inner：B.x 4000→4240、墙恢复 240、Opening 跟随 +240", () => {
    const plan = planWithOpening();
    const toContinuous = applyFloorConnectionSupportV3(plan, { connectionId: "connection:a:east:b:west", support: "continuous" });
    expect(toContinuous.ok).toBe(true);
    if (!toContinuous.ok) return;
    const back = applyFloorConnectionSupportV3(toContinuous.plan, { connectionId: "connection:a:east:b:west", support: "inner-wall" });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expect(solveFloorTopology(back.plan).walls).toHaveLength(1);
    expect(solveFloorTopology(back.plan).walls[0].thicknessMm).toBe(240);
    expect(back.plan.openings[0].x).toBe(4740);
    expectCanonical(back.plan);
  });

  it("同 Support 重复切换返回原 Plan（不产生新 History）", () => {
    const plan = planWithOpening();
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:a:east:b:west", support: "inner-wall" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toBe(plan);
    expect(result.addedRuleId).toBeNull();
  });
});

describe("V1.4A.2.1 Detach 容差与局部清理", () => {
  it("Jitter 15mm 保留 Connection，Materialize 把 Gap 拉回正式 240", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3255, 0);
    expect(result.removedConnectionIds).toEqual([]);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(3240);
    expect(solveFloorTopology(result.plan).walls).toHaveLength(1);
    expectCanonical(result.plan);
  });

  it("明显拖离（Gap 300）→ Detach", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3540, 0);
    expect(result.removedConnectionIds).toEqual(["connection:a:east:b:west"]);
  });

  it("lock-start Jitter 10mm 保留，Materialize 切向拉回锁定值", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 3000), room("b", 3240, 0, 3000, 3000)],
      connections: [connection(
        "connection:a:east:b:west",
        { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        { mode: "lock-start", offsetMm: 0 },
      )],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3240, 10);
    expect(result.removedConnectionIds).toEqual([]);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.y).toBe(0);
    expectCanonical(result.plan);
  });

  it("局部清理：只删刚 Detach 端点的规则，其它边与孤立规则保留", () => {
    const plan = v3Plan({
      slabs: [
        room("k", 0, 0, 4000, 4000),
        room("l", 4000, 0, 2000, 2000),
        room("c", 4000, 2000, 2000, 2000),
        room("d", 8000, 0, 2000, 2000),
      ],
      connections: [
        connection("connection:k:east:l:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "l", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:k:east:c:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
    });
    const withRules: FloorPlanState = {
      ...plan,
      supportRules: [
        { id: "r1", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" },
        { id: "r2", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "offset", startMm: 2000, endMm: 4000 } }, support: "continuous" },
        { id: "orphan", target: { kind: "slab-edge", slabId: "d", side: "west", range: { mode: "whole" } }, support: "inner-wall" },
      ],
    };
    const result = applyFloorSlabPhysicalMoveV3(withRules, "l", 5240, 0);
    expect(result.removedConnectionIds).toEqual(["connection:k:east:l:west"]);
    expect(result.plan.supportRules.map((rule) => rule.id).sort()).toEqual(["orphan", "r2"]);
  });

  it("Whole 规则在仍有其它 Connection 覆盖时保留", () => {
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
    });
    const withRule: FloorPlanState = {
      ...plan,
      supportRules: [
        { id: "whole-continuous", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "whole" } }, support: "continuous" },
      ],
    };
    const result = applyFloorSlabPhysicalMoveV3(withRule, "l", 5000, 0);
    expect(result.removedConnectionIds).toEqual(["connection:k:east:l:west"]);
    expect(result.plan.supportRules.map((rule) => rule.id)).toEqual(["whole-continuous"]);
  });
});

describe("V1.4A.2.2 Move 原子回滚", () => {
  it("Move 非法 Overlap：ok:false、返回原 Plan 引用、Connection/Opening 不变", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 4000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 4740, 500, 1000, 1000)],
    };
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 1000, 500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("move-slab-overlap");
    expect(result.plan).toBe(plan);
    expect(result.removedConnectionIds).toEqual([]);
    expect(plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expect(plan.connections).toHaveLength(1);
    expect(plan.openings[0].x).toBe(4740);
  });

  it("Preview 对重叠目标返回 valid:false + move-slab-overlap issue", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 4000, 4000), room("b", 4240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const preview = previewFloorSlabPhysicalMoveV3(plan, "b", 1000, 500);
    expect(preview.valid).toBe(false);
    expect(preview.issues.some((issue) => issue.code === "move-slab-overlap" && issue.objectIds?.includes("a"))).toBe(true);
    // 未重叠目标 valid:true。
    const okPreview = previewFloorSlabPhysicalMoveV3(plan, "b", 5240, 0);
    expect(okPreview.valid).toBe(true);
    expect(okPreview.issues).toEqual([]);
  });

  it("Move 非法不 Detach、不清理 Support Rules", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 4000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      supportRules: [
        { id: "r-inner", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "inner-wall" },
      ],
    };
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 1000, 500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.plan.supportRules.map((rule) => rule.id)).toEqual(["r-inner"]);
    expect(result.plan.connections).toHaveLength(1);
  });

  it("预置冲突规则的合法目标 Move → move-topology-conflict（Atomic Rollback）", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      supportRules: [
        { id: "r-inner", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "inner-wall" },
        { id: "r-cont", target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "whole" } }, support: "continuous" },
      ],
    };
    // 目标不重叠但 finalize 被 support-rule-conflict 阻断。
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 4240, 500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("move-topology-conflict");
    expect(result.plan).toBe(plan);
    expect(plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
  });
});

describe("V1.4A.2.2 Stable Anchor", () => {
  it("Anchor Jitter：拖 A -10mm，A 回到 0、B 保持 4240（整组不漂移）", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 4000, 4000), room("b", 4240, 0, 3000, 3000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "a", -10, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removedConnectionIds).toEqual([]);
    expect(result.plan.slabs.find((slab) => slab.id === "a")!.x).toBe(0);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expectCanonical(result.plan);
  });

  it("链式 A-B-C：拖 A 法向 +10mm，三块 X 全部保持正式位置", () => {
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 4000, 3000),
        room("b", 4240, 0, 3000, 3000),
        room("c", 7480, 0, 3000, 3000),
      ],
      connections: [
        abWall(),
        connection("connection:b:east:c:west", { slabId: "b", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "a", 10, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slabs.find((slab) => slab.id === "a")!.x).toBe(0);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(7480);
    expectCanonical(result.plan);
  });

  it("Slide Along Wall：B 切向 +500 保留、法向 Jitter 拉回正式 Gap、A 不动", () => {
    const plan = v3Plan({
      slabs: [room("a", 0, 0, 3000, 4000), room("b", 3240, 500, 2000, 2000)],
      connections: [abWall()],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "b", 3250, 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removedConnectionIds).toEqual([]);
    const a = result.plan.slabs.find((slab) => slab.id === "a")!;
    const b = result.plan.slabs.find((slab) => slab.id === "b")!;
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(b.x).toBe(3240);
    expect(b.y).toBe(1000);
    expect(result.plan.connections).toHaveLength(1);
    expectCanonical(result.plan);
  });

  it("T 型 B-D/K-C：轻拖 D 法向 10mm，D 回正式位置、其它 Slab 不漂移", () => {
    const plan = v3Plan({
      slabs: [
        room("b", 0, 0, 4000, 3000),
        room("d", 4240, 0, 3000, 3000),
        room("k", 4240, 3240, 3000, 3000),
        room("c", 7480, 0, 3000, 3000),
      ],
      connections: [
        connection("connection:b:east:d:west", { slabId: "b", side: "east", range: { mode: "auto-overlap" } }, { slabId: "d", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:k:south:d:north", { slabId: "k", side: "south", range: { mode: "auto-overlap" } }, { slabId: "d", side: "north", range: { mode: "auto-overlap" } }),
        connection("connection:d:east:c:west", { slabId: "d", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
    });
    const result = applyFloorSlabPhysicalMoveV3(plan, "d", 4250, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.removedConnectionIds).toEqual([]);
    const d = result.plan.slabs.find((slab) => slab.id === "d")!;
    expect(d.x).toBe(4240);
    expect(d.y).toBe(0);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(0);
    expect(result.plan.slabs.find((slab) => slab.id === "k")!.x).toBe(4240);
    expect(result.plan.slabs.find((slab) => slab.id === "k")!.y).toBe(3240);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(7480);
    expectCanonical(result.plan);
  });
});

describe("V1.4A.2.2 Support Range Split", () => {
  const kSide = () => ({
    plan: v3Plan({
      slabs: [
        room("k", 0, 0, 4000, 4000),
        room("l", 4000, 0, 2000, 2000),
        room("c", 4000, 2000, 2000, 2000),
      ],
      connections: [
        connection("connection:k:east:l:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "l", side: "west", range: { mode: "auto-overlap" } }),
        connection("connection:k:east:c:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
      ],
    }),
    withWhole: (): FloorPlanState => {
      const base = kSide().plan;
      return {
        ...base,
        supportRules: [
          { id: "whole-continuous", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "whole" } }, support: "continuous" },
        ],
      };
    },
  });

  const resolvedSupports = (plan: FloorPlanState) => {
    const solution = solveFloorTopology(plan);
    return new Map(solution.solvedConnections.map((item) => [item.connectionId, item.support]));
  };

  it("T 型局部墙：K east 0~2000→L、2000~4000→C，只切 K-L inner", () => {
    const result = applyFloorConnectionSupportV3(kSide().withWhole(), { connectionId: "connection:k:east:l:west", support: "inner-wall" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const supports = resolvedSupports(result.plan);
    expect(supports.get("connection:k:east:l:west")).toBe("inner-wall");
    expect(supports.get("connection:k:east:c:west")).toBe("continuous");
    // 墙只在 0~2000 段生成。
    const solution = solveFloorTopology(result.plan);
    expect(solution.walls).toHaveLength(1);
    expect(solution.walls[0].connectionId).toBe("connection:k:east:l:west");
    expect(solution.walls[0].lengthMm).toBeCloseTo(2000, 6);
    expect(result.plan.slabs.find((slab) => slab.id === "l")!.x).toBe(4240);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(4000);
    // Rule 层面：一条残段 continuous + 一条新 inner。
    expect(result.plan.supportRules.map((rule) => rule.support).sort()).toEqual(["continuous", "inner-wall"]);
    expectCanonical(result.plan);
  });

  it("反向：K-L inner→continuous 后两段均 continuous、无墙、规则合并回 whole", () => {
    const first = applyFloorConnectionSupportV3(kSide().withWhole(), { connectionId: "connection:k:east:l:west", support: "inner-wall" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const back = applyFloorConnectionSupportV3(first.plan, { connectionId: "connection:k:east:l:west", support: "continuous" });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const supports = resolvedSupports(back.plan);
    expect(supports.get("connection:k:east:l:west")).toBe("continuous");
    expect(supports.get("connection:k:east:c:west")).toBe("continuous");
    expect(solveFloorTopology(back.plan).walls).toEqual([]);
    // 相邻同 Support 规则自动合并回 whole continuous（幂等，不堆积）。
    expect(back.plan.supportRules).toHaveLength(1);
    expect(back.plan.supportRules[0].target.range).toEqual({ mode: "whole" });
    expect(back.plan.supportRules[0].support).toBe("continuous");
    expect(back.plan.slabs.find((slab) => slab.id === "l")!.x).toBe(4000);
    expectCanonical(back.plan);
  });

  it("中间 Range：0~6000 三段连接，只改中间 B inner，左右残段保留", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [
          room("k", 0, 0, 4000, 6000),
          room("a", 4000, 0, 2000, 2000),
          room("b", 4000, 2000, 2000, 2000),
          room("c", 4000, 4000, 2000, 2000),
        ],
        connections: [
          connection("connection:k:east:a:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "a", side: "west", range: { mode: "auto-overlap" } }),
          connection("connection:k:east:b:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "b", side: "west", range: { mode: "auto-overlap" } }),
          connection("connection:k:east:c:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "c", side: "west", range: { mode: "auto-overlap" } }),
        ],
      }),
      supportRules: [
        { id: "whole-continuous", target: { kind: "slab-edge", slabId: "k", side: "east", range: { mode: "whole" } }, support: "continuous" },
      ],
    };
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:k:east:b:west", support: "inner-wall" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const supports = resolvedSupports(result.plan);
    expect(supports.get("connection:k:east:a:west")).toBe("continuous");
    expect(supports.get("connection:k:east:b:west")).toBe("inner-wall");
    expect(supports.get("connection:k:east:c:west")).toBe("continuous");
    const solution = solveFloorTopology(result.plan);
    expect(solution.walls).toHaveLength(1);
    expect(solution.walls[0].connectionId).toBe("connection:k:east:b:west");
    expect(solution.walls[0].lengthMm).toBeCloseTo(2000, 6);
    expect(result.plan.slabs.find((slab) => slab.id === "a")!.x).toBe(4000);
    expect(result.plan.slabs.find((slab) => slab.id === "c")!.x).toBe(4000);
    expect(result.plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
    expectCanonical(result.plan);
  });

  it("往返切换幂等：Inner→Continuous→Inner 规则数量稳定、语义等价", () => {
    const first = applyFloorConnectionSupportV3(kSide().withWhole(), { connectionId: "connection:k:east:l:west", support: "inner-wall" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const continuous = applyFloorConnectionSupportV3(first.plan, { connectionId: "connection:k:east:l:west", support: "continuous" });
    expect(continuous.ok).toBe(true);
    if (!continuous.ok) return;
    const second = applyFloorConnectionSupportV3(continuous.plan, { connectionId: "connection:k:east:l:west", support: "inner-wall" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.plan.supportRules).toHaveLength(first.plan.supportRules.length);
    expect(resolvedSupports(second.plan)).toEqual(resolvedSupports(first.plan));
    expectCanonical(second.plan);
  });

  it("Support 切换失败 Atomic Rollback：plan === 原引用、Rule 未写入", () => {
    const plan = v3Plan({
      slabs: [
        room("a", 0, 0, 4000, 2000),
        room("b", 4240, 0, 3000, 3000),
        room("c", 1100, 2100, 3000, 900),
      ],
      connections: [abWall()],
    });
    // Inner→Continuous 使 B 左移到 4000，与 C（1100~4100 × 2100~3000）正面积重叠 → solved-slab-overlap 阻断。
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:a:east:b:west", support: "continuous" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("mutation-blocked-by-topology");
    expect(result.plan).toBe(plan);
    expect(plan.supportRules).toEqual([]);
    expect(plan.slabs.find((slab) => slab.id === "b")!.x).toBe(4240);
  });

  it("规则在 B 端点（l west whole）同样 Range Split", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("k", 0, 0, 4000, 4000), room("l", 4000, 1000, 2000, 4000)],
        connections: [
          connection("connection:k:east:l:west", { slabId: "k", side: "east", range: { mode: "auto-overlap" } }, { slabId: "l", side: "west", range: { mode: "auto-overlap" } }),
        ],
      }),
      supportRules: [
        { id: "r-l-west", target: { kind: "slab-edge", slabId: "l", side: "west", range: { mode: "whole" } }, support: "continuous" },
      ],
    };
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:k:east:l:west", support: "inner-wall" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.supportRules.map((rule) => rule.id).sort()).toEqual([
      "connection-support:connection:k:east:l:west:inner-wall",
      "r-l-west:remain:3000:4000",
    ]);
    expect(resolvedSupports(result.plan).get("connection:k:east:l:west")).toBe("inner-wall");
    expect(result.plan.slabs.find((slab) => slab.id === "l")!.x).toBe(4240);
    expectCanonical(result.plan);
  });

  it("opening-edge 规则绝不修改", () => {
    const plan: FloorPlanState = {
      ...v3Plan({
        slabs: [room("a", 0, 0, 4000, 3000), room("b", 4240, 0, 3000, 3000)],
        connections: [abWall()],
      }),
      openings: [opening("o", 4740, 500, 1000, 1000)],
      supportRules: [
        { id: "r-open", target: { kind: "opening-edge", openingId: "o", side: "west", range: { mode: "whole" } }, support: "opening-cut" },
      ],
    };
    const result = applyFloorConnectionSupportV3(plan, { connectionId: "connection:a:east:b:west", support: "continuous" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.supportRules.map((rule) => rule.id)).toContain("r-open");
    expect(result.plan.supportRules.find((rule) => rule.id === "r-open")!.target.kind).toBe("opening-edge");
  });
});
