import { expect, test, type Page } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";

async function installV3Workspace(
  page: Page,
  slabs: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }>,
  connections: Array<Record<string, unknown>>,
  openings: Array<{ id: string; name: string; x: number; y: number; width: number; height: number }> = [],
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, slabs: slabData, connections: connData, openings: openingData }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "clear-space-physical-v2",
        slabs: slabData.map((slab) => ({ ...slab, type: "room" })),
        openings: openingData.map((item) => ({ ...item, type: "stair" })),
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
  }, { draftKey: DRAFT_KEY, slabs, connections, openings });
  await page.reload();
}

async function savedDraft(page: Page): Promise<{
  slabs: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  openings: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  connections: Array<{ id: string }>;
  coordinateModel: string;
}> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { slabs: [], openings: [], connections: [], coordinateModel: "" };
    const state = (JSON.parse(raw) as { state?: { slabs?: unknown; openings?: unknown; connections?: unknown; coordinateModel?: string } }).state ?? {};
    return {
      slabs: (state.slabs as Array<{ id: string; x: number; y: number; width: number; height: number }>) ?? [],
      openings: (state.openings as Array<{ id: string; x: number; y: number; width: number; height: number }>) ?? [],
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
    await editor.getByLabel("东西向净尺寸").press("Enter");
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
    // 对话框：固定西边（三态 Modal）。
    await editor.getByLabel("东西向净尺寸").fill("4000");
    await editor.getByLabel("东西向净尺寸").press("Enter");
    const modal = page.getByTestId("resize-anchor-modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "固定西边" }).click();
    await expect(modal).toHaveCount(0);
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

  test("Opening 跟随拖动：拖 B +1000mm，Hosted Opening 同步 +1000，一次 Undo 一起恢复", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION], [
      { id: "o-b", name: "楼梯间", x: 4740, y: 500, width: 800, height: 800 },
    ]);

    const slabB = page.locator('rect[aria-label="选择板区 板区B"]');
    const box = await slabB.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    // 向右拖离（保持在 Canvas 内部，避免 pointerup 落出 SVG）。
    await page.mouse.move(centerX + 60, centerY, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(0);
    const after = await savedDraft(page);
    const bAfter = after.slabs.find((slab) => slab.id === "b")!;
    const openingAfter = after.openings[0];
    expect(bAfter.x).toBeGreaterThan(4240);
    expect(openingAfter.x - bAfter.x).toBeCloseTo(500, 5);
    expect(openingAfter.y).toBe(500);
    expect(openingAfter.width).toBe(800);

    // 一次 Undo：Slab + Opening + Connection 一起恢复。
    await page.getByRole("button", { name: "撤销" }).click();
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    const restored = await savedDraft(page);
    expect(restored.openings[0].x).toBe(4740);
  });

  test("墙厚修改 rematerialize：240→300 后 B.x=4300，Opening 跟随 +60", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION], [
      { id: "o-b", name: "楼梯间", x: 4740, y: 500, width: 1000, height: 1000 },
    ]);
    const thickness = page.getByLabel("内墙厚度");
    await expect(thickness).toHaveAttribute("data-commit-mode", "blur-enter");
    await thickness.fill("300");
    await thickness.press("Enter");
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4300);
    const draft = await savedDraft(page);
    expect(draft.openings[0].x).toBe(4800);
    expect(draft.connections.length).toBe(1);
    await expect(page.locator('[aria-label="选择板区 板区B"]')).toHaveAttribute("data-physical-x", "4300");
    await expect(page.locator('svg[aria-label*="整层板区"] [data-wall-kind="inner-wall"]').first()).toHaveAttribute("data-wall-thickness-mm", "300");
  });

  test("Support 切换 rematerialize：内墙→连续 B.x=4000；再切回 B.x=4240 墙恢复", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);

    await page.locator('rect[aria-label="选择板区 板区A"]').click();
    await page.getByRole("tab", { name: "边界" }).click();
    const wall = page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]').first();
    await wall.click();
    await page.getByRole("button", { name: "连续楼板", exact: true }).click();
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4000);
    await expect(page.locator('[data-atomic-boundary-id*="atomic:v3:connection:a:east:b:west"]')).toHaveCount(1);
    await expect(page.locator('svg[aria-label*="整层板区"] [data-wall-kind="inner-wall"]')).toHaveCount(0);
    // 切回内墙。
    await page.getByRole("button", { name: "内墙", exact: true }).click();
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    await expect(page.locator('svg[aria-label*="整层板区"] [data-wall-kind="inner-wall"]').first()).toHaveAttribute("data-wall-thickness-mm", "240");
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
  });

  test("Resize blur/enter 单次提交：输入 5000 只产生一次正式修改", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);

    await page.locator('rect[aria-label="选择板区 板区A"]').click();
    const editor = page.getByTestId("floor-size-editor");
    const width = editor.getByLabel("东西向净尺寸");
    await expect(width).toHaveAttribute("data-commit-mode", "blur-enter");
    await width.fill("5000");
    // 未提交：仍是 4000。
    await expect(page.locator('[aria-label="选择板区 板区A"]')).toHaveAttribute("data-net-x", "0");
    await width.press("Enter");
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "a")?.width).toBe(5000);
    // 一次 Undo 恢复 4000（不是四次 History）。
    await page.getByRole("button", { name: "撤销" }).click();
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "a")?.width).toBe(4000);
  });

  test("Mouse Jitter（约 27mm）保留 Connection：松手 Gap 拉回正式 240", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const slabB = page.locator('rect[aria-label="选择板区 板区B"]');
    const box = await slabB.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 2, centerY, { steps: 2 });
    // Editor Detach 容差（30mm）内：不显示断连提示。
    await expect(page.locator("[data-drag-preview]")).toHaveAttribute("data-v3-detach-count", "0");
    await page.mouse.up();
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
  });

  test("Resize 双侧连接 Modal：取消修改不改任何数据", async ({ page }) => {
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
    await editor.getByLabel("东西向净尺寸").fill("4000");
    await editor.getByLabel("东西向净尺寸").press("Enter");
    const modal = page.getByTestId("resize-anchor-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "固定西边" })).toBeVisible();
    await expect(modal.getByRole("button", { name: "固定东边" })).toBeVisible();
    await modal.getByRole("button", { name: "取消修改" }).click();
    await expect(modal).toHaveCount(0);
    const draft = await savedDraft(page);
    expect(draft.slabs.find((slab) => slab.id === "b")?.width).toBe(3000);
    expect(draft.slabs.find((slab) => slab.id === "b")?.x).toBe(3240);
    expect(draft.slabs.find((slab) => slab.id === "d")?.x).toBe(6480);
    expect(draft.connections.length).toBe(2);
  });

  test("V3 Inspector 文案：显示净空物理坐标说明", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const copy = page.getByTestId("floor-coordinate-model-copy");
    await expect(copy).toContainText("净空物理坐标");
    await expect(copy).not.toContainText("净跨拓扑坐标");
  });
});

