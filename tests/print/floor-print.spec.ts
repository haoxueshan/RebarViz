import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import {
  calculateFloorBottomRebar,
  DEFAULT_FLOOR_BOTTOM_STATE,
} from "../../src/lib/floor-bottom-calculator";
import {
  createFloorProductionGoldenBottomState,
  createFloorProductionGoldenPlan,
  createFloorProductionGoldenRoleState,
  createFloorProductionGoldenTopState,
} from "../../src/lib/__fixtures__/floor-production-golden-v3";
import {
  buildFloorPrintSnapshot,
  DEFAULT_FLOOR_PRINT_OPTIONS,
} from "../../src/lib/floor-print";
import type { FloorPlanState, FloorSlab } from "../../src/lib/floor-plan";
import {
  calculateFloorTopRebar,
  DEFAULT_FLOOR_TOP_STATE,
} from "../../src/lib/floor-top-calculator";

type FloorDraftInput = {
  width: number;
  height: number;
  opening?: { x: number; y: number; width: number; height: number };
};

function buildOfficialPrintSnapshot(input: {
  plan: FloorPlanState;
  bottomState: typeof DEFAULT_FLOOR_BOTTOM_STATE;
  topState: typeof DEFAULT_FLOOR_TOP_STATE;
  roleState?: Parameters<typeof calculateFloorBottomRebar>[2];
  projectName: string;
  snapshotId: string;
}) {
  const bottom = calculateFloorBottomRebar(input.plan, input.bottomState, input.roleState);
  const top = calculateFloorTopRebar(input.plan, input.topState, input.roleState);
  expect(bottom.isValid).toBe(true);
  expect(top.isValid).toBe(true);
  return buildFloorPrintSnapshot({
    plan: input.plan,
    bottom,
    top,
    bottomRoleReviewRequired: false,
    topRoleReviewRequired: false,
    invalidDraftCount: 0,
    project: { projectName: input.projectName, floorName: "二层顶板", remark: "A4打印压力回归" },
    options: structuredClone(DEFAULT_FLOOR_PRINT_OPTIONS),
    snapshotId: input.snapshotId,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
}

function buildTwelveSlabStressSnapshot() {
  const slabs: FloorSlab[] = [
    ["a", 0, 0, 3600, 2600], ["b", 3600, 0, 3300, 2600], ["c", 6900, 0, 3400, 2600], ["d", 10300, 0, 3000, 2600],
    ["e", 0, 2600, 3000, 2800], ["f", 3000, 2600, 4200, 2800], ["g", 7200, 2600, 3000, 2800], ["h", 10200, 2600, 3100, 2800],
    ["i", 0, 5400, 4000, 2400], ["j", 4000, 5400, 3200, 2400], ["k", 7200, 5400, 3600, 2400], ["l", 10800, 5400, 2500, 2400],
  ].map(([id, x, y, width, height]) => ({
    id: String(id), name: `板区${String(id).toUpperCase()}`, type: "room", x: Number(x), y: Number(y), width: Number(width), height: Number(height),
  }));
  const plan: FloorPlanState = {
    coordinateModel: "net-layout-v1",
    slabs,
    openings: [{ id: "stress-opening", name: "楼梯间", type: "stair", x: 900, y: 700, width: 1200, height: 1000 }],
    supportRules: [],
    innerWallThickness: 240,
    outerWallThickness: 370,
    snapDistanceMm: 150,
    overlapToleranceMm: 10,
  };
  const topState = structuredClone(DEFAULT_FLOOR_TOP_STATE);
  topState.throughPaths = [{
    id: "stress-through-a-d",
    name: "通墙压力路径",
    direction: "x",
    slabIds: ["a", "b", "c", "d"],
    bandStartMm: 1800,
    bandEndMm: 2600,
    enabled: true,
  }];
  return buildOfficialPrintSnapshot({
    plan,
    bottomState: structuredClone(DEFAULT_FLOOR_BOTTOM_STATE),
    topState,
    projectName: "十二板区压力工程",
    snapshotId: "twelve-slab-a4-pdf",
  });
}

/** 从 IndexedDB 读取打印快照（V1.2 起主存储，sessionStorage 仅 legacy fallback）。 */
async function readSnapshotFromIndexedDb(page: Page, id: string): Promise<unknown> {
  return page.evaluate(async (snapshotId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rebarviz-floor-print", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction("snapshots", "readonly").objectStore("snapshots").get(snapshotId);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error("get failed"));
      });
    } finally {
      db.close();
    }
  }, id);
}

