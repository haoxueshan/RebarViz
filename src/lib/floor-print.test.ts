import { describe, expect, it } from "vitest";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "./floor-bottom-calculator";
import type { FloorOpening, FloorPlanState, FloorSlab } from "./floor-plan";
import {
  assignFloorPrintMarks,
  buildFloorPrintContent,
  buildFloorPrintSnapshot,
  DEFAULT_FLOOR_PRINT_OPTIONS,
  detectFloorPrintPreset,
  floorPrintOptionsForPreset,
  getFloorPrintEligibility,
  normalizeFloorPrintOptions,
  validateFloorPrintBomConsistency,
  type FloorPrintBomCandidate,
} from "./floor-print";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
} from "./floor-top-calculator";
import { buildFloorPrintSlabRefs } from "./floor-print-layout";

function slab(id: string, width = 4200, height = 3600): FloorSlab {
  return { id, name: `板区${id.toUpperCase()}`, type: "room", x: 0, y: 0, width, height };
}

function opening(id: string, x: number, y: number, width: number, height: number): FloorOpening {
  return { id, name: "楼梯间", type: "stair", x, y, width, height };
}

function plan(
  floorSlab = slab("a"),
  openings: FloorOpening[] = [],
): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs: [floorSlab],
    openings,
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

function calculations(state = plan()) {
  return {
    bottom: calculateFloorBottomRebar(state, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE)),
    top: calculateFloorTopRebar(state, structuredClone(DEFAULT_FLOOR_TOP_STATE)),
  };
}

function snapshotInput(state = plan()) {
  const { bottom, top } = calculations(state);
  return {
    plan: state,
    bottom,
    top,
    bottomRoleReviewRequired: false,
    topRoleReviewRequired: false,
    invalidDraftCount: 0,
    project: { projectName: "郝家住宅", floorName: "二层顶板", remark: "现场复核后下料" },
    options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
    createdAt: "2026-08-10T12:00:00.000Z",
    snapshotId: "floor-print-test",
  } as const;
}

