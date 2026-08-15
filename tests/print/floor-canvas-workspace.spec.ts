import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

async function savedSlabs(page: import("@playwright/test").Page): Promise<Array<{ id: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
    return record.state?.slabs ?? [];
  }, DRAFT_KEY);
}

test("大画布：收起Inspector后Canvas明显扩大并持久化", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const canvas = page.locator("[data-testid='floor-canvas-card']");
  const before = await canvas.boundingBox();
  await page.getByTestId("collapse-inspector-handle").click();
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  const after = await canvas.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeGreaterThan(before!.width + 200);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("true");
  await page.reload();
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  await page.getByTestId("open-inspector-handle").click();
  await expect(page.getByTestId("collapse-inspector-handle")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("false");
});

test("Fullscreen：进入隐藏页面组件，退出恢复且FloorPlan不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const heading = page.getByRole("heading", { name: "整层楼板板筋系统" });
  await expect(heading).toBeVisible();
  await page.getByRole("button", { name: "全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toBeVisible();
  await expect(heading).toHaveCount(0);
  await page.getByRole("button", { name: "退出全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
});

test("Zoom按钮改变缩放百分比且不修改FloorPlan坐标", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const percent = page.getByTestId("canvas-zoom-percent");
  await expect(percent).toHaveText("100%");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(percent).toHaveText("125%");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(percent).not.toHaveText("125%");
  await page.getByRole("button", { name: "缩小" }).click();
  await page.getByRole("button", { name: "缩小" }).click();
  await expect(percent).toHaveText("100%");
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
});

test("拖动只在松手提交一次正式坐标，Undo一步直接回到起点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slab = page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await slab.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await slab.dispatchEvent("pointerdown", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX + 120, clientY: startY, bubbles: true });
  // 拖动中正式坐标保持旧值，只渲染预览。
  await expect(page.locator("[data-drag-preview]")).toHaveCount(1);
  await expect(page.getByLabel("西南角 X")).toHaveValue("0");
  await svg.dispatchEvent("pointerup", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: startX + 120, clientY: startY, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  await expect.poll(async () => {
    const slabs = await savedSlabs(page);
    return slabs[0]?.x ?? 0;
  }).toBeGreaterThan(0);

  const movedX = (await savedSlabs(page))[0]?.x;
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(0);
  await page.getByRole("button", { name: "重做" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(movedX);
});

test("iPad横屏：工具栏与全屏可用且拖空白平移不修改几何", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await expect(page.getByTestId("floor-canvas-toolbar")).toBeVisible();
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  // 空白处拖动平移（Pan）。
  await svg.dispatchEvent("pointerdown", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box!.x + 30, clientY: box!.y + 30, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box!.x + 90, clientY: box!.y + 70, bubbles: true });
  await svg.dispatchEvent("pointerup", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 0, clientX: box!.x + 90, clientY: box!.y + 70, bubbles: true });
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
  // 全屏进入与退出。
  await page.getByRole("button", { name: "全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toBeVisible();
  await page.getByRole("button", { name: "退出全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toHaveCount(0);
});