/** 向 IndexedDB 写回修改后的快照（用于冻结数据不变性测试）。 */
async function writeSnapshotToIndexedDb(page: Page, id: string, snapshot: unknown): Promise<void> {
  await page.evaluate(async ({ snapshotId, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rebarviz-floor-print", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("snapshots", "readwrite");
        transaction.objectStore("snapshots").put({ ...(value as Record<string, unknown>), id: snapshotId });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("put failed"));
      });
    } finally {
      db.close();
    }
  }, { snapshotId: id, value: snapshot });
}

async function openFloorBom(page: Page, input: FloorDraftInput): Promise<void> {
  await page.goto("/calculator/floor");
  await page.evaluate(({ width, height, opening }) => {
    localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
      schemaVersion: 3,
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
  await expect(page.getByLabel("纸张")).toHaveValue("A4");
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

type SvgBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function boxesOverlap(left: SvgBounds, right: SvgBounds, padding = 0): boolean {
  return left.x < right.x + right.width + padding &&
    left.x + left.width + padding > right.x &&
    left.y < right.y + right.height + padding &&
    left.y + left.height + padding > right.y;
}

async function readPlanAnnotations(page: Page, mode: "bottom" | "top") {
  return page.locator(`svg[data-floor-print-plan="${mode}"]`).evaluate((svg) => {
    const numberAttribute = (element: Element, name: string) => Number(element.getAttribute(name));
    const annotations = [...svg.querySelectorAll("[data-annotation-x]")].map((element) => ({
      kind: element.getAttribute("data-annotation-kind") ?? "",
      fallback: element.getAttribute("data-annotation-fallback") === "true",
      x: numberAttribute(element, "data-annotation-x"),
      y: numberAttribute(element, "data-annotation-y"),
      width: numberAttribute(element, "data-annotation-width"),
      height: numberAttribute(element, "data-annotation-height"),
    }));
    const legend = svg.querySelector("[data-print-legend]");
    if (!legend) throw new Error("print legend is missing");
    return {
      annotations,
      legend: {
        x: numberAttribute(legend, "data-legend-reserved-x"),
        y: numberAttribute(legend, "data-legend-reserved-y"),
        width: numberAttribute(legend, "data-legend-reserved-width"),
        height: numberAttribute(legend, "data-legend-reserved-height"),
      },
    };
  });
}

async function makeA4LandscapePdf(page: Page, testInfo: TestInfo): Promise<void> {
  await page.emulateMedia({ media: "print" });
  const bytes = await page.pdf({
    path: testInfo.outputPath("floor-print-a4-landscape.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(bytes.byteLength).toBeGreaterThan(10_000);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);
  for (const pdfPage of pdf.getPages()) {
    const size = pdfPage.getSize();
    expect(Math.abs(size.width - 841.89)).toBeLessThan(1);
    expect(Math.abs(size.height - 595.28)).toBeLessThan(1);
  }
}

async function openFrozenSnapshot(page: Page, snapshot: { id: string }): Promise<void> {
  await page.goto("/calculator/floor");
  await writeSnapshotToIndexedDb(page, snapshot.id, snapshot);
  await page.goto(`/calculator/floor/print?id=${snapshot.id}`);
  await expect(page.getByTestId("floor-print-preview")).toBeVisible();
}

test.describe("Floor Print V1整层冻结快照打印", () => {
  test("料单Tab生成正式快照，D/M图表关联、刷新不重算并输出A4横向PDF", async ({ page }, testInfo) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await expect(page.getByText("整层地筋 + 面筋料单")).toBeVisible();
    const snapshotId = await generateSnapshot(page);

    await expect(page.getByTestId("floor-print-preview")).toBeVisible();
    await expect(page.locator('[data-floor-print-status="official"]')).toBeVisible();
    await expect(page.locator('svg[data-floor-print-plan="bottom"] [data-mark="D01"]')).not.toHaveCount(0);
    await expect(page.locator('tr[data-print-mark="D01"]').first()).toBeVisible();
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-mark="M01"]')).not.toHaveCount(0);
    await expect(page.locator('tr[data-print-mark="M01"]').first()).toBeVisible();
    const markLabel = page.locator('svg[data-floor-print-plan="bottom"] [data-mark-label]').first();
    await expect(markLabel).toContainText("Φ");
    await expect(markLabel).not.toContainText("桅");
    await expect(page.locator('svg[data-floor-print-plan="geometry"] [data-slab-label="S01"]')).toHaveCount(1);
    const bottomSlabLabel = page.locator('svg[data-floor-print-plan="bottom"] [data-slab-label="S01"]');
    await expect(bottomSlabLabel).toContainText("主");
    await expect(bottomSlabLabel).toContainText("副");
    const annotationBounds = await page.locator('svg[data-floor-print-plan="bottom"] [data-annotation-x]').evaluateAll((elements) =>
      elements.map((element) => ({
        x: Number(element.getAttribute("data-annotation-x")),
        y: Number(element.getAttribute("data-annotation-y")),
        width: Number(element.getAttribute("data-annotation-width")),
        height: Number(element.getAttribute("data-annotation-height")),
      })));
    expect(annotationBounds.length).toBeGreaterThan(0);
    annotationBounds.forEach((bounds) => {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1200);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
    });
    const monochrome = await page.locator('svg[data-floor-print-plan="bottom"]').evaluate((svg) => ({
      markup: svg.innerHTML,
      outerWallFills: [...svg.querySelectorAll('[data-wall-kind="outer-wall"]')].map((wall) => wall.getAttribute("fill")),
    }));
    expect(monochrome.markup).not.toContain("#2563eb");
    expect(monochrome.outerWallFills.length).toBeGreaterThan(0);
    expect(monochrome.outerWallFills).not.toContain("#171717");

    const before = await readSnapshotFromIndexedDb(page, snapshotId);
    expect((before as { summary: { totalPieceCount: number } }).summary.totalPieceCount).toBeGreaterThan(0);
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem("rebarviz:floor-rebar:draft:v1") ?? "null");
      draft.state.slabs[0].width = 9999;
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify(draft));
    });
    await page.reload();
    await expect(page.getByTestId("floor-print-report")).toBeVisible();
    const after = await readSnapshotFromIndexedDb(page, snapshotId);
    expect(after).toEqual(before);
    await page.emulateMedia({ media: "print" });
    const printOverflow = await page.locator('[data-testid="floor-print-report"]').evaluate((report) => ({
      scrollWidth: report.scrollWidth,
      clientWidth: report.clientWidth,
    }));
    expect(printOverflow.scrollWidth).toBeLessThanOrEqual(printOverflow.clientWidth + 1);
    await makeA4LandscapePdf(page, testInfo);
  });

  test("Production Golden House通过正式计算链生成A4横向PDF", async ({ page }, testInfo) => {
    const snapshot = buildOfficialPrintSnapshot({
      plan: createFloorProductionGoldenPlan(),
      bottomState: createFloorProductionGoldenBottomState(),
      topState: createFloorProductionGoldenTopState(),
      roleState: createFloorProductionGoldenRoleState(),
      projectName: "Production Golden House",
      snapshotId: "production-golden-a4-pdf",
    });
    expect(snapshot.status).toBe("official");
    await openFrozenSnapshot(page, snapshot);
    await expect(page.locator('svg[data-floor-print-plan="bottom"] [data-slab-label]')).toHaveCount(3);
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-area-callout-kind="through"]')).toHaveCount(1);
    await makeA4LandscapePdf(page, testInfo);
  });

  test("十二板区压力工程通过正式计算链生成A4横向PDF", async ({ page }, testInfo) => {
    const snapshot = buildTwelveSlabStressSnapshot();
    expect(snapshot.status).toBe("official");
    expect(snapshot.top.rows.some((row) => row.source === "through")).toBe(true);
    await openFrozenSnapshot(page, snapshot);
    await expect(page.locator('svg[data-floor-print-plan="bottom"] [data-slab-label]')).toHaveCount(12);
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-area-callout-kind="through"]')).toHaveCount(1);
    for (const mode of ["bottom", "top"] as const) {
      const { annotations, legend } = await readPlanAnnotations(page, mode);
      expect(annotations).not.toHaveLength(0);
      expect(annotations.filter((annotation) => annotation.kind === "slab-label")).toHaveLength(12);
      expect(annotations.filter((annotation) => annotation.kind === "opening-label")).toHaveLength(1);
      annotations.forEach((annotation) => {
        expect(annotation.kind).not.toBe("");
        expect(Number.isFinite(annotation.x)).toBe(true);
        expect(Number.isFinite(annotation.y)).toBe(true);
        expect(Number.isFinite(annotation.width)).toBe(true);
        expect(Number.isFinite(annotation.height)).toBe(true);
        expect(annotation.x).toBeGreaterThanOrEqual(0);
        expect(annotation.y).toBeGreaterThanOrEqual(0);
        expect(annotation.x + annotation.width).toBeLessThanOrEqual(1200);
        expect(annotation.y + annotation.height).toBeLessThanOrEqual(720);
        expect(boxesOverlap(annotation, legend)).toBe(false);
      });
      const slabLabels = annotations.filter((annotation) => annotation.kind === "slab-label");
      for (let index = 0; index < slabLabels.length; index += 1) {
        for (let other = index + 1; other < slabLabels.length; other += 1) {
          expect(boxesOverlap(slabLabels[index], slabLabels[other])).toBe(false);
        }
      }
      for (const slab of slabLabels) {
        for (const annotation of annotations.filter((item) => item.kind !== "slab-label")) {
          if (!annotation.fallback) {
            expect(boxesOverlap(slab, annotation), `${mode}: ${JSON.stringify({ slab, annotation })}`).toBe(false);
          }
        }
      }
    }
    const overflow = await page.locator('[data-testid="floor-print-report"]').evaluate((report) => ({
      report: report.scrollWidth - report.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.report).toBeLessThanOrEqual(1);
    expect(overflow.document).toBeLessThanOrEqual(1);
    await makeA4LandscapePdf(page, testInfo);
  });

  test("同一Mark在两个分离空间带各标一次但BOM仍只有一行", async ({ page }) => {
    await openFloorBom(page, { width: 8000, height: 4000 });
    const snapshotId = await generateSnapshot(page);
    const snapshot = await readSnapshotFromIndexedDb(page, snapshotId) as {
      bottom: { pieces: Array<{ mark: string; direction: "x" | "y"; runStartMm: number; runEndMm: number }> };
    };
    const pieces = snapshot.bottom.pieces.filter((piece) => piece.mark === "D01");
    pieces.forEach((piece, index) => {
      const firstBand = index < Math.ceil(pieces.length / 2);
      if (piece.direction === "x") {
        piece.runStartMm = firstBand ? 0 : 6000;
        piece.runEndMm = firstBand ? 2000 : 8000;
      } else {
        piece.runStartMm = firstBand ? 0 : 3000;
        piece.runEndMm = firstBand ? 1000 : 4000;
      }
    });
    await writeSnapshotToIndexedDb(page, snapshotId, snapshot);
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
    await expect(page.locator("[data-print-piece-id]").first()).toBeAttached();
    const snapshotId = new URL(page.url()).searchParams.get("id") ?? "";
    const snapshot = await readSnapshotFromIndexedDb(page, snapshotId) as { bottom: { pieces: Array<{ direction: "x" | "y"; positionMm: number; runStartMm: number; runEndMm: number; id: string }> } };
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
    const openingLabel = page.locator('svg[data-floor-print-plan="bottom"] [data-opening-label="print-opening-a"]');
    await expect(openingLabel).toHaveCount(1);
    await expect(openingLabel).toHaveAttribute("data-annotation-kind", "opening-label");
    await expect(openingLabel).toContainText("VOID");
    await expect(page.getByText("楼梯间").first()).toBeVisible();
  });

  test("Site preset remains a six-column site layout after custom content changes", async ({ page }) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await page.getByTestId("open-floor-print-dialog").click();
    await page.getByLabel("按直径汇总").uncheck();
    await page.getByTestId("generate-floor-print-preview").click();
    await page.waitForURL(/\/calculator\/floor\/print\?id=/);
    const snapshotId = new URL(page.url()).searchParams.get("id")!;
    const snapshot = await readSnapshotFromIndexedDb(page, snapshotId) as {
      options: { preset: string; layoutMode: string };
    };
    expect(snapshot.options).toEqual(expect.objectContaining({ preset: "custom", layoutMode: "site" }));
    await expect(page.getByTestId("floor-print-report")).toHaveAttribute("data-floor-print-layout", "site");
    await expect(page.locator('table[data-print-bom-layout="site"]')).toHaveCount(2);
    await expect(page.locator('[data-area-header]').first()).toBeVisible();
    await expect(page.locator('[data-area-index-kind="slab"]')).not.toHaveCount(0);
  });

  test("Full preset remains a report BOM layout after custom content changes", async ({ page }) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await page.getByTestId("open-floor-print-dialog").click();
    await page.getByRole("button", { name: "完整报告" }).click();
    await page.getByLabel("计算参数").uncheck();
    await page.getByTestId("generate-floor-print-preview").click();
    await page.waitForURL(/\/calculator\/floor\/print\?id=/);
    const snapshotId = new URL(page.url()).searchParams.get("id")!;
    const snapshot = await readSnapshotFromIndexedDb(page, snapshotId) as {
      options: { preset: string; layoutMode: string };
    };
    expect(snapshot.options).toEqual(expect.objectContaining({ preset: "custom", layoutMode: "report" }));
    await expect(page.getByTestId("floor-print-report")).toHaveAttribute("data-floor-print-layout", "report");
    await expect(page.locator('table[data-print-bom-layout="report"]')).toHaveCount(3);
    await expect(page.locator('table[data-print-bom-layout="site"]')).toHaveCount(0);
  });

  test("A4纵向选项生成正确纸张方向", async ({ page }) => {
    await openFloorBom(page, { width: 4200, height: 3600 });
    await page.getByTestId("open-floor-print-dialog").click();
    await page.getByLabel("纸张").selectOption("A4");
    await page.getByLabel("方向").selectOption("portrait");
    await page.getByTestId("generate-floor-print-preview").click();
    await page.waitForURL(/\/calculator\/floor\/print\?id=/);
    await expect(page.getByTestId("floor-print-report")).toBeVisible();
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
        schemaVersion: 3,
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
      localStorage.setItem("floorWorkspaceInspectorOpen", "true");
      localStorage.setItem("floorNavigatorCollapsed", "false");
      sessionStorage.clear();
    });
    await page.reload();
    await page.getByRole("button", { name: /3\. 面筋/ }).click();
    await page.getByRole("button", { name: "新建通墙路径" }).click();
    const pathCard = page.locator("[data-through-path-id]").first();
    await pathCard.getByRole("button", { name: "编辑经过板区" }).click();
    await pathCard.getByLabel("内走廊", { exact: true }).check();
    await pathCard.getByLabel("房间C", { exact: true }).check();
    await pathCard.getByRole("button", { name: "完成选择" }).click();
    await pathCard.getByRole("button", { name: "使用最大共同范围" }).click();
    await pathCard.getByLabel("启用", { exact: true }).check();
    await expect(page.getByTestId("floor-live-summary")).toContainText("面筋有效");
    await page.getByTestId("floor-live-summary").getByRole("button", { name: "查看料单" }).click();
    const throughRow = page.locator('tr[data-source="through"]').first();
    await expect(throughRow.getByRole("cell", { name: "13,220 mm", exact: true })).toBeVisible();
    await expect(throughRow).toContainText("T01");
    await expect(throughRow).toContainText("通墙面筋 · 通墙01");

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
    await expect(page.locator('svg[data-floor-print-plan="top"] [data-area-callout-kind="through"]')).toHaveCount(1);
    await expect(page.locator('[data-area-header]').filter({ hasText: "通墙面筋 · 通墙01" })).toBeVisible();
    const frozen = await readSnapshotFromIndexedDb(page, snapshotId) as {
      schemaVersion: number;
      summary: { topThroughPieceCount: number };
    };
    expect(frozen.schemaVersion).toBe(2);
    expect(frozen.summary.topThroughPieceCount).toBeGreaterThan(0);

    await page.evaluate(() => {
      const record = JSON.parse(localStorage.getItem("rebarviz:floor-rebar:top:v1") ?? "null");
      record.state.throughPaths[0].bandEndMm = 1600;
      localStorage.setItem("rebarviz:floor-rebar:top:v1", JSON.stringify(record));
    });
    await page.reload();
    const after = await readSnapshotFromIndexedDb(page, snapshotId);
    expect(after).toEqual(frozen);
  });

  test("Tablet print dialog stays within portrait and landscape viewports", async ({ page }) => {
    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await openFloorBom(page, { width: 4200, height: 3600 });
      await page.getByTestId("open-floor-print-dialog").click();

      const dialog = page.getByTestId("floor-print-dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("generate-floor-print-preview")).toBeVisible();
      const metrics = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[data-testid="floor-print-dialog"]');
        const rect = element?.getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dialogTop: rect?.top ?? -1,
          dialogBottom: rect?.bottom ?? Number.POSITIVE_INFINITY,
          viewportHeight: window.innerHeight,
        };
      });
      expect(metrics.pageOverflow).toBeLessThanOrEqual(0);
      expect(metrics.dialogTop).toBeGreaterThanOrEqual(0);
      expect(metrics.dialogBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
      await page.getByLabel("关闭打印设置").click();
    }
  });
});
