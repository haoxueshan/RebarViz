import { describe, expect, it } from "vitest";
import {
  applyFloorDock,
  applyFloorMultiAlign,
  calculateFloorDockPosition,
  describeFloorSlabSideRelations,
  floorDockAlignmentLabel,
  floorDockDirectionLabel,
  previewFloorDock,
  previewFloorMultiAlign,
  suggestFloorDockFixes,
} from "./floor-docking";
import type { FloorPlanState, FloorSlab } from "./floor-plan";

function slab(id: string, x: number, y: number, width: number, height: number, name?: string): FloorSlab {
  return { id, name: name ?? `板区${id.toUpperCase()}`, type: "room", x, y, width, height };
}

function plan(slabs: FloorSlab[], overlapToleranceMm = 10): FloorPlanState {
  return {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm,
  };
}

describe("Floor Docking位置计算", () => {
  it("Case1 上下拼接：A在北侧时 A.y = B.y + B.height", () => {
    const a = slab("a", 0, 0, 3600, 3600);
    const b = slab("b", 0, 5000, 4200, 3600);
    expect(calculateFloorDockPosition(a, b, "north", "preserve")).toEqual({ x: 0, y: 8600 });
  });

  it("Case2 左右拼接：A.x = B.x + B.width", () => {
    const a = slab("a", 0, 0, 3600, 3600);
    const b = slab("b", 5000, 0, 4200, 3600);
    expect(calculateFloorDockPosition(a, b, "east", "preserve")).toEqual({ x: 9200, y: 0 });
  });

  it("Case3 Preserve：上下拼接只修改Y，X完全不变", () => {
    const a = slab("a", 1234, 0, 3600, 3600);
    const b = slab("b", 0, 5000, 4200, 3600);
    const position = calculateFloorDockPosition(a, b, "north", "preserve");
    expect(position.x).toBe(1234);
    expect(position.y).toBe(8600);
  });

  it("Case4 Start对齐：A.x = B.x", () => {
    const a = slab("a", 777, 0, 2400, 3600);
    const b = slab("b", 0, 5000, 4200, 3600);
    expect(calculateFloorDockPosition(a, b, "north", "start")).toEqual({ x: 0, y: 8600 });
  });

  it("Case5 Center对齐：中心一致", () => {
    const a = slab("a", 0, 0, 2400, 3600);
    const b = slab("b", 0, 5000, 4200, 3600);
    const position = calculateFloorDockPosition(a, b, "north", "center");
    expect(position.x).toBe(900);
    expect(position.x + a.width / 2).toBe(b.x + b.width / 2);
  });

  it("Case6 End对齐：右边一致", () => {
    const a = slab("a", 0, 0, 2400, 3600);
    const b = slab("b", 0, 5000, 4200, 3600);
    const position = calculateFloorDockPosition(a, b, "north", "end");
    expect(position.x).toBe(1800);
    expect(position.x + a.width).toBe(b.x + b.width);
  });

  it("南侧/西侧拼接公式正确", () => {
    const a = slab("a", 0, 0, 3600, 3000);
    const b = slab("b", 0, 5000, 4200, 3600);
    expect(calculateFloorDockPosition(a, b, "south", "preserve")).toEqual({ x: 0, y: 2000 });
    expect(calculateFloorDockPosition(a, b, "west", "preserve")).toEqual({ x: -3600, y: 0 });
  });
});

