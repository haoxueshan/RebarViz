import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

type DraftSupportRule = {
  id: string;
  target: { kind: "slab-edge"; slabId: string; side: "east" | "west" | "south" | "north"; range: { mode: "whole" } };
  support: "inner-wall" | "continuous" | "opening-cut";
};

function defaultDraftState(): {
  coordinateModel: "net-layout-v1";
  slabs: Array<{ id: string; name: string; type: string; x: number; y: number; width: number; height: number }>;
  openings: never[];
  supportRules: DraftSupportRule[];
  innerWallThickness: number;
  outerWallThickness: number;
  snapDistanceMm: number;
  overlapToleranceMm: number;
} {
  return {
    coordinateModel: "net-layout-v1",
    slabs: [
      { id: "floor-slab-a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
      { id: "floor-slab-b", name: "板区B", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
    ],
    openings: [],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
}

async function installDefaultWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey, state }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state,
    }));
    localStorage.removeItem(bottomKey);
    localStorage.removeItem(topKey);
    localStorage.removeItem(roleKey);
    if (window.innerWidth >= 640) localStorage.setItem("floorWorkspaceInspectorOpen", "true");
  }, {
    draftKey: DRAFT_KEY,
    bottomKey: BOTTOM_KEY,
    topKey: TOP_KEY,
    roleKey: ROLE_KEY,
    state: defaultDraftState(),
  });
  await page.reload();
}

test("默认双房间：实体墙真实比例占位、板区物理位置正确、Fit包含外墙", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDefaultWorkspace(page);
  const canvas = page.locator('svg[aria-label*="整层板区"]');
  await expect(canvas).toBeVisible();

  // 板区A保持物理原点，板区B = 4200 + 240 内墙。
  await expect(page.locator('[aria-label="选择板区 板区A"]')).toHaveAttribute("data-physical-x", "0");
  await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-physical-x", "4440");
  await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-net-x", "4200");

  // 实体内墙：240mm 真实几何。
  const inner = canvas.locator('[data-wall-kind="inner-wall"]');
  await expect(inner).toHaveCount(1);
  await expect(inner).toHaveAttribute("data-wall-thickness-mm", "240");
  await expect(inner).toHaveAttribute("data-wall-length-mm", "3600");
  await expect(inner).toHaveAttribute("data-wall-x-mm", "4200");

  // 外墙：370mm，位于净房间外侧。
  const outer = canvas.locator('[data-wall-kind="outer-wall"]');
  await expect(outer).toHaveCount(6);
  await expect(outer.first()).toHaveAttribute("data-wall-thickness-mm", "370");

  // 真实比例：同一 zoom 下 370/240 ≈ 1.5417，而不是被 4~12px clamp。
  const innerWidthPx = await inner.evaluate((element) => (element as SVGRectElement).getBoundingClientRect().width);
  const outerWidthPx = await outer.first().evaluate((element) => (element as SVGRectElement).getBoundingClientRect().width);
  const ratio = outerWidthPx / innerWidthPx;
  expect(Math.abs(ratio - 370 / 240)).toBeLessThan(0.06);

  // 适合楼层把外墙纳入取景：中心 = (-370 + 8410)/2 = 4020。
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "适合楼层" }).click();
  await expect(canvas).toHaveAttribute("data-viewport-center-x", "4020");
  await expect(canvas).toHaveAttribute("data-viewport-center-y", "1800");
});

test("Continuous共享边：物理0mm共边且无内墙实体", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  const continuousState = defaultDraftState();
  continuousState.supportRules = [{
    id: "continuous-a-b",
    target: { kind: "slab-edge", slabId: "floor-slab-a", side: "east", range: { mode: "whole" } },
    support: "continuous",
  }];
  await page.evaluate(({ draftKey, state }) => {
    localStorage.setItem(draftKey, JSON.stringify({ schemaVersion: 3, savedAt: new Date().toISOString(), state }));
  }, { draftKey: DRAFT_KEY, state: continuousState });
  await page.reload();
  const canvas = page.locator('svg[aria-label*="整层板区"]');
  await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-physical-x", "4200");
  await expect(canvas.locator('[data-wall-kind="inner-wall"]')).toHaveCount(0);
  await expect(canvas.locator('[data-floor-layer="display-boundaries"] line')).not.toHaveCount(0);
});

test("内墙厚度修改：物理位置与墙宽实时更新，净跨保持不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDefaultWorkspace(page);
  await page.getByLabel("内墙厚度").fill("300");
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-physical-x", "4500");
  await expect(page.locator('svg[aria-label*="整层板区"] [data-wall-kind="inner-wall"]')).toHaveAttribute("data-wall-thickness-mm", "300");
  // 净跨坐标不因墙厚变化。
  await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-net-x", "4200");
});

test("实体墙Hit区域与可见墙体对齐并可选中Boundary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDefaultWorkspace(page);
  const canvas = page.locator('svg[aria-label*="整层板区"]');
  // 点击可见内墙实体（带 atomic id 的 hit 层）。
  const inner = canvas.locator('[data-wall-kind="inner-wall"]').first();
  const box = await inner.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(canvas.locator('[data-selected-atomic-id]')).toHaveCount(1);
});

test("拖动预览使用物理位置，松手写回净坐标", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDefaultWorkspace(page);
  // 关闭吸附与容差纠偏，避免拖动被自动拉回原位置。
  await page.getByLabel("自动吸附距离").fill("0");
  await page.keyboard.press("Enter");
  await page.getByLabel("几何对齐容差").fill("0");
  await page.keyboard.press("Enter");
  const slabA = page.locator('[aria-label="选择板区 板区A"]');
  const box = await slabA.boundingBox();
  expect(box).toBeTruthy();
  // 拖动板区A向南移动，预览应出现在物理坐标系；松手后 Net Y 变化。
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 60, { steps: 8 });
  await expect(page.locator('[data-drag-preview="true"]')).toBeVisible();
  await page.mouse.up();
  // 松手后净坐标被正式写入（向南移动，Y 偏离 0；物理显示同步更新）。
  await expect(slabA).not.toHaveAttribute("data-net-y", "0");
  const netY = Number(await slabA.getAttribute("data-net-y"));
  expect(Number.isFinite(netY)).toBe(true);
  expect(netY).not.toBe(0);
});
