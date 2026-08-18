import { describe, expect, it } from "vitest";
import {
  previewFloorDock,
  previewFloorDockAuto,
  type FloorDockRequest,
} from "./floor-docking";
import { buildFloorAtomicBoundarySegments, type FloorPlanState } from "./floor-plan";
import { buildFloorPhysicalLayout } from "./floor-physical-layout";
import {
  applyFloorSlabJoin,
  findFloorSlabJoinCandidates,
  findFloorUnresolvedJoinCandidates,
  selectFloorSlabJoinCandidate,
  validateFloorJoinCandidate,
} from "./floor-slab-join";

function buildPlan(slabs: FloorPlanState["slabs"], supportRules: FloorPlanState["supportRules"] = []): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [],
    supportRules,
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

const slabA = { id: "a", name: "板区A", type: "room" as const, x: 0, y: 0, width: 4200, height: 3600 };
const slabB = { id: "b", name: "板区B", type: "room" as const, x: 4280, y: 0, width: 3600, height: 3600 };

function candidatesFor(plan: FloorPlanState, sourceId: string) {
  return findFloorSlabJoinCandidates(plan, sourceId);
}

describe("Floor Slab Join 板边磁吸连接", () => {
  it("80mm Gap：候选有效且距离=80，Join 后精确 4200", () => {
    const plan = buildPlan([slabA, slabB]);
    const candidates = candidatesFor(plan, "b");
    expect(candidates.length).toBeGreaterThan(0);
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin).toBeDefined();
    expect(eastJoin!.distanceMm).toBe(80);
    expect(eastJoin!.targetX).toBe(4200);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(4200);
  });

  it("20mm Gap：候选有效，Join 后精确共边", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4220 }]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin?.distanceMm).toBe(20);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(4200);
  });

  it("100mm Gap：snapDistance=150 时候选有效，Join 精确 4200", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4300 }]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin?.distanceMm).toBe(100);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(4200);
  });

  it("超过 Capture（200mm）：无候选", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4400 }]);
    const candidates = candidatesFor(plan, "b");
    expect(candidates.filter((candidate) => candidate.targetSlabId === "a")).toEqual([]);
  });

  it("50mm 轻微重叠：候选修复为精确共边", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4150 }]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin?.distanceMm).toBe(50);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(4200);
  });

  it("Partial Shared Edge：Y 投影 2600mm 仍为合法 Join", () => {
    const plan = buildPlan([
      slabA,
      { ...slabB, x: 4280, y: 1000 },
    ]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a" && candidate.alignment === "preserve");
    expect(eastJoin).toBeDefined();
    expect(eastJoin!.projectedSharedLengthMm).toBe(2600);
  });

  it("Zero Shared Length（Y 完全不重叠）：跨轴移动过大时不自动吸", () => {
    const plan = buildPlan([
      slabA,
      { ...slabB, x: 4280, y: 5000 },
    ]);
    const candidates = candidatesFor(plan, "b");
    // preserve 共享长度为0 → 不能成为操作候选；start/center/end 跨轴移动均超过捕捉距离 → 不自动吸。
    expect(candidates).toEqual([]);
  });

  it("Corner Touch：共享长度为0，不产生候选", () => {
    const plan = buildPlan([
      slabA,
      { id: "b", name: "板区B", type: "room", x: 4200, y: 3600, width: 2000, height: 2000 },
    ]);
    const candidates = candidatesFor(plan, "b");
    expect(candidates).toEqual([]);
  });

  it("T型：B 宽 2000 靠近 A 北边，形成 2000mm 共享", () => {
    const plan = buildPlan([
      { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 6000, height: 3600 },
      { id: "b", name: "板区B", type: "room", x: 2000, y: 3700, width: 2000, height: 3000 },
    ]);
    const candidates = candidatesFor(plan, "b");
    const northJoin = candidates.find((candidate) => candidate.sourceSide === "south" && candidate.targetSlabId === "a");
    expect(northJoin).toBeDefined();
    expect(northJoin!.projectedSharedLengthMm).toBe(2000);
    const next = applyFloorSlabJoin(plan, northJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.y).toBe(3600);
  });

  it("第三方冲突：B Join A 会与 C 面积重叠 → 候选无效", () => {
    const plan = buildPlan([
      slabA,
      { ...slabB, x: 4280, y: 0 },
      { id: "c", name: "板区C", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
    ]);
    const candidates = candidatesFor(plan, "b");
    // 候选搜索阶段已排除第三方冲突。
    expect(candidates.some((candidate) => candidate.targetSlabId === "a")).toBe(false);
  });

  it("Continuous：已有 continuous 规则预测 continuous，Join 后物理 Gap 0", () => {
    const plan = buildPlan(
      [slabA, slabB],
      [{ id: "r1", target: { kind: "slab-edge", slabId: "b", side: "west", range: { mode: "whole" } }, support: "continuous" }],
    );
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin?.predictedSupport).toBe("continuous");
    expect(eastJoin?.predictedWallThicknessMm).toBe(0);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    const adjacency = buildFloorAtomicBoundarySegments(next).filter(
      (segment) => segment.geometryKind === "shared-slab" && segment.slabIds.includes("a") && segment.slabIds.includes("b"),
    );
    expect(adjacency.length).toBeGreaterThan(0);
    expect(adjacency.every((segment) => segment.support === "continuous")).toBe(true);
    const layout = buildFloorPhysicalLayout(next);
    expect(layout.walls.filter((wall) => wall.kind === "inner-wall")).toEqual([]);
  });

  it("Inner Wall 默认：Join 后 shared-slab 默认解析 inner-wall，物理墙 240", () => {
    const plan = buildPlan([slabA, slabB]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a");
    expect(eastJoin?.predictedSupport).toBe("inner-wall");
    expect(eastJoin?.predictedWallThicknessMm).toBe(240);
    const next = applyFloorSlabJoin(plan, eastJoin!);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(4200);
    // Atomic shared-slab 存在且支持为 inner-wall。
    const shared = buildFloorAtomicBoundarySegments(next).filter(
      (segment) => segment.geometryKind === "shared-slab" && segment.slabIds.includes("a") && segment.slabIds.includes("b"),
    );
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((segment) => segment.support === "inner-wall")).toBe(true);
    // Physical：B.physicalX = 4440，内墙 240。
    const layout = buildFloorPhysicalLayout(next);
    const physicalB = layout.slabs.find((item) => item.slabId === "b");
    expect(physicalB?.x).toBe(4440);
    const innerWalls = layout.walls.filter((wall) => wall.kind === "inner-wall" && wall.slabIds.includes("a") && wall.slabIds.includes("b"));
    expect(innerWalls.length).toBeGreaterThan(0);
    expect(innerWalls[0].thicknessMm).toBe(240);
  });

  it("validateFloorJoinCandidate：合法候选 valid=true 且 support=inner-wall", () => {
    const plan = buildPlan([slabA, slabB]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a")!;
    const result = validateFloorJoinCandidate(plan, eastJoin);
    expect(result.valid).toBe(true);
    expect(result.support).toBe("inner-wall");
    expect(result.sharedLengthMm).toBe(3600);
  });

  it("精确 Net 坐标：Join 后 B.x 严格等于 target.x + target.width（无浮点误差）", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4287 }]);
    const candidates = candidatesFor(plan, "b");
    const eastJoin = candidates.find((candidate) => candidate.sourceSide === "west" && candidate.targetSlabId === "a")!;
    const next = applyFloorSlabJoin(plan, eastJoin);
    expect(next.slabs.find((slab) => slab.id === "b")!.x).toBe(slabA.x + slabA.width);
  });

  it("候选排序：移动距离小优先，其次共享长度大", () => {
    const plan = buildPlan([
      slabA,
      { ...slabB, x: 4280, y: 0 },
      { id: "c", name: "板区C", type: "room", x: 4000, y: 2000, width: 3000, height: 3000 },
    ]);
    const candidates = candidatesFor(plan, "b");
    for (let index = 1; index < candidates.length; index += 1) {
      const previous = candidates[index - 1];
      const current = candidates[index];
      expect(previous.moveDistanceMm).toBeLessThanOrEqual(current.moveDistanceMm + 1e-9);
    }
  });

  it("Hysteresis：锁定候选在 180mm 内保持，超过释放切换", () => {
    const plan = buildPlan([
      slabA,
      { ...slabB, x: 4290, y: 0 },
      { id: "c", name: "板区C", type: "room", x: 0, y: 100, width: 3000, height: 3000 },
    ]);
    const nearCandidates = candidatesFor(plan, "b");
    expect(nearCandidates.length).toBeGreaterThan(0);
    const locked = nearCandidates[0];
    // 用户手指抖远：release=180 时仍保持锁定候选。
    const farPlan = buildPlan([
      slabA,
      { ...slabB, x: 4320, y: 0 },
      { id: "c", name: "板区C", type: "room", x: 0, y: 100, width: 3000, height: 3000 },
    ]);
    const farCandidates = candidatesFor(farPlan, "b");
    const kept = selectFloorSlabJoinCandidate(farCandidates, locked, 180);
    expect(kept).not.toBeNull();
    expect(`${kept!.sourceSide}:${kept!.targetSlabId}`).toBe(`${locked.sourceSide}:${locked.targetSlabId}`);
    // 超过 180mm：释放锁定。
    const beyondPlan = buildPlan([
      slabA,
      { ...slabB, x: 4440, y: 0 },
    ]);
    const beyondCandidates = candidatesFor(beyondPlan, "b");
    const released = selectFloorSlabJoinCandidate(beyondCandidates, locked, 180);
    expect(released).toBeNull();
  });

  it("findFloorUnresolvedJoinCandidates：扫描 12 板布局并识别未连接强候选", () => {
    const slabs: FloorPlanState["slabs"] = [];
    for (let index = 0; index < 12; index += 1) {
      slabs.push({
        id: `s${index}`,
        name: `板区${index + 1}`,
        type: "room",
        x: index * 3680,
        y: 0,
        width: 3600,
        height: 3600,
      });
    }
    const plan = buildPlan(slabs);
    const unresolved = findFloorUnresolvedJoinCandidates(plan);
    // 每对相邻板区距离 80mm，均低于 150 捕捉距离。
    expect(unresolved.length).toBeGreaterThan(0);
    const pair = unresolved.find((candidate) =>
      (candidate.sourceSlabId === "s0" && candidate.targetSlabId === "s1")
      || (candidate.sourceSlabId === "s1" && candidate.targetSlabId === "s0"));
    expect(pair).toBeDefined();
  });

  it("Dock False Positive：X 贴齐但 Y 无重叠 → preview.valid=false / no-shared-edge", () => {
    const plan = buildPlan([
      slabA,
      { id: "b", name: "板区B", type: "room", x: 4300, y: 5000, width: 3600, height: 3000 },
    ]);
    const request: FloorDockRequest = { sourceSlabId: "b", targetSlabId: "a", direction: "east", alignment: "preserve" };
    const preview = previewFloorDock(plan, request)!;
    expect(preview.valid).toBe(false);
    expect(preview.invalidReason).toBe("no-shared-edge");
    expect(preview.sharedLengthMm).toBe(0);
  });

  it("Dock 成功：Y 存在投影 → valid=true、sharedLength>0、inner-wall、物理 Gap 240", () => {
    const plan = buildPlan([slabA, { ...slabB, x: 4280, y: 0 }]);
    const request: FloorDockRequest = { sourceSlabId: "b", targetSlabId: "a", direction: "east", alignment: "preserve" };
    const preview = previewFloorDock(plan, request)!;
    expect(preview.valid).toBe(true);
    expect(preview.sharedLengthMm).toBe(3600);
    expect(preview.resultSupport).toBe("inner-wall");
    expect(preview.physicalGapMm).toBe(240);
  });

  it("Dock Auto：preserve 共享为0时选择移动最小的有效对齐形成真实 shared-slab", () => {
    const plan = buildPlan([
      slabA,
      { id: "b", name: "板区B", type: "room", x: 4300, y: 5000, width: 2000, height: 2000 },
    ]);
    const auto = previewFloorDockAuto(plan, "b", "a", "east")!;
    expect(auto.valid).toBe(true);
    expect(auto.sharedLengthMm).toBe(2000);
    expect(auto.alignment).not.toBe("preserve");
  });
});
