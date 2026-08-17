import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";
const META_KEY = "rebarviz:floor-rebar:project-meta:v1";

const SNAPSHOT_PREFIX = "rebarviz:floor-print:snapshot:";

function buildValidProjectFile(): string {
  return JSON.stringify({
    format: "rebarviz-floor-layout",
    schemaVersion: 1,
    meta: { projectName: "平板导入工程", exportedAt: "2026-08-17T10:00:00.000Z", app: "RebarViz" },
    data: {
      plan: {
        schemaVersion: 2,
        savedAt: "2026-08-17T10:00:00.000Z",
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [
            { id: "tab-s1", name: "客厅", type: "hall", x: 0, y: 0, width: 4200, height: 3600 },
            { id: "tab-s2", name: "卧室", type: "room", x: 4200, y: 0, width: 3600, height: 3600 },
          ],
          openings: [],
          supportRules: [],
          innerWallThickness: 240,
          outerWallThickness: 370,
          snapDistanceMm: 150,
          overlapToleranceMm: 10,
        },
      },
      bottom: {
        schemaVersion: 3,
        savedAt: "2026-08-17T10:00:00.000Z",
        roleReviewRequired: false,
        state: {
          countMode: "floor",
          defaults: { mainDiameter: 14, secondaryDiameter: 12, xSpacing: 150, ySpacing: 150 },
          slabOverrides: {},
        },
      },
      top: {
        schemaVersion: 4,
        savedAt: "2026-08-17T10:00:00.000Z",
        roleReviewRequired: false,
        state: {
          countMode: "project",
          topAnchorExtra: 250,
          defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 150, ySpacing: 150, xExtraMode: "both", yExtraMode: "both" },
          slabOverrides: {},
          throughPaths: [],
        },
      },
      role: {
        schemaVersion: 1,
        savedAt: "2026-08-17T10:00:00.000Z",
        state: { mainDirectionOverrides: {} },
      },
    },
  }, null, 2);
}

async function installLargeFloorDraft(page: Page): Promise<void> {
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, bottomKey, topKey, roleKey, metaKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "ls-1", name: "板区一", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "ls-2", name: "板区二", type: "room", x: 4200, y: 0, width: 4200, height: 3600 },
          { id: "ls-3", name: "板区三", type: "room", x: 8400, y: 0, width: 4200, height: 3600 },
          { id: "ls-4", name: "板区四", type: "room", x: 12600, y: 0, width: 4200, height: 3600 },
        ],
        openings: [],
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
      state: { countMode: "floor", defaults: { mainDiameter: 12, secondaryDiameter: 10, xSpacing: 150, ySpacing: 150 }, slabOverrides: {} },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: { countMode: "project", topAnchorExtra: 250, defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 150, ySpacing: 150, xExtraMode: "both", yExtraMode: "both" }, slabOverrides: {}, throughPaths: [] },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem(metaKey, JSON.stringify({ schemaVersion: 1, projectName: "平板打印工程" }));
    sessionStorage.clear();
  }, { draftKey: DRAFT_KEY, bottomKey: BOTTOM_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, metaKey: META_KEY });
  await page.reload();
}

async function expectTouchProfile(page: Page): Promise<void> {
  const touchDetected = await page.evaluate(() =>
    window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches);
  expect(touchDetected).toBe(true);
}

async function expectProjectMenuWorks(page: Page): Promise<void> {
  await page.getByTestId("floor-project-menu-button").click();
  const sheet = page.getByTestId("floor-project-mobile-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "新建楼板布局" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "导入数据" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "导出数据" })).toBeVisible();
  await page.getByLabel("关闭工程菜单").click();
  await expect(sheet).toHaveCount(0);
}

async function listIndexedDbSnapshotIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rebarviz-floor-print", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    try {
      const records = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll();
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
        request.onerror = () => reject(request.error ?? new Error("getAll failed"));
      });
      return records.map((record) => String(record.id));
    } finally {
      db.close();
    }
  });
}

