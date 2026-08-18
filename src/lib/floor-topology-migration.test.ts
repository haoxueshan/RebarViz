import { describe, expect, it } from "vitest";
import {
  GOLDEN_MENG,
  GOLDEN_MENG_EXPECTED_PAIRS,
  goldenMengLegacyV2Plan,
} from "./__fixtures__/floor-topology-golden-meng";
import { buildFloorAssembly } from "./floor-assembly";
import { buildFloorPhysicalLayout } from "./floor-physical-layout";
import { validateFloorPlanState } from "./floor-topology-adapter";
import { migrateFloorPlanV2ToV3 } from "./floor-topology-migration";
import {
  buildFloorTopologyBoundarySegmentsV3,
  buildFloorTopologyExteriorRanges,
  solveFloorTopology,
} from "./floor-topology-solver";

describe("Floor Topology V1.4A Golden Fixture：孟", () => {
  it("Golden 1：B 净宽 + 内墙 + D 净宽 = K 净宽（业务语义等式）", () => {
    const { bWidth, dWidth, wall, kWidth } = GOLDEN_MENG.equation;
    expect(bWidth + wall + dWidth).toBe(kWidth);
    expect(kWidth).toBe(7270);
  });

  it("Golden 2：迁移必须识别 D-C（Gap=240 为真实墙带）", () => {
    const legacy = goldenMengLegacyV2Plan();
    expect(legacy.slabs.find((slab) => slab.id === "meng-d")!.x + 3530).toBe(5354);
    expect(legacy.slabs.find((slab) => slab.id === "meng-c")!.x).toBe(5594);
    const { plan, report } = migrateFloorPlanV2ToV3(legacy);
    expect(plan.coordinateModel).toBe("clear-space-physical-v2");
    const dc = plan.connections?.find((connection) =>
      (connection.a.slabId === "meng-d" && connection.b.slabId === "meng-c")
      || (connection.a.slabId === "meng-c" && connection.b.slabId === "meng-d"));
    expect(dc).toBeDefined();
    expect(dc?.source).toBe("legacy-wall-gap");
    expect(dc?.confidence).toBe("high");
    expect(report.wallGapConnections).toBeGreaterThanOrEqual(1);
    expect(report.exactSharedConnections).toBeGreaterThanOrEqual(11);
  });

  it("Golden 3：Physical X 精确（K 宽 7270 保留，D.east=K.east=5834）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const x = new Map(solution.slabs.map((slab) => [slab.slabId, slab.x]));
    expect(x.get("meng-a")).toBe(GOLDEN_MENG.physicalX.a);
    expect(x.get("meng-b")).toBe(GOLDEN_MENG.physicalX.b);
    expect(x.get("meng-d")).toBe(GOLDEN_MENG.physicalX.d);
    expect(x.get("meng-k")).toBe(GOLDEN_MENG.physicalX.k);
    expect(x.get("meng-d")! + 3530).toBe(GOLDEN_MENG.physicalX.dEast);
    expect(x.get("meng-k")! + 7270).toBe(GOLDEN_MENG.physicalX.kEast);
    expect(x.get("meng-c")).toBe(GOLDEN_MENG.physicalX.c);
    expect(x.get("meng-l")).toBe(GOLDEN_MENG.physicalX.l);
  });

  it("Golden 4：K 净宽与 B/D 净尺寸不被修改", () => {
    const legacy = goldenMengLegacyV2Plan();
    const { plan } = migrateFloorPlanV2ToV3(legacy);
    expect(plan.slabs.find((slab) => slab.id === "meng-k")?.width).toBe(7270);
    expect(plan.slabs.find((slab) => slab.id === "meng-b")?.width).toBe(3500);
    expect(plan.slabs.find((slab) => slab.id === "meng-d")?.width).toBe(3530);
    expect(plan.slabs.map((slab) => slab.id).sort()).toEqual(legacy.slabs.map((slab) => slab.id).sort());
  });

  it("Golden 5：D-C 墙（vertical、240、x=5834）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const wall = solution.walls.find((item) =>
      item.slabIds.includes("meng-d") && item.slabIds.includes("meng-c"));
    expect(wall).toBeDefined();
    expect(wall?.orientation).toBe("vertical");
    expect(wall?.thicknessMm).toBe(240);
    expect(wall?.x).toBe(5834);
    expect(wall?.width).toBe(240);
    expect(wall!.lengthMm).toBeGreaterThan(0);
  });

  it("Golden 6：B-D 墙（240）且 D.x = B.x + B.width + 240", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const wall = solution.walls.find((item) =>
      item.slabIds.includes("meng-b") && item.slabIds.includes("meng-d"));
    expect(wall?.thicknessMm).toBe(240);
    const b = solution.slabs.find((item) => item.slabId === "meng-b")!;
    const d = solution.slabs.find((item) => item.slabId === "meng-d")!;
    expect(d.x).toBe(b.x + b.width + 240);
  });

  it("Golden 7：K-C 墙（240）且 C.x = K.x + K.width + 240", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const wall = solution.walls.find((item) =>
      item.slabIds.includes("meng-k") && item.slabIds.includes("meng-c"));
    expect(wall?.thicknessMm).toBe(240);
    const k = solution.slabs.find((item) => item.slabId === "meng-k")!;
    const c = solution.slabs.find((item) => item.slabId === "meng-c")!;
    expect(c.x).toBe(k.x + k.width + 240);
  });

  it("Golden 8：T Junction 垂直墙终止于水平墙顶，交接无缝且不算 Clear Slab Overlap", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const bdWall = solution.walls.find((item) =>
      item.slabIds.includes("meng-b") && item.slabIds.includes("meng-d"))!;
    const bK = solution.walls.find((item) =>
      item.slabIds.includes("meng-b") && item.slabIds.includes("meng-k") && item.orientation === "horizontal")!;
    const dK = solution.walls.find((item) =>
      item.slabIds.includes("meng-d") && item.slabIds.includes("meng-k") && item.orientation === "horizontal")!;
    // B-D 竖向墙底部精确落在 B/D-K 水平墙顶部（0 空洞），且墙不缩短 240。
    expect(Math.abs(bK.y + bK.height - bdWall.y)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(dK.y + dK.height - bdWall.y)).toBeLessThanOrEqual(1e-6);
    expect(bdWall.x + 1e-6).toBeGreaterThanOrEqual(bK.x);
    expect(bdWall.x + bdWall.width).toBeLessThanOrEqual(dK.x + dK.width + 1e-6);
    expect(bdWall.height).toBe(3270);
    // Wall 交接不是 Slab 重叠：Solver 不报 constraint conflict。
    expect(solution.issues.some((issue) => issue.code === "topology-constraint-conflict")).toBe(false);
  });

  it("Golden 9：C-L 水平内墙 240 且 K-C/K-L 竖向墙可形成 junction", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const clWall = solution.walls.find((item) =>
      item.slabIds.includes("meng-c") && item.slabIds.includes("meng-l"));
    expect(clWall?.orientation).toBe("horizontal");
    expect(clWall?.thicknessMm).toBe(240);
    // K 东侧竖向墙：K-C 与 K-L 两段（x=5834，thickness 240）。
    const kEastVerticalWalls = solution.walls.filter((item) =>
      item.orientation === "vertical" && item.slabIds.includes("meng-k") && item.x === 5834);
    expect(kEastVerticalWalls).toHaveLength(2);
    expect(kEastVerticalWalls.every((wall) => wall.thicknessMm === 240)).toBe(true);
  });

  it("Golden 10：Assembly 一个主要组件，D-C 不因 240 Gap 判 Disconnected", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const assembly = buildFloorAssembly(plan);
    expect(assembly.connectedComponentCount).toBe(1);
    expect(assembly.isFullyConnected).toBe(true);
    expect(assembly.disconnectedSlabIds).toEqual([]);
    expect(assembly.primarySlabIds.length).toBe(8);
  });

  it("Golden 11：全部 12 组逻辑连接存在", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const connections = plan.connections ?? [];
    for (const [leftId, rightId] of GOLDEN_MENG_EXPECTED_PAIRS) {
      const found = connections.some((connection) =>
        (connection.a.slabId === leftId && connection.b.slabId === rightId)
        || (connection.a.slabId === rightId && connection.b.slabId === leftId));
      expect(found, `缺少连接 ${leftId} ↔ ${rightId}`).toBe(true);
    }
  });

  it("Golden 12：迁移不使用 snapDistanceMm=1500 推断墙带且保留其值", () => {
    const legacy = goldenMengLegacyV2Plan();
    expect(legacy.snapDistanceMm).toBe(1500);
    const { plan, report } = migrateFloorPlanV2ToV3(legacy);
    expect(plan.snapDistanceMm).toBe(1500);
    // D-C 之外不允许出现“所有1500以内都当墙”的过度推断：
    // F-K 等 exact 已连接；检查没有把 A 与 F 这类 5840mm 之外的距离误判。
    const af = plan.connections?.find((connection) =>
      (connection.a.slabId === "meng-a" && connection.b.slabId === "meng-f")
      || (connection.a.slabId === "meng-f" && connection.b.slabId === "meng-a"));
    expect(af).toBeUndefined();
    expect(report.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("Golden 13：Golden Y 以 K 为 Anchor（B/D/A=13130、E=10730、F=6810、C=11078）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    const y = new Map(solution.slabs.map((slab) => [slab.slabId, slab.y]));
    expect(y.get("meng-k")).toBe(GOLDEN_MENG.physicalY.k);
    expect(y.get("meng-b")).toBe(GOLDEN_MENG.physicalY.b);
    expect(y.get("meng-d")).toBe(GOLDEN_MENG.physicalY.d);
    expect(y.get("meng-a")).toBe(GOLDEN_MENG.physicalY.a);
    expect(y.get("meng-e")).toBe(GOLDEN_MENG.physicalY.e);
    expect(y.get("meng-f")).toBe(GOLDEN_MENG.physicalY.f);
    expect(y.get("meng-l")).toBe(GOLDEN_MENG.physicalY.l);
    expect(y.get("meng-c")).toBe(GOLDEN_MENG.physicalY.c);
  });

  it("Golden 14：Physical Layout V3 输出（禁止双重加墙）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const layout = buildFloorPhysicalLayout(plan);
    const physicalD = layout.slabs.find((slab) => slab.slabId === "meng-d")!;
    expect(physicalD.x).toBe(2304);
    const innerWalls = layout.walls.filter((wall) => wall.kind === "inner-wall");
    expect(innerWalls.length).toBeGreaterThanOrEqual(11);
    const dcWall = innerWalls.find((wall) =>
      wall.slabIds.includes("meng-d") && wall.slabIds.includes("meng-c"));
    expect(dcWall?.thicknessMm).toBe(240);
    expect(dcWall?.x).toBe(5834);
    expect(dcWall?.width).toBe(240);
  });

  it("Golden 15：V3 Validation 无 D-C near miss；迁移结果通过完整 Solver Validation", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const issues = validateFloorPlanState(plan);
    expect(issues.map((issue) => issue.code)).not.toContain("slab-edge-near-miss");
    expect(issues.filter((issue) => issue.level === "error")).toEqual([]);
    // 迁移产生的每条 Connection 都通过 Solver Validation（含 solved-slab-overlap / 区间冲突）。
    const solution = solveFloorTopology(plan);
    expect(solution.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(solution.solvedConnections.every((solved) => solved.valid && solved.lengthMm > 0)).toBe(true);
  });

  it("Golden 16：局部 Connection Side 未被覆盖区间生成外墙（Atomic 与 Physical 同源）", () => {
    const { plan } = migrateFloorPlanV2ToV3(goldenMengLegacyV2Plan());
    const solution = solveFloorTopology(plan);
    // K east 高 6090，被 K-C / K-L 部分覆盖，未被覆盖的区间必须仍有外墙。
    const kEastExterior = buildFloorTopologyExteriorRanges(plan, solution)
      .filter((range) => range.slabId === "meng-k" && range.side === "east");
    expect(kEastExterior.length).toBeGreaterThan(0);
    const coveredOnEast = 6090 - kEastExterior.reduce((sum, range) => sum + (range.endMm - range.startMm), 0);
    expect(coveredOnEast).toBeGreaterThan(0);
    expect(coveredOnEast).toBeLessThan(6090);
    const atomicExterior = buildFloorTopologyBoundarySegmentsV3(plan, solution)
      .filter((segment) => segment.geometryKind === "building-exterior" && segment.slabIds.includes("meng-k") && segment.id.includes(":east:"));
    const layout = buildFloorPhysicalLayout(plan);
    const physicalExterior = layout.walls.filter((wall) =>
      wall.kind === "outer-wall" && wall.slabIds.includes("meng-k") && wall.side === "east");
    expect(atomicExterior.length).toBe(physicalExterior.length);
  });
});
