import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

async function installMultiBlockWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
    const slabs = Array.from({ length: 12 }, (_, index) => ({
      id: `s${String(index + 1).padStart(2, "0")}`,
      name: `板区${String(index + 1).padStart(2, "0")}`,
      type: index === 5 ? "corridor" : index === 8 ? "balcony" : "room",
      x: (index % 4) * 3000,
      y: Math.floor(index / 4) * 2400,
      width: 3000,
      height: 2400,
    }));
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs,
        openings: [
          { id: "o1", name: "楼梯间", type: "stair", x: 3600, y: 3000, width: 900, height: 900 },
          { id: "o2", name: "井道", type: "shaft", x: 9300, y: 5400, width: 600, height: 600 },
        ],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.setItem(bottomKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300 },
        slabOverrides: {
          s03: { mainDiameter: 14, secondaryDiameter: 10, xSpacing: 250, ySpacing: 300 },
          s05: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 280, ySpacing: 300 },
          s08: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 260, ySpacing: 300 },
        },
      },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        topAnchorExtra: 250,
        defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" },
        slabOverrides: {
          s08: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" },
          s10: { mainDiameter: 10, secondaryDiameter: 8, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" },
        },
        throughPaths: [
          { id: "p-valid", name: "通墙有效", direction: "x", slabIds: ["s01", "s02"], bandStartMm: 0, bandEndMm: 2400, enabled: true },
          { id: "p-invalid", name: "通墙错误", direction: "x", slabIds: ["s05", "s09"], bandStartMm: 2400, bandEndMm: 4800, enabled: true },
          { id: "p-disabled", name: "通墙停用", direction: "x", slabIds: ["s03", "s04"], bandStartMm: 0, bandEndMm: 0, enabled: false },
        ],
      },
    }));
    localStorage.removeItem(roleKey);
    // 显式用户设置：平板也展开 Inspector（Canvas First 首访默认由专用用例验证）。
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();
}

test("12板区工作台保持Navigator、Canvas与Inspector双向同步并实时更新Summary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMultiBlockWorkspace(page);
  await expect(page.getByTestId("floor-workspace-grid")).toBeVisible();
  await expect(page.locator('[data-navigator-object-id^="s"]')).toHaveCount(12);

  await page.locator('[data-navigator-object-id="s10"]').click();
  await expect(page.locator('[data-navigator-object-id="s10"]')).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("floor-workspace-inspector")).toContainText("板区10");
  await expect(page.getByRole("button", { name: "选择板区 板区10" })).toHaveAttribute("stroke", "#2563eb");

  await page.getByRole("button", { name: "适合楼层" }).click();
  await page.getByRole("button", { name: "选择板区 板区03" }).click();
  await expect(page.locator('[data-navigator-object-id="s03"]')).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("floor-workspace-inspector")).toContainText("板区03");

  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await expect(page.locator('[data-navigator-object-id="s03"]')).toContainText("局部规格");
  await page.locator('[data-navigator-object-id="s03"]').click();
  const summaryBefore = await page.getByTestId("floor-live-summary").innerText();
  await page.getByLabel("东西向间距").first().fill("180");
  await expect.poll(async () => page.getByTestId("floor-live-summary").innerText()).not.toBe(summaryBefore);
  await page.getByLabel("主筋直径").first().fill("");
  await expect(page.getByTestId("floor-live-summary")).toContainText("地筋结果无效");

  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("Through Navigator区分有效、错误与停用，新路径只继承当前板区", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMultiBlockWorkspace(page);
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.locator('[data-navigator-through-id="p-valid"]')).toContainText("正常");
  await expect(page.locator('[data-navigator-through-id="p-invalid"]')).toContainText("异常");
  await expect(page.locator('[data-navigator-through-id="p-disabled"]')).toContainText("未启用");
  await page.locator('[data-navigator-through-id="p-valid"]').click();
  await expect(page.getByTestId("floor-workspace-inspector")).toContainText("通墙有效");
  await expect(page.locator('[data-through-path-id="p-valid"]')).toContainText("板区01 → 板区02");

  await page.locator('[data-navigator-object-id="s10"]').click();
  await page.getByRole("button", { name: "新建通墙路径" }).click();
  await expect(page.locator("[data-through-path-id]").last()).toBeVisible();
  await page.waitForTimeout(400);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), TOP_KEY);
  expect(stored.state.throughPaths.at(-1)).toMatchObject({ slabIds: ["s10"], enabled: false });
  expect(stored.state.throughPaths.at(-1).slabIds).not.toEqual(["s01", "s02"]);
});

