import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";
const META_KEY = "rebarviz:floor-rebar:project-meta:v1";
const REAL_PROJECT_FIXTURE = "tests/fixtures/floor-project-real-export.json";

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
    const text = path ? readFileSync(path, "utf-8") : "";
    expect(text).toContain('"format": "rebarviz-floor-layout"');
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.plan.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["a", "b"]);
    expect(parsed.data.plan.state.openings.map((opening: { id: string }) => opening.id)).toEqual(["o1"]);
    expect(parsed.meta.projectName).toBe("当前工程");
    // 状态栏闪示导出成功。
    await expect(page.getByTestId("status-flash")).toContainText("已导出");
  });

  test("工程菜单关闭后 file input 仍然永久挂载", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/calculator/floor");

    await expect(page.getByTestId("floor-project-file-input")).toHaveCount(1);
    await page.getByTestId("floor-project-menu-button").click();
    await expect(page.getByTestId("floor-project-file-input")).toHaveCount(1);
    await page.getByLabel("关闭工程菜单").click();
    await expect(page.getByTestId("floor-project-file-input")).toHaveCount(1);
  });

  test("真实点击导入数据后 filechooser 选择合法工程并出现 Preview", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/calculator/floor");

    await page.getByTestId("floor-project-menu-button").click();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入数据" }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles(REAL_PROJECT_FIXTURE);

    const dialog = page.getByTestId("floor-import-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("floor-import-project-name")).toContainText("未命名楼板");
    await expect(dialog).toContainText("12");
    await expect(dialog).toContainText("2");
    await expect(dialog).toContainText("通墙路径");

    await page.getByTestId("floor-import-confirm").click();
    await expect(page.getByRole("button", { name: "选择板区 板区01" })).toBeVisible();

    const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(draft.state.slabs.length).toBe(12);
    const top = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), TOP_KEY);
    expect(top.state.countMode).toBe("round");
    expect(top.state.throughPaths.length).toBe(2);
    const bottom = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), BOTTOM_KEY);
    expect(bottom.state.countMode).toBe("round");
    const role = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), ROLE_KEY);
    expect(role.state.mainDirectionOverrides).toEqual(expect.objectContaining({ "role:slab-01|slab-02|slab-03": "x" }));

    await page.reload();
    await expect(page.getByRole("button", { name: "选择板区 板区01" })).toBeVisible();
  });

  test("Phone 390×844：真实 filechooser 导入合法工程并显示 Preview", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/calculator/floor");

    await page.getByTestId("floor-project-menu-button").click();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入数据" }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles(REAL_PROJECT_FIXTURE);

    const dialog = page.getByTestId("floor-import-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("floor-import-project-name")).toContainText("未命名楼板");
    await expect(dialog).toContainText("12");
    await expect(dialog).toContainText("2");
  });

  test("真实工程导出后再导入 round trip：保留核心结构与 ID", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
        schemaVersion: 2,
        savedAt: new Date().toISOString(),
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [{ id: "r1", name: "板区R1", type: "room", x: 0, y: 0, width: 3000, height: 3000 }],
          openings: [],
          supportRules: [],
          innerWallThickness: 200,
          outerWallThickness: 300,
          snapDistanceMm: 100,
          overlapToleranceMm: 5,
        },
      }));
      localStorage.setItem("rebarviz:floor-rebar:bottom:v1", JSON.stringify({
        schemaVersion: 3,
        savedAt: new Date().toISOString(),
        roleReviewRequired: false,
        state: { countMode: "round", defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200 }, slabOverrides: {} },
      }));
      localStorage.setItem("rebarviz:floor-rebar:top:v1", JSON.stringify({
        schemaVersion: 4,
        savedAt: new Date().toISOString(),
        roleReviewRequired: false,
        state: { countMode: "round", topAnchorExtra: 250, defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200, xExtraMode: "both", yExtraMode: "both" }, slabOverrides: {}, throughPaths: [] },
      }));
      localStorage.setItem("rebarviz:floor-rebar:role:v1", JSON.stringify({
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        state: { mainDirectionOverrides: { r1: "x" } },
      }));
      localStorage.setItem("rebarviz:floor-rebar:project-meta:v1", JSON.stringify({ schemaVersion: 1, projectName: "RoundTrip" }));
    });
    await page.reload();

    await page.getByTestId("floor-project-menu-button").click();
    const exportDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出数据" }).click();
    const exportDownload = await exportDownloadPromise;
    const exportPath = await exportDownload.path();
    expect(exportPath).toBeTruthy();

    const exportText = exportPath ? readFileSync(exportPath, "utf-8") : "";
    const exported = JSON.parse(exportText);
    expect(exported.data.plan.state.slabs).toHaveLength(1);
    expect(exported.data.top.state.throughPaths).toEqual([]);

    const fileChooserPromise = page.waitForEvent("filechooser");
    // 导出动作会关闭工程菜单，导入前需要重新打开入口。
    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "导入数据" }).click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles(exportPath ?? REAL_PROJECT_FIXTURE);

    await expect(page.getByTestId("floor-import-project-dialog")).toBeVisible();
    await page.getByTestId("floor-import-confirm").click();
    await expect(page.getByRole("button", { name: "选择板区 板区R1" })).toBeVisible();

    const draftAfter = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(draftAfter.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["r1"]);
    await page.reload();
    await expect(page.getByRole("button", { name: "选择板区 板区R1" })).toBeVisible();
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

  // —— Floor Project File V1.1 稳定性修复 ——

  test("Case A：损坏的 Project Meta 不影响页面，工程名 fallback 为未命名楼板", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);
    // 保留正常 Plan/Bottom/Top/Role，仅破坏 meta JSON。
    await page.evaluate((metaKey) => localStorage.setItem(metaKey, "{broken"), META_KEY);
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.reload();

    // 页面正常：原板区仍存在，工程名 fallback。
    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区B" })).toBeVisible();
    await expect(page.getByTestId("floor-project-menu-button")).toContainText("未命名楼板");
    // 无白屏：Canvas 工作区存在，且无未捕获异常。
    await expect(page.getByTestId("floor-canvas-column")).toBeVisible();
    expect(consoleErrors).toEqual([]);
    // 四个核心数据未被破坏。
    const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(draft.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["a", "b"]);
  });

  test("Case B：新建 Dialog 取消后再次打开恢复默认名称与空白模式", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "新建楼板布局" }).click();
    const dialog = page.getByTestId("floor-new-project-dialog");
    await expect(dialog).toBeVisible();
    // 第一次：输入并选择示例，然后取消。
    await page.getByTestId("new-project-name-input").fill("A栋一层");
    await dialog.getByText("使用默认示例布局").click();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toHaveCount(0);

    // 第二次打开：必须恢复默认状态。
    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "新建楼板布局" }).click();
    await expect(page.getByTestId("new-project-name-input")).toHaveValue("未命名楼板");
    const radios = page.getByTestId("floor-new-project-dialog").getByRole("radio");
    await expect(radios).toHaveCount(2);
    await expect(radios.first()).toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();
  });

  test("Case C：空白工程第一个板区从原点 (0,0) 创建", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByRole("button", { name: "新建楼板布局" }).click();
    await page.getByTestId("new-project-confirm").click();
    await expect(page.getByTestId("floor-canvas-empty")).toBeVisible();
    await page.getByTestId("floor-canvas-empty").getByRole("button", { name: "新增板区" }).click();

    // autosave 为 300ms debounce，轮询读取 Floor Draft。
    await expect.poll(async () =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        return saved.state?.slabs?.[0] ?? null;
      }, DRAFT_KEY),
    ).toMatchObject({ x: 0, y: 0, width: 3600, height: 3600 });
  });

  test("Case D：损坏标准 Project 不覆盖当前工程", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "broken-project.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        format: "rebarviz-floor-layout",
        schemaVersion: 1,
        data: { plan: { schemaVersion: 2, state: {} } },
      }), "utf-8"),
    });
    await expect(page.getByTestId("floor-import-error")).toContainText("不完整或已损坏");
    await page.getByRole("button", { name: "取消" }).click();

    // 原板区仍存在，localStorage 未被替换。
    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区B" })).toBeVisible();
    const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(draft.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["a", "b"]);
    const meta = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), META_KEY);
    expect(meta.projectName).toBe("当前工程");
  });

  test("Case E：普通 JSON 不误判 Legacy，当前工程保持不变", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "plain.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ slabs: [] }), "utf-8"),
    });
    await expect(page.getByTestId("floor-import-error")).toContainText("不是有效的 RebarViz 楼板布局文件");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("button", { name: "选择板区 板区A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 板区B" })).toBeVisible();
  });

  test("Case F：导入确认后立即刷新，Plan/Bottom/Top/Through/工程名全部保持", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installRichWorkspace(page);

    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "RebarViz_导入测试工程_2026-08-16.json",
      mimeType: "application/json",
      buffer: Buffer.from(buildValidProjectFile(), "utf-8"),
    });
    await expect(page.getByTestId("floor-import-project-dialog")).toBeVisible();
    await page.getByTestId("floor-import-confirm").click();
    // Autosave Race 核心验收：确认后立即刷新。
    await page.reload();

    await expect(page.getByRole("button", { name: "选择板区 客厅" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 卧室" })).toBeVisible();
    const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(draft.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["imp-s1", "imp-s2"]);
    expect(draft.state.openings.map((opening: { id: string }) => opening.id)).toEqual(["imp-o1"]);
    const bottom = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), BOTTOM_KEY);
    expect(bottom.state.slabOverrides["imp-s1"]).toMatchObject({ mainDiameter: 16, xSpacing: 150 });
    const top = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), TOP_KEY);
    expect(top.state.slabOverrides["imp-s2"]).toMatchObject({ mainDiameter: 12, xSpacing: 260 });
    expect(top.state.throughPaths.map((path: { id: string }) => path.id)).toEqual(["imp-tp1"]);
    const meta = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), META_KEY);
    expect(meta.projectName).toBe("导入测试工程");
  });
});
