import { describe, expect, it } from "vitest";
import { buildFloorRebarLayout } from "./floor-rebar-layout";

function layout(minMm: number, maxMm: number, spacingMm: number, count: number, key = "g") {
  return buildFloorRebarLayout({ key, direction: "x", count, spacingMm, minMm, maxMm });
}

describe("Floor Rebar Alignment Layout（钢筋对齐排布引擎）", () => {
  it("单矩形区域钢筋居中且步长恒等于间距", () => {
    const result = layout(0, 3600, 200, 18);
    expect(result.positionsMm).toHaveLength(18);
    expect(result.positionsMm[0]).toBe(100);
    expect(result.positionsMm[17]).toBe(3500);
    expect(result.startOffsetMm).toBe(100);
    expect(result.endOffsetMm).toBe(100);
    result.positionsMm.slice(1).forEach((position, index) => {
      expect(position - result.positionsMm[index]).toBeCloseTo(200, 9);
    });
  });

  it("剩余净跨无法整除间距时首末等距", () => {
    // 8100 / 200 = 40.5 -> ceil 41 -> covered 8000 -> offset 50
    const result = layout(0, 8100, 200, 41);
    expect(result.positionsMm[0]).toBe(50);
    expect(result.positionsMm[40]).toBe(8050);
    expect(result.startOffsetMm).toBe(50);
    expect(result.endOffsetMm).toBe(50);
  });

  it("count=1 时单根居中", () => {
    const result = layout(0, 3600, 200, 1);
    expect(result.positionsMm).toEqual([1800]);
  });

  it("originMm = min + offset，恒不越过区域起点", () => {
    const result = layout(500, 4300, 200, 19);
    expect(result.originMm).toBe(500 + result.startOffsetMm);
    expect(result.startOffsetMm).toBeGreaterThanOrEqual(0);
    expect(result.endOffsetMm).toBeGreaterThanOrEqual(0);
  });

  it("非法输入返回空序列而不抛错", () => {
    expect(layout(0, 3600, 200, 0).positionsMm).toEqual([]);
    expect(layout(0, 3600, 0, 18).positionsMm).toEqual([]);
  });

  it("不同key/间距分组互不影响", () => {
    const wide = buildFloorRebarLayout({ key: "domain-1:x", direction: "x", count: 8, spacingMm: 400, minMm: 0, maxMm: 3200 });
    const tight = buildFloorRebarLayout({ key: "domain-2:x", direction: "x", count: 17, spacingMm: 200, minMm: 0, maxMm: 3200 });
    expect(wide.key).toBe("domain-1:x");
    expect(tight.key).toBe("domain-2:x");
    expect(wide.positionsMm[0]).toBe(200);
    expect(tight.positionsMm[0]).toBe(0);
    expect(wide.positionsMm[7]).toBe(3000);
    expect(tight.positionsMm[16]).toBe(3200);
  });
});
