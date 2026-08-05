import { describe, expect, it } from "vitest";
import {
  displayNumberDraft,
  numberValueToDraft,
  parseNumberDraft,
} from "./number-field-draft";

describe("计算器数字输入草稿", () => {
  it.each([
    ["房间尺寸", 4200, "3800", 3800],
    ["钢筋直径", 8, "10", 10],
    ["钢筋间距", 150, "200", 200],
    ["手动锚固", 240, "300", 300],
  ])("%s允许删除为空后直接输入新值", (_label, initial, replacement, expected) => {
    let draft = numberValueToDraft(initial);
    expect(draft).toBe(String(initial));

    draft = "";
    expect(parseNumberDraft(draft)).toBeNull();
    expect(displayNumberDraft(draft, initial)).toBe("");

    draft = replacement;
    expect(parseNumberDraft(draft)).toBe(expected);
    expect(draft).toBe(replacement);
    expect(draft.startsWith("0")).toBe(false);
  });

  it("空白失焦恢复最近一个有效业务值而不是0", () => {
    expect(displayNumberDraft("", 4200)).toBe("");
    expect(displayNumberDraft(null, 4200)).toBe("4200");
  });

  it("编辑草稿原样展示且结束编辑后重新跟随业务值", () => {
    expect(displayNumberDraft("010", 8)).toBe("010");
    expect(displayNumberDraft("not-a-number", 150)).toBe("not-a-number");
    expect(displayNumberDraft(null, 150)).toBe("150");
  });

  it("外部重置或草稿恢复可以重新生成显示字符串", () => {
    expect(numberValueToDraft(4200)).toBe("4200");
    expect(numberValueToDraft(3600)).toBe("3600");
    expect(numberValueToDraft(Number.NaN)).toBe("");
  });
});
