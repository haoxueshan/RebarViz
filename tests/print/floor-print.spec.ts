import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

type FloorDraftInput = {
  width: number;
  height: number;
  opening?: { x: number; y: number; width: number; height: number };
};

async function openFloorBom(page: Page, input: FloorDraftInput): Promise<void> {
  await page.goto("/calculator/floor");
  await page.evaluate(({ width, height, opening }) => {
    localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
      schemaVersion: 2,
      savedAt: "2026-08-10T12:00:00.000Z",
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [{ id: "print-slab-a", name: "客厅", type: "hall", x: 0, y: 0, width, height }],
        openings: opening ? [{ id: "print-opening-a", name: "楼梯间", type: "stair", ...opening }] : [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
    localStorage.removeItem("rebarviz:floor-print:settings:v1");
    sessionStorage.clear();
  }, input);
  await page.reload();
  await page.getByRole("button", { name: /料单$/ }).click();
  await expect(page.getByTestId("floor-bom-panel")).toBeVisible();
}

async function generateSnapshot(page: Page): Promise<string> {
  const openButton = page.getByTestId("open-floor-print-dialog");
  await expect(openButton).toBeEnabled();
  await openButton.click();
  await expect(page.getByTestId("floor-print-dialog")).toBeVisible();
  await expect(page.getByLabel("纸张")).toHaveValue("A3");
  await expect(page.getByLabel("方向")).toHaveValue("landscape");
  await page.getByLabel("项目名称").fill("郝家住宅");
  await page.getByLabel("楼层名称").fill("二层顶板");
  await page.getByLabel("备注").fill("现场复核后下料");
  await page.getByTestId("generate-floor-print-preview").click();
  await page.waitForURL(/\/calculator\/floor\/print\?id=/);
  const id = new URL(page.url()).searchParams.get("id");
  expect(id).toBeTruthy();
  return id!;
}

async function makeA3Pdf(page: Page, testInfo: TestInfo): Promise<void> {
  await page.emulateMedia({ media: "print" });
  const bytes = await page.pdf({
    path: testInfo.outputPath("floor-print-a3-landscape.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(bytes.byteLength).toBeGreaterThan(10_000);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);
  for (const pdfPage of pdf.getPages()) {
    const size = pdfPage.getSize();
    expect(Math.abs(size.width - 1190.55)).toBeLessThan(1);
    expect(Math.abs(size.height - 841.89)).toBeLessThan(1);
  }
}

test.describe("Floor Print V1整层冻结快照打印", () => {
  test("料单Tab生成正式快照，D/M图表关联、刷新不重算并输出A3横向PDF", async ({ page }, testInfo) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await expect(page.getByText("整层地筋 + 面筋料单")).toBeVisible();
    const snapshotId = await generateSnapshot(page);

    await expect(page.getByTestId("floor-print-preview")).toBeVisible();
    await expect(page.locator('[data-floor-print-status="official"]')).toBeVisible();
    await expect(page.getByText("正式下料单").first()).toBeVisible();
    await expect(page.locator('svg[data-floor-print-plan="bottom"] [data-mark="D01"]')).not.toHaveCount(0);
    await expect(page.locator('tr[data-print-mark="D01"]').first()).toBeVisible();
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-mark="M01"]')).not.toHaveCount(0);
    await expect(page.locator('tr[data-print-mark="M01"]').first()).toBeVisible();
    await expect(page.getByText("郝家住宅")).toBeVisible();

    const before = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`rebarviz:floor-print:snapshot:${id}`) ?? "null"), snapshotId);
    expect(before.summary.totalPieceCount).toBeGreaterThan(0);
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem("rebarviz:floor-rebar:draft:v1") ?? "null");
      draft.state.slabs[0].width = 9999;
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify(draft));
    });
    await page.reload();
    await expect(page.getByText("郝家住宅")).toBeVisible();
    const after = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`rebarviz:floor-print:snapshot:${id}`) ?? "null"), snapshotId);
    expect(after).toEqual(before);
    await makeA3Pdf(page, testInfo);
  });

  test("同一Mark在两个分离空间带各标一次但BOM仍只有一行", async ({ page }) => {
    await openFloorBom(page, { width: 8000, height: 4000 });
    const snapshotId = await generateSnapshot(page);
    await page.evaluate((id) => {
      const key = `rebarviz:floor-print:snapshot:${id}`;
      const snapshot = JSON.parse(sessionStorage.getItem(key) ?? "null");
      const pieces = snapshot.bottom.pieces.filter((piece: { mark: string }) => piece.mark === "D01");
      pieces.forEach((piece: { direction: "x" | "y"; runStartMm: number; runEndMm: number }, index: number) => {
        const firstBand = index < Math.ceil(pieces.length / 2);
        if (piece.direction === "x") {
          piece.runStartMm = firstBand ? 0 : 6000;
          piece.runEndMm = firstBand ? 2000 : 8000;
        } else {
          piece.runStartMm = firstBand ? 0 : 3000;
          piece.runEndMm = firstBand ? 1000 : 4000;
        }
      });
      sessionStorage.setItem(key, JSON.stringify(snapshot));
    }, snapshotId);
    await page.reload();
    await expect(page.locator('svg[data-floor-print-plan="bottom"] [data-mark-label="D01"]')).toHaveCount(2);
    await expect(page.locator('tr[data-print-mark="D01"]')).toHaveCount(1);
  });

  test("正方形未确认主筋方向时仅显示草稿且正式打印按钮禁用", async ({ page }) => {
    await openFloorBom(page, { width: 4000, height: 4000 });
    await expect(page.getByTestId("floor-bom-draft-warning")).toContainText("人工选择主筋方向");
    await expect(page.getByTestId("open-floor-print-dialog")).toBeDisabled();
  });

  test("Opening在快照与打印SVG中保持真实断筋Piece，390px打印设置无页面溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openFloorBom(page, {
      width: 6000,
      height: 4000,
      opening: { x: 2000, y: 1000, width: 2000, height: 2000 },
    });
    await page.getByTestId("open-floor-print-dialog").click();
    await expect(page.getByTestId("floor-print-dialog")).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    await page.getByTestId("generate-floor-print-preview").click();
    await page.waitForURL(/\/calculator\/floor\/print\?id=/);
    const snapshot = await page.evaluate(() => {
      const id = new URL(location.href).searchParams.get("id");
      return JSON.parse(sessionStorage.getItem(`rebarviz:floor-print:snapshot:${id}`) ?? "null");
    });
    const byPosition = new Map<string, Array<{ start: number; end: number; id: string }>>();
    for (const piece of snapshot.bottom.pieces) {
      const key = `${piece.direction}:${piece.positionMm}`;
      const values = byPosition.get(key) ?? [];
      values.push({ start: piece.runStartMm, end: piece.runEndMm, id: piece.id });
      byPosition.set(key, values);
    }
    const clipped = [...byPosition.values()].find((values) => values.length > 1 && values.sort((a, b) => a.start - b.start).some((value, index) => index > 0 && value.start > values[index - 1].end));
    expect(clipped).toBeDefined();
    const printedPieceIds = await page.locator("[data-print-piece-id]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-print-piece-id")));
    expect(printedPieceIds).toEqual(expect.arrayContaining((clipped ?? []).map((piece) => piece.id)));
    await expect(page.getByText("楼梯间").first()).toBeVisible();
  });

  test("A4纵向选项生成正确纸张方向", async ({ page }) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await page.getByTestId("open-floor-print-dialog").click();
    await page.getByLabel("纸张").selectOption("A4");
    await page.getByLabel("方向").selectOption("portrait");
    await page.getByTestId("generate-floor-print-preview").click();
    await page.waitForURL(/\/calculator\/floor\/print\?id=/);
    await page.emulateMedia({ media: "print" });
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    for (const pdfPage of pdf.getPages()) {
      const size = pdfPage.getSize();
      expect(Math.abs(size.width - 595.28)).toBeLessThan(1);
      expect(Math.abs(size.height - 841.89)).toBeLessThan(1);
    }
  });

  test("缺失快照明确报错且不回读当前Floor草稿重算", async ({ page }) => {
    await page.goto("/calculator/floor/print?id=missing-snapshot");
    await expect(page.getByRole("heading", { name: "打印快照不存在或已损坏" })).toBeVisible();
    await expect(page.getByTestId("floor-print-preview")).toHaveCount(0);
  });

  test("A-B-C创建通墙路径后以T编号替换普通筋，并冻结到SVG与料单", async ({ page }) => {
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
        schemaVersion: 2,
        savedAt: new Date().toISOString(),
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [
            { id: "a", name: "房间A", type: "room", x: 0, y: 0, width: 4000, height: 3600 },
            { id: "b", name: "内走廊", type: "corridor", x: 4000, y: 0, width: 4000, height: 3600 },
            { id: "c", name: "房间C", type: "room", x: 8000, y: 0, width: 4000, height: 3600 },
          ],
          openings: [],
          supportRules: [],
          innerWallThickness: 240,
          outerWallThickness: 370,
          snapDistanceMm: 150,
        },
      }));
      localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
      localStorage.removeItem("rebarviz:floor-rebar:top:v1");
      localStorage.removeItem("rebarviz:floor-rebar:role:v1");
      sessionStorage.clear();
    });
    await page.reload();
    await page.getByRole("button", { name: /3\. 面筋/ }).click();
    await page.getByRole("button", { name: "新建通墙路径" }).click();
    const pathCard = page.locator("[data-through-path-id]").first();
    await pathCard.getByLabel("房间C", { exact: true }).check();
    await pathCard.getByRole("button", { name: "使用最大共同范围" }).click();
    await pathCard.getByLabel("启用", { exact: true }).check();
    await expect(page.getByText("正式面筋结果有效")).toBeVisible();
    await expect(page.getByText("13.220m").first()).toBeVisible();
    await expect(page.getByText("T01", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("通墙面筋 · 通墙01", { exact: true }).first()).toBeVisible();

    await page.waitForTimeout(450);
    const storedTop = await page.evaluate(() => JSON.parse(localStorage.getItem("rebarviz:floor-rebar:top:v1") ?? "null"));
    expect(storedTop).toMatchObject({
      schemaVersion: 4,
      roleReviewRequired: false,
      state: { throughPaths: [{ name: "通墙01", direction: "x", slabIds: ["a", "b", "c"], bandStartMm: 0, bandEndMm: 3600, enabled: true }] },
    });

    await page.getByRole("button", { name: /4\. 料单/ }).click();
    await expect(page.locator('tr[data-source="through"]')).toContainText("T01");
    const snapshotId = await generateSnapshot(page);
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-mark="T01"][data-source="through"]')).not.toHaveCount(0);
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-mark="T01"] [data-through-outer="true"]')).not.toHaveCount(0);
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-mark="T01"] [data-through-inner="true"]')).not.toHaveCount(0);
    await expect(page.locator('tr[data-print-mark="T01"]')).toContainText("通墙面筋 · 通墙01");
    const frozen = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`rebarviz:floor-print:snapshot:${id}`) ?? "null"), snapshotId);
    expect(frozen.schemaVersion).toBe(2);
    expect(frozen.summary.topThroughPieceCount).toBeGreaterThan(0);

    await page.evaluate(() => {
      const record = JSON.parse(localStorage.getItem("rebarviz:floor-rebar:top:v1") ?? "null");
      record.state.throughPaths[0].bandEndMm = 1600;
      localStorage.setItem("rebarviz:floor-rebar:top:v1", JSON.stringify(record));
    });
    await page.reload();
    const after = await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`rebarviz:floor-print:snapshot:${id}`) ?? "null"), snapshotId);
    expect(after).toEqual(frozen);
  });
});