describe("Floor Docking预览与提交", () => {
  it("Case7 部分共享边：A.width < B.width 形成T型共享边仍合法", () => {
    const state = plan([
      slab("a", 500, 0, 2400, 3600, "小板"),
      slab("b", 0, 5000, 4200, 3600, "大板"),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "north", alignment: "preserve" });
    expect(preview).not.toBeNull();
    expect(preview!.x).toBe(500);
    expect(preview!.y).toBe(8600);
    expect(preview!.valid).toBe(true);
    const applied = applyFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "north", alignment: "preserve" });
    const aApplied = applied.slabs.find((item) => item.id === "a")!;
    expect(aApplied.y).toBe(8600);
    expect(aApplied.x).toBe(500);
  });

  it("Case8 第三方冲突：Dock后与C重叠 valid=false 且不提交", () => {
    const state = plan([
      slab("a", 500, 0, 3600, 3600, "板区A"),
      slab("b", 0, 5000, 4200, 3600, "板区B"),
      slab("c", 300, 8400, 2000, 2000, "板区C"),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "north", alignment: "preserve" });
    expect(preview!.valid).toBe(false);
    expect(preview!.conflicts).toContain("板区C");
    const applied = applyFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "north", alignment: "preserve" });
    expect(applied.slabs.find((item) => item.id === "a")!.y).toBe(0);
  });

  it("Case9 5mm Near Miss：Dock后 Gap=0", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 0, 3605, 3600, 3600),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "b", targetSlabId: "a", direction: "north", alignment: "preserve" });
    expect(preview!.y).toBe(3600);
    expect(preview!.moveYmm).toBe(-5);
    const applied = applyFloorDock(state, { sourceSlabId: "b", targetSlabId: "a", direction: "north", alignment: "preserve" });
    expect(applied.slabs.find((item) => item.id === "b")!.y).toBe(3600);
  });

  it("Case10 5mm Overlap：Dock后 Overlap=0", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600),
      slab("b", 0, 3595, 3600, 3600),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "b", targetSlabId: "a", direction: "north", alignment: "preserve" });
    expect(preview!.y).toBe(3600);
    const applied = applyFloorDock(state, { sourceSlabId: "b", targetSlabId: "a", direction: "north", alignment: "preserve" });
    expect(applied.slabs.find((item) => item.id === "b")!.y).toBe(3600);
  });

  it("Case11 L型：不同长度板区拼接合法且不强制对齐", () => {
    const state = plan([
      slab("a", 4200, 0, 3600, 3600, "板区A"),
      slab("b", 0, 0, 4200, 3600, "板区B"),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "east", alignment: "preserve" });
    expect(preview!.valid).toBe(true);
    expect(preview!.x).toBe(4200);
  });

  it("Case12 T型：小板拼到大板中部，preserve不被自动左对齐", () => {
    const state = plan([
      slab("a", 600, 0, 1200, 2400, "小板"),
      slab("b", 0, 5000, 4200, 3600, "大板"),
    ]);
    const preview = previewFloorDock(state, { sourceSlabId: "a", targetSlabId: "b", direction: "south", alignment: "preserve" });
    expect(preview!.x).toBe(600);
    expect(preview!.y).toBe(2600);
    expect(preview!.valid).toBe(true);
  });

  it("缺少Source或Target时返回null且apply不改变State", () => {
    const state = plan([slab("a", 0, 0, 4200, 3600)]);
    expect(previewFloorDock(state, { sourceSlabId: "a", targetSlabId: "missing", direction: "north", alignment: "preserve" })).toBeNull();
    const applied = applyFloorDock(state, { sourceSlabId: "missing", targetSlabId: "a", direction: "north", alignment: "preserve" });
    expect(applied).toBe(state);
  });
});

