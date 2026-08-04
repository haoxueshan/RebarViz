import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  calculateSlabResults,
  cloneDefaultSlabCalculatorState,
  createDefaultRoomAnchorRules,
  type SlabCalculatorState,
} from "../../src/lib/slab-calculator";
import {
  CALCULATOR_ALGORITHM_VERSION,
  RESULT_KEY,
  createCalculationRecord,
  type StoredCalculationRecord,
} from "../../src/lib/slab-calculator-storage";

const PRINT_FOOTER_DISCLAIMER =
  "计算结果仅供钢筋工程量估算、下料复核和学习参考，不替代设计图纸、现行规范及工程师审核。当前结果未计施工损耗。";
const PRINT_FOOTER_UNIQUE_TEXT = "当前结果未计施工损耗";

type RoomInput = {
  name: string;
  spanX: number;
  spanY: number;
};

function createRecord(
  rooms: RoomInput[],
  mutate?: (state: SlabCalculatorState) => void,
): StoredCalculationRecord {
  const state = cloneDefaultSlabCalculatorState();
  const arrangement = rooms.length === 1 ? "single" : "x";
  state.slab.arrangement = arrangement;
  state.slab.rooms = rooms.map((room, index) => ({
    id: `print-room-${index + 1}`,
    name: room.name,
    spanX: room.spanX,
    spanY: room.spanY,
    anchors: createDefaultRoomAnchorRules(arrangement, index, rooms.length),
  }));
  mutate?.(state);
  const calculation = calculateSlabResults(state);
  if (!calculation.isValid) {
    throw new Error(`打印测试数据无效：${calculation.errors.join("；")}`);
  }
  return createCalculationRecord(
    state,
    calculation,
    "2026-08-05T03:04:05.000Z",
  );
}

async function openStoredResult(
  page: Page,
  record: StoredCalculationRecord,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
      Object.defineProperty(window, "print", {
        configurable: true,
        value: () => document.documentElement.setAttribute("data-print-called", "true"),
      });
    },
    { key: RESULT_KEY, value: JSON.stringify(record) },
  );
  await page.goto("/calculator/results");
  await expect(page.getByRole("heading", { name: "楼板钢筋计算结果" })).toBeVisible();
  await expect(page.getByRole("button", { name: /打印设置/ })).toBeEnabled();
}

async function commitPrintSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: /打印所选内容/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "true");
}