describe("Floor Print资格与正式数据一致性", () => {
  it("合法Bottom/Top计算具备正式打印资格，迁移复核与无效草稿会阻止", () => {
    const input = snapshotInput();
    expect(getFloorPrintEligibility(input)).toMatchObject({ eligible: true, errors: [] });

    expect(getFloorPrintEligibility({
      ...input,
      bottomRoleReviewRequired: true,
    })).toMatchObject({ eligible: false });
    expect(getFloorPrintEligibility({
      ...input,
      bottomRoleReviewRequired: true,
    }).errors.map((issue) => issue.code)).toContain("floor-print-role-review-required");

    expect(getFloorPrintEligibility({ ...input, invalidDraftCount: 1 }).errors.map((issue) => issue.code))
      .toContain("floor-print-draft-invalid");
  });

  it("板边Near-Miss通过Geometry错误阻止正式打印资格", () => {
    const state = plan();
    state.slabs.push({ ...slab("b", 3600, 3600), x: 4200.5 });
    const bottom = calculateFloorBottomRebar(state, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE));
    const top = calculateFloorTopRebar(state, structuredClone(DEFAULT_FLOOR_TOP_STATE));
    const eligibility = getFloorPrintEligibility({
      plan: state,
      bottom,
      top,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.errors.map((issue) => issue.code)).toContain("slab-edge-near-miss");
  });

  it("正式分组必须完整覆盖FloorBarPiece并与长度、重量一致", () => {
    const { bottom, top } = calculations();
    expect(validateFloorPrintBomConsistency(bottom, top)).toEqual([]);
    const broken = structuredClone(bottom);
    broken.groups[0].count += 1;
    expect(validateFloorPrintBomConsistency(broken, top).map((issue) => issue.code))
      .toContain("floor-print-bom-consistency-error");
  });

  it("Snapshot建立后不受原始plan和calculation继续修改影响", () => {
    const input = snapshotInput();
    const snapshot = buildFloorPrintSnapshot(input);
    const originalName = snapshot.geometry.slabs[0].name;
    const originalWeight = snapshot.summary.totalWeightKg;
    input.plan.slabs[0].name = "已修改";
    input.bottom.totalWeightKg = 999999;
    expect(snapshot.geometry.slabs[0].name).toBe(originalName);
    expect(snapshot.summary.totalWeightKg).toBe(originalWeight);
    expect(snapshot.status).toBe("official");
    expect(snapshot.parameters.coordinateModel).toBe("net-layout-v1");
    expect(snapshot.source.coordinateModel).toBe("net-layout-v1");
  });

  it("净跨拓扑允许负坐标，打印只禁止负长度而不误判世界坐标", () => {
    const state = plan({ ...slab("a"), x: -4200, y: -3600 });
    const input = snapshotInput(state);
    const snapshot = buildFloorPrintSnapshot(input);
    expect(snapshot.geometry.bounds).toMatchObject({ minX: -4200, minY: -3600 });
    expect(snapshot.bottom.pieces.some((piece) => piece.runStartMm < 0 || piece.positionMm < 0)).toBe(true);
  });

  it("远端未覆盖洞口保留在快照但不压缩正式楼板图范围", () => {
    const state = plan(slab("a", 6000, 4000), [opening("far", 50000, 50000, 1000, 1000)]);
    const input = snapshotInput(state);
    const snapshot = buildFloorPrintSnapshot(input);
    expect(snapshot.geometry.openings.map((item) => item.id)).toContain("far");
    expect(snapshot.geometry.bounds).toEqual({ minX: 0, minY: 0, maxX: 6000, maxY: 4000 });
  });

  it("现场与完整报告模板有确定章节，自定义改动可被识别", () => {
    const site = floorPrintOptionsForPreset("site");
    expect(site).toMatchObject({
      preset: "site",
      layoutMode: "site",
      paperSize: "A4",
      orientation: "landscape",
      lengthUnit: "mm",
      sections: { summary: false, floorPlan: true, bottomPlan: true, topPlan: true, combinedBom: false, calculationParameters: false },
    });
    const full = floorPrintOptionsForPreset("full");
    expect(full).toMatchObject({ preset: "full", layoutMode: "report", paperSize: "A3", orientation: "landscape", lengthUnit: "mm" });
    expect(Object.values(full.sections).every(Boolean)).toBe(true);
    expect(detectFloorPrintPreset({ ...site, sections: { ...site.sections, summary: true } })).toBe("custom");
  });

  it("keeps page composition when a preset becomes custom", () => {
    const siteCustom = {
      ...floorPrintOptionsForPreset("site"),
      sections: { ...floorPrintOptionsForPreset("site").sections, diameterSummary: false },
    };
    expect(detectFloorPrintPreset(siteCustom)).toBe("custom");
    expect(normalizeFloorPrintOptions({ ...siteCustom, preset: "custom" })?.layoutMode).toBe("site");

    const fullCustom = {
      ...floorPrintOptionsForPreset("full"),
      sections: { ...floorPrintOptionsForPreset("full").sections, calculationParameters: false },
    };
    expect(detectFloorPrintPreset(fullCustom)).toBe("custom");
    expect(normalizeFloorPrintOptions({ ...fullCustom, preset: "custom" })?.layoutMode).toBe("report");
  });
});

