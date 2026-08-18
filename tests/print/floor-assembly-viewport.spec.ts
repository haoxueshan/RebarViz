import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

type TestSlab = { id: string; name: string; type: string; x: number; y: number; width: number; height: number };

function slab(id: string, name: string, x: number, y: number, width = 4000, height = 3000): TestSlab {
  return { id, name, type: "room", x, y, width, height };
}

function fourSlabs(): TestSlab[] {
  return [
    slab("a", "板A", 0, 0),
    slab("b", "板B", 4000, 0),
    slab("c", "板C", 0, 3000),
    slab("d", "板D", 4000, 3000),
  ];
}

function twelveSlabs(): TestSlab[] {
  return Array.from({ length: 12 }, (_, index) => slab(
    `s${String(index + 1).padStart(2, "0")}`,
    `板区${String(index + 1).padStart(2, "0")}`,
    (index % 4) * 3000,
    Math.floor(index / 4) * 2400,
    3000,
    2400,
  ));
}

async function installPlan(page: import("@playwright/test").Page, slabs: TestSlab[]) {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey, state }) => {
    localStorage.setItem(draftKey, JSON.stringify({ schemaVersion: 2, savedAt: new Date().toISOString(), state }));
    localStorage.removeItem(roleKey);
  }, {
    draftKey: DRAFT_KEY,
    roleKey: ROLE_KEY,
    state: {
      coordinateModel: "net-layout-v1",
      slabs,
      openings: [],
      supportRules: [],
      innerWallThickness: 240,
      outerWallThickness: 370,
      snapDistanceMm: 150,
      overlapToleranceMm: 10,
    },
  });
  await page.reload();
}

function canvas(page: import("@playwright/test").Page) {
  return page.locator("svg[data-floor-canvas-fit]");
}

async function readViewport(page: import("@playwright/test").Page) {
  const svg = canvas(page);
  return {
    zoom: await svg.getAttribute("data-zoom-percent"),
    centerX: await svg.getAttribute("data-viewport-center-x"),
    centerY: await svg.getAttribute("data-viewport-center-y"),
  };
}

async function fitFloor(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "适合楼层" }).click();
}

test("Scenario A：点击板区只改高亮，Viewport完全不变（4板2×2）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, fourSlabs());
  await fitFloor(page);
  const before = await readViewport(page);
  await page.getByRole("button", { name: "选择板区 板A" }).click();
  await expect(page.getByRole("button", { name: "选择板区 板A" })).toHaveAttribute("stroke", "#2563eb");
  expect(await readViewport(page)).toEqual(before);
  await page.getByRole("button", { name: "选择板区 板D" }).click();
  await expect(page.getByRole("button", { name: "选择板区 板D" })).toHaveAttribute("stroke", "#2563eb");
  expect(await readViewport(page)).toEqual(before);
  // 其它板区继续显示。
  await expect(page.locator('[data-floor-layer="slabs"] rect')).toHaveCount(4);
  for (const name of ["板A", "板B", "板C"]) {
    const box = await page.getByRole("button", { name: `选择板区 ${name}` }).boundingBox();
    expect(box).not.toBeNull();
  }
});

test("Scenario B：12板整层依次点击板1/4/8/12，画面不丢", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, twelveSlabs());
  await fitFloor(page);
  const before = await readViewport(page);
  for (const label of ["板区01", "板区04", "板区08", "板区12"]) {
    await page.getByRole("button", { name: `选择板区 ${label}` }).click();
    await expect(page.getByRole("button", { name: `选择板区 ${label}` })).toHaveAttribute("stroke", "#2563eb");
    expect(await readViewport(page)).toEqual(before);
    await expect(page.locator('[data-floor-layer="slabs"] rect')).toHaveCount(12);
    const others = page.getByRole("button", { name: /选择板区 (板区02|板区05|板区09)/ });
    await expect(others.first()).toBeVisible();
  }
});

test("Scenario C：Navigator选择已可见板区，Viewport不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, twelveSlabs());
  await fitFloor(page);
  const before = await readViewport(page);
  await page.getByRole("button", { name: "导航-对象" }).click();
  await page.locator('[data-navigator-object-id="s02"]').click();
  await expect(page.locator('[data-navigator-object-id="s02"]')).toHaveAttribute("data-selected", "true");
  expect(await readViewport(page)).toEqual(before);
});

test("Scenario D：Navigator选择不可见板区只平移，Zoom保持不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, twelveSlabs());
  await fitFloor(page);
  // 放大到约244%，把角落的板区12推出视口。
  for (let index = 0; index < 4; index += 1) await page.getByRole("button", { name: "放大" }).click();
  const before = await readViewport(page);
  expect(before.zoom).toBe("244");
  await page.getByRole("button", { name: "导航-对象" }).click();
  await page.locator('[data-navigator-object-id="s12"]').click();
  const after = await readViewport(page);
  expect(after.zoom).toBe(before.zoom);
  expect(after.centerX).not.toBe(before.centerX);
  // 板区12进入可视区域（其矩形与画布有交叠）。
  const svgBox = await canvas(page).boundingBox();
  const slabBox = await page.getByRole("button", { name: "选择板区 板区12" }).boundingBox();
  expect(svgBox).not.toBeNull();
  expect(slabBox).not.toBeNull();
  expect(slabBox!.x + slabBox!.width).toBeGreaterThan(svgBox!.x);
  expect(slabBox!.x).toBeLessThan(svgBox!.x + svgBox!.width);
  expect(slabBox!.y + slabBox!.height).toBeGreaterThan(svgBox!.y);
  expect(slabBox!.y).toBeLessThan(svgBox!.y + svgBox!.height);
});

