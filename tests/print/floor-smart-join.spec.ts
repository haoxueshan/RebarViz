import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

async function installJoinWorkspace(page: Page, bX = 4280): Promise<void> {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey, bX }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "sj-a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "sj-b", name: "板区B", type: "room", x: bX, y: 0, width: 3600, height: 3600 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: 10,
      },
    }));
    localStorage.removeItem(bottomKey);
    localStorage.removeItem(topKey);
    localStorage.removeItem(roleKey);
    sessionStorage.clear();
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, bX });
  await page.reload();
}

async function slabBBox(page: Page) {
  const rect = page.locator('rect[aria-label="选择板区 板区B"]');
  const box = await rect.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function savedSlabs(page: Page): Promise<Array<{ id: string; x: number; y: number }>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return (JSON.parse(raw).state?.slabs ?? []) as Array<{ id: string; x: number; y: number }>;
  }, DRAFT_KEY);
}

test.describe("Floor Smart Join V1.3.2 板边磁吸连接", () => {
  test("Mouse Drag：接近板边出现 Join Preview（内墙240），松手精确连接并形成实体墙，Undo/Redo 一步", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installJoinWorkspace(page);

    const box = await slabBBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    // 拖动板区B向左（接近板区A东边，初始净距离80mm已在150mm捕捉范围内）。
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 12, centerY, { steps: 4 });
    // Join Preview 出现：Guide + 内墙240预览 + 共享长度数据。
    const joinPreview = page.locator("[data-floor-join-preview]");
    await expect(joinPreview).toBeVisible();
    await expect(joinPreview).toHaveAttribute("data-join-source", "sj-b");
    await expect(joinPreview).toHaveAttribute("data-join-target", "sj-a");
    await expect(joinPreview).toHaveAttribute("data-join-side", "west");
    await expect(joinPreview).toHaveAttribute("data-join-support", "inner-wall");
    const distance = Number(await joinPreview.getAttribute("data-join-distance-mm"));
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(150);
    const wallPreview = page.locator("[data-floor-join-wall-preview]");
    await expect(wallPreview).toBeVisible();
    await expect(wallPreview).toHaveAttribute("data-wall-thickness-mm", "240");
    // 松手：B.x 精确 = A.x + A.width = 4200。
    await page.mouse.up();
    await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "sj-b")?.x).toBe(4200);
    // 实体内墙出现在 Physical Walls 层（240mm）。
    const innerWalls = page.locator('[data-wall-kind="inner-wall"]');
    await expect(innerWalls.first()).toBeVisible();
    const thickness = await innerWalls.first().getAttribute("data-wall-thickness-mm");
    expect(thickness).toBe("240");
    // Viewport 不跳：缩放百分比保持 100%。
    await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("100%");
    // Undo 一步恢复 Join 前位置；Redo 精确恢复。
    await page.getByRole("button", { name: "撤销" }).click();
    await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "sj-b")?.x).toBe(4280);
    await page.getByRole("button", { name: "重做" }).click();
    await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "sj-b")?.x).toBe(4200);
  });

  test("Touch Drag：超过阈值后出现 Join Preview，松手精确连接", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    // 初始 gap 110mm：Touch 小位移（约11px≈180mm）后仍在150mm捕捉范围内。
    await installJoinWorkspace(page, 4310);

    const box = await slabBBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const rect = page.locator('rect[aria-label="选择板区 板区B"]');
    const svg = page.locator("svg[data-floor-canvas-fit]");
    // 超过 10px Touch Drag Threshold 才激活候选。
    await rect.dispatchEvent("pointerdown", { pointerId: 71, pointerType: "touch", isPrimary: true, buttons: 1, clientX: centerX, clientY: centerY, bubbles: true });
    await svg.dispatchEvent("pointermove", { pointerId: 71, pointerType: "touch", buttons: 1, clientX: centerX - 11, clientY: centerY, bubbles: true });
    await expect(page.locator("[data-floor-join-preview]")).toBeVisible();
    await svg.dispatchEvent("pointerup", { pointerId: 71, pointerType: "touch", buttons: 0, clientX: centerX - 11, clientY: centerY, bubbles: true });
    await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "sj-b")?.x).toBe(4200);
  });

  test("Touch Tap：低于阈值不触发 Join，几何不变", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installJoinWorkspace(page);

    const box = await slabBBox(page);
    const rect = page.locator('rect[aria-label="选择板区 板区B"]');
    const svg = page.locator("svg[data-floor-canvas-fit]");
    await rect.dispatchEvent("pointerdown", { pointerId: 81, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true });
    // 仅 3px：低于 Touch Drag Threshold。
    await svg.dispatchEvent("pointermove", { pointerId: 81, pointerType: "touch", buttons: 1, clientX: box.x + box.width / 2 + 3, clientY: box.y + box.height / 2, bubbles: true });
    await svg.dispatchEvent("pointerup", { pointerId: 81, pointerType: "touch", buttons: 0, clientX: box.x + box.width / 2 + 3, clientY: box.y + box.height / 2, bubbles: true });
    await expect(page.locator("[data-floor-join-preview]")).toHaveCount(0);
    await page.waitForTimeout(150);
    const slabs = await savedSlabs(page);
    expect(slabs.find((slab) => slab.id === "sj-b")).toMatchObject({ x: 4280, y: 0 });
  });

  test("Pinch：第二指加入取消 Join Preview 且不写几何", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installJoinWorkspace(page, 4310);

    const box = await slabBBox(page);
    const rect = page.locator('rect[aria-label="选择板区 板区B"]');
    const svg = page.locator("svg[data-floor-canvas-fit]");
    const svgBox = await svg.boundingBox();
    expect(svgBox).not.toBeNull();
    await rect.dispatchEvent("pointerdown", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true });
    await svg.dispatchEvent("pointermove", { pointerId: 61, pointerType: "touch", buttons: 1, clientX: box.x + box.width / 2 - 11, clientY: box.y + box.height / 2, bubbles: true });
    await expect(page.locator("[data-floor-join-preview]")).toBeVisible();
    // 第二指落空白 → 升级 Pinch，Join Preview 取消。
    await svg.dispatchEvent("pointerdown", { pointerId: 62, pointerType: "touch", isPrimary: false, buttons: 1, clientX: svgBox!.x + 30, clientY: svgBox!.y + 30, bubbles: true });
    await expect(page.locator("[data-floor-join-preview]")).toHaveCount(0);
    await svg.dispatchEvent("pointerup", { pointerId: 61, pointerType: "touch", buttons: 0, clientX: box.x + box.width / 2 - 11, clientY: box.y + box.height / 2, bubbles: true });
    await svg.dispatchEvent("pointerup", { pointerId: 62, pointerType: "touch", buttons: 0, clientX: svgBox!.x + 30, clientY: svgBox!.y + 30, bubbles: true });
    await page.waitForTimeout(200);
    const slabs = await savedSlabs(page);
    expect(slabs.find((slab) => slab.id === "sj-b")).toMatchObject({ x: 4310, y: 0 });
    await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  test("PointerCancel：取消 Join 且不写几何、不产生 History", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installJoinWorkspace(page);

    const box = await slabBBox(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 12, centerY, { steps: 4 });
    await expect(page.locator("[data-floor-join-preview]")).toBeVisible();
    await page.locator("svg[data-floor-canvas-fit]").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: centerX - 12, clientY: centerY, bubbles: true });
    await expect(page.locator("[data-floor-join-preview]")).toHaveCount(0);
    await page.waitForTimeout(200);
    const slabs = await savedSlabs(page);
    expect(slabs.find((slab) => slab.id === "sj-b")).toMatchObject({ x: 4280, y: 0 });
    await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  test("页面加载不自动拼接：100mm 距离仅提示场景，坐标保持", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
      localStorage.setItem(draftKey, JSON.stringify({
        schemaVersion: 3,
        savedAt: new Date().toISOString(),
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [
            { id: "sj-a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
            { id: "sj-b", name: "板区B", type: "room", x: 4300, y: 0, width: 3600, height: 3600 },
          ],
          openings: [],
          supportRules: [],
          innerWallThickness: 240,
          outerWallThickness: 370,
          snapDistanceMm: 150,
          overlapToleranceMm: 10,
        },
      }));
      localStorage.removeItem(bottomKey);
      localStorage.removeItem(topKey);
      localStorage.removeItem(roleKey);
      sessionStorage.clear();
    }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
    await page.reload();
    await page.waitForTimeout(400);
    const slabs = await savedSlabs(page);
    // 100mm 候选存在但绝不自动修改坐标（必须用户明确操作）。
    expect(slabs.find((slab) => slab.id === "sj-b")?.x).toBe(4300);
  });
});
