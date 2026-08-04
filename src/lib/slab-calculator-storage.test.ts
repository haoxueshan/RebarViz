import { describe, expect, it } from "vitest";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  createDefaultRoomAnchorRules,
  synchronizeRoomAnchors,
  type SlabCalculatorState,
} from "./slab-calculator";
import {
  CALCULATOR_ALGORITHM_VERSION,
  CALCULATOR_SCHEMA_VERSION,
  DEFAULT_SLAB_PRINT_SECTIONS,
  RESULT_PRINT_SETTINGS_KEY,
  createCalculationRecord,
  createDefaultSlabPrintOptions,
  createResultGroups,
  filterResultGroups,
  paginateResultGroups,
  parseCalculationRecord,
  parseDraftRecord,
  parseResultPrintSettings,
  parseResultUiState,
  serializeResultPrintSettings,
} from "./slab-calculator-storage";

function xRooms(through: boolean): SlabCalculatorState {
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

describe("正式计算记录", () => {
  it("只接受版本兼容且可重新验证的有效结果", () => {
    const state = xRooms(true);
    const calculation = calculateSlabResults(state);
    const record = createCalculationRecord(state, calculation, "2026-08-02T00:00:00.000Z");

    expect(parseCalculationRecord(JSON.stringify(record))?.calculation.isValid).toBe(true);

    const wrongSchema = { ...record, schemaVersion: CALCULATOR_SCHEMA_VERSION + 1 };
    const wrongAlgorithm = { ...record, algorithmVersion: `${CALCULATOR_ALGORITHM_VERSION}-old` };
    const legacyCoverAlgorithm = {
      ...record,
      algorithmVersion: "slab-calculator-2026-08-v1",
    };
    expect(parseCalculationRecord(JSON.stringify(wrongSchema))).toBeNull();
    expect(parseCalculationRecord(JSON.stringify(wrongAlgorithm))).toBeNull();
    expect(parseCalculationRecord(JSON.stringify(legacyCoverAlgorithm))).toBeNull();
    expect(parseCalculationRecord("not-json")).toBeNull();
  });

  it("无效、空结果或0kg记录不能恢复为有效结果页", () => {
    const state = xRooms(true);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    expect(parseCalculationRecord(JSON.stringify({
      ...record,
      calculation: { ...record.calculation, isValid: false, results: [], totalWeightKg: null },
    }))).toBeNull();
    expect(parseCalculationRecord(JSON.stringify({
      ...record,
      calculation: { ...record.calculation, totalWeightKg: 0 },
    }))).toBeNull();
  });

  it("round和floor草稿及正式结果能够保存并恢复", () => {
    const roundState = xRooms(true);
    roundState.slab.countMode = "round";
    const record = createCalculationRecord(
      roundState,
      calculateSlabResults(roundState),
    );
    expect(
      parseCalculationRecord(JSON.stringify(record))?.inputSnapshot.slab.countMode,
    ).toBe("round");

    const floorState = cloneDefaultSlabCalculatorState();
    floorState.slab.countMode = "floor";
    const draft = parseDraftRecord(JSON.stringify({
      schemaVersion: CALCULATOR_SCHEMA_VERSION,
      savedAt: "2026-08-03T00:00:00.000Z",
      state: floorState,
      ui: {
        openSections: { base: true, bottom: true, top: true, through: false },
        bottomDirection: "x",
        topDirection: "x",
      },
    }));
    expect(draft?.state.slab.countMode).toBe("floor");
  });
});

describe("结果分组、筛选和分页", () => {
  it("通墙组合区排在第一组，房间重名仍按ID独立分组", () => {
    const state = xRooms(true);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    const groups = createResultGroups(record);

    expect(groups.map((group) => group.scopeType)).toEqual(["through", "room", "room"]);
    expect(groups[0].results).toHaveLength(2);
    expect(groups[1].roomId).toBe("room-a");
    expect(groups[2].roomId).toBe("room-b");
    expect(new Set(groups.map((group) => group.scopeId)).size).toBe(3);
  });

  it("普通结果按房间和层分组，分页不会拆开钢筋行", () => {
    const state = xRooms(false);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    const groups = createResultGroups(record);
    const firstPage = paginateResultGroups(groups, 1, 2);

    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.results.length === 2)).toBe(true);
    expect(firstPage.groups).toHaveLength(2);
    expect(firstPage.groups.every((group) => group.results.length === 2)).toBe(true);
  });

  it("筛选只影响显示组，不改变正式总重量", () => {
    const state = xRooms(true);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    const total = record.calculation.totalWeightKg;
    const groups = createResultGroups(record);
    const topOnly = filterResultGroups(groups, { layer: "top", direction: "all", through: "all" });

    expect(topOnly).toHaveLength(1);
    expect(record.calculation.totalWeightKg).toBe(total);
  });

  it("通墙筛选保留整条组合区，不拆掉垂直方向结果", () => {
    const state = xRooms(true);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    const throughOnly = filterResultGroups(createResultGroups(record), {
      layer: "all",
      direction: "all",
      through: "through",
    });

    expect(throughOnly).toHaveLength(1);
    expect(throughOnly[0].scopeType).toBe("through");
    expect(throughOnly[0].results).toHaveLength(2);
  });
});

