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
  createCalculationRecord,
  createResultGroups,
  filterResultGroups,
  paginateResultGroups,
  parseCalculationRecord,
  parseDraftRecord,
  parseResultUiState,
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