test("390px通过Navigator与Inspector Drawer完成板区定位和局部规格编辑", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMultiBlockWorkspace(page);
  await page.getByRole("button", { name: /当前：板区01/ }).click();
  const navigatorDrawer = page.getByTestId("floor-workspace-left-drawer");
  await expect(navigatorDrawer).toBeVisible();
  await navigatorDrawer.getByPlaceholder("搜索板区/洞口").fill("板区10");
  await navigatorDrawer.locator('[data-navigator-object-id="s10"]').click();
  await expect(navigatorDrawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: /当前：板区10/ })).toBeVisible();

  await page.getByRole("button", { name: "地筋", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toContainText("当前板区：板区10");
  await inspector.getByRole("button", { name: "局部规格" }).click();
  await expect(inspector.getByLabel("主筋直径")).toHaveCount(2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("正方形和不规则Role区域在Navigator定位并共享人工主筋方向", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "rect", name: "矩形板", type: "room", x: 0, y: 0, width: 4000, height: 3000 },
          { id: "square", name: "正方形板", type: "room", x: 5000, y: 0, width: 3000, height: 3000 },
          { id: "l1", name: "L区南", type: "hall", x: 9000, y: 0, width: 4000, height: 2000 },
          { id: "l2", name: "L区北", type: "hall", x: 9000, y: 2000, width: 2000, height: 2000 },
        ],
        openings: [],
        supportRules: [{ id: "l-continuous", target: { kind: "slab-edge", slabId: "l1", side: "north", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" }],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const roleRows = page.locator("[data-navigator-role-id]");
  await expect(roleRows).toHaveCount(3);
  await expect(roleRows.filter({ hasText: "自动判断" })).toHaveCount(1);
  await expect(roleRows.filter({ hasText: "主筋方向待确认" })).toHaveCount(2);
  const squareRow = roleRows.filter({ hasText: "正方形区域" });
  await squareRow.click();
  await expect(page.getByTestId("floor-workspace-inspector")).toContainText("两个方向净跨相同");
  await page.getByTestId("floor-workspace-inspector").getByRole("button", { name: "东西向主筋" }).click();
  await expect(squareRow).toContainText("正常");
});

test("Tablet四档断点保持Workflow可用、无横向溢出并按设备切换工作区", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installMultiBlockWorkspace(page);
  const viewports = [
    { width: 768, height: 1024, inspector: true, navigator: false },
    { width: 820, height: 1180, inspector: true, navigator: false },
    { width: 1024, height: 768, inspector: true, navigator: false },
    { width: 1180, height: 820, inspector: true, navigator: false },
    { width: 1280, height: 800, inspector: true, navigator: true },
    { width: 1366, height: 768, inspector: true, navigator: true },
    { width: 1366, height: 1024, inspector: true, navigator: true },
    { width: 1440, height: 900, inspector: true, navigator: true },
    { width: 1920, height: 1080, inspector: true, navigator: true },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator('[aria-label="整层计算步骤"] button')).toHaveCount(4);
    const metrics = await page.evaluate(() => {
      const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
        .some((element) => getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0);
      const grid = document.querySelector<HTMLElement>('[data-testid="floor-workspace-grid"]');
      const canvas = document.querySelector<SVGElement>('svg[aria-label*="正式钢筋Piece"]');
      const summary = document.querySelector<HTMLElement>('[data-testid="floor-live-summary"]');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inspector: visible('[data-testid="floor-workspace-inspector"]'),
        navigator: visible('[data-testid="floor-workspace-navigator"]'),
        canvasRatio: grid && canvas ? canvas.getBoundingClientRect().width / grid.getBoundingClientRect().width : 0,
        summaryRendered: Boolean(summary && summary.getBoundingClientRect().height > 0),
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.inspector).toBe(viewport.inspector);
    expect(metrics.navigator).toBe(viewport.navigator);
    if (viewport.width >= 1024) {
      expect(metrics.summaryRendered).toBe(true);
    }
    if (viewport.width >= 1024 && viewport.width < 1280) expect(metrics.canvasRatio).toBeGreaterThan(0.5);
  }
});

test("Tablet竖横屏切换保持stage、selection和数字输入，并支持Escape关闭Navigator", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await installMultiBlockWorkspace(page);
  const currentObject = page.getByRole("button", { name: /当前：板区01/ });
  await currentObject.click();
  await expect(page.getByTestId("floor-workspace-left-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("floor-workspace-left-drawer")).toHaveCount(0);

  await currentObject.click();
  const drawer = page.getByTestId("floor-workspace-left-drawer");
  await drawer.getByPlaceholder("搜索板区/洞口").fill("板区08");
  await drawer.locator('[data-navigator-object-id="s08"]').click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: /当前：板区08/ })).toBeVisible();

  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByLabel("东西向间距").first().fill("275");

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByRole("button", { name: /2\. 地筋/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /当前：板区08/ })).toBeVisible();
  await expect(inspector.getByLabel("东西向间距").first()).toHaveValue("275");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel("东西向间距").first()).toHaveValue("275");
});

