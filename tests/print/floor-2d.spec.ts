import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

test("Floor 2D V2.2近错位在图中警示并阻止正式Piece与打印", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 4200.5, y: 0, width: 3600, height: 3600 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: 0,
      },
    }));
    localStorage.removeItem(bottomKey);
    localStorage.removeItem(topKey);
    localStorage.setItem(roleKey, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: { mainDirectionOverrides: { "role:b": "x" } } }));
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await expect(page.getByText(/0\.5mm/).first()).toBeVisible();
  await expect(page.locator("[data-near-miss]")).toHaveCount(1);
  await page.getByRole("button", { name: "地筋", exact: true }).click();
  await expect(page.getByText("地筋结果无效")).toBeVisible();
  await expect(page.locator("[data-piece-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "料单", exact: true }).click();
  await expect(page.getByRole("button", { name: "打印设置" })).toBeDisabled();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("容差内0.5mm间隙自动对齐为精确共边并生成正式Piece", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 4200.5, y: 0, width: 3600, height: 3600 },
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
    localStorage.setItem(roleKey, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: { mainDirectionOverrides: { "role:b": "x" } } }));
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("[data-near-miss]")).toHaveCount(0);
  await expect.poll(async () => {
    const stored = await page.evaluate((draftKey) => JSON.parse(localStorage.getItem(draftKey) ?? "null"), DRAFT_KEY);
    return stored.state.slabs.find((slab: { id: string; x: number }) => slab.id === "b")?.x;
  }).toBe(4200);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "地筋", exact: true }).click();
  await expect(page.getByTestId("floor-live-summary")).toContainText("地筋有效");
  await expect(page.locator("[data-piece-id]")).not.toHaveCount(0);
});

test("Display边可合并但点击与编辑精确落到对应Atomic段", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 2000, width: 2000, height: 2000 },
          { id: "b", name: "板区B", type: "room", x: 2000, y: 2000, width: 2000, height: 2000 },
          { id: "c", name: "板区C", type: "room", x: 0, y: 0, width: 2000, height: 2000 },
          { id: "d", name: "板区D", type: "room", x: 2000, y: 0, width: 2000, height: 2000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.setItem(roleKey, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: { mainDirectionOverrides: { "role:a": "x", "role:b": "x", "role:c": "x", "role:d": "x" } } }));
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const upper = page.locator('[data-atomic-boundary-id*="atomic:v:shared-slab:2000,2000-2000,4000"]');
  const lower = page.locator('[data-atomic-boundary-id*="atomic:v:shared-slab:2000,0-2000,2000"]');
  await expect(upper).toHaveCount(1);
  await expect(lower).toHaveCount(1);
  await lower.dispatchEvent("pointerdown", { pointerId: 9, bubbles: true });
  const selectedCard = page.locator("aside .border-orange-400");
  await expect(selectedCard).toContainText("与板区D");
  await selectedCard.getByRole("button", { name: "连续楼板" }).click();
  await expect(lower).toHaveAttribute("data-boundary-support", "continuous");
  await expect(upper).toHaveAttribute("data-boundary-support", "inner-wall");
});

test("pointercancel恢复拖动起点且不会把中间位置保存为草稿", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();
  const slab = page.getByRole("button", { name: "选择板区 板区A" });
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await slab.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await slab.dispatchEvent("pointerdown", { pointerId: 41, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 41, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX + 80, clientY: startY + 20, bubbles: true });
  // PRD 40/41/81：拖动中只更新Canvas预览，正式坐标保持旧值。
  await expect(page.locator("[data-drag-preview]")).toHaveCount(1);
  await expect(page.getByLabel("西南角 X")).toHaveValue("0");
  await svg.dispatchEvent("pointercancel", { pointerId: 41, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: startX + 80, clientY: startY + 20, bubbles: true });
  await expect(page.getByLabel("西南角 X")).toHaveValue("0");
  await expect(page.getByLabel("西南角 Y")).toHaveValue("0");
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  await page.waitForTimeout(400);
  const saved = await page.evaluate((draftKey) => JSON.parse(localStorage.getItem(draftKey) ?? "null"), DRAFT_KEY);
  expect(saved.state.slabs[0]).toMatchObject({ x: 0, y: 0 });
});

test("正式普通Piece和Through Piece均可点击检查，远端洞口不压缩主体视图", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, topKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4000, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 4000, y: 0, width: 4000, height: 3600 },
        ],
        openings: [{ id: "far", name: "远端洞口", type: "void", x: 50000, y: 50000, width: 1000, height: 1000 }],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        topAnchorExtra: 250,
        defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 900, ySpacing: 900, xExtraMode: "both", yExtraMode: "both" },
        slabOverrides: {},
        throughPaths: [{ id: "path-a-b", name: "通墙01", direction: "x", slabIds: ["a", "b"], bandStartMm: 0, bandEndMm: 3600, enabled: true }],
      },
    }));
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();
  await expect(page.locator('svg[data-floor-canvas-fit="floor"]')).toBeVisible();
  await expect(page.getByText(/有1个洞口位于楼板范围外/)).toBeVisible();
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "查看全部" }).click();
  await expect(page.locator('svg[data-floor-canvas-fit="all"]')).toBeVisible();
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "适合楼层" }).click();

  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByTestId("floor-live-summary")).toContainText("面筋有效");
  const normalPiece = page.locator('[data-piece-source="normal"]').first();
  await normalPiece.dispatchEvent("pointerdown", { pointerId: 10, bubbles: true });
  await expect(page.getByTestId("floor-piece-inspector")).toContainText("普通面筋");
  await expect(page.getByTestId("floor-piece-inspector")).toContainText(/Φ10@900/);
  await expect(page.getByTestId("floor-piece-inspector")).toContainText("正式下料");

  const throughPiece = page.locator('[data-piece-source="through"]').first();
  await throughPiece.dispatchEvent("pointerdown", { pointerId: 11, bubbles: true });
  await expect(page.getByTestId("floor-piece-inspector")).toContainText("通墙01 · 通墙面筋");
  await expect(page.getByTestId("floor-piece-inspector")).toContainText("中间穿墙");
  await expect(page.locator("[data-through-crossing]")).not.toHaveCount(0);
});