async function openBomStage(page: Page): Promise<void> {
  // Phone 下序号前缀（“4. ”）被隐藏，按钮文本仅“料单”。
  await page.getByRole("button", { name: /料单$/ }).click();
  await expect(page.getByTestId("floor-bom-panel")).toBeVisible();
}

async function generatePrintPreview(page: Page): Promise<string> {
  await page.getByTestId("open-floor-print-dialog").click();
  await expect(page.getByTestId("floor-print-dialog")).toBeVisible();
  await page.getByTestId("generate-floor-print-preview").click();
  await page.waitForURL(/\/calculator\/floor\/print\?id=/);
  await expect(page.getByTestId("floor-print-preview")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id") ?? "";
  expect(id).toBeTruthy();
  return id;
}

test.describe("Floor Tablet V1.2 平板工程入口与打印链路", () => {
  test.use({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: true,
  });

  test("Tablet Portrait 768×1024：四阶段工程入口均可用且无横向溢出", async ({ page }) => {
    await page.goto("/calculator/floor");
    await expectTouchProfile(page);
    await expect(page.getByTestId("floor-touch-action-bar")).toBeVisible();
    await expectProjectMenuWorks(page);

    // 2. 地筋
    await page.getByRole("button", { name: /2\. 地筋/ }).click();
    await expect(page.getByTestId("floor-touch-action-bar")).toBeVisible();
    await expectProjectMenuWorks(page);
    // 3. 面筋
    await page.getByRole("button", { name: /3\. 面筋/ }).click();
    await expectProjectMenuWorks(page);
    // 4. 料单：工程入口仍然存在，且不再显示无意义的当前对象/编辑按钮。
    await page.getByRole("button", { name: /4\. 料单/ }).click();
    await expect(page.getByTestId("floor-bom-workspace")).toBeVisible();
    await expect(page.getByTestId("floor-touch-action-bar")).toBeVisible();
    await expect(page.getByTestId("floor-touch-action-bar")).toContainText("料单");
    await expectProjectMenuWorks(page);

    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("Tablet 820×1180 与 1024×768 Touch：工程入口存在", async ({ page }) => {
    for (const viewport of [{ width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/calculator/floor");
      await expectTouchProfile(page);
      await expect(page.getByTestId("floor-touch-action-bar")).toBeVisible();
      await expectProjectMenuWorks(page);
    }
  });

  test("Tablet Touch 导入合法工程：预览、确认、完整恢复", async ({ page }) => {
    await page.goto("/calculator/floor");
    await expectTouchProfile(page);
    await page.getByTestId("floor-project-menu-button").click();
    await page.getByTestId("floor-project-file-input").setInputFiles({
      name: "RebarViz_平板导入工程_2026-08-17.json",
      mimeType: "application/json",
      buffer: Buffer.from(buildValidProjectFile(), "utf-8"),
    });
    const dialog = page.getByTestId("floor-import-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("floor-import-project-name")).toContainText("平板导入工程");
    await expect(dialog).toContainText("板区");
    await page.getByTestId("floor-import-confirm").click();
    await expect(page.getByRole("button", { name: "选择板区 客厅" })).toBeVisible();
    await expect(page.getByRole("button", { name: "选择板区 卧室" })).toBeVisible();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), DRAFT_KEY);
    expect(saved.state.slabs.map((slab: { id: string }) => slab.id)).toEqual(["tab-s1", "tab-s2"]);
  });

  test("Tablet Touch 导出工程文件：下载合法 JSON", async ({ page }) => {
    await installLargeFloorDraft(page);
    await expectTouchProfile(page);
    await page.getByTestId("floor-project-menu-button").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出数据" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^RebarViz_平板打印工程_\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const text = path ? readFileSync(path, "utf-8") : "";
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe("rebarviz-floor-layout");
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.plan.state.slabs.length).toBe(4);
  });

  test("Phone 390×844 Touch：料单阶段工程入口仍然存在", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installLargeFloorDraft(page);
    await expectTouchProfile(page);
    await openBomStage(page);
    await expect(page.getByTestId("floor-touch-action-bar")).toBeVisible();
    await expect(page.getByTestId("floor-touch-action-bar")).toContainText("料单");
    await expectProjectMenuWorks(page);
  });

  test("Tablet 打印设置 Dialog 完整显示且无横向溢出", async ({ page }) => {
    await installLargeFloorDraft(page);
    await openBomStage(page);
    await page.getByTestId("open-floor-print-dialog").click();
    const dialog = page.getByTestId("floor-print-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("generate-floor-print-preview")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("Tablet 生成打印预览：IndexedDB 主存储、刷新可用、sessionStorage 无大对象", async ({ page }) => {
    await installLargeFloorDraft(page);
    await openBomStage(page);
    const snapshotId = await generatePrintPreview(page);

    // 新 Snapshot 不再写入 sessionStorage。
    const sessionKeys = await page.evaluate(() => Object.keys(sessionStorage));
    expect(sessionKeys.some((key) => key.startsWith(SNAPSHOT_PREFIX))).toBe(false);
    // Snapshot 存在于 IndexedDB。
    const ids = await listIndexedDbSnapshotIds(page);
    expect(ids).toContain(snapshotId);
    // 刷新打印页后仍能读取（Frozen Snapshot 不重算）。
    await page.reload();
    await expect(page.getByTestId("floor-print-preview")).toBeVisible();
    await expect(page.getByTestId("floor-print-report")).toBeVisible();
  });

  test("打印按钮直接调用 window.print 恰好一次", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printCalls: number }).__printCalls = 0;
      window.print = () => { (window as unknown as { __printCalls: number }).__printCalls += 1; };
    });
    await installLargeFloorDraft(page);
    await openBomStage(page);
    await generatePrintPreview(page);
    await page.getByTestId("floor-print-button").click();
    const printCalls = await page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls);
    expect(printCalls).toBe(1);
  });

  test("IndexedDB 与 sessionStorage 双重失败时显示中文业务错误且不跳转", async ({ page }) => {
    await page.addInitScript(() => {
      // 模拟 IndexedDB 不可用。
      try {
        Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
      } catch {
        // 部分环境不可覆盖时忽略。
      }
      // 模拟 sessionStorage 对打印快照写入 QuotaExceededError。
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (String(key).startsWith("rebarviz:floor-print:snapshot:")) {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await installLargeFloorDraft(page);
    await openBomStage(page);
    await page.getByTestId("open-floor-print-dialog").click();
    await page.getByTestId("generate-floor-print-preview").click();
    // 显示中文业务错误，不显示原始英文 quota，不跳转打印页。
    await expect(page.getByTestId("floor-bom-panel")).toContainText("打印数据较大，浏览器临时存储空间不足");
    await expect(page.getByTestId("floor-bom-panel")).not.toContainText("The quota has been exceeded");
    expect(page.url()).not.toContain("/calculator/floor/print");
  });

  test("大工程连续生成 5 次打印预览：不出现 quota 且 IndexedDB 保留最近 3 个", async ({ page }) => {
    await installLargeFloorDraft(page);
    const generatedIds: string[] = [];
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) await page.goto("/calculator/floor");
      await openBomStage(page);
      const snapshotId = await generatePrintPreview(page);
      generatedIds.push(snapshotId);
      await expect(page.getByTestId("floor-print-preview")).toBeVisible();
    }
    // Retention：最多保留最近 3 个，最新一个必须存在。
    const ids = await listIndexedDbSnapshotIds(page);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids).toContain(generatedIds[generatedIds.length - 1]);
    expect(ids).not.toContain(generatedIds[0]);
    expect(ids).not.toContain(generatedIds[1]);
    // 打印清理不影响工程数据。
    const draft = await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
    expect(draft).toBeTruthy();
    const meta = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), META_KEY);
    expect(meta.projectName).toBe("平板打印工程");
  });
});