test("Tablet Through板区选择器容纳20板区并在内部滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installMultiBlockWorkspace(page);
  await page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    for (let index = 12; index < 20; index += 1) {
      record.state.slabs.push({
        id: `s${String(index + 1).padStart(2, "0")}`,
        name: `板区${String(index + 1).padStart(2, "0")}`,
        type: "room",
        x: (index % 4) * 3000,
        y: Math.floor(index / 4) * 2400,
        width: 3000,
        height: 2400,
      });
    }
    localStorage.setItem(draftKey, JSON.stringify(record));
  }, DRAFT_KEY);
  await page.reload();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await page.getByRole("button", { name: /当前：板区01/ }).click();
  const drawer = page.getByTestId("floor-workspace-left-drawer");
  await drawer.locator('[data-navigator-through-id="p-disabled"]').click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "编辑经过板区" }).click();
  const selector = page.getByTestId("through-slab-selector");
  await expect(selector.locator('input[type="checkbox"]')).toHaveCount(20);
  const size = await selector.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(size.scrollHeight).toBeGreaterThan(size.clientHeight);
  expect(size.clientHeight).toBeLessThanOrEqual(0.45 * 768 + 2);
});

test("Tablet竖屏768×1024保持Canvas在上、Editor为右侧Overlay且页面整体自然滚动", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installMultiBlockWorkspace(page);
  const canvas = page.locator('svg[aria-label*="正式钢筋Piece"]');
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  // Editor为固定Overlay：位于顶部导航下方，覆盖Canvas右侧区域（PRD 16/32）。
  expect(inspectorBox!.y).toBeGreaterThanOrEqual(100);
  expect(inspectorBox!.y).toBeLessThan(canvasBox!.y + canvasBox!.height);
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
  expect(canvasBox!.width).toBeGreaterThan(768 * 0.8);
  const scroll = await page.evaluate(() => ({ clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight }));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
});

test("楼层阶段选中板区直接看到净尺寸，修改后Canvas实时变化", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(bottomKey);
    localStorage.removeItem(topKey);
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();
  const editor = page.getByTestId("floor-size-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("东西向净尺寸")).toHaveValue("4200");
  await expect(editor.getByLabel("南北向净尺寸")).toHaveValue("3600");
  await editor.getByLabel("东西向净尺寸").fill("5000");
  await editor.getByLabel("南北向净尺寸").fill("4000");
  await expect(page.locator('svg[data-floor-canvas-fit]')).toContainText("5000 × 4000 mm");
});