test.describe("Floor Topology V1.4A.2.1 Touch 编辑器容错", () => {
  test.use({ hasTouch: true, isMobile: true });

  async function touchDrag(page: Page, slabName: string, deltaX: number, deltaY: number) {
    const rect = page.locator(`rect[aria-label="选择板区 ${slabName}"]`);
    const box = await rect.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await rect.dispatchEvent("pointerdown", { pointerId: 71, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
    const svg = page.locator("svg[data-floor-canvas-fit]");
    await svg.dispatchEvent("pointermove", { pointerId: 71, pointerType: "touch", buttons: 1, clientX: cx + deltaX, clientY: cy + deltaY, bubbles: true });
    return { svg, pointerId: 71, endX: cx + deltaX, endY: cy + deltaY };
  }

  test("Tap 不 Detach", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const rect = page.locator('rect[aria-label="选择板区 板区B"]');
    const box = await rect.boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await rect.dispatchEvent("pointerdown", { pointerId: 70, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
    await rect.dispatchEvent("pointerup", { pointerId: 70, pointerType: "touch", isPrimary: true, buttons: 0, clientX: cx, clientY: cy, bubbles: true });
    await page.waitForTimeout(350);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
    expect((await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
  });

  test("Touch 微抖（低于拖动激活阈值）不 Detach", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const drag = await touchDrag(page, "板区B", 6, 4);
    await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
    await drag.svg.dispatchEvent("pointerup", { pointerId: drag.pointerId, pointerType: "touch", buttons: 0, clientX: drag.endX, clientY: drag.endY, bubbles: true });
    await page.waitForTimeout(350);
    expect((await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    expect((await savedDraft(page)).connections.length).toBe(1);
  });

  test("沿墙滑动保持 Connection", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 3000, height: 4000 },
      { id: "b", name: "板区B", x: 3240, y: 0, width: 2000, height: 2000 },
    ], [AB_CONNECTION]);
    const drag = await touchDrag(page, "板区B", 0, 120);
    await drag.svg.dispatchEvent("pointerup", { pointerId: drag.pointerId, pointerType: "touch", buttons: 0, clientX: drag.endX, clientY: drag.endY, bubbles: true });
    // 沿墙（法向不变）滑动：Y 改变，X 被 Materialize 拉回正式 Gap，Connection 保留。
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.y).not.toBe(0);
    await expect.poll(async () => (await savedDraft(page)).slabs.find((slab) => slab.id === "b")?.x).toBe(3240);
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(1);
  });

  test("明显拖离 Detach", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const drag = await touchDrag(page, "板区B", 100, 0);
    await expect(page.locator("[data-drag-preview]")).toHaveAttribute("data-v3-detach-count", "1");
    await drag.svg.dispatchEvent("pointerup", { pointerId: drag.pointerId, pointerType: "touch", buttons: 0, clientX: drag.endX, clientY: drag.endY, bubbles: true });
    await expect.poll(async () => (await savedDraft(page)).connections.length).toBe(0);
  });

  test("PointerCancel 不修改任何数据", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const drag = await touchDrag(page, "板区B", 100, 0);
    await drag.svg.dispatchEvent("pointercancel", { pointerId: drag.pointerId, pointerType: "touch", buttons: 0, clientX: drag.endX, clientY: drag.endY, bubbles: true });
    await page.waitForTimeout(350);
    const draft = await savedDraft(page);
    expect(draft.slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    expect(draft.connections.length).toBe(1);
  });

  test("Pinch 取消 Detach Preview，Connection 与位置不变", async ({ page }) => {
    await installV3Workspace(page, [
      { id: "a", name: "板区A", x: 0, y: 0, width: 4000, height: 3000 },
      { id: "b", name: "板区B", x: 4240, y: 0, width: 3000, height: 3000 },
    ], [AB_CONNECTION]);
    const drag = await touchDrag(page, "板区B", 100, 0);
    await expect(page.locator("[data-drag-preview]")).toHaveAttribute("data-v3-detach-count", "1");
    // 第二指加入 → 升级为 Pinch：Detach Preview 取消。
    await drag.svg.dispatchEvent("pointerdown", { pointerId: 72, pointerType: "touch", isPrimary: false, buttons: 1, clientX: drag.endX + 120, clientY: drag.endY, bubbles: true });
    await drag.svg.dispatchEvent("pointermove", { pointerId: 71, pointerType: "touch", buttons: 1, clientX: drag.endX - 40, clientY: drag.endY, bubbles: true });
    await drag.svg.dispatchEvent("pointermove", { pointerId: 72, pointerType: "touch", buttons: 1, clientX: drag.endX + 200, clientY: drag.endY, bubbles: true });
    await drag.svg.dispatchEvent("pointerup", { pointerId: 71, pointerType: "touch", buttons: 0, clientX: drag.endX - 40, clientY: drag.endY, bubbles: true });
    await drag.svg.dispatchEvent("pointerup", { pointerId: 72, pointerType: "touch", buttons: 0, clientX: drag.endX + 200, clientY: drag.endY, bubbles: true });
    await page.waitForTimeout(350);
    const draft = await savedDraft(page);
    expect(draft.slabs.find((slab) => slab.id === "b")?.x).toBe(4240);
    expect(draft.connections.length).toBe(1);
  });
});