async function makePdf(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<Uint8Array> {
  await page.emulateMedia({ media: "print" });
  const bytes = await page.pdf({
    path: testInfo.outputPath(`${name}.pdf`),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(bytes.byteLength).toBeGreaterThan(10_000);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  for (const pdfPage of pdf.getPages()) {
    const { width, height } = pdfPage.getSize();
    expect(width).toBeCloseTo(841.89, 0);
    expect(height).toBeCloseTo(595.28, 0);
  }
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const textDocument = await loadingTask.promise;
  for (let pageNumber = 1; pageNumber <= textDocument.numPages; pageNumber += 1) {
    const pdfPage = await textDocument.getPage(pageNumber);
    const content = await pdfPage.getTextContent();
    const textItems = content.items.flatMap((item) =>
      "str" in item && item.str.trim().length > 0
        ? [{
            text: item.str,
            y: item.transform[5],
            height: item.height,
          }]
        : [],
    );
    const text = textItems.map((item) => item.text).join("");
    expect(text).toContain("RebarViz");
    expect(text).toContain(CALCULATOR_ALGORITHM_VERSION);
    expect(text.split(PRINT_FOOTER_UNIQUE_TEXT)).toHaveLength(2);

    const pageHeight = pdfPage.getViewport({ scale: 1 }).height;
    const footerBandLimit = pageHeight * 0.1;
    const footerItems = textItems.filter((item) => item.y < footerBandLimit);
    const bodyItems = textItems.filter((item) => item.y >= footerBandLimit);
    const normalizedFooterText = footerItems
      .map((item) => item.text)
      .join("")
      .replace(/\s+/gu, "");

    expect(footerItems.length).toBeGreaterThan(0);
    expect(bodyItems.length).toBeGreaterThan(0);
    expect(normalizedFooterText).toMatch(
      new RegExp(
        `^RebarViz打印时间：.+算法版本：${CALCULATOR_ALGORITHM_VERSION}${PRINT_FOOTER_DISCLAIMER}$`,
      ),
    );

    const footerTop = Math.max(
      ...footerItems.map((item) => item.y + item.height),
    );
    const bodyBottom = Math.min(...bodyItems.map((item) => item.y));
    expect(footerTop).toBeLessThan(footerBandLimit);
    expect(bodyBottom - footerTop).toBeGreaterThan(4);
  }
  textDocument.cleanup();
  await loadingTask.destroy();
  return bytes;
}

async function diagramPrintSize(page: Page): Promise<{ width: number; height: number }> {
  const sheet = page.getByTestId("slab-print-diagram-sheet");
  await expect(sheet).toBeVisible();
  return sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

test.describe("楼板结果真实浏览器打印", () => {
  test("单房间全部结果生成A4横向PDF且没有部分选择提示", async ({ page }, testInfo) => {
    const record = createRecord([{ name: "房间A", spanX: 4200, spanY: 3600 }]);
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await commitPrintSettings(page);
    await expect(page.getByTestId("slab-print-report")).toContainText("全部正式结果");
    await expect(page.getByTestId("slab-print-report")).not.toContainText("仅显示所选钢筋");
    await makePdf(page, testInfo, "single-all");
  });

  test("五房间约20项时二维图打印尺寸保持固定且明细可分页", async ({ page }, testInfo) => {
    const record = createRecord(
      Array.from({ length: 5 }, (_, index) => ({
        name: `房间${index + 1}`,
        spanX: 3000 + index * 500,
        spanY: 3600,
      })),
    );
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await page.locator('input[name="slab-print-range"][value="custom"]').check();
    await page.getByRole("button", { name: "清空" }).click();
    await page.locator("input[data-result-id]").first().check();
    await commitPrintSettings(page);
    await page.emulateMedia({ media: "print" });
    const oneItemSize = await diagramPrintSize(page);

    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: /打印设置/ }).click();
    await page.locator('input[name="slab-print-range"][value="all"]').check();
    await commitPrintSettings(page);
    await page.emulateMedia({ media: "print" });
    const allItemsSize = await diagramPrintSize(page);
    expect(allItemsSize.width).toBeCloseTo(oneItemSize.width, 1);
    expect(allItemsSize.height).toBeCloseTo(oneItemSize.height, 1);
    expect(allItemsSize.width).toBeGreaterThan(900);
    expect(allItemsSize.height / allItemsSize.width).toBeGreaterThan(0.45);
    expect(allItemsSize.height / allItemsSize.width).toBeLessThan(0.7);
    const maxHeight = await page
      .getByTestId("slab-print-diagram-sheet")
      .evaluate((element) => getComputedStyle(element).maxHeight);
    expect(maxHeight).toBe("none");
    const svgMaxHeight = await page
      .getByTestId("slab-print-diagram-sheet")
      .getByTestId("slab-diagram-canvas")
      .evaluate((element) => getComputedStyle(element).maxHeight);
    expect(svgMaxHeight).toBe("none");
    const legend = page.getByTestId("slab-print-result-legend");
    expect(await legend.locator("thead").evaluate((element) => getComputedStyle(element).display))
      .toBe("table-header-group");
    expect(await legend.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)))
      .toBeGreaterThanOrEqual(10);
    const pdfBytes = await makePdf(page, testInfo, "five-rooms-all");
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBeGreaterThan(2);
  });

  test("当前筛选打印忽略分页并只打印筛选项", async ({ page }, testInfo) => {
    const record = createRecord(
      Array.from({ length: 3 }, (_, index) => ({
        name: `筛选房间${index + 1}`,
        spanX: 3200 + index * 200,
        spanY: 3600,
      })),
    );
    await openStoredResult(page, record);
    await page.getByLabel("类型筛选").selectOption("top");
    await page.getByLabel("方向筛选").selectOption("x");
    await page.getByLabel("每页组数").selectOption("2");
    const expectedIds = record.calculation.results
      .filter((result) => result.layer === "top" && result.direction === "x")
      .map((result) => result.id)
      .sort();
    const screenIds = await page
      .locator("main.slab-results-screen")
      .getByTestId("slab-diagram-canvas")
      .locator("[data-result-id]")
      .evaluateAll((elements) => [
        ...new Set(elements.map((element) => element.getAttribute("data-result-id"))),
      ].filter((value): value is string => value !== null).sort());
    expect(screenIds).toEqual(expectedIds);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await page.locator('input[name="slab-print-range"][value="current-filters"]').check();
    await commitPrintSettings(page);
    const report = page.getByTestId("slab-print-report");
    await expect(report).toContainText("当前筛选");
    await expect(
      report
        .getByTestId("slab-print-result-legend")
        .locator("tr[data-result-id]:not([data-variant-id])"),
    ).toHaveCount(3);
    await makePdf(page, testInfo, "current-filter");
  });

  test("自定义单项打印只保留父级正式结果及其全部分区", async ({ page }, testInfo) => {
    const record = createRecord([
      { name: "低房间", spanX: 3000, spanY: 3000 },
      { name: "高房间", spanX: 3000, spanY: 6000 },
    ]);
    const selectedId = record.calculation.results.find(
      (result) => result.roomId === "print-room-2" && result.layer === "bottom" && result.direction === "x",
    )?.id;
    expect(selectedId).toBeTruthy();
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await page.locator('input[name="slab-print-range"][value="custom"]').check();
    await page.getByRole("button", { name: "清空" }).click();
    await page.locator(`input[data-result-id="${selectedId}"]`).check();
    await commitPrintSettings(page);
    const report = page.getByTestId("slab-print-report");
    await expect(report).toContainText("自定义选择 1/");
    await expect(
      report.locator(`tr[data-result-id="${selectedId}"]:not([data-variant-id])`),
    ).toHaveCount(1);
    await expect(report.locator("[data-variant-id]")).toHaveCount(2);
    await makePdf(page, testInfo, "unequal-zoned-custom");
  });

  test("不等尺寸普通多房间分区以完整模式打印", async ({ page }, testInfo) => {
    const record = createRecord([
      { name: "房间A", spanX: 3000, spanY: 3000 },
      { name: "房间B", spanX: 3000, spanY: 6000 },
    ]);
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await commitPrintSettings(page);
    const report = page.getByTestId("slab-print-report");
    await expect(report).toContainText("多长度");
    await expect(report.locator("[data-variant-id]")).toHaveCount(4);
    await makePdf(page, testInfo, "unequal-full");
  });

  test("长房间名称允许换行且打印不横向溢出", async ({ page }, testInfo) => {
    const record = createRecord([
      { name: "这是一个用于验证打印自动换行且不会撑破A4页面的超长房间名称", spanX: 4200, spanY: 3600 },
    ]);
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await commitPrintSettings(page);
    await page.emulateMedia({ media: "print" });
    const overflow = await page.getByTestId("slab-print-report").evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await makePdf(page, testInfo, "long-name");
  });

  test("超长手动锚固保留真实标注并打印不溢出", async ({ page }, testInfo) => {
    const record = createRecord(
      [{ name: "长锚固房间", spanX: 4200, spanY: 3600 }],
      (state) => {
        const anchor = state.slab.rooms[0].anchors.top.x.start;
        anchor.source = "manual";
        anchor.manualValue = 50_000;
        anchor.origin = "user";
      },
    );
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await commitPrintSettings(page);
    await page.emulateMedia({ media: "print" });
    const overflow = await page.getByTestId("slab-print-report").evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await expect(page.getByTestId("slab-print-report")).toContainText("50000mm");
    await makePdf(page, testInfo, "long-anchor");
  });

  test("精简模式真正省略锚固列并生成PDF", async ({ page }, testInfo) => {
    const record = createRecord([{ name: "精简料单", spanX: 4200, spanY: 3600 }]);
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();
    await page.locator('input[name="slab-print-detail"]').nth(1).check();
    await commitPrintSettings(page);
    const legend = page.getByTestId("slab-print-result-legend");
    await expect(legend.getByRole("columnheader", { name: "起点锚固" })).toHaveCount(0);
    await expect(legend.getByRole("columnheader", { name: "终点锚固" })).toHaveCount(0);
    await makePdf(page, testInfo, "compact");
  });

  test("仅打印二维图章节时首页直接包含图纸且不产生空白页", async ({ page }, testInfo) => {
    const record = createRecord([{ name: "二维图专页", spanX: 4200, spanY: 3600 }]);
    await openStoredResult(page, record);
    await page.getByRole("button", { name: /打印设置/ }).click();

    for (const sectionName of [
      "重量汇总",
      "参数快照",
      "房间尺寸表",
      "规格汇总表",
      "分组钢筋明细",
      "计算说明",
    ]) {
      await page.getByRole("checkbox", { name: sectionName, exact: true }).uncheck();
    }
    await expect(
      page.getByRole("checkbox", { name: "钢筋示意图", exact: true }),
    ).toBeChecked();
    await commitPrintSettings(page);

    const pdfBytes = await makePdf(page, testInfo, "diagram-only");
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);

    const loadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
    const textDocument = await loadingTask.promise;
    const firstPage = await textDocument.getPage(1);
    const firstPageText = (await firstPage.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join("");
    expect(firstPageText).toContain("楼板钢筋计算二维示意图");
    textDocument.cleanup();
    await loadingTask.destroy();
  });

  test("输入页布局预览不伪造正式钢筋和结果图例", async ({ page }) => {
    await page.goto("/calculator");
    const preview = page.getByTestId("slab-layout-diagram");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("当前为布局预览");
    await expect(preview.locator("[data-result-id]")).toHaveCount(0);
    await expect(preview.getByTestId("slab-diagram-result-legend")).toHaveCount(0);
  });
});