test("正方形板区进入地筋即可直接点击主筋方向按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [{ id: "square", name: "正方形板区", type: "room", x: 0, y: 0, width: 4000, height: 4000 }],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(bottomKey);
    localStorage.removeItem(topKey);
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY });
  await page.reload();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const xButton = page.getByTestId("floor-workspace-inspector").getByRole("button", { name: "东西向主筋" });
  const yButton = page.getByTestId("floor-workspace-inspector").getByRole("button", { name: "南北向主筋" });
  await expect(xButton).toBeVisible();
  await expect(yButton).toBeVisible();
  const xBox = await xButton.boundingBox();
  expect(xBox).not.toBeNull();
  expect(xBox!.height).toBeGreaterThanOrEqual(56);
  await xButton.click();
  await expect(page.getByText("正式地筋结果有效")).toBeVisible();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByTestId("floor-workspace-inspector").getByRole("button", { name: "东西向主筋" })).toHaveAttribute("aria-pressed", "true");
});

test("非法数字输入失焦后恢复旧值并解除invalid标记", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installMultiBlockWorkspace(page);
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const spacing = page.getByLabel("东西向间距").first();
  await spacing.fill("");
  await expect(spacing).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("floor-live-summary")).toContainText("地筋结果无效");
  await page.getByRole("heading", { name: "整层地筋默认规格" }).click();
  await expect(spacing).toHaveValue("300");
  await expect(spacing).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("floor-live-summary")).not.toContainText("地筋结果无效");
});

test("重置平面同步清理局部规格、通墙路径和关联状态", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installMultiBlockWorkspace(page);
  await page.getByRole("button", { name: /1\. 楼层/ }).click();
  await page.getByTestId("floor-settings-section").getByRole("button", { name: "楼层设置" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重置平面" }).click();
  await page.waitForTimeout(600);
  const stored = await page.evaluate(({ bottomKey, topKey, roleKey, draftKey }) => ({
    draft: JSON.parse(localStorage.getItem(draftKey) ?? "null"),
    bottom: JSON.parse(localStorage.getItem(bottomKey) ?? "null"),
    top: JSON.parse(localStorage.getItem(topKey) ?? "null"),
    role: JSON.parse(localStorage.getItem(roleKey) ?? "null"),
  }), { bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, draftKey: DRAFT_KEY });
  const defaultIds = stored.draft.state.slabs.map((slab: { id: string }) => slab.id);
  expect(Object.keys(stored.bottom.state.slabOverrides)).toEqual([]);
  expect(Object.keys(stored.top.state.slabOverrides)).toEqual([]);
  expect(stored.top.state.throughPaths).toEqual([]);
  expect(Object.keys(stored.role.state.mainDirectionOverrides)).toEqual([]);
  expect(defaultIds).not.toContain("s10");
});

test("点击共享板边只高亮选中Atomic段，Display边正常绘制", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
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
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();
  const upper = page.locator('[data-atomic-boundary-id*="atomic:v:shared-slab:2000,2000-2000,4000"]');
  const lower = page.locator('[data-atomic-boundary-id*="atomic:v:shared-slab:2000,0-2000,2000"]');
  await lower.dispatchEvent("pointerdown", { pointerId: 9, bubbles: true });
  await expect(page.locator("[data-selected-atomic-id]")).toHaveCount(1);
  await expect(page.locator('[data-floor-layer="display-boundaries"] line[stroke="#f97316"]')).toHaveCount(0);
  await upper.dispatchEvent("pointerdown", { pointerId: 10, bubbles: true });
  await expect(page.locator("[data-selected-atomic-id]")).toHaveCount(1);
  await expect(page.locator("[data-selected-atomic-id]")).toHaveAttribute("data-selected-atomic-id", new RegExp("2000,2000-2000,4000"));
});

test("异常洞口伸出很远时适合楼层仍以楼板主体取景，显示全部才纳入洞口", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [{ id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 6000, height: 4000 }],
        openings: [{ id: "far", name: "异常洞口", type: "void", x: 5500, y: 3500, width: 50000, height: 50000 }],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();
  await expect(page.locator('svg[data-floor-canvas-fit="floor"]')).toBeVisible();
  const floorSlab = page.getByRole("button", { name: "选择板区 板区A" });
  const floorBox = await floorSlab.boundingBox();
  expect(floorBox).not.toBeNull();
  expect(floorBox!.width).toBeGreaterThan(150);
  await page.getByRole("button", { name: "查看全部" }).click();
  await expect(page.locator('svg[data-floor-canvas-fit="all"]')).toBeVisible();
  const allBox = await floorSlab.boundingBox();
  expect(allBox).not.toBeNull();
  expect(allBox!.width).toBeLessThan(floorBox!.width);
});