describe("Floor多选对齐", () => {
  it("Case13 左对齐：所有板X统一为min(x)", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 500, 4000, 3600, 3600),
      slab("c", 1200, 8000, 3600, 3600),
    ]);
    const applied = applyFloorMultiAlign(state, ["a", "b", "c"], "left");
    expect(applied.slabs.every((item) => item.x === 0)).toBe(true);
  });

  it("右对齐/上对齐/下对齐公式正确", () => {
    const horizontal = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 500, 4000, 2400, 3600),
      slab("c", 1200, 8000, 3000, 3600),
    ]);
    const rightApplied = applyFloorMultiAlign(horizontal, ["a", "b", "c"], "right");
    const rightReference = Math.max(...horizontal.slabs.map((item) => item.x + item.width));
    rightApplied.slabs.forEach((item) => expect(item.x + item.width).toBe(rightReference));

    const vertical = plan([
      slab("a", 0, 0, 3600, 3000),
      slab("b", 4000, 4000, 2400, 2000),
      slab("c", 7000, 8000, 3000, 2600),
    ]);
    const topApplied = applyFloorMultiAlign(vertical, ["a", "b", "c"], "top");
    const topReference = Math.max(...vertical.slabs.map((item) => item.y + item.height));
    topApplied.slabs.forEach((item) => expect(item.y + item.height).toBe(topReference));
    const bottomApplied = applyFloorMultiAlign(vertical, ["a", "b", "c"], "bottom");
    bottomApplied.slabs.forEach((item) => expect(item.y).toBe(0));
  });

  it("对齐后与未选中板重叠则禁止执行", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 500, 4000, 3600, 3600),
      slab("c", 50, 3700, 3600, 3600), // 与 b 移动结果重叠的未选中板
    ]);
    const preview = previewFloorMultiAlign(state, ["a", "b"], "left");
    expect(preview.valid).toBe(false);
    const applied = applyFloorMultiAlign(state, ["a", "b"], "left");
    expect(applied.slabs.find((item) => item.id === "b")!.x).toBe(500);
  });

  it("preview返回移动数量与最大位移", () => {
    const state = plan([
      slab("a", 0, 0, 3600, 3600),
      slab("b", 500, 4000, 3600, 3600),
      slab("c", 1200, 8000, 3600, 3600),
    ]);
    const preview = previewFloorMultiAlign(state, ["a", "b", "c"], "left");
    expect(preview).toMatchObject({ valid: true, movedSlabCount: 3, maxMoveMm: 1200 });
  });
});

describe("Floor Dock建议与位置关系", () => {
  it("5mm near-miss生成精确拼接建议", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600, "板区A"),
      slab("b", 0, 3605, 3600, 3600, "板区B"),
    ]);
    const suggestions = suggestFloorDockFixes(state);
    expect(suggestions).toContainEqual(expect.objectContaining({
      kind: "near-miss",
      sourceSlabId: "b",
      targetSlabId: "a",
      direction: "north",
      label: "将板区B拼到板区A北侧",
    }));
  });

  it("轻微重叠生成贴齐建议，角点重叠不提供唯一修复", () => {
    const overlap = plan([
      slab("a", 0, 0, 4200, 3600, "板区A"),
      slab("b", 0, 3595, 3600, 3600, "板区B"),
    ]);
    expect(suggestFloorDockFixes(overlap)).toContainEqual(expect.objectContaining({ kind: "overlap", sourceSlabId: "b", direction: "south", label: "将板区B贴齐板区A至南侧" }));
    const corner = plan([
      slab("a", 0, 0, 4200, 3600, "板区A"),
      slab("b", 4198, 3598, 3600, 3600, "板区B"),
    ]);
    expect(suggestFloorDockFixes(corner)).toEqual([]);
  });

  it("describeFloorSlabSideRelations给出四侧关系", () => {
    const state = plan([
      slab("a", 0, 0, 4200, 3600, "板区A"),
      slab("b", 4200, 0, 3600, 3600, "板区B"),
    ]);
    const relations = describeFloorSlabSideRelations(state, "a");
    const east = relations.find((item) => item.side === "east");
    expect(east).toMatchObject({ label: "板区B · 内墙", otherSlabId: "b", support: "inner-wall" });
    const west = relations.find((item) => item.side === "west");
    expect(west).toMatchObject({ label: "建筑外边", otherSlabId: null });
  });

  it("方向与对齐标签", () => {
    expect(floorDockDirectionLabel("west")).toBe("西侧");
    expect(floorDockDirectionLabel("north")).toBe("北侧");
    expect(floorDockAlignmentLabel("preserve")).toBe("保持当前位置");
    expect(floorDockAlignmentLabel("center")).toBe("居中");
  });
});
