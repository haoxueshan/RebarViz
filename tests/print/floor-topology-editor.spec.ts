import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";

async function installV3Workspace(
  page: Page,
  slabs: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>,
  connections: Array<Record<string, unknown>>,
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, slabs: slabData, connections: connData }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "clear-space-physical-v2",
        slabs: slabData.map((slab) => ({ ...slab, type: "room" })),
        openings: [],
        supportRules: [],
        connections: connData,
        innerWallThickness: 240,
        outerWallThickness: 240,
        snapDistanceMm: 1500,
        overlapToleranceMm: 10,
      },
    }));
    localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
    localStorage.setItem("floorNavigatorCollapsed", "false");
    sessionStorage.clear();
  }, { draftKey: DRAFT_KEY, slabs, connections });
  await page.reload();
}

async function savedDraft(page: Page): Promise<{
  slabs: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  connections: Array<{ id: string }>;
  coordinateModel: string;
}> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { slabs: [], connections: [], coordinateModel: "" };
    const state = (JSON.parse(raw) as { state?: { slabs?: unknown; connections?: unknown; coordinateModel?: string } }).state ?? {};
    return {
      slabs: (state.slabs as Array<{ id: string; x: number; y: number; width: number; height: number }>) ?? [],
      connections: (state.connections as Array<{ id: string }>) ?? [],
      coordinateModel: state.coordinateModel ?? "",
    };
  }, DRAFT_KEY);
}

const AB_CONNECTION = {
  id: "connection:a:east:b:west",
  a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
  b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
  source: "manual",
  confidence: "confirmed",
  tangentConstraint: { mode: "none" },
};

test.describe("Floor Topology V1.4A.2 V3 物理编辑器", () => {
  test("Connected Slab 拖离：预览提示断连，松手 Detach，一次 Undo 恢复", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);

    // V3 状态即为 Physical Canonical：Canvas data-physical-x 与 State 一致。
    const slabB = page.locator('rect[aria-label="选择板区 板区B"]');
    await expect(slabB).toHaveAttribute("data-net-x", "4240");
    await expect(slabB).toHaveAttribute("data-physical-x", "4240");
    const wallBefore = page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]');
    await expect(wallBefore).toHaveCount(1);

    const box = await slabB.boundingBox();
    expect(box).not.toBeNull();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    // 向左拖离约 100px（法向 Gap 破坏）：目标点保持在 Canvas 内部，避免 pointerup 落出 SVG。
    await page.mouse.move(centerX - 100, centerY, { steps: 6 });
    const preview = page.locator("[data-drag-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-v3-detach-count", "1");
    await expect(page.locator("[data-v3-detach-label]")).toContainText("释放后将断开 1 处连接");
    await page.mouse.move(centerX - 100, centerY);
    await page.mouse.up();

    // 松手：B 停留在新位置，Connection 被删除（Move + Detach 一个事务）。
    await expect.poll(async () => {
      const draft = await savedDraft(page);
      return draft.slabs.find((slab) => slab.id === "b")?.x;
    }).toBeLessThan(4240);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(0);
    const afterMove = await savedDraft(page);
    const movedB = afterMove.slabs.find((slab) => slab.id === "b")!;
    expect(movedB.x).toBeLessThan(4240);
    await expect(page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]')).toHaveCount(0);

    // 一次 Undo：位置 + Connection + 墙全部恢复。
    await page.getByRole("button", { name: "撤销" }).click();
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    await expect(page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]')).toHaveCount(1);
  });

  test("Resize auto：单侧 Connected 保持 Connected 侧固定，墙与邻板不移动", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);

    await page.locator('rect[aria-label="选择板区 板区A"]').click();
    const editor = page.getByTestId("floor-size-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("东西向净尺寸")).toHaveValue("4000");
    await editor.getByLabel("东西向净尺寸").fill("5000");
    // A 只连东侧 → auto 锚东边：A 向西扩展，B 与墙不动。
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "a")?.x).toBe(-1000);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
    await expect(page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]')).toHaveCount(1);
    const wallSupport = await page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]').first().getAttribute("data-boundary-support");
    expect(wallSupport).toBe("inner-wall");
  });

  test("Resize 双侧 Connected：提示选择固定边，确认后保持全部 Connection", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 3000, height: 3000 },
      { id: "b", name: "板区B", x: 3240, y: 0, width: 3000, height: 3000 },
      { id: "d", name: "板区D", x: 6480, y: 0, width: 3000, height: 3000 },
    ], [
      {
        id: "connection:a:east:b:west",
        a: { slabId: "a", side: "east", range: { mode: "auto-overlap" } },
        b: { slabId: "b", side: "west", range: { mode: "auto-overlap" } },
        source: "manual",
        confidence: "confirmed",
        tangentConstraint: { mode: "none" },
      },
      {
        id: "connection:b:east:d:west",
        a: { slabId: "b", side: "east", range: { mode: "auto-overlap" } },
        b: { slabId: "d", side: "west", range: { mode: "auto-overlap" } },
        source: "manual",
        confidence: "confirmed",
        tangentConstraint: { mode: "none" },
      },
    ]);

    await page.locator('rect[aria-label="选择板区 板区B"]').click();
    const editor = page.getByTestId("floor-size-editor");
    await expect(editor).toBeVisible();
    // 对话框：确定 = 固定西边。
    page.once("dialog", (dialog) => dialog.accept());
    await editor.getByLabel("东西向净尺寸").fill("4000");
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.width).toBe(4000);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(3240);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "d")?.x).toBe(7480);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(2);
  });

  test("新增板区：V3 使用 Physical Clear Bounds（maxX=7240 → 新板 x=7740）", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);

    await page.getByRole("button", { name: "新增板区" }).click();
    await expect.poll(async () => (await savedDraft(page)).slabs.length).toBe(3);
    const draft = await savedDraft(page);
    const added = draft.slabs.find((slab) => slab.id !== "a" && slab.id !== "b")!;
    expect(added.x).toBe(7740);
    expect(added.y).toBe(0);
    // 新板没有 Connection。
    expect(draft.connections.length).toBe(1);
  });
});
