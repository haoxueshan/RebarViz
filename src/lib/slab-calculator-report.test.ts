import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  countModeLabel,
  createDefaultRoomAnchorRules,
  synchronizeRoomAnchors,
  type CountMode,
  type SlabCalculatorState,
} from "./slab-calculator";
import {
  buildSlabPrintReport,
  countModeFormulaText,
  formatAnchorLabel,
  formatCountFormula,
  isPrintableCalculationRecord,
} from "./slab-calculator-report";
import {
  createCalculationRecord,
  createResultGroups,
  paginateResultGroups,
} from "./slab-calculator-storage";

function twoXRooms(through: boolean): SlabCalculatorState {
  const state = cloneDefaultSlabCalculatorState();
  state.slab.arrangement = "x";
  state.slab.rooms = synchronizeRoomAnchors(
    [
      {
        id: "room-a",
        name: "同名房间",
        spanX: 4200,
        spanY: 3600,
        anchors: createDefaultRoomAnchorRules("x", 0, 2),
      },
      {
        id: "room-b",
        name: "同名房间",
        spanX: 3600,
        spanY: 3600,
        anchors: createDefaultRoomAnchorRules("x", 1, 2),
      },
    ],
    "x",
  );
  state.through.enabled = through;
  state.through.direction = through ? "x" : "none";
  return state;
}

function makeReport(state: SlabCalculatorState) {
  const calculation = calculateSlabResults(state);
  expect(calculation.isValid).toBe(true);
  const record = createCalculationRecord(
    state,
    calculation,
    "2026-08-03T10:00:00.000Z",
  );
  return { record, report: buildSlabPrintReport(record) };
}

describe("楼板计算打印模型", () => {
  it("单房间打印四条正式结果且总重量与正式记录一致", () => {
    const { record, report } = makeReport(cloneDefaultSlabCalculatorState());

    expect(report.rows).toHaveLength(4);
    expect(
      report.rows.map((row) => `${row.layer}:${row.direction}`).sort(),
    ).toEqual(["bottom:x", "bottom:y", "top:x", "top:y"]);
    expect(report.totalWeightKg).toBe(record.calculation.totalWeightKg);
    expect(report.bottomWeightKg + report.topWeightKg).toBeCloseTo(
      report.totalWeightKg,
      10,
    );
  });

  it("普通多房间打印全部分组，不受当前页大小影响且同名房间按ID区分", () => {
    const { record, report } = makeReport(twoXRooms(false));
    const currentPage = paginateResultGroups(createResultGroups(record), 1, 2);

    expect(currentPage.groups).toHaveLength(2);
    expect(report.groups).toHaveLength(4);
    expect(report.rows).toHaveLength(8);
    expect(new Set(report.rows.map((row) => row.resultId)).size).toBe(8);
    expect(new Set(report.groups.flatMap((group) => group.roomId ?? []))).toEqual(
      new Set(["room-a", "room-b"]),
    );
  });

  it("通墙组合区最先打印，通墙与垂直面筋各一次且不重复普通面筋", () => {
    const { report } = makeReport(twoXRooms(true));
    const topRows = report.rows.filter((row) => row.layer === "top");

    expect(report.groups[0].scopeType).toBe("through");
    expect(report.groups[0].rows).toHaveLength(2);
    expect(topRows.filter((row) => row.throughWall)).toHaveLength(1);
    expect(
      topRows.filter((row) => row.scopeType === "through" && !row.throughWall),
    ).toHaveLength(1);
    expect(report.rows.filter((row) => row.layer === "bottom")).toHaveLength(4);
    expect(topRows.some((row) => row.scopeType === "room")).toBe(false);
  });

  it("规格汇总按层位、方向、直径和间距分别归组", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.bottom.x = { diameter: 12, spacing: 150 };
    state.bottom.y = { diameter: 12, spacing: 200 };
    state.top.x = { diameter: 12, spacing: 150, extraMode: "both" };
    state.top.y = { diameter: 10, spacing: 150, extraMode: "both" };
    const { report } = makeReport(state);

    expect(report.specifications.map((item) => item.key)).toEqual([
      "bottom:x:12:150",
      "bottom:y:12:200",
      "top:x:12:150",
      "top:y:10:150",
    ]);
    expect(
      report.specifications.reduce((sum, item) => sum + item.totalWeightKg, 0),
    ).toBeCloseTo(report.totalWeightKg, 10);
  });

  it("无效或无正重量记录不能生成可打印报表", () => {
    const { record } = makeReport(cloneDefaultSlabCalculatorState());
    const invalidRecord = {
      ...record,
      calculation: {
        ...record.calculation,
        isValid: false,
        results: [],
        totalWeightKg: null,
      },
    };

    expect(isPrintableCalculationRecord(invalidRecord)).toBe(false);
    expect(() => buildSlabPrintReport(invalidRecord)).toThrow(
      "正式计算记录无效",
    );
  });
});

