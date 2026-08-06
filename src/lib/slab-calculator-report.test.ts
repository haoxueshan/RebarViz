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
  allPrintResultIds,
  arrangementLabel,
  barTypeDirectionLabel,
  buildSlabPrintReport,
  canPrintSlabReport,
  countModeFormulaText,
  createResultFigureNumberMap,
  directionLabel,
  filteredPrintResultIds,
  formatAnchorLabel,
  formatCountFormula,
  formatExtraModeLabel,
  isPrintableCalculationRecord,
  normalizePrintResultIds,
  printSelectionSummary,
} from "./slab-calculator-report";
import {
  DEFAULT_SLAB_PRINT_SECTIONS,
  createCalculationRecord,
  createDefaultSlabPrintOptions,
  createResultGroups,
  paginateResultGroups,
  type SlabPrintOptions,
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

function twoUnequalXRooms(): SlabCalculatorState {
  const state = twoXRooms(false);
  state.slab.rooms[0].spanX = 3000;
  state.slab.rooms[0].spanY = 3000;
  state.slab.rooms[1].spanX = 3000;
  state.slab.rooms[1].spanY = 6000;
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
  const options = createDefaultSlabPrintOptions(record);
  return { record, options, report: buildSlabPrintReport(record, options) };
}

function selectedOptions(
  record: ReturnType<typeof createCalculationRecord>,
  selectedResultIds: string[],
  overrides: Partial<SlabPrintOptions> = {},
): SlabPrintOptions {
  const defaults = createDefaultSlabPrintOptions(record);
  return {
    ...defaults,
    ...overrides,
    selectedResultIds,
    sections: { ...defaults.sections, ...overrides.sections },
  };
}

describe("楼板计算打印模型", () => {
  it("统一将打印方向显示为东西向和南北向", () => {
    expect(directionLabel("x")).toBe("东西向");
    expect(directionLabel("y")).toBe("南北向");
    expect(arrangementLabel("x")).toBe("沿东西向（西→东）排列");
    expect(arrangementLabel("y")).toBe("沿南北向（南→北）排列");

    const { report } = makeReport(cloneDefaultSlabCalculatorState());
    expect(new Set(report.rows.map((row) => row.typeDirectionText))).toEqual(
      new Set(["东西向地筋", "南北向地筋", "东西向面筋", "南北向面筋"]),
    );

    const throughBar = makeReport(twoXRooms(true)).record.calculation
      .throughWall!.throughBar;
    expect(barTypeDirectionLabel(throughBar)).toBe("东西向通墙筋");
    expect(barTypeDirectionLabel({ ...throughBar, direction: "y" })).toBe(
      "南北向通墙筋",
    );

    const reportText = [
      arrangementLabel("x"),
      arrangementLabel("y"),
      ...report.rows.map((row) => row.typeDirectionText),
      ...report.specifications.map((item) => directionLabel(item.direction)),
      barTypeDirectionLabel(throughBar),
    ].join(" ");
    expect(reportText).toContain("东西向");
    expect(reportText).toContain("南北向");
    expect(reportText).not.toMatch(/X向|Y向|X方向|Y方向/);
  });

  it("单房间打印四条正式结果且总重量与正式记录一致", () => {
    const { record, report } = makeReport(cloneDefaultSlabCalculatorState());

    expect(report.rows).toHaveLength(4);
    expect(
      report.rows.map((row) => `${row.layer}:${row.direction}`).sort(),
    ).toEqual(["bottom:x", "bottom:y", "top:x", "top:y"]);
    expect(report.fullTotalWeightKg).toBe(record.calculation.totalWeightKg);
    expect(report.selectedTotalWeightKg).toBe(record.calculation.totalWeightKg);
    expect(report.selectedBottomWeightKg + report.selectedTopWeightKg).toBeCloseTo(
      report.selectedTotalWeightKg,
      10,
    );
    expect(report.isFullSelection).toBe(true);
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

  it("通墙组合区最先打印且垂直普通面筋按房间保留", () => {
    const { report } = makeReport(twoXRooms(true));
    const topRows = report.rows.filter((row) => row.layer === "top");

    expect(report.groups[0].scopeType).toBe("through");
    expect(report.groups[0].rows).toHaveLength(1);
    expect(topRows.filter((row) => row.throughWall)).toHaveLength(1);
    expect(topRows.filter((row) => row.scopeType === "room")).toHaveLength(2);
    expect(topRows.filter((row) => row.direction === "y")).toHaveLength(2);
    expect(report.rows.filter((row) => row.layer === "bottom")).toHaveLength(4);
    expect(report.rows).toHaveLength(7);
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
    ).toBeCloseTo(report.selectedTotalWeightKg, 10);
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
    expect(() => buildSlabPrintReport(invalidRecord, createDefaultSlabPrintOptions(record))).toThrow(
      "正式计算记录无效",
    );
  });
});

describe("打印范围与局部汇总", () => {
  it("全部、当前筛选和自定义选择使用明确且互不混淆的范围文案", () => {
    expect(printSelectionSummary("all", 8, 8)).toBe(
      "全部正式结果 8/8项",
    );
    expect(printSelectionSummary("current-filters", 4, 8)).toBe(
      "当前筛选 4/8项",
    );
    expect(printSelectionSummary("custom", 1, 8)).toBe(
      "自定义选择 1/8项",
    );
    expect(printSelectionSummary("current-filters", 8, 8)).toBe(
      "当前筛选 8/8项",
    );
  });

  it("全部选择包含所有正式结果并保持完整重量", () => {
    const { record } = makeReport(twoXRooms(false));
    const options = createDefaultSlabPrintOptions(record);
    const report = buildSlabPrintReport(record, options);

    expect(options.rangeMode).toBe("all");
    expect(options.detailMode).toBe("full");
    expect(options.sections).toEqual(DEFAULT_SLAB_PRINT_SECTIONS);
    expect(report.rows.map((row) => row.resultId)).toHaveLength(
      record.calculation.results.length,
    );
    expect(report.selectedTotalWeightKg).toBeCloseTo(
      report.fullTotalWeightKg,
      10,
    );
    expect(report.isFullSelection).toBe(true);
  });

  it("当前筛选使用全部筛选组，不受页码和每页组数影响", () => {
    const { record } = makeReport(twoXRooms(false));
    const allGroups = createResultGroups(record);
    const firstPage = paginateResultGroups(allGroups, 1, 2);
    const selectedIds = filteredPrintResultIds(record, {
      layer: "all",
      direction: "all",
      through: "all",
    });
    const report = buildSlabPrintReport(
      record,
      selectedOptions(record, selectedIds, { rangeMode: "current-filters" }),
    );

    expect(firstPage.groups.flatMap((group) => group.results)).toHaveLength(4);
    expect(report.rows).toHaveLength(8);

    const topIds = filteredPrintResultIds(record, {
      layer: "top",
      direction: "all",
      through: "all",
    });
    expect(
      buildSlabPrintReport(record, selectedOptions(record, topIds)).rows.every(
        (row) => row.layer === "top",
      ),
    ).toBe(true);

    const xIds = filteredPrintResultIds(record, {
      layer: "all",
      direction: "x",
      through: "all",
    });
    expect(
      buildSlabPrintReport(record, selectedOptions(record, xIds)).rows.every(
        (row) => row.direction === "x",
      ),
    ).toBe(true);
  });

  it("自定义可只选择一个房间、一个方向或单一层位", () => {
    const { record } = makeReport(twoXRooms(false));
    const roomAIds = record.calculation.results
      .filter((result) => result.roomId === "room-a")
      .map((result) => result.id);
    const roomReport = buildSlabPrintReport(
      record,
      selectedOptions(record, roomAIds, { rangeMode: "custom" }),
    );
    expect(roomReport.rows).toHaveLength(4);
    expect(roomReport.rows.every((row) => row.roomId === "room-a")).toBe(true);
    expect(roomReport.groups.every((group) => group.roomId === "room-a")).toBe(true);

    const bottomXIds = record.calculation.results
      .filter((result) => result.layer === "bottom" && result.direction === "x")
      .map((result) => result.id);
    const bottomXReport = buildSlabPrintReport(
      record,
      selectedOptions(record, bottomXIds, { rangeMode: "custom" }),
    );
    expect(bottomXReport.rows.every((row) => row.layer === "bottom")).toBe(true);
    expect(bottomXReport.rows.every((row) => row.direction === "x")).toBe(true);

    const topIds = record.calculation.results
      .filter((result) => result.layer === "top")
      .map((result) => result.id);
    expect(
      buildSlabPrintReport(record, selectedOptions(record, topIds)).rows.every(
        (row) => row.layer === "top",
      ),
    ).toBe(true);
  });

  it("空分组被删除，原分组顺序保持且同名房间仍按ID区分", () => {
    const { record } = makeReport(twoXRooms(false));
    const groups = createResultGroups(record);
    const selectedIds = [
      groups.at(-1)!.results[0].id,
      groups[0].results[0].id,
    ];
    const report = buildSlabPrintReport(
      record,
      selectedOptions(record, selectedIds, { rangeMode: "custom" }),
    );

    expect(report.groups.map((group) => group.scopeId)).toEqual([
      groups[0].scopeId,
      groups.at(-1)!.scopeId,
    ]);
    expect(report.groups.map((group) => group.roomId)).toEqual([
      "room-a",
      "room-b",
    ]);
    expect(report.groups.every((group) => group.rows.length > 0)).toBe(true);
  });

  it("图中R编号基于完整正式结果，局部选择不会重新编号", () => {
    const { record } = makeReport(twoXRooms(false));
    const numbers = createResultFigureNumberMap(record.calculation.results);
    const selected = [
      record.calculation.results.at(-1)!.id,
      record.calculation.results[0].id,
    ];
    const report = buildSlabPrintReport(
      record,
      selectedOptions(record, selected, { rangeMode: "custom" }),
    );

    expect(report.rows.map((row) => row.figureNumber)).toEqual(
      report.rows.map((row) => numbers.get(row.resultId)),
    );
    expect(report.rows.map((row) => row.figureNumber)).toContain("R01");
    expect(report.rows.map((row) => row.figureNumber)).toContain(
      `R${String(record.calculation.results.length).padStart(2, "0")}`,
    );
  });

  it("重复和不存在的ID被忽略且选择不会修改正式记录", () => {
    const { record } = makeReport(twoXRooms(false));
    const before = structuredClone(record);
    const id = record.calculation.results[0].id;
    const normalized = normalizePrintResultIds(record, [id, id, "missing"]);
    const report = buildSlabPrintReport(
      record,
      selectedOptions(record, [id, id, "missing"], { rangeMode: "custom" }),
    );

    expect(normalized).toEqual([id]);
    expect(report.rows).toHaveLength(1);
    expect(record).toEqual(before);
  });

  it("通墙方向与房间垂直普通面筋可独立选择且地筋保持独立", () => {
    const { record } = makeReport(twoXRooms(true));
    const through = record.calculation.throughWall!;
    const throughReport = buildSlabPrintReport(
      record,
      selectedOptions(record, [through.throughBar.id], { rangeMode: "custom" }),
    );
    expect(throughReport.groups).toHaveLength(1);
    expect(throughReport.groups[0].scopeType).toBe("through");
    expect(throughReport.rows[0].throughWall).toBe(true);

    const roomTopY = record.calculation.results.find(
      (result) =>
        result.roomId === "room-b" &&
        result.layer === "top" &&
        result.direction === "y",
    )!;
    const perpendicularReport = buildSlabPrintReport(
      record,
      selectedOptions(record, [roomTopY.id], { rangeMode: "custom" }),
    );
    expect(perpendicularReport.rows).toHaveLength(1);
    expect(perpendicularReport.rows[0].scopeType).toBe("room");
    expect(perpendicularReport.rows[0].roomId).toBe("room-b");
    expect(perpendicularReport.rows[0].throughWall).toBe(false);

    const roomBottomId = record.calculation.results.find(
      (result) => result.roomId === "room-b" && result.layer === "bottom",
    )!.id;
    const roomBottomReport = buildSlabPrintReport(
      record,
      selectedOptions(record, [roomBottomId], { rangeMode: "custom" }),
    );
    expect(roomBottomReport.groups[0].roomId).toBe("room-b");
    expect(roomBottomReport.rows[0].layer).toBe("bottom");
    expect(roomBottomReport.rows.some((row) => row.layer === "top")).toBe(false);
  });

  it("局部重量、分组小计和规格汇总只统计所选结果", () => {
    const { record } = makeReport(twoXRooms(false));
    const selectedResults = record.calculation.results.filter(
      (result) => result.direction === "x",
    );
    const report = buildSlabPrintReport(
      record,
      selectedOptions(
        record,
        selectedResults.map((result) => result.id),
        { rangeMode: "custom" },
      ),
    );
    const expectedWeight = selectedResults.reduce(
      (sum, result) => sum + result.weightKg,
      0,
    );

    expect(report.selectedTotalWeightKg).toBeCloseTo(expectedWeight, 10);
    expect(report.selectedBottomWeightKg + report.selectedTopWeightKg).toBeCloseTo(
      report.selectedTotalWeightKg,
      10,
    );
    expect(
      report.groups.reduce((sum, group) => sum + group.subtotalWeightKg, 0),
    ).toBeCloseTo(expectedWeight, 10);
    expect(
      report.specifications.reduce((sum, item) => sum + item.totalWeightKg, 0),
    ).toBeCloseTo(expectedWeight, 10);
    expect(report.specifications.every((item) => item.direction === "x")).toBe(true);
    expect(report.fullTotalWeightKg).toBe(record.calculation.totalWeightKg);
    expect(report.isFullSelection).toBe(false);
  });

  it("空选择或未选择章节时不允许打印", () => {
    const { record } = makeReport(cloneDefaultSlabCalculatorState());
    const emptyOptions = selectedOptions(record, [], { rangeMode: "custom" });
    const emptyReport = buildSlabPrintReport(record, emptyOptions);
    expect(emptyReport.groups).toEqual([]);
    expect(emptyReport.selectedTotalWeightKg).toBe(0);
    expect(canPrintSlabReport(emptyReport, emptyOptions)).toBe(false);

    const noSectionOptions = selectedOptions(record, allPrintResultIds(record), {
      sections: {
        weightSummary: false,
        parameters: false,
        roomDimensions: false,
        diagram: false,
        specificationSummary: false,
        resultDetails: false,
        calculationNotes: false,
      },
    });
    const noSectionReport = buildSlabPrintReport(record, noSectionOptions);
    expect(canPrintSlabReport(noSectionReport, noSectionOptions)).toBe(false);
  });
});

describe("多长度分区打印模型", () => {
  it("父级结果显示多长度并展开稳定分区编号，重量只汇总一次", () => {
    const { record, report } = makeReport(twoUnequalXRooms());
    const row = report.rows.find(
      (item) =>
        item.roomId === "room-b" &&
        item.layer === "bottom" &&
        item.direction === "x",
    );

    expect(row).toBeDefined();
    expect(row!.lengthMode).toBe("zoned");
    expect(row!.variantRows).toHaveLength(2);
    expect(row!.variantRows.map((variant) => variant.figureNumber)).toEqual([
      `${row!.figureNumber}-A`,
      `${row!.figureNumber}-B`,
    ]);
    expect(
      row!.variantRows.reduce((sum, variant) => sum + variant.count, 0),
    ).toBe(row!.count);
    expect(
      row!.variantRows.reduce(
        (sum, variant) => sum + variant.representativeCount,
        0,
      ),
    ).toBe(row!.representativeCount);
    expect(
      row!.variantRows.reduce(
        (sum, variant) => sum + variant.totalLengthM,
        0,
      ),
    ).toBeCloseTo(row!.totalLengthM, 12);
    expect(
      row!.variantRows.reduce((sum, variant) => sum + variant.weightKg, 0),
    ).toBeCloseTo(row!.weightKg, 12);
    expect(report.selectedTotalWeightKg).toBeCloseTo(
      record.calculation.totalWeightKg!,
      12,
    );
    expect(
      report.specifications.reduce(
        (sum, specification) => sum + specification.totalWeightKg,
        0,
      ),
    ).toBeCloseTo(report.selectedTotalWeightKg, 12);
  });

  it("选择父级分区结果时包含全部分区但选择项仍只计一项", () => {
    const { record } = makeReport(twoUnequalXRooms());
    const result = record.calculation.results.find(
      (item) =>
        item.roomId === "room-b" &&
        item.layer === "top" &&
        item.direction === "x",
    )!;
    const report = buildSlabPrintReport(
      record,
      selectedOptions(record, [result.id], { rangeMode: "custom" }),
    );

    expect(report.selectedRowCount).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].variantRows).toHaveLength(
      result.lengthVariants.length,
    );
    expect(report.selectedTotalWeightKg).toBeCloseTo(result.weightKg, 12);
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

      expect(throughTopRows).toHaveLength(1);
      expect(throughTopRows.every((row) => row.count === expectedCount)).toBe(
        true,
      );
      const roomTopYRows = throughReport.rows.filter(
        (row) => row.scopeType === "room" && row.layer === "top" && row.direction === "y",
      );
      expect(roomTopYRows).toHaveLength(2);
      expect(roomTopYRows.map((row) => row.count)).toEqual([
        mode === "project" ? 9 : 8,
        mode === "project" ? 9 : 8,
      ]);
    });
  });

  it("数值根数公式包含正式结果采用的三种表达式", () => {
    expect(formatCountFormula(3350, 200, "project")).toBe(
      "ceil(3350 / 200)",
    );
    expect(formatCountFormula(3350, 200, "round")).toBe(
      "max(1, round(3350 / 200))",
    );
    expect(formatCountFormula(3350, 200, "floor")).toBe(
      "max(1, floor(3350 / 200))",
    );
  });
});