test("Scenario E：超大对象只允许Zoom Out，不允许Zoom In", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, [slab("big", "板区大", 0, 0, 16000, 12000)]);
  await fitFloor(page);
  await page.getByRole("button", { name: "放大" }).click();
  await page.getByRole("button", { name: "放大" }).click();
  const before = await readViewport(page);
  await page.getByRole("button", { name: "导航-对象" }).click();
  await page.locator('[data-navigator-object-id="big"]').click();
  const after = await readViewport(page);
  expect(Number(after.zoom)).toBeLessThanOrEqual(Number(before.zoom));
});

test("Toolbar适合选中是一次性命令：之后点其它板Viewport不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, fourSlabs());
  await fitFloor(page);
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "选中" }).click();
  // 适合选中：一次性把当前选中板区A放到取景中心。
  const afterFitSelection = await readViewport(page);
  expect(afterFitSelection.zoom).toBe("100");
  expect(afterFitSelection.centerX).toBe("2000");
  expect(afterFitSelection.centerY).toBe("1500");
  // 之后点击其它板区（板B左缘仍在可见裁切区内），Viewport 不再自动变化。
  const slabB = page.getByRole("button", { name: "选择板区 板B" });
  const slabBBox = await slabB.boundingBox();
  expect(slabBBox).not.toBeNull();
  await page.mouse.click(slabBBox!.x + 18, slabBBox!.y + slabBBox!.height / 2);
  await expect(slabB).toHaveAttribute("stroke", "#2563eb");
  expect(await readViewport(page)).toEqual(afterFitSelection);
});

test("remount不污染：Navigator聚焦后切换阶段再回楼层，Canvas不以Selection Fit启动", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, twelveSlabs());
  await fitFloor(page);
  await page.getByRole("button", { name: "导航-对象" }).click();
  await page.locator('[data-navigator-object-id="s02"]').click();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await page.getByRole("button", { name: /1\. 楼层/ }).click();
  const svg = canvas(page);
  await expect(svg).toHaveAttribute("data-floor-canvas-fit", "floor");
  await expect(svg).toHaveAttribute("data-viewport-center-x", "6360");
  await expect(svg).toHaveAttribute("data-viewport-center-y", "3840");
  // 再点板区08：Viewport 仍保持整层Fit。
  await page.getByRole("button", { name: "选择板区 板区08" }).click();
  await expect(svg).toHaveAttribute("data-viewport-center-x", "6360");
  await expect(svg).toHaveAttribute("data-viewport-center-y", "3840");
});

test("Assembly状态：12板已连接与10+2未连接的状态栏、Navigator Badge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlan(page, twelveSlabs());
  await expect(page.getByTestId("floor-workspace-status-bar")).toContainText("整层已连接");
  await page.getByRole("button", { name: "导航-对象" }).click();
  await expect(page.locator('[data-navigator-object-id="s05"][data-assembly-status="connected"]')).toHaveCount(1);

  const connected = Array.from({ length: 10 }, (_, index) => slab(
    `s${String(index + 1).padStart(2, "0")}`,
    `板区${String(index + 1).padStart(2, "0")}`,
    (index % 4) * 3000,
    Math.floor(index / 4) * 2400,
    3000,
    2400,
  ));
  const detached = [
    slab("s11", "板区11", 20000, 0, 3000, 2400),
    slab("s12", "板区12", 23000, 0, 3000, 2400),
  ];
  await installPlan(page, [...connected, ...detached]);
  // 未连接时状态栏被问题摘要覆盖；通过 Issue Center 与 Navigator Badge 验证。
  await page.getByTestId("status-issues-button").click();
  await expect(page.getByTestId("floor-issue-center")).toContainText("尚未连接到整层主体");
  await page.getByRole("button", { name: "关闭问题中心", exact: true }).click();
  await expect(page.getByTestId("floor-issue-center")).toHaveCount(0);
  await page.getByRole("button", { name: "导航-对象" }).click();
  await expect(page.locator('[data-navigator-object-id="s11"]')).toHaveAttribute("data-assembly-status", "disconnected");
  await expect(page.locator('[data-assembly-status="disconnected"]').first()).toContainText("未连接");
});

test.describe("Touch平板", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("Touch Tap板区：Geometry与Viewport都不变", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installPlan(page, fourSlabs());
    const svg = canvas(page);
    const before = await readViewport(page);
    const slabA = page.getByRole("button", { name: "选择板区 板A" });
    const box = await slabA.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(slabA).toHaveAttribute("stroke", "#2563eb");
    expect(await readViewport(page)).toEqual(before);
    await expect(svg).toHaveAttribute("data-zoom-percent", before.zoom ?? "100");
  });
});