describe("打印报表根数算法", () => {
  const cases: Array<{
    mode: CountMode;
    label: string;
    expectedCount: number;
    formula: string;
  }> = [
    {
      mode: "project",
      label: "项目算法",
      expectedCount: 17,
      formula: "ceil(计算宽度 / 间距)",
    },
    {
      mode: "cover",
      label: "保护层算法",
      expectedCount: 18,
      formula: "ceil((计算宽度 - 2 × 保护层) / 间距) + 1",
    },
    {
      mode: "round",
      label: "四舍五入算法",
      expectedCount: 17,
      formula: "max(1, round(计算宽度 / 间距))",
    },
    {
      mode: "floor",
      label: "向下取整算法",
      expectedCount: 16,
      formula: "max(1, floor(计算宽度 / 间距))",
    },
  ];

  cases.forEach(({ mode, label, expectedCount, formula }) => {
    it(`${label}在普通房间和通墙组合区使用同一口径`, () => {
      const normal = cloneDefaultSlabCalculatorState();
      normal.slab.rooms[0].spanX = 3350;
      normal.slab.rooms[0].spanY = 3350;
      normal.slab.countMode = mode;
      normal.bottom.x.spacing = 200;
      normal.bottom.y.spacing = 200;
      normal.top.x.spacing = 200;
      normal.top.y.spacing = 200;
      const normalReport = makeReport(normal).report;

      expect(countModeLabel(mode)).toBe(label);
      expect(countModeFormulaText(mode)).toBe(formula);
      expect(normalReport.rows.every((row) => row.count === expectedCount)).toBe(
        true,
      );

      const through = twoXRooms(true);
      through.slab.rooms[0].spanX = 1675;
      through.slab.rooms[1].spanX = 1675;
      through.slab.rooms[0].spanY = 3350;
      through.slab.rooms[1].spanY = 3350;
      through.slab.countMode = mode;
      through.top.x.spacing = 200;
      through.top.y.spacing = 200;
      const throughReport = makeReport(through).report;
      const throughTopRows = throughReport.rows.filter(
        (row) => row.scopeType === "through",
      );

      expect(throughTopRows).toHaveLength(2);
      expect(throughTopRows.every((row) => row.count === expectedCount)).toBe(
        true,
      );
    });
  });

  it("数值根数公式包含正式结果采用的四种表达式", () => {
    expect(formatCountFormula(3350, 200, 15, "project")).toBe(
      "ceil(3350 / 200)",
    );
    expect(formatCountFormula(3350, 200, 15, "cover")).toBe(
      "ceil((3350 - 2 × 15) / 200) + 1",
    );
    expect(formatCountFormula(3350, 200, 15, "round")).toBe(
      "max(1, round(3350 / 200))",
    );
    expect(formatCountFormula(3350, 200, 15, "floor")).toBe(
      "max(1, floor(3350 / 200))",
    );
  });
});

describe("打印锚固文字", () => {
  it("自动内外墙、增加作用端和手动最终值均按正式结果显示", () => {
    const multi = makeReport(twoXRooms(false)).record.calculation.results;
    const bottomX = multi.find(
      (result) =>
        result.roomId === "room-a" &&
        result.layer === "bottom" &&
        result.direction === "x",
    );
    expect(bottomX).toBeDefined();
    expect(formatAnchorLabel(bottomX!, "start")).toBe("外墙370mm");
    expect(formatAnchorLabel(bottomX!, "end")).toBe("内墙240mm");
    const multiTopX = multi.find(
      (result) =>
        result.roomId === "room-a" &&
        result.layer === "top" &&
        result.direction === "x",
    );
    expect(formatAnchorLabel(multiTopX!, "start")).toBe(
      "外墙620mm（已增加250mm）",
    );
    expect(formatAnchorLabel(multiTopX!, "end")).toBe(
      "内墙490mm（已增加250mm）",
    );

    const state = cloneDefaultSlabCalculatorState();
    state.top.x.extraMode = "start";
    state.slab.rooms[0].anchors.top.x.start = {
      source: "manual",
      manualValue: 550,
      origin: "user",
    };
    const topX = makeReport(state).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    );
    expect(topX).toBeDefined();
    expect(formatAnchorLabel(topX!, "start")).toBe("手动550mm（最终值）");
    expect(formatAnchorLabel(topX!, "end")).toBe("外墙370mm（未增加）");

    state.top.x.extraMode = "both";
    const topXBoth = makeReport(state).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    );
    expect(formatAnchorLabel(topXBoth!, "start")).toBe("手动550mm（最终值）");
    expect(formatAnchorLabel(topXBoth!, "end")).toBe(
      "外墙620mm（已增加250mm）",
    );
  });
});
