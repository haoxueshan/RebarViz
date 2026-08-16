import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

function setDraft(page: import("@playwright/test").Page, slabs: Array<Record<string, unknown>>, overlapToleranceMm = 10) {
  return page.evaluate(({ draftKey, roleKey, slabs: slabData, tolerance }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: slabData,
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: tolerance,
      },
    }));
    localStorage.setItem(roleKey, JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      state: { mainDirectionOverrides: { "role:a": "x", "role:b": "x", "role:c": "x" } },
    }));
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY, slabs, tolerance: overlapToleranceMm });
}

async function savedSlabs(page: import("@playwright/test").Page): Promise<Array<{ id: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
    return record.state?.slabs ?? [];
  }, DRAFT_KEY);
}

function canvasSlab(page: import("@playwright/test").Page, name: string) {
  return page.locator(`[data-floor-layer="slabs"] rect[aria-label="选择板区 ${name}"]`);
}

test("Floor Docking V1拼接模式：Source+Target+北边+Ghost+确认生成0mm共享边", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await setDraft(page, [
    { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "b", name: "板区B", type: "room", x: 0, y: 3605, width: 3600, height: 3600 },
  ], 0);
  await page.reload();

  await page.getByRole("button", { name: "拼接", exact: true }).click();

  await canvasSlab(page, "板区B").click();
  await canvasSlab(page, "板区A").click();

  await page.locator('[data-dock-side="north"]').dispatchEvent("pointerover");
  await expect(page.locator("[data-dock-ghost]")).toHaveCount(1);
  await expect(page.getByText("拼到板区A北侧")).toBeVisible();

  await page.locator('[data-dock-side="north"]').dispatchEvent("pointerdown");
  const panel = page.getByTestId("dock-confirm-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("源板区：板区B");
  await expect(panel).toContainText("目标板区：板区A");
  await expect(panel).toContainText("方向：北侧");
  await expect(panel).toContainText("拼接后将形成精确 0mm 共享板边");
  await panel.getByRole("button", { name: "确认拼接" }).click();

  await expect(page.locator("[data-near-miss]")).toHaveCount(0);
  await expect(page.getByText(/发生面积重叠/)).toHaveCount(0);
  await expect(page.locator('[data-atomic-boundary-id*="shared-slab"]').first()).toBeAttached();
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "b")?.y).toBe(3600);
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "b")?.x).toBe(0);
});

test("Floor Docking V1一键修复5mm Near Miss", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await setDraft(page, [
    { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "b", name: "板区B", type: "room", x: 0, y: 3605, width: 3600, height: 3600 },
  ], 0);
  // UI V3.1：Inspector 为 Overlay，一键修复需要展开（首块板区默认选中）。
  await page.evaluate(() => localStorage.setItem("floorWorkspaceInspectorOpen", "true"));
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.setItem("floorWorkspaceInspectorOpen", "true"));
  await page.reload();

  await expect(page.locator("[data-near-miss]")).toHaveCount(1);
  // UI V3.1：Inspector 为 Overlay（已设 floorWorkspaceInspectorOpen=true），首块板区默认选中。
  await page.getByRole("button", { name: "楼层设置" }).click();
  const suggestion = page.getByTestId("dock-suggestion-button");
  await expect(suggestion).toContainText("将板区B拼到板区A北侧");
  await suggestion.click();

  await expect(page.locator("[data-near-miss]")).toHaveCount(0);
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "b")?.y).toBe(3600);
});

test("Floor Docking V1冲突提示：与第三方重叠时禁止提交", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await setDraft(page, [
    { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "b", name: "板区B", type: "room", x: 0, y: 3605, width: 3600, height: 3600 },
    { id: "c", name: "板区C", type: "room", x: 200, y: 7000, width: 2000, height: 2000 },
  ], 0);
  await page.reload();

  await page.getByRole("button", { name: "拼接", exact: true }).click();
  await canvasSlab(page, "板区B").click();
  await canvasSlab(page, "板区A").click();
  await page.locator('[data-dock-side="north"]').dispatchEvent("pointerdown");
  const panel = page.getByTestId("dock-confirm-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("无法拼接");
  await expect(panel).toContainText("板区C");
  await expect(panel.getByRole("button", { name: "确认拼接" })).toBeDisabled();
  await panel.getByRole("button", { name: "取消" }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "b")?.y).toBe(3605);
});

test("Floor Docking V1多选对齐：左对齐统一X并显示位移确认", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await setDraft(page, [
    { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 3600, height: 3600 },
    { id: "b", name: "板区B", type: "room", x: 500, y: 4000, width: 2400, height: 3600 },
    { id: "c", name: "板区C", type: "room", x: 1200, y: 8000, width: 3000, height: 3600 },
  ], 0);
  await page.reload();

  await page.getByRole("button", { name: "多选对齐", exact: true }).click();
  await canvasSlab(page, "板区A").click();
  await canvasSlab(page, "板区B").click();
  await canvasSlab(page, "板区C").click();
  await expect(page.locator('[data-multi-selected="true"]')).toHaveCount(3);

  const bar = page.getByTestId("multi-align-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "左对齐" }).click();
  await expect(bar).toContainText("将移动 3 个板区，最大位移：1200mm");
  await bar.getByRole("button", { name: "确认对齐" }).click();

  await expect.poll(async () => (await savedSlabs(page)).every((slab) => slab.x === 0)).toBe(true);
});

test("Floor Docking V1 iPad触摸：拼接边命中区可点击", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/calculator/floor");
  await setDraft(page, [
    { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
    { id: "b", name: "板区B", type: "room", x: 0, y: 3605, width: 3600, height: 3600 },
  ], 0);
  await page.reload();

  await page.getByRole("button", { name: "拼接", exact: true }).click();
  await canvasSlab(page, "板区B").click();
  await canvasSlab(page, "板区A").click();
  const northSide = page.locator('[data-dock-side="north"]');
  await expect(northSide).toBeAttached();
  await northSide.dispatchEvent("pointerover");
  await northSide.dispatchEvent("pointerdown");
  await expect(page.getByTestId("dock-confirm-panel")).toBeVisible();
  await page.getByTestId("dock-confirm-panel").getByRole("button", { name: "确认拼接" }).click();
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "b")?.y).toBe(3600);
});