describe("打印锚固文字", () => {
  it("自动内外墙、增加作用端和手动最终值均按正式结果显示", () => {
    const defaultTopX = makeReport(
      cloneDefaultSlabCalculatorState(),
    ).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    )!;
    expect(defaultTopX.startExtraApplied).toBe(false);
    expect(defaultTopX.endExtraApplied).toBe(false);
    expect(formatAnchorLabel(defaultTopX, "start")).toBe("外墙370mm（未增加）");
    expect(formatAnchorLabel(defaultTopX, "end")).toBe("外墙370mm（未增加）");
    expect(formatExtraModeLabel(defaultTopX)).toBe("未实际增加");

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
      "外墙370mm（未增加）",
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
    expect(formatExtraModeLabel(topX!)).toBe(
      "手动锚固为最终值，未叠加增加值",
    );

    state.top.x.extraMode = "both";
    const topXBoth = makeReport(state).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    );
    expect(formatAnchorLabel(topXBoth!, "start")).toBe("手动550mm（最终值）");
    expect(formatAnchorLabel(topXBoth!, "end")).toBe(
      "外墙370mm（未增加）",
    );
    expect(formatExtraModeLabel(topXBoth!)).toBe(
      "手动锚固为最终值，未叠加增加值",
    );

    state.slab.rooms[0].anchors.top.x.end = {
      source: "manual",
      manualValue: 600,
      origin: "user",
    };
    const bothManual = makeReport(state).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    )!;
    expect(bothManual.startExtraApplied).toBe(false);
    expect(bothManual.endExtraApplied).toBe(false);
    expect(formatExtraModeLabel(bothManual)).toBe(
      "手动锚固为最终值，未叠加增加值",
    );

    const innerNotSelectedState = cloneDefaultSlabCalculatorState();
    innerNotSelectedState.top.x.extraMode = "end";
    innerNotSelectedState.slab.rooms[0].anchors.top.x.start = {
      source: "inner-wall",
      manualValue: 0,
      origin: "user",
    };
    const innerNotSelected = makeReport(
      innerNotSelectedState,
    ).record.calculation.results.find(
      (result) => result.layer === "top" && result.direction === "x",
    )!;
    expect(formatAnchorLabel(innerNotSelected, "start")).toBe(
      "内墙240mm（未增加）",
    );
  });
});