describe("Floor Print BOM与编号", () => {
  it("runs a twelve-slab residential stress plan through the formal Bottom, Top and Through calculations", () => {
    const slabs: FloorSlab[] = [
      ["a", 0, 0, 3600, 2600], ["b", 3600, 0, 3300, 2600], ["c", 6900, 0, 3400, 2600], ["d", 10300, 0, 3000, 2600],
      ["e", 0, 2600, 3000, 2800], ["f", 3000, 2600, 4200, 2800], ["g", 7200, 2600, 3000, 2800], ["h", 10200, 2600, 3100, 2800],
      ["i", 0, 5400, 4000, 2400], ["j", 4000, 5400, 3200, 2400], ["k", 7200, 5400, 3600, 2400], ["l", 10800, 5400, 2500, 2400],
    ].map(([id, x, y, width, height]) => ({
      id: String(id), name: `板区${String(id).toUpperCase()}`, type: "room", x: Number(x), y: Number(y), width: Number(width), height: Number(height),
    }));
    const state: FloorPlanState = {
      coordinateModel: "net-layout-v1",
      slabs,
      openings: [{ id: "stress-opening", name: "楼梯间", type: "stair", x: 900, y: 700, width: 1200, height: 1000 }],
      supportRules: [],
      innerWallThickness: 240,
      outerWallThickness: 370,
      snapDistanceMm: 150,
      overlapToleranceMm: 10,
    };
    const bottom = calculateFloorBottomRebar(state, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE));
    const topState = structuredClone(DEFAULT_FLOOR_TOP_STATE);
    topState.throughPaths = [{
      id: "stress-through-a-d",
      name: "通墙压力路径",
      direction: "x",
      slabIds: ["a", "b", "c", "d"],
      bandStartMm: 1800,
      bandEndMm: 2600,
      enabled: true,
    }];
    const top = calculateFloorTopRebar(state, topState);
    expect(bottom.isValid).toBe(true);
    expect(top.isValid).toBe(true);
    expect(top.pieces.some((piece) => piece.source === "through")).toBe(true);
    const snapshot = buildFloorPrintSnapshot({
      plan: state,
      bottom,
      top,
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
      invalidDraftCount: 0,
      project: { projectName: "十二板区压力工程", floorName: "二层", remark: "" },
      options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
      snapshotId: "twelve-slab-stress",
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    expect(snapshot.summary.slabCount).toBe(12);
    expect(snapshot.summary.openingCount).toBe(1);
    expect(snapshot.top.rows.filter((row) => row.source === "through")).toHaveLength(1);
    expect(new Set(buildFloorPrintSlabRefs(snapshot.geometry).map((entry) => entry.printId)).size).toBe(12);
    expect(new Set(snapshot.bottom.rows.map((row) => row.mark)).size).toBe(snapshot.bottom.rows.length);
  });

  it("D/M编号分层生成，综合视图不合并Bottom与Top", () => {
    const input = snapshotInput();
    const content = buildFloorPrintContent(input.plan, input.bottom, input.top);
    expect(content.parameters.coordinateModel).toBe("net-layout-v1");
    expect(content.geometry.boundaries.length).toBeGreaterThan(0);
    expect(content.bottom.rows.every((row) => row.mark.startsWith("D"))).toBe(true);
    expect(content.top.rows.every((row) => row.mark.startsWith("M"))).toBe(true);
    expect(content.combinedRows).toHaveLength(content.bottom.rows.length + content.top.rows.length);
    expect(content.summary.totalPieceCount).toBe(input.bottom.pieces.length + input.top.pieces.length);
    expect(content.summary.bottomWeightKg).toBeCloseTo(input.bottom.totalWeightKg!, 10);
    expect(content.summary.topWeightKg).toBeCloseTo(input.top.totalWeightKg!, 10);
    expect(content.summary.totalWeightKg).toBeCloseTo(
      input.bottom.totalWeightKg! + input.top.totalWeightKg!,
      10,
    );
  });

  it("Mark排序与候选数组输入顺序无关", () => {
    const candidate = (
      id: string,
      role: "main" | "secondary",
      direction: "x" | "y",
      length: number,
      name: string,
    ): FloorPrintBomCandidate => ({
      id,
      layer: "bottom",
      source: "normal",
      role,
      direction,
      diameter: role === "main" ? 12 : 10,
      spacing: 200,
      singleLengthMm: length,
      count: 2,
      totalLengthM: length * 2 / 1000,
      unitWeightKgM: 1,
      weightKg: length * 2 / 1000,
      slabIds: [id],
      slabNames: [name],
      pieceIds: [`${id}-1`, `${id}-2`],
      sortPositionMm: 100,
      sortRunStartMm: 0,
    });
    const source = [
      candidate("b", "secondary", "y", 5000, "板区B"),
      candidate("a", "main", "x", 4000, "板区A"),
      candidate("c", "main", "x", 4500, "板区C"),
    ];
    const first = assignFloorPrintMarks(source, "bottom");
    const second = assignFloorPrintMarks([...source].reverse(), "bottom");
    expect(first.map((row) => [row.slabNames[0], row.mark]))
      .toEqual(second.map((row) => [row.slabNames[0], row.mark]));
    expect(first.map((row) => row.mark)).toEqual(["D01", "D02", "D03"]);
  });

  it("相同直径汇总Bottom与Top，但不同实际长度仍保留独立BOM行", () => {
    const input = snapshotInput();
    const content = buildFloorPrintContent(input.plan, input.bottom, input.top);
    const diameter10Rows = content.combinedRows.filter((row) => row.diameter === 10);
    const summary10 = content.diameterSummary.find((row) => row.diameter === 10)!;
    expect(summary10.pieceCount).toBe(diameter10Rows.reduce((sum, row) => sum + row.count, 0));
    expect(summary10.totalLengthM).toBeCloseTo(
      diameter10Rows.reduce((sum, row) => sum + row.totalLengthM, 0),
      10,
    );
    expect(new Set(content.combinedRows.map((row) => `${row.layer}:${row.direction}:${row.singleLengthMm}`)).size)
      .toBe(content.combinedRows.length);
  });

  it("最终Top按普通M与通墙T分别编号，图表共享同一Mark且汇总不重复", () => {
    const state: FloorPlanState = {
      coordinateModel: "net-layout-v1",
      slabs: [
        { ...slab("a", 4000, 3600), x: 0 },
        { ...slab("b", 4000, 3600), x: 4000 },
      ],
      openings: [],
      supportRules: [],
      innerWallThickness: 240,
      outerWallThickness: 370,
      snapDistanceMm: 150,
      overlapToleranceMm: 10,
    };
    const bottom = calculateFloorBottomRebar(state, structuredClone(DEFAULT_FLOOR_BOTTOM_STATE));
    const topState = structuredClone(DEFAULT_FLOOR_TOP_STATE);
    topState.defaults.xSpacing = 900;
    topState.throughPaths = [{
      id: "path-a-b",
      name: "通墙01",
      direction: "x",
      slabIds: ["b", "a"],
      bandStartMm: 0,
      bandEndMm: 3600,
      enabled: true,
    }];
    const top = calculateFloorTopRebar(state, topState);
    const content = buildFloorPrintContent(state, bottom, top);
    const normalRows = content.top.rows.filter((row) => row.source === "normal");
    const throughRows = content.top.rows.filter((row) => row.source === "through");
    expect(normalRows.length).toBeGreaterThan(0);
    expect(normalRows.every((row) => row.mark.startsWith("M"))).toBe(true);
    expect(throughRows.length).toBeGreaterThan(0);
    expect(throughRows.every((row) =>
      row.mark.startsWith("T") &&
      row.throughPathId === "path-a-b" &&
      row.throughPathName === "通墙01")).toBe(true);
    expect(content.top.pieces.filter((piece) => piece.source === "through").map((piece) => piece.mark).sort())
      .toEqual(throughRows.flatMap((row) => Array(row.count).fill(row.mark)).sort());
    expect(content.summary).toMatchObject({
      topNormalPieceCount: top.normalPieceCount,
      topThroughPieceCount: top.throughPieceCount,
      topPieceCount: top.totalPieces,
    });
    expect(content.diameterSummary.reduce((sum, row) => sum + row.pieceCount, 0))
      .toBe(bottom.totalPieces + top.totalPieces);
    expect(validateFloorPrintBomConsistency(bottom, top)).toEqual([]);
  });
});

describe("Floor Print平铺Piece", () => {
  it("Opening后的打印图DTO使用真实Piece而不是贯穿理论Line", () => {
    const state = plan(
      slab("a", 6000, 4000),
      [opening("opening-a", 2000, 1000, 2000, 2000)],
    );
    const input = snapshotInput(state);
    const content = buildFloorPrintContent(state, input.bottom, input.top);
    expect(content.bottom.pieces.length).toBeGreaterThan(input.bottom.lines.length);
    const clippedLine = input.bottom.lines.find((line) =>
      input.bottom.pieces.filter((piece) => piece.lineId === line.id).length > 1,
    );
    expect(clippedLine).toBeDefined();
    const printPieces = content.bottom.pieces.filter((piece) => {
      const source = input.bottom.pieces.find((item) => item.id === piece.id);
      return source?.lineId === clippedLine?.id;
    });
    expect(printPieces).toHaveLength(2);
    expect(printPieces[0].runEndMm).toBeLessThanOrEqual(printPieces[1].runStartMm);
    expect(printPieces.every((piece) => piece.mark.startsWith("D"))).toBe(true);
  });
});

describe("Floor Print 物理墙体几何", () => {
  it("快照几何内嵌 Physical Layout：墙体真实比例、净跨不写回", () => {
    const state = plan();
    state.slabs = [
      { ...slab("a", 4200, 3600), x: 0, y: 0 },
      { ...slab("b", 3600, 3000), x: 4200, y: 0 },
    ];
    const input = snapshotInput(state);
    const content = buildFloorPrintContent(state, input.bottom, input.top);
    expect(content.geometry.physical).toBeDefined();
    const physical = content.geometry.physical!;
    expect(physical.slabs.find((item) => item.slabId === "a")!.x).toBe(0);
    expect(physical.slabs.find((item) => item.slabId === "b")!.x).toBe(4440);
    expect(physical.walls.filter((wall) => wall.kind === "inner-wall")).toHaveLength(1);
    expect(physical.walls.find((wall) => wall.kind === "inner-wall")!.thicknessMm).toBe(240);
    expect(physical.walls.find((wall) => wall.kind === "outer-wall" && wall.side === "west")!.thicknessMm).toBe(370);
    expect(physical.floorBounds.maxX - physical.floorBounds.minX).toBe(8780);
    // 净跨数据不写回快照 slab。
    expect(content.geometry.slabs.find((item) => item.id === "b")!.x).toBe(4200);
  });
});