test("平板竖屏768×1024 Canvas全宽、Editor为右侧Overlay且Summary在Canvas下方", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installMultiBlockWorkspace(page);
  const canvas = page.locator('svg[aria-label*="正式钢筋Piece"]');
  const inspector = page.getByTestId("floor-workspace-inspector");
  const summary = page.getByTestId("floor-live-summary");
  await expect(canvas).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(summary).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  // Canvas全宽；Editor Overlay贴在Canvas右侧上方；Summary在Canvas下方。
  expect(canvasBox!.width).toBeGreaterThan(768 * 0.8);
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
  expect(summaryBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height - 1);
});

test("平板横屏1024×768 Canvas全宽，Editor Overlay收起/展开不改变Canvas宽度", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installMultiBlockWorkspace(page);
  const canvas = page.getByTestId("floor-canvas-card");
  const inspector = page.getByTestId("floor-workspace-inspector");
  const summary = page.getByTestId("floor-live-summary");
  await expect(inspector).toBeVisible();
  const canvasWithInspector = await canvas.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(canvasWithInspector).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(canvasWithInspector!.width).toBeGreaterThan(1024 * 0.8);
  expect(summaryBox!.y).toBeGreaterThanOrEqual(canvasWithInspector!.y + canvasWithInspector!.height - 1);
  // Overlay收起：Canvas宽度不变（PRD 77），不重新Fit。
  await page.getByRole("button", { name: "收起编辑" }).click();
  await expect(inspector).not.toBeVisible();
  const canvasWithoutInspector = await canvas.boundingBox();
  expect(canvasWithoutInspector).not.toBeNull();
  expect(Math.abs(canvasWithoutInspector!.width - canvasWithInspector!.width)).toBeLessThan(1);
  await page.getByRole("button", { name: "展开编辑" }).click();
  await expect(inspector).toBeVisible();
});

test("桌面1440×900保持Navigator|Canvas|Editor三栏", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMultiBlockWorkspace(page);
  const navigator = page.getByTestId("floor-workspace-navigator");
  const canvas = page.getByTestId("floor-canvas-card");
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(navigator).toBeVisible();
  await expect(inspector).toBeVisible();
  const navBox = await navigator.boundingBox();
  const canvasBox = await canvas.boundingBox();
  const editorBox = await inspector.boundingBox();
  expect(navBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(navBox!.x).toBeLessThan(canvasBox!.x);
  expect(canvasBox!.x).toBeLessThan(editorBox!.x);
  expect(Math.abs(navBox!.y - canvasBox!.y)).toBeLessThan(50);
  expect(Math.abs(canvasBox!.y - editorBox!.y)).toBeLessThan(50);
});

test("桌面1366×768 Navigator充分利用垂直空间且不溢出视口", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installMultiBlockWorkspace(page);
  const navigator = page.getByTestId("floor-workspace-navigator");
  await expect(navigator).toBeVisible();
  const box = await navigator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(480);
  expect(box!.y + box!.height).toBeLessThanOrEqual(768);
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("390px手机仅保留一个编辑入口且Canvas可视高度充足", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMultiBlockWorkspace(page);
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /编辑当前对象/ })).toHaveCount(0);
  const canvas = page.locator('svg[aria-label*="正式钢筋Piece"]');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.height).toBeGreaterThanOrEqual(340);
});

test("平板收起与展开编辑保持Inspector状态和选择", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await installMultiBlockWorkspace(page);
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toBeVisible();
  const toggle = page.getByRole("button", { name: "收起编辑" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toHaveClass(/bg-blue-600/);
  await toggle.click();
  await expect(inspector).not.toBeVisible();
  await expect(page.getByRole("button", { name: "展开编辑" })).toBeVisible();
  await page.getByRole("button", { name: "展开编辑" }).click();
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("button", { name: /2\. 地筋/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /当前：板区01/ })).toBeVisible();
});

test("430×932与1280×800无横向溢出且工作区可用", async ({ page }) => {
  for (const viewport of [{ width: 430, height: 932 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installMultiBlockWorkspace(page);
    await expect(page.locator('[aria-label="整层计算步骤"] button')).toHaveCount(4);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});