describe("本地状态解析", () => {
  it("旧保护层草稿迁移为项目算法并移除保护层字段", () => {
    const state = xRooms(false);
    state.slab.rooms[0].anchors.top.x.start = {
      source: "manual",
      manualValue: 550,
      origin: "user",
    };
    const legacyState = {
      ...state,
      slab: {
        ...state.slab,
        cover: 15,
        countMode: "cover",
      },
    };
    const draft = parseDraftRecord(JSON.stringify({
      schemaVersion: CALCULATOR_SCHEMA_VERSION,
      savedAt: "2026-08-03T00:00:00.000Z",
      state: legacyState,
      ui: {
        openSections: { base: false, bottom: true, top: false, through: true },
        bottomDirection: "y",
        topDirection: "x",
      },
    }));

    expect(draft?.state.slab.countMode).toBe("project");
    expect(draft?.state.slab).not.toHaveProperty("cover");
    expect(draft?.state.slab.rooms.map((room) => room.id)).toEqual([
      "room-a",
      "room-b",
    ]);
    expect(draft?.state.slab.rooms[0].anchors.top.x.start).toEqual({
      source: "manual",
      manualValue: 550,
      origin: "user",
    });
    expect(draft?.state.bottom).toEqual(state.bottom);
    expect(draft?.state.top).toEqual(state.top);
    expect(draft?.ui.openSections.base).toBe(false);
    expect(draft?.ui.bottomDirection).toBe("y");
  });

  it("草稿恢复输入和折叠状态，但不会产生正式记录", () => {
    const state = cloneDefaultSlabCalculatorState();
    const raw = JSON.stringify({
      schemaVersion: CALCULATOR_SCHEMA_VERSION,
      savedAt: "2026-08-02T00:00:00.000Z",
      state,
      ui: {
        openSections: { base: true, bottom: false, top: true, through: false },
        bottomDirection: "y",
        topDirection: "x",
      },
    });
    const draft = parseDraftRecord(raw);
    expect(draft?.state.slab.rooms[0].id).toBe("room-a");
    expect(draft?.ui.bottomDirection).toBe("y");
  });

  it("损坏的结果UI状态回退默认分页", () => {
    expect(parseResultUiState("broken").pageSize).toBe(5);
    expect(parseResultUiState(JSON.stringify({ page: -3, pageSize: 99, filters: {} })).page).toBe(1);
  });
});

describe("打印偏好存储", () => {
  it("合法偏好可以恢复且持久化内容不包含结果ID或范围", () => {
    const state = xRooms(false);
    const record = createCalculationRecord(state, calculateSlabResults(state));
    const options = createDefaultSlabPrintOptions(record);
    options.rangeMode = "custom";
    options.selectedResultIds = [record.calculation.results[0].id];
    options.detailMode = "compact";
    options.sections.diagram = false;

    const raw = serializeResultPrintSettings(options);
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const restored = parseResultPrintSettings(raw);

    expect(restored.detailMode).toBe("compact");
    expect(restored.sections.diagram).toBe(false);
    expect(payload).not.toHaveProperty("selectedResultIds");
    expect(payload).not.toHaveProperty("rangeMode");
    expect(RESULT_PRINT_SETTINGS_KEY).toBe(
      "rebarviz:slab-calculator:print-settings:v1",
    );
  });

  it("损坏、版本不兼容或字段不完整的偏好恢复默认值", () => {
    const expected = {
      detailMode: "full",
      sections: DEFAULT_SLAB_PRINT_SECTIONS,
    };
    expect(parseResultPrintSettings("broken")).toEqual(expected);
    expect(parseResultPrintSettings(JSON.stringify({
      schemaVersion: 2,
      detailMode: "compact",
      sections: DEFAULT_SLAB_PRINT_SECTIONS,
    }))).toEqual(expected);
    expect(parseResultPrintSettings(JSON.stringify({
      schemaVersion: 1,
      detailMode: "compact",
      sections: { diagram: true },
    }))).toEqual(expected);
  });

  it("每个新正式记录默认恢复全部范围并全选当前结果", () => {
    const firstState = cloneDefaultSlabCalculatorState();
    const firstRecord = createCalculationRecord(
      firstState,
      calculateSlabResults(firstState),
    );
    const first = createDefaultSlabPrintOptions(firstRecord, {
      detailMode: "compact",
      sections: { ...DEFAULT_SLAB_PRINT_SECTIONS, calculationNotes: false },
    });

    const secondState = xRooms(false);
    const secondRecord = createCalculationRecord(
      secondState,
      calculateSlabResults(secondState),
    );
    const second = createDefaultSlabPrintOptions(secondRecord, {
      detailMode: first.detailMode,
      sections: first.sections,
    });

    expect(first.rangeMode).toBe("all");
    expect(first.selectedResultIds).toEqual(
      firstRecord.calculation.results.map((result) => result.id),
    );
    expect(second.rangeMode).toBe("all");
    expect(second.selectedResultIds).toEqual(
      secondRecord.calculation.results.map((result) => result.id),
    );
    expect(second.selectedResultIds).toHaveLength(8);
    expect(second.detailMode).toBe("compact");
    expect(second.sections.calculationNotes).toBe(false);
  });
});
