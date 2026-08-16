import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";
const META_KEY = "rebarviz:floor-rebar:project-meta:v1";

function buildValidProjectFile(): string {
  return JSON.stringify({
    format: "rebarviz-floor-layout",
    schemaVersion: 1,
    meta: { projectName: "导入测试工程", exportedAt: "2026-08-16T10:00:00.000Z", app: "RebarViz" },
    data: {
      plan: {
        schemaVersion: 2,
        savedAt: "2026-08-16T10:00:00.000Z",
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [
            { id: "imp-s1", name: "客厅", type: "hall", x: 0, y: 0, width: 4200, height: 3600 },
            { id: "imp-s2", name: "卧室", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
          ],
          openings: [{ id: "imp-o1", name: "楼梯间", type: "stair", x: 1200, y: 900, width: 900, height: 900 }],
          supportRules: [{ id: "imp-r1", target: { kind: "slab-edge", slabId: "imp-s1", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } }, support: "continuous" }],
          innerWallThickness: 200,
          outerWallThickness: 300,
          snapDistanceMm: 100,
          overlapToleranceMm: 5,
        },
      },
      bottom: {
        schemaVersion: 3,
        savedAt: "2026-08-16T10:00:00.000Z",
        roleReviewRequired: false,
        state: {
          countMode: "floor",
          defaults: { mainDiameter: 14, secondaryDiameter: 12, xSpacing: 180, ySpacing: 160 },
          slabOverrides: { "imp-s1": { mainDiameter: 16, xSpacing: 150 } },
        },
      },
      top: {
        schemaVersion: 4,
        savedAt: "2026-08-16T10:00:00.000Z",
        roleReviewRequired: false,
        state: {
          countMode: "project",
          topAnchorExtra: 250,
          defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" },
          slabOverrides: { "imp-s2": { mainDiameter: 12, xSpacing: 260, xExtraMode: "end", yExtraMode: "start" } },
          throughPaths: [{ id: "imp-tp1", name: "通墙01", direction: "x", slabIds: ["imp-s1", "imp-s2"], bandStartMm: 0, bandEndMm: 3600, enabled: true }],
        },
      },
      role: {
        schemaVersion: 1,
        savedAt: "2026-08-16T10:00:00.000Z",
        state: { mainDirectionOverrides: {} },
      },
    },
  }, null, 2);
}

async function installRichWorkspace(page: Page) {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey, metaKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
        ],
        openings: [{ id: "o1", name: "楼梯间", type: "stair", x: 1200, y: 900, width: 900, height: 900 }],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: 10,
      },
    }));
    localStorage.setItem(bottomKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: { countMode: "project", defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300 }, slabOverrides: {} },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: { countMode: "project", topAnchorExtra: 250, defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 300, ySpacing: 300, xExtraMode: "both", yExtraMode: "both" }, slabOverrides: {}, throughPaths: [] },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem(metaKey, JSON.stringify({ schemaVersion: 1, projectName: "当前工程" }));
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, metaKey: META_KEY });
  await page.reload();
}

