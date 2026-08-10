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
    await expect(page.getByText("整层地筋 + 普通面筋料单")).toBeVisible();
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
});
