import { describe, expect, it } from "vitest";
import { cloneDefaultSlabCalculatorState } from "./slab-calculator";
import {
  DEFAULT_SLAB_PRINT_OPTIONS,
  DEFAULT_SLAB_PRINT_SECTIONS,
  SITE_SLAB_PRINT_SECTIONS,
} from "./slab-calculator-storage";
import {
  applyPrintPreset,
  detectPrintPreset,
  getCalculationModeSummary,
  getPaginationItems,
  getThroughExtraStatusText,
  getTopDirectionStatusLabel,
} from "./slab-calculator-ui";

describe("计算器展示辅助逻辑", () => {
  it("普通面筋方向标签同步通墙方向，但不修改钢筋设置", () => {
    const state = cloneDefaultSlabCalculatorState();
    expect(getTopDirectionStatusLabel("x", state)).toBe("X向（西→东）");
    state.slab.arrangement = "x";
    state.through.enabled = true;
    state.through.direction = "x";
    expect(getTopDirectionStatusLabel("x", state)).toBe("X向 · 通墙规格");
    expect(getTopDirectionStatusLabel("y", state)).toBe("Y向 · 按房间");
  });

  it("当前计算模式覆盖单房间、普通多房间和通墙", () => {
    const state = cloneDefaultSlabCalculatorState();
    expect(getCalculationModeSummary(state)).toMatchObject({
      arrangement: "单房间",
      topX: "按房间",
      topY: "按房间",
    });
    state.slab.arrangement = "y";
    state.slab.rooms.push(structuredClone(state.slab.rooms[0]));
    state.through.enabled = true;
    state.through.direction = "y";
    expect(getCalculationModeSummary(state)).toMatchObject({
      arrangement: "2间 · 南北向排列",
      topX: "按房间",
      topY: "通墙",
    });
  });

  it("通墙实际增加提示区分外墙、内墙和手动端", () => {
    const state = cloneDefaultSlabCalculatorState();
    state.slab.arrangement = "x";
    state.through.enabled = true;
    state.through.direction = "x";
    expect(getThroughExtraStatusText(state)).toContain("两端均为外墙");
    state.through.startAnchor.source = "inner-wall";
    expect(getThroughExtraStatusText(state)).toContain("仅最西端");
    state.through.startAnchor.source = "manual";
    expect(getThroughExtraStatusText(state)).toContain("手动锚固");
  });

  it("分页只生成有限页码并保留当前页附近", () => {
    const items = getPaginationItems(9, 24);
    expect(items).toEqual([1, "start-ellipsis", 7, 8, 9, 10, 11, "end-ellipsis", 24]);
    expect(items.filter((item) => typeof item === "number")).toHaveLength(7);
    expect(getPaginationItems(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("现场料单、完整报告与自定义打印模板可确定识别", () => {
    const site = applyPrintPreset(DEFAULT_SLAB_PRINT_OPTIONS, "site");
    expect(site.detailMode).toBe("compact");
    expect(site.sections).toEqual(SITE_SLAB_PRINT_SECTIONS);
    expect(detectPrintPreset(site)).toBe("site");

    const full = applyPrintPreset(site, "full");
    expect(full.detailMode).toBe("full");
    expect(full.sections).toEqual(DEFAULT_SLAB_PRINT_SECTIONS);
    expect(detectPrintPreset(full)).toBe("full");

    expect(detectPrintPreset({
      ...full,
      sections: { ...full.sections, calculationNotes: false },
    })).toBe("custom");
  });
});
