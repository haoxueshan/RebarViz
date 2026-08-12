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
  await page.getByLabel("东西向间距").fill("180");
  await expect.poll(async () => page.getByTestId("floor-live-summary").innerText()).not.toBe(summaryBefore);
  await page.getByLabel("主筋直径").fill("");
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
  await page.getByRole("button", { name: /编辑当前对象/ }).click();
  const inspector = page.getByTestId("floor-workspace-inspector");
  await inspector.getByRole("tab", { name: "当前板区" }).click();
  await expect(inspector).toContainText("当前板区：板区10");
  await inspector.getByRole("button", { name: "局部规格" }).click();
  await expect(inspector.getByLabel("主筋直径")).toBeVisible();
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
  await page.getByTestId("floor-workspace-inspector").getByLabel("东西向主筋").check();
  await expect(squareRow).toContainText("正常");
});

test("Tablet四档断点保持Workflow可用、无横向溢出并按设备切换工作区", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installMultiBlockWorkspace(page);
  const viewports = [
    { width: 768, height: 1024, inspector: false, navigator: false },
    { width: 820, height: 1180, inspector: false, navigator: false },
    { width: 1024, height: 768, inspector: true, navigator: false },
    { width: 1180, height: 820, inspector: true, navigator: false },
    { width: 1366, height: 1024, inspector: true, navigator: true },
    { width: 1440, height: 900, inspector: true, navigator: true },
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
        summaryVisible: Boolean(summary && summary.getBoundingClientRect().top < window.innerHeight),
        summaryVisibleHeight: summary
          ? Math.max(0, Math.min(summary.getBoundingClientRect().bottom, window.innerHeight) - Math.max(summary.getBoundingClientRect().top, 0))
          : 0,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.inspector).toBe(viewport.inspector);
    expect(metrics.navigator).toBe(viewport.navigator);
    if (viewport.width >= 1024) {
      expect(metrics.summaryVisible).toBe(true);
      expect(metrics.summaryVisibleHeight).toBeGreaterThanOrEqual(50);
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
  await page.getByRole("button", { name: "展开编辑" }).click();
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByRole("tab", { name: "整层默认" }).click();
  await inspector.getByLabel("东西向间距").fill("275");

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(page.getByRole("button", { name: /2\. 地筋/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /当前：板区08/ })).toBeVisible();
  await expect(inspector.getByLabel("东西向间距")).toHaveValue("275");
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel("东西向间距")).toHaveValue("275");
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
