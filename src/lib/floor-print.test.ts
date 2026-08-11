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
  validateFloorPrintBomConsistency,
  type FloorPrintBomCandidate,
} from "./floor-print";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
} from "./floor-top-calculator";

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
  });

  it("净跨拓扑允许负坐标，打印只禁止负长度而不误判世界坐标", () => {
    const state = plan({ ...slab("a"), x: -4200, y: -3600 });
    const input = snapshotInput(state);
    const snapshot = buildFloorPrintSnapshot(input);
    expect(snapshot.geometry.bounds).toMatchObject({ minX: -4200, minY: -3600 });
    expect(snapshot.bottom.pieces.some((piece) => piece.runStartMm < 0 || piece.positionMm < 0)).toBe(true);
  });

  it("现场与完整报告模板有确定章节，自定义改动可被识别", () => {
    const site = floorPrintOptionsForPreset("site");
    expect(site).toMatchObject({
      preset: "site",
      paperSize: "A3",
      orientation: "landscape",
      sections: { bottomPlan: true, topPlan: true, combinedBom: false, calculationParameters: false },
    });
    const full = floorPrintOptionsForPreset("full");
    expect(Object.values(full.sections).every(Boolean)).toBe(true);
    expect(detectFloorPrintPreset({ ...site, sections: { ...site.sections, floorPlan: true } })).toBe("custom");
  });
});

describe("Floor Print BOM与编号", () => {
  it("D/M编号分层生成，综合视图不合并Bottom与Top", () => {
    const input = snapshotInput();
    const content = buildFloorPrintContent(input.plan, input.bottom, input.top);
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
