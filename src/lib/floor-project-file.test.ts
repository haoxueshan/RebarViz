import { describe, expect, it } from "vitest";
import { DEFAULT_FLOOR_BOTTOM_STATE, type FloorBottomState } from "./floor-bottom-calculator";
import { resolveFloorGeometryTolerance } from "./floor-geometry-tolerance";
import { DEFAULT_FLOOR_PLAN_STATE, type FloorPlanState } from "./floor-plan";
import { createFloorDraftRecord } from "./floor-plan-storage";
import {
  createBlankFloorPlanState,
  createFloorProjectFile,
  FLOOR_DEFAULT_PROJECT_NAME,
  FLOOR_PROJECT_FILE_FORMAT,
  FLOOR_PROJECT_FILE_SCHEMA_VERSION,
  floorProjectFileName,
  parseFloorProjectFile,
  serializeFloorProjectFile,
} from "./floor-project-file";
import { buildFloorRebarRoleDomains, DEFAULT_FLOOR_REBAR_ROLE_STATE } from "./floor-rebar-role";
import { DEFAULT_FLOOR_TOP_STATE, type FloorTopState } from "./floor-top-calculator";

function buildRichPlan(): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs: [
      { id: "s-keep-1", name: "一层客厅", type: "hall", x: 0, y: 0, width: 4200, height: 3600 },
      { id: "s-keep-2", name: "一层卧室", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
    ],
    openings: [{ id: "o-keep-1", name: "楼梯间", type: "stair", x: 1200, y: 900, width: 900, height: 900 }],
    supportRules: [
      { id: "rule-keep-1", target: { kind: "slab-edge", slabId: "s-keep-1", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" },
    ],
    innerWallThickness: 200,
    outerWallThickness: 300,
    snapDistanceMm: 100,
    overlapToleranceMm: 5,
  };
}

function buildRichInputs() {
  const plan = buildRichPlan();
  const bottom: FloorBottomState = {
    countMode: "floor",
    defaults: { mainDiameter: 14, secondaryDiameter: 12, xSpacing: 180, ySpacing: 160 },
    slabOverrides: {
      "s-keep-1": { mainDiameter: 16, xSpacing: 150 },
      "stale-slab": { secondaryDiameter: 8, ySpacing: 90 },
    },
  };
  const top: FloorTopState = {
    countMode: "project",
    topAnchorExtra: 250,
    defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" },
    slabOverrides: {
      "s-keep-2": { mainDiameter: 12, xSpacing: 260, xExtraMode: "end", yExtraMode: "start" },
      "stale-slab": { secondaryDiameter: 8 },
    },
    throughPaths: [
      { id: "tp-keep-1", name: "通墙01", direction: "x", slabIds: ["s-keep-1", "s-keep-2"], bandStartMm: 0, bandEndMm: 3600, enabled: true },
      { id: "tp-stale", name: "失效通墙", direction: "x", slabIds: ["stale-slab"], bandStartMm: 0, bandEndMm: 1000, enabled: true },
    ],
  };
  const role = {
    mainDirectionOverrides: {
      [buildFloorRebarRoleDomains(plan)[0].id]: "x" as const,
      "role:stale-domain": "y" as const,
    },
  };
  return { plan, bottom, top, role };
}

describe("Floor Project File 工程文件", () => {
  it("完整 Round Trip：State → Export → JSON → Import → State", () => {
    const { plan, bottom, top, role } = buildRichInputs();
    const file = createFloorProjectFile({
      projectName: "一层楼板",
      plan, bottom, top, role,
      bottomRoleReviewRequired: true,
      topRoleReviewRequired: false,
    });
    expect(file.format).toBe(FLOOR_PROJECT_FILE_FORMAT);
    expect(file.schemaVersion).toBe(FLOOR_PROJECT_FILE_SCHEMA_VERSION);
    const text = serializeFloorProjectFile(file);
    const result = parseFloorProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.legacy).toBe(false);
    expect(result.project.projectName).toBe("一层楼板");
    expect(result.project.bottomRoleReviewRequired).toBe(true);
    expect(result.project.topRoleReviewRequired).toBe(false);
    // Plan 完全一致（ID 原样保留）。
    expect(result.project.planState).toEqual(plan);
    // Bottom Override 保留且失效项被清理。
    expect(result.project.bottomState.slabOverrides).toEqual({ "s-keep-1": bottom.slabOverrides["s-keep-1"] });
    // Top Override 保留且失效项被清理。
    expect(result.project.topState.slabOverrides).toEqual({ "s-keep-2": top.slabOverrides["s-keep-2"] });
    // Through Path 保留且失效路径被清理。
    expect(result.project.topState.throughPaths.map((path) => path.id)).toEqual(["tp-keep-1"]);
    // Role Override 保留且失效 Domain 被清理。
    const expectedRoleKey = buildFloorRebarRoleDomains(plan)[0].id;
    expect(result.project.roleState.mainDirectionOverrides).toEqual({ [expectedRoleKey]: "x" });
  });

  it("Slab ID 保留", () => {
    const { plan, bottom, top, role } = buildRichInputs();
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom, top, role, bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    const result = parseFloorProjectFile(serializeFloorProjectFile(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.planState.slabs.map((slab) => slab.id)).toEqual(["s-keep-1", "s-keep-2"]);
  });

  it("Opening ID 与 Support Rule 保留", () => {
    const { plan, bottom, top, role } = buildRichInputs();
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom, top, role, bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    const result = parseFloorProjectFile(serializeFloorProjectFile(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.planState.openings.map((opening) => opening.id)).toEqual(["o-keep-1"]);
    expect(result.project.planState.supportRules.map((rule) => rule.id)).toEqual(["rule-keep-1"]);
    expect(result.project.planState.supportRules[0]).toMatchObject({ support: "continuous", target: { slabId: "s-keep-1", side: "east" } });
  });

  it("roleReviewRequired 保留", () => {
    const { plan, bottom, top, role } = buildRichInputs();
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom, top, role, bottomRoleReviewRequired: true, topRoleReviewRequired: true });
    const result = parseFloorProjectFile(serializeFloorProjectFile(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.bottomRoleReviewRequired).toBe(true);
    expect(result.project.topRoleReviewRequired).toBe(true);
  });

  it("非法 JSON 返回 not-json", () => {
    const result = parseFloorProjectFile("{ not json !!!");
    expect(result).toEqual({ ok: false, error: "not-json" });
  });

  it("错误 format 返回 not-floor-file", () => {
    const result = parseFloorProjectFile(JSON.stringify({ format: "other-app", schemaVersion: 1, data: {} }));
    expect(result).toEqual({ ok: false, error: "not-floor-file" });
  });

  it.each([0, -1, 0.5, "1", null, 2, 99])("schemaVersion=%j 一律返回 unsupported-schema", (schemaVersion) => {
    const text = JSON.stringify({
      format: FLOOR_PROJECT_FILE_FORMAT,
      schemaVersion,
      meta: { projectName: "测试", exportedAt: new Date(0).toISOString(), app: "RebarViz" },
      data: { plan: createFloorDraftRecord(buildRichPlan()) },
    });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "unsupported-schema" });
  });

  it("缺少 Plan 返回 missing-plan", () => {
    const result = parseFloorProjectFile(JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { bottom: {}, top: {}, role: {} } }));
    expect(result).toEqual({ ok: false, error: "missing-plan" });
  });

  it("数据损坏（Bottom 不可解析）返回 corrupted", () => {
    const { plan, bottom, top, role } = buildRichInputs();
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom, top, role, bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    const broken = { ...file, data: { ...file.data, bottom: { schemaVersion: 99, state: {} } } };
    const result = parseFloorProjectFile(JSON.stringify(broken));
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("失效 Bottom slabOverride 自动删除", () => {
    const plan = buildRichPlan();
    const bottom: FloorBottomState = {
      ...DEFAULT_FLOOR_BOTTOM_STATE,
      slabOverrides: { "stale-1": { mainDiameter: 20 }, "s-keep-1": { mainDiameter: 16 } },
    };
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom, top: structuredClone(DEFAULT_FLOOR_TOP_STATE), role: structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE), bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    expect(file.data.bottom.state.slabOverrides).toEqual({ "s-keep-1": { mainDiameter: 16 } });
  });

  it("失效 Top slabOverride 与 ThroughPath 自动删除", () => {
    const plan = buildRichPlan();
    const top: FloorTopState = {
      ...DEFAULT_FLOOR_TOP_STATE,
      slabOverrides: { "stale-2": { mainDiameter: 22 } },
      throughPaths: [
        { id: "tp-stale", name: "失效", direction: "x", slabIds: ["stale-2"], bandStartMm: 0, bandEndMm: 500, enabled: true },
      ],
    };
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE), top, role: structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE), bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    expect(file.data.top.state.slabOverrides).toEqual({});
    expect(file.data.top.state.throughPaths).toEqual([]);
  });

  it("失效 Role Override 自动删除", () => {
    const plan = buildRichPlan();
    const validKey = buildFloorRebarRoleDomains(plan)[0].id;
    const role = { mainDirectionOverrides: { "role:stale-domain": "x", [validKey]: "y" } as const };
    const file = createFloorProjectFile({ projectName: "测试", plan, bottom: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE), top: structuredClone(DEFAULT_FLOOR_TOP_STATE), role: role as never, bottomRoleReviewRequired: false, topRoleReviewRequired: false });
    expect(file.data.role.state.mainDirectionOverrides).toEqual({ [validKey]: "y" });
  });

  it("旧版仅楼层草稿文件：恢复 Plan，其余默认值且标记 legacy", () => {
    const plan = buildRichPlan();
    const result = parseFloorProjectFile(JSON.stringify(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.legacy).toBe(true);
    expect(result.project.planState.slabs.map((slab) => slab.id)).toEqual(["s-keep-1", "s-keep-2"]);
    expect(result.project.bottomState).toEqual(DEFAULT_FLOOR_BOTTOM_STATE);
    expect(result.project.topState).toEqual(DEFAULT_FLOOR_TOP_STATE);
  });

  it("createBlankFloorPlanState 生成真空白且保留默认工程参数", () => {
    const blank = createBlankFloorPlanState();
    expect(blank.slabs).toEqual([]);
    expect(blank.openings).toEqual([]);
    expect(blank.supportRules).toEqual([]);
    expect(blank.innerWallThickness).toBe(DEFAULT_FLOOR_PLAN_STATE.innerWallThickness);
    expect(blank.outerWallThickness).toBe(DEFAULT_FLOOR_PLAN_STATE.outerWallThickness);
    expect(blank.snapDistanceMm).toBe(DEFAULT_FLOOR_PLAN_STATE.snapDistanceMm);
    expect(blank.overlapToleranceMm).toBe(DEFAULT_FLOOR_PLAN_STATE.overlapToleranceMm);
  });

  it("文件名清理非法字符且包含日期", () => {
    const name = floorProjectFileName("A栋/一层:楼板?", new Date("2026-08-16T10:00:00Z"));
    expect(name).toBe("RebarViz_A栋_一层_楼板__2026-08-16.json");
    expect(floorProjectFileName("", new Date("2026-08-16T10:00:00Z"))).toBe(`RebarViz_${FLOOR_DEFAULT_PROJECT_NAME}_2026-08-16.json`);
  });

  // —— Floor Project File V1.1 稳定性修复 ——

  it("标准工程 Plan 是 {} 返回 corrupted", () => {
    const text = JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { plan: {} } });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("标准工程 Plan.state 是 {} 返回 corrupted", () => {
    const text = JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { plan: { schemaVersion: 2, state: {} } } });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("标准工程 Plan.state 缺少 slabs 返回 corrupted", () => {
    const state = { ...buildRichPlan() } as unknown as Record<string, unknown>;
    delete state.slabs;
    const text = JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { plan: { schemaVersion: 2, state } } });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("标准工程 Plan.state 缺少 openings 返回 corrupted", () => {
    const state = { ...buildRichPlan() } as unknown as Record<string, unknown>;
    delete state.openings;
    const text = JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { plan: { schemaVersion: 2, state } } });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("标准工程 Plan.state 缺少 supportRules 返回 corrupted", () => {
    const state = { ...buildRichPlan() } as unknown as Record<string, unknown>;
    delete state.supportRules;
    const text = JSON.stringify({ format: FLOOR_PROJECT_FILE_FORMAT, schemaVersion: 1, data: { plan: { schemaVersion: 2, state } } });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("标准工程 Plan.state.coordinateModel 非法返回 corrupted", () => {
    const text = JSON.stringify({
      format: FLOOR_PROJECT_FILE_FORMAT,
      schemaVersion: 1,
      data: { plan: { schemaVersion: 2, state: { ...buildRichPlan(), coordinateModel: "legacy-model-v9" } } },
    });
    const result = parseFloorProjectFile(text);
    expect(result).toEqual({ ok: false, error: "corrupted" });
  });

  it("普通 { slabs: [] } 不误判为 Legacy，返回 not-floor-file", () => {
    expect(parseFloorProjectFile(JSON.stringify({ slabs: [] }))).toEqual({ ok: false, error: "not-floor-file" });
    expect(parseFloorProjectFile(JSON.stringify({ state: {} }))).toEqual({ ok: false, error: "not-floor-file" });
    expect(parseFloorProjectFile(JSON.stringify({ data: [] }))).toEqual({ ok: false, error: "not-floor-file" });
    expect(parseFloorProjectFile(JSON.stringify({ projectName: "test" }))).toEqual({ ok: false, error: "not-floor-file" });
    expect(parseFloorProjectFile(JSON.stringify({ hello: "world" }))).toEqual({ ok: false, error: "not-floor-file" });
  });

  it("真正裸 FloorPlanState 仍然兼容且标记 legacy", () => {
    const plan = buildRichPlan();
    const result = parseFloorProjectFile(JSON.stringify(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.legacy).toBe(true);
    expect(result.project.planState.slabs.map((slab) => slab.id)).toEqual(["s-keep-1", "s-keep-2"]);
  });

  it("真正 FloorDraftRecord（V2 wrapper）按 Plan V2→V3 Migration 导入", () => {
    const plan = buildRichPlan();
    const draft = { schemaVersion: 2, savedAt: "2026-08-16T10:00:00.000Z", state: plan };
    const result = parseFloorProjectFile(JSON.stringify(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.legacy).toBe(true);
    // V1.4A.2.2：V2 wrapper 走 parseFloorDraftRecord 的 V2→V3 Migration，不再降级为 net-layout-v1。
    expect(result.project.planState.coordinateModel).toBe("clear-space-physical-v2");
    expect(result.project.planState.connections?.map((connection) => connection.id))
      .toEqual(["connection:s-keep-1:east:s-keep-2:west"]);
    expect(result.project.planState.slabs.map((slab) => slab.id)).toEqual(["s-keep-1", "s-keep-2"]);
    // rule-keep-1（s-keep-1 east 0~2000 continuous）使整条共享边解析为 continuous → gap 0 → x 保持 4200。
    expect(result.project.planState.slabs.find((slab) => slab.id === "s-keep-2")?.x).toBe(4200);
  });

  it("Raw FloorDraft V3 导入：保持 V3 坐标模型与 Connections，不降级 Legacy", () => {
    const draft = {
      schemaVersion: 3,
      savedAt: "2026-08-18T10:00:00.000Z",
      state: {
        coordinateModel: "clear-space-physical-v2",
        slabs: [
          { id: "s-a", name: "板区A", type: "room", x: 0, y: 0, width: 4000, height: 3000 },
          { id: "s-b", name: "板区B", type: "room", x: 4240, y: 0, width: 3000, height: 3000 },
        ],
        openings: [],
        supportRules: [],
        connections: [
          {
            id: "connection:s-a:east:s-b:west",
            a: { slabId: "s-a", side: "east", range: { mode: "auto-overlap" } },
            b: { slabId: "s-b", side: "west", range: { mode: "auto-overlap" } },
            source: "manual",
            confidence: "confirmed",
            tangentConstraint: { mode: "none" },
          },
        ],
        innerWallThickness: 240,
        outerWallThickness: 240,
        snapDistanceMm: 1500,
        overlapToleranceMm: 10,
      },
    };
    const result = parseFloorProjectFile(JSON.stringify(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.planState.coordinateModel).toBe("clear-space-physical-v2");
    expect(result.project.planState.connections).toHaveLength(1);
    expect(result.project.planState.connections?.[0].id).toBe("connection:s-a:east:s-b:west");
    expect(result.project.planState.slabs.find((slab) => slab.id === "s-b")?.x).toBe(4240);
  });

  it("Canonical Export：导出 Plan 使用几何容差纠偏后的 canonical Plan", () => {
    // 板区A east=4200、板区B west=4205：5mm 微小 gap，overlapToleranceMm=10 应纠偏为精确共边。
    const raw: FloorPlanState = {
      ...structuredClone(DEFAULT_FLOOR_PLAN_STATE),
      slabs: [
        { id: "s-a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
        { id: "s-b", name: "板区B", type: "room", x: 4205, y: 0, width: 3600, height: 3600 },
      ],
      openings: [],
      supportRules: [],
      overlapToleranceMm: 10,
    };
    const resolved = resolveFloorGeometryTolerance(raw);
    expect(resolved.plan.slabs[1].x).toBe(4200);
    expect(resolved.plan).not.toEqual(raw);
    const file = createFloorProjectFile({
      projectName: "测试",
      plan: resolved.plan,
      bottom: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE),
      top: structuredClone(DEFAULT_FLOOR_TOP_STATE),
      role: structuredClone(DEFAULT_FLOOR_REBAR_ROLE_STATE),
      bottomRoleReviewRequired: false,
      topRoleReviewRequired: false,
    });
    // 导出 Plan 必须等于 canonical Plan，而不是原始带 5mm gap 的 state。
    expect(file.data.plan.state).toEqual(resolved.plan);
    expect(file.data.plan.state.slabs[1].x).toBe(4200);
    // Round Trip 后保持 canonical 坐标。
    const parsed = parseFloorProjectFile(serializeFloorProjectFile(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.planState).toEqual(resolved.plan);
  });
});