test.describe("Floor Project IO 工程文件", () => {
  test("导出：下载完整 .json 且包含布局/地筋/面筋/通墙", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出数据" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^RebarViz_当前工程_\d{4}-\d{2}-\d{2}\.json$/);

    const path = await download.path();
    const text = path ? require("fs").readFileSync(path, "utf-8") : "";
    expect(text).toContain('"format": "rebarviz-floor-layout"');
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.plan.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["a", "b"]);
    expect(parsed.data.plan.state.openings.map((opening: { id: string }) => opening.id)).toEqual(["o1"]);
    expect(parsed.meta.projectName).toBe("当前工程");
    // 状态栏闪示导出成功。
    await expect(page.getByTestId("status-flash")).toContainText("已导出");
  });

  test("导入：预览后确认，完整恢复布局/设置/ID", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "RebarViz_导入测试工程_2026-08-16.json",
      mimeType: "application/json",
      buffer: Buffer.from(buildValidProjectFile(), "utf-8"),
    });

    const dialog = page.getByTestId("floor-import-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("floor-import-project-name")).toContainText("导入测试工程");
    await expect(dialog).toContainText("板区");
    await page.getByTestId("floor-import-confirm").click();
    await expect(dialog).toHaveCount(0);

    // Canvas 恢复导入布局：客厅/卧室/楼梯间。
    await expect(page.getByRole("button", { name: "选择板区 客厅" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 卧室" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择洞口 楼梯间" })).toBeVisible();
    // ID 原样保留。
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(saved.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["imp-s1", "imp-s2"]);
    // 地筋/面筋/通墙恢复。
    const bottom = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), BOTTOM_KEY);
    expect(bottom.state.slabOverrides["imp-s1"]).toMatchObject({ mainDiameter: 16, xSpacing: 150 });
    const top = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), TOP_KEY);
    expect(top.state.throughPaths.map((path: { id: string }) => path.id)).toEqual(["imp-tp1"]);
    // 工程名称更新。
    const meta = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), META_KEY);
    expect(meta.projectName).toBe("导入测试工程");
    // 刷新后仍保持导入工程（Autosave Race 验收）。
    await page.reload();
    await expect(page.getByRole("button", { name: "选择板区 客厅" })).toBeVisible();
  });

  test("导入错误文件：当前工程保持不变", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{ not valid json !!!", "utf-8"),
    });
    await expect(page.getByTestId("floor-import-error")).toContainText("不是有效的 JSON");
    await page.getByRole("button", { name: "取消" }).click();

    // 原板区仍然存在。
    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区B" })).toBeVisible();
  });

  test("导入未知 schemaVersion 报版本不支持", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);
    const future = JSON.parse(buildValidProjectFile());
    future.schemaVersion = 99;
    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(future), "utf-8"),
    });
    await expect(page.getByTestId("floor-import-error")).toContainText("版本暂不支持");
  });

  test("新建空白楼板：0板区空状态且无Error，刷新后保持", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "新建楼板布局" }).click();
    const dialog = page.getByTestId("floor-new-project-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("new-project-name-input").fill("屋顶板");
    await page.getByTestId("new-project-confirm").click();
    await expect(dialog).toHaveCount(0);

    // 空白楼板：空状态 + 无板区。
    await expect(page.getByTestId("floor-canvas-empty")).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toHaveCount(0);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(saved.state.slabs).toEqual([]);
    expect(saved.state.openings).toEqual([]);
    // Bottom/Top/Role 已重置。
    const bottom = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), BOTTOM_KEY);
    expect(bottom.state.slabOverrides).toEqual({});
    // 工程名称已更新。
    const meta = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), META_KEY);
    expect(meta.projectName).toBe("屋顶板");
    // 地筋阶段显示“请先创建板区”。
    await page.getByRole("button", { name: /2\. 地筋/ }).click();
    await expect(page.getByTestId("floor-empty-stage-hint")).toBeVisible();
    // 刷新后保持空白工程。
    await page.reload();
    await expect(page.getByTestId("floor-canvas-empty")).toBeVisible();
  });

  test("新建默认示例布局：恢复 DEFAULT 两板区", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "新建楼板布局" }).click();
    await page.getByTestId("floor-new-project-dialog").getByText("使用默认示例布局").click();
    await page.getByTestId("new-project-confirm").click();

    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区B" })).toBeVisible();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(saved.state.slabs.length).toBe(2);
  });

  test("390×844 Phone：工程Sheet+新建Dialog可完整操作且无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      localStorage.removeItem("rebarviz:floor-rebar:draft:v1");
      localStorage.removeItem("rebarviz:floor-rebar:role:v1");
    });
    await page.reload();

    await page.getByTestId("floor-project-menu-button").click();
    const sheet = page.getByTestId("floor-project-mobile-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("当前：未命名楼板");
    await sheet.getByRole("button", { name: "新建楼板布局" }).click();
    const dialog = page.getByTestId("floor-new-project-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("new-project-name-input").fill("一层楼板");
    await page.getByTestId("new-project-confirm").click();
    await expect(page.getByTestId("floor-canvas-empty")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("Wide 1920×1080：工程入口不破坏 Dock 布局", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await installRichWorkspace(page);
    await expect(page.getByTestId("floor-wide-navigator")).toBeVisible();
    await expect(page.getByTestId("floor-wide-inspector")).toBeVisible();
    await expect(page.getByTestId("floor-project-menu-button")).toBeVisible();
    // 打开工程菜单不改变 Dock 结构。
    await page.getByTestId("floor-project-menu-button").click();
    await expect(page.getByTestId("floor-project-menu")).toBeVisible();
    await expect(page.getByTestId("floor-wide-navigator")).toBeVisible();
  });
});
