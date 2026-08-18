import { expect, test, type Page } from "@playwright/test";
import { incompleteMengPlan3 } from "../../src/lib/__fixtures__/floor-topology-plan3-incomplete-meng";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";

async function installIncompleteMeng(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ key, plan }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 3, savedAt: new Date().toISOString(), state: plan }));
    localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
    sessionStorage.clear();
  }, { key: DRAFT_KEY, plan: incompleteMengPlan3() });
  await page.reload();
}

async function savedPlan(page: Page): Promise<{
  connections: Array<{ id: string }>;
  slabs: Array<{ id: string; x: number; y: number; width: number; height: number }>;
}> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").state, DRAFT_KEY);
}

async function openRepairDialog(page: Page) {
  await page.getByTestId("status-issues-button").click();
  const issueCenter = page.getByTestId("floor-issue-center");
  await expect(issueCenter).toContainText("当前楼层存在3个互不连接的楼板组合");
  await issueCenter.getByTestId("floor-topology-repair-open").click();
  const dialog = page.getByTestId("floor-topology-repair-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Floor Topology V1.4B.0 missing connection repair", () => {
  test("repairs four Meng candidates in one history step and supports undo/redo", async ({ page }) => {
    await installIncompleteMeng(page);
    const dialog = await openRepairDialog(page);
    await expect(dialog.getByTestId("floor-topology-repair-candidate")).toHaveCount(4);
    await expect(dialog).toContainText("板区D 东侧 ↔ 板区C 西侧");
    await expect(dialog).toContainText("板区K 东侧 ↔ 板区C 西侧");
    await expect(dialog).toContainText("板区K 东侧 ↔ 板区L 西侧");
    await expect(dialog).toContainText("板区C 南侧 ↔ 板区L 北侧");
    await expect(dialog.getByText("待确认")).toHaveCount(4);
    await expect(dialog.getByRole("button", { name: "应用修复" })).toBeDisabled();

    const rowInnerButton = dialog.getByTestId("floor-topology-repair-candidate").first().getByRole("button", { name: "内墙 240" });
    expect((await rowInnerButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.getByRole("button", { name: "全部设为内墙 240" }).click();
    await expect(dialog.getByText("待确认")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "应用修复" })).toBeEnabled();
    await dialog.getByRole("button", { name: "应用修复" }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(async () => (await savedPlan(page)).connections.length).toBe(12);
    const repaired = await savedPlan(page);
    expect(repaired.slabs.find((slab) => slab.id === "meng-c")?.x).toBe(6074);
    expect(repaired.slabs.find((slab) => slab.id === "meng-l")?.x).toBe(6074);
    const c = repaired.slabs.find((slab) => slab.id === "meng-c")!;
    const l = repaired.slabs.find((slab) => slab.id === "meng-l")!;
    expect(c.y - (l.y + l.height)).toBe(240);

    await expect(page.getByTestId("status-issues-button")).toHaveCount(0);
    await page.getByLabel("查看地筋问题").click();
    await expect(page.getByTestId("floor-issue-center")).not.toContainText("互不连接的楼板组合");
    await expect(page.getByTestId("floor-issue-center")).toContainText("地筋计算模块尚未完成V1.4连接路径迁移");
    await page.getByRole("button", { name: "关闭问题中心", exact: true }).click();

    await page.getByRole("button", { name: "撤销" }).click();
    await expect.poll(async () => (await savedPlan(page)).connections.length).toBe(8);
    await page.getByTestId("status-issues-button").click();
    await expect(page.getByTestId("floor-issue-center")).toContainText("当前楼层存在3个互不连接的楼板组合");
    await page.getByRole("button", { name: "关闭问题中心", exact: true }).click();

    await page.getByRole("button", { name: "重做" }).click();
    await expect.poll(async () => (await savedPlan(page)).connections.length).toBe(12);
  });

  test("cancel and Escape leave Plan and history unchanged", async ({ page }) => {
    await installIncompleteMeng(page);
    let dialog = await openRepairDialog(page);
    await dialog.getByRole("button", { name: "全部设为内墙 240" }).click();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await savedPlan(page)).connections).toHaveLength(8);
    await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();

    dialog = await openRepairDialog(page);
    await dialog.getByRole("button", { name: "全部设为内墙 240" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect((await savedPlan(page)).connections).toHaveLength(8);
    await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  });

  test("phone dialog stays within the viewport and keeps 44px decision targets", async ({ page }) => {
    await installIncompleteMeng(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openRepairDialog(page);
    const panel = dialog.getByRole("dialog");
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    const firstRow = dialog.getByTestId("floor-topology-repair-candidate").first();
    for (const name of ["内墙 240", "连续楼板", "忽略"]) {
      expect((await firstRow.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
