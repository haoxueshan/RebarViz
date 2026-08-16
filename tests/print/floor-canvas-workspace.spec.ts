import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

async function savedSlabs(page: import("@playwright/test").Page): Promise<Array<{ id: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
    return record.state?.slabs ?? [];
  }, DRAFT_KEY);
}

test("桌面默认Canvas First：Inspector收起，展开/收起持久化（PRD 12-14）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorInspectorCollapsed");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 无用户设置：桌面首次 Canvas First，Inspector 默认收起。
  const canvas = page.locator("[data-testid='floor-canvas-card']");
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  await expect(page.getByTestId("collapse-inspector-handle")).toHaveCount(0);
  const before = await canvas.boundingBox();
  expect(before).not.toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("true");
  // 展开 Inspector → Canvas 变窄（Split），并持久化。
  await page.getByTestId("open-inspector-handle").click();
  await expect(page.getByTestId("collapse-inspector-handle")).toBeVisible();
  const after = await canvas.boundingBox();
  expect(after).not.toBeNull();
  expect(before!.width).toBeGreaterThan(after!.width + 200);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("false");
  await page.reload();
  await expect(page.getByTestId("collapse-inspector-handle")).toBeVisible();
  await page.getByTestId("collapse-inspector-handle").click();
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("true");
});

test("Fullscreen：进入隐藏页面组件，退出恢复且FloorPlan不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const heading = page.getByRole("heading", { name: "整层楼板板筋系统" });
  await expect(heading).toBeVisible();
  // 先放大到125%，验证Fullscreen进入/退出保持Viewport（PRD 70）。
  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  await page.getByRole("button", { name: "全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toBeVisible();
  await expect(heading).toHaveCount(0);
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  await page.getByRole("button", { name: "退出全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
});

test("Zoom按钮改变缩放百分比且不修改FloorPlan坐标", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const percent = page.getByTestId("canvas-zoom-percent");
  await expect(percent).toHaveText("100%");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(percent).toHaveText("125%");
  await page.getByRole("button", { name: "放大" }).click();
  await expect(percent).not.toHaveText("125%");
  await page.getByRole("button", { name: "缩小" }).click();
  await page.getByRole("button", { name: "缩小" }).click();
  await expect(percent).toHaveText("100%");
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
});

test("拖动只在松手提交一次正式坐标，Undo一步直接回到起点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.setItem("floorInspectorCollapsed", "false"));
  await page.reload();

  const slab = page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await slab.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await slab.dispatchEvent("pointerdown", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX + 120, clientY: startY, bubbles: true });
  // 拖动中正式坐标保持旧值，只渲染预览。
  await expect(page.locator("[data-drag-preview]")).toHaveCount(1);
  await expect(page.getByLabel("西南角 X")).toHaveValue("0");
  await svg.dispatchEvent("pointerup", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 0, clientX: startX + 120, clientY: startY, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  // PRD 72-3：PointerUp 后旧 RAF 不得回弹 Preview。
  await page.waitForTimeout(150);
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  await expect.poll(async () => {
    const slabs = await savedSlabs(page);
    return slabs[0]?.x ?? 0;
  }).toBeGreaterThan(0);

  const movedX = (await savedSlabs(page))[0]?.x;
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(0);
  // PRD 26/75：一次拖动 = 一个Undo Step，撤销后不再有可撤销的历史。
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  await page.getByRole("button", { name: "重做" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(movedX);
});

test("iPad横屏：工具栏与全屏可用且拖空白平移不修改几何", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await expect(page.getByTestId("floor-canvas-toolbar")).toBeVisible();
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  // 空白处拖动平移（Pan）。
  await svg.dispatchEvent("pointerdown", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box!.x + 30, clientY: box!.y + 30, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 1, clientX: box!.x + 90, clientY: box!.y + 70, bubbles: true });
  await svg.dispatchEvent("pointerup", { pointerId: 61, pointerType: "touch", isPrimary: true, buttons: 0, clientX: box!.x + 90, clientY: box!.y + 70, bubbles: true });
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
  // 全屏进入与退出。
  await page.getByRole("button", { name: "全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toBeVisible();
  await page.getByRole("button", { name: "退出全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toHaveCount(0);
});

async function savedOpenings(page: import("@playwright/test").Page): Promise<Array<{ id: string; x: number; y: number }>> {
  return page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
    return record.state?.openings ?? [];
  }, DRAFT_KEY);
}

/**
 * 世界位移 → 屏幕位移的精确换算：
 * 使用SVG属性几何（不含描边/letterbox污染），与FloorCanvas的pxPerWorld完全一致。
 */
async function worldDeltaToScreen(
  page: import("@playwright/test").Page,
  slab: import("@playwright/test").Locator,
  worldWidthMm: number,
  worldHeightMm: number,
  dxWorld: number,
  dyWorld: number,
): Promise<{ dxPx: number; dyPx: number }> {
  const geom = await slab.evaluate((element) => ({
    viewWidth: Number(element.getAttribute("width")),
    viewHeight: Number(element.getAttribute("height")),
  }));
  const svgBox = await page.locator("svg[data-floor-canvas-fit]").boundingBox();
  const contentWidth = Math.min(svgBox!.width, svgBox!.height * 1000 / 650);
  const contentHeight = Math.min(svgBox!.height, svgBox!.width * 650 / 1000);
  return {
    // 世界+X=屏幕右，世界+Y=屏幕上（SVG坐标Y向上）。
    dxPx: dxWorld * (geom.viewWidth / worldWidthMm) * (contentWidth / 1000),
    dyPx: -dyWorld * (geom.viewHeight / worldHeightMm) * (contentHeight / 650),
  };
}

test("Pinch双指缩放：两指加入后缩放，抬起一指保留另一指Pan", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  const baseX = box!.x + 40;
  const baseY = box!.y + 40;
  const percent = page.getByTestId("canvas-zoom-percent");
  await expect(percent).toHaveText("100%");
  // 两根手指按下（不覆盖彼此，PRD 3-5）。
  await svg.dispatchEvent("pointerdown", { pointerId: 71, pointerType: "touch", isPrimary: true, buttons: 1, clientX: baseX, clientY: baseY, bubbles: true });
  await svg.dispatchEvent("pointerdown", { pointerId: 72, pointerType: "touch", isPrimary: false, buttons: 1, clientX: baseX + 80, clientY: baseY, bubbles: true });
  // 双指张开。
  await svg.dispatchEvent("pointermove", { pointerId: 71, pointerType: "touch", buttons: 1, clientX: baseX - 60, clientY: baseY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 72, pointerType: "touch", buttons: 1, clientX: baseX + 140, clientY: baseY, bubbles: true });
  await expect(percent).not.toHaveText("100%");
  // 一根抬起后剩余指针继续Pan，zoom保持不变（PRD 8）。
  await svg.dispatchEvent("pointerup", { pointerId: 72, pointerType: "touch", buttons: 0, clientX: baseX + 140, clientY: baseY, bubbles: true });
  const zoomAfterLift = await percent.textContent();
  const centerBefore = Number(await svg.getAttribute("data-viewport-center-x"));
  await svg.dispatchEvent("pointermove", { pointerId: 71, pointerType: "touch", buttons: 1, clientX: baseX - 20, clientY: baseY, bubbles: true });
  await expect.poll(async () => Number(await svg.getAttribute("data-viewport-center-x"))).not.toBe(centerBefore);
  expect(await percent.textContent()).toBe(zoomAfterLift);
  await svg.dispatchEvent("pointerup", { pointerId: 71, pointerType: "touch", buttons: 0, clientX: baseX - 20, clientY: baseY, bubbles: true });
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
});

test("单指Pan增量无漂移且不修改FloorPlan（PRD 68）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + 30;
  const cy = box!.y + 30;
  const readCenter = () => svg.getAttribute("data-viewport-center-x").then(Number);
  const start = await readCenter();
  // 手势A：两次30px增量。
  await svg.dispatchEvent("pointerdown", { pointerId: 81, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 81, pointerType: "touch", buttons: 1, clientX: cx + 30, clientY: cy, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 81, pointerType: "touch", buttons: 1, clientX: cx + 60, clientY: cy, bubbles: true });
  await expect.poll(async () => await readCenter()).not.toBe(start);
  const afterTwo = await readCenter();
  await svg.dispatchEvent("pointerup", { pointerId: 81, pointerType: "touch", buttons: 0, clientX: cx + 60, clientY: cy, bubbles: true });
  // 手势B：单次60px，位移应与手势A一致（增量Pan无累计漂移）。
  await svg.dispatchEvent("pointerdown", { pointerId: 82, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 82, pointerType: "touch", buttons: 1, clientX: cx + 60, clientY: cy, bubbles: true });
  await expect.poll(async () => await readCenter()).not.toBe(afterTwo);
  const afterSixty = await readCenter();
  await svg.dispatchEvent("pointerup", { pointerId: 82, pointerType: "touch", buttons: 0, clientX: cx + 60, clientY: cy, bubbles: true });
  const deltaA = start - afterTwo;
  const deltaB = afterTwo - afterSixty;
  expect(deltaA).toBeGreaterThan(0);
  expect(deltaA).toBeCloseTo(deltaB, 6);
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("100%");
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0, width: 4200, height: 3600 });
});

test("Quick Dock：拖近共边松手精确0mm、一次Undo回原点（PRD 72/75）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 2000, height: 2000 },
          { id: "b", name: "板区B", type: "room", x: 3000, y: 0, width: 2000, height: 2000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slabA = page.locator('rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const boxA = await slabA.boundingBox();
  expect(boxA).not.toBeNull();
  // 目标：A西边 == B东边 → dock east → A.x = 5000（由floor-docking计算）。
  const { dxPx, dyPx } = await worldDeltaToScreen(page, slabA, 2000, 2000, 5000, 0);
  const startX = boxA!.x + boxA!.width / 2;
  const startY = boxA!.y + boxA!.height / 2;
  await slabA.dispatchEvent("pointerdown", { pointerId: 51, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 51, pointerType: "mouse", buttons: 1, clientX: startX + dxPx, clientY: startY + dyPx, bubbles: true });
  await expect(page.locator("[data-drag-guide]")).toHaveCount(1);
  await expect(page.locator("[data-drag-guide]")).toContainText("精确共边");
  await svg.dispatchEvent("pointerup", { pointerId: 51, pointerType: "mouse", buttons: 0, clientX: startX + dxPx, clientY: startY + dyPx, bubbles: true });
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.x ?? 0).toBe(5000);
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.y ?? 0).toBe(0);
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.x ?? 0).toBe(0);
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  await page.getByRole("button", { name: "重做" }).click();
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.x ?? 0).toBe(5000);
});

test("Quick Dock不经过二次普通Snap：preserve的X保持自由拖动值（PRD 73）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 1000, y: 0, width: 2000, height: 2000 },
          { id: "b", name: "板区B", type: "room", x: 0, y: 3000, width: 2000, height: 2000 },
          { id: "c", name: "板区C", type: "room", x: 1650, y: 7050, width: 2000, height: 2000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slabA = page.locator('rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const boxA = await slabA.boundingBox();
  expect(boxA).not.toBeNull();
  // 拖到 free (x=1500, y=5000)：y方向dock到B北侧精确共边；
  // 普通Snap会把x吸附到C的1650候选，Quick Dock必须保持1500。
  const { dxPx, dyPx } = await worldDeltaToScreen(page, slabA, 2000, 2000, 500, 5000);
  const startX = boxA!.x + boxA!.width / 2;
  const startY = boxA!.y + boxA!.height / 2;
  await slabA.dispatchEvent("pointerdown", { pointerId: 52, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 52, pointerType: "mouse", buttons: 1, clientX: startX + dxPx, clientY: startY + dyPx, bubbles: true });
  await expect(page.locator("[data-drag-guide]")).toHaveCount(1);
  await svg.dispatchEvent("pointerup", { pointerId: 52, pointerType: "mouse", buttons: 0, clientX: startX + dxPx, clientY: startY + dyPx, bubbles: true });
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.x ?? 0).toBe(1500);
  await expect.poll(async () => (await savedSlabs(page)).find((slab) => slab.id === "a")?.y ?? 0).toBe(5000);
});

test("仅洞口的Undo/Redo恢复Selection为opening类型（PRD 76）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [],
        openings: [{ id: "o1", name: "楼梯间", type: "stair", x: 0, y: 0, width: 900, height: 900 }],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const opening = page.locator('rect[aria-label="选择洞口 楼梯间"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await opening.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await opening.dispatchEvent("pointerdown", { pointerId: 53, pointerType: "mouse", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 53, pointerType: "mouse", buttons: 1, clientX: startX + 80, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointerup", { pointerId: 53, pointerType: "mouse", buttons: 0, clientX: startX + 80, clientY: startY, bubbles: true });
  await expect.poll(async () => (await savedOpenings(page))[0]?.x ?? 0).toBeGreaterThan(0);
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await savedOpenings(page))[0]?.x ?? 0).toBe(0);
  // Selection kind 必须恢复为 opening，Inspector显示洞口编辑器。
  await expect(page.getByTestId("floor-workspace-inspector")).toContainText("楼梯间");
  await expect(page.getByTestId("floor-size-editor")).toBeVisible();
});

test("平板首次访问默认Canvas First，展开编辑为Overlay且不压缩Canvas（PRD 29-33）", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorInspectorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 无用户设置时平板默认收起Inspector（Canvas First）。
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorInspectorCollapsed"))).toBe("true");
  const canvas = page.getByTestId("floor-canvas-card");
  const grid = page.getByTestId("floor-workspace-grid");
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const before = await canvas.boundingBox();
  const gridBox = await grid.boundingBox();
  const svgBox = await svg.boundingBox();
  expect(before).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect(svgBox).not.toBeNull();
  expect(before!.width).toBeGreaterThan(gridBox!.width * 0.9);
  // PRD 79：平板画布高度明显提升（≥540px）。
  expect(svgBox!.height).toBeGreaterThanOrEqual(540);
  // 展开编辑 → Overlay Drawer，Canvas宽度不变。
  await page.getByRole("button", { name: "展开编辑" }).click();
  await expect(inspector).toBeVisible();
  const after = await canvas.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
});

test.describe("触摸设备", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("平板工具栏主要按钮触摸尺寸≥44px（PRD 80）", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();
    const box = await page.getByRole("button", { name: "移动" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test("高频PointerMove连续5次Pan不丢增量（PRD 72）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + 30;
  const cy = box!.y + 30;
  const readCenter = () => svg.getAttribute("data-viewport-center-x").then(Number);
  const start = await readCenter();
  // 同一帧内连续5次+20px，不等待RAF（模拟高频Pointer事件）。
  await svg.dispatchEvent("pointerdown", { pointerId: 85, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
  for (const step of [1, 2, 3, 4, 5]) {
    await svg.dispatchEvent("pointermove", { pointerId: 85, pointerType: "touch", buttons: 1, clientX: cx + step * 20, clientY: cy, bubbles: true });
  }
  await expect.poll(async () => await readCenter()).not.toBe(start);
  const afterBurst = await readCenter();
  await svg.dispatchEvent("pointerup", { pointerId: 85, pointerType: "touch", buttons: 0, clientX: cx + 100, clientY: cy, bubbles: true });
  // 对照：单次+100px，位移应与连续5次完全一致。
  await svg.dispatchEvent("pointerdown", { pointerId: 86, pointerType: "touch", isPrimary: true, buttons: 1, clientX: cx, clientY: cy, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 86, pointerType: "touch", buttons: 1, clientX: cx + 100, clientY: cy, bubbles: true });
  await expect.poll(async () => await readCenter()).not.toBe(afterBurst);
  const afterSingle = await readCenter();
  await svg.dispatchEvent("pointerup", { pointerId: 86, pointerType: "touch", buttons: 0, clientX: cx + 100, clientY: cy, bubbles: true });
  const deltaBurst = start - afterBurst;
  const deltaSingle = afterBurst - afterSingle;
  expect(deltaBurst).toBeGreaterThan(0);
  expect(deltaBurst).toBeCloseTo(deltaSingle, 5);
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
});

test("PointerCancel不恢复过期Drag Preview（PRD 72-3/89）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slab = page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await slab.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await slab.dispatchEvent("pointerdown", { pointerId: 87, pointerType: "touch", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 87, pointerType: "touch", buttons: 1, clientX: startX + 80, clientY: startY + 20, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(1);
  await svg.dispatchEvent("pointercancel", { pointerId: 87, pointerType: "touch", buttons: 0, clientX: startX + 80, clientY: startY + 20, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  // 等待两帧后仍不得出现旧RAF回弹的Ghost。
  await page.waitForTimeout(150);
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
});

test("Slab上双指Pinch：第一指落板区、第二指落空白，升级为缩放且不移动板区（PRD 43）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slabA = page.locator('rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const boxA = await slabA.boundingBox();
  const boxS = await svg.boundingBox();
  expect(boxA).not.toBeNull();
  expect(boxS).not.toBeNull();
  const percent = page.getByTestId("canvas-zoom-percent");
  await expect(percent).toHaveText("100%");
  // finger1 落板区（touch）→ 进入拖动预览；finger2 落空白 → 升级为 Pinch。
  await slabA.dispatchEvent("pointerdown", { pointerId: 91, pointerType: "touch", isPrimary: true, buttons: 1, clientX: boxA!.x + boxA!.width / 2, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await svg.dispatchEvent("pointerdown", { pointerId: 92, pointerType: "touch", isPrimary: false, buttons: 1, clientX: boxS!.x + 30, clientY: boxS!.y + 30, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  // 双指拉开。
  await svg.dispatchEvent("pointermove", { pointerId: 91, pointerType: "touch", buttons: 1, clientX: boxA!.x - 60, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 92, pointerType: "touch", buttons: 1, clientX: boxS!.x + 90, clientY: boxS!.y + 30, bubbles: true });
  await expect(percent).not.toHaveText("100%");
  await svg.dispatchEvent("pointerup", { pointerId: 91, pointerType: "touch", buttons: 0, clientX: boxA!.x - 60, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await svg.dispatchEvent("pointerup", { pointerId: 92, pointerType: "touch", buttons: 0, clientX: boxS!.x + 90, clientY: boxS!.y + 30, bubbles: true });
  await page.waitForTimeout(400);
  // 板区完全不变，且被取消的拖动不产生任何History（PRD 46）。
  const slabs = await savedSlabs(page);
  expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
});

test("两指都落在Slab区域也升级Pinch（PRD 44）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 2000, height: 2000 },
          { id: "b", name: "板区B", type: "room", x: 3000, y: 0, width: 2000, height: 2000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
    localStorage.setItem("floorInspectorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slabA = page.locator('rect[aria-label="选择板区 板区A"]');
  const slabB = page.locator('rect[aria-label="选择板区 板区B"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const boxA = await slabA.boundingBox();
  const boxB = await slabB.boundingBox();
  expect(boxA).not.toBeNull();
  expect(boxB).not.toBeNull();
  const percent = page.getByTestId("canvas-zoom-percent");
  await expect(percent).toHaveText("100%");
  await slabA.dispatchEvent("pointerdown", { pointerId: 93, pointerType: "touch", isPrimary: true, buttons: 1, clientX: boxA!.x + boxA!.width / 2, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await slabB.dispatchEvent("pointerdown", { pointerId: 94, pointerType: "touch", isPrimary: false, buttons: 1, clientX: boxB!.x + boxB!.width / 2, clientY: boxB!.y + boxB!.height / 2, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
  // 双指拉开。
  await svg.dispatchEvent("pointermove", { pointerId: 93, pointerType: "touch", buttons: 1, clientX: boxA!.x - 60, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 94, pointerType: "touch", buttons: 1, clientX: boxB!.x + boxB!.width + 40, clientY: boxB!.y + boxB!.height / 2, bubbles: true });
  await expect(percent).not.toHaveText("100%");
  await svg.dispatchEvent("pointerup", { pointerId: 93, pointerType: "touch", buttons: 0, clientX: boxA!.x - 60, clientY: boxA!.y + boxA!.height / 2, bubbles: true });
  await svg.dispatchEvent("pointerup", { pointerId: 94, pointerType: "touch", buttons: 0, clientX: boxB!.x + boxB!.width + 40, clientY: boxB!.y + boxB!.height / 2, bubbles: true });
  await page.waitForTimeout(400);
  const slabs = await savedSlabs(page);
  expect(slabs.find((slab) => slab.id === "a")).toMatchObject({ x: 0, y: 0 });
  expect(slabs.find((slab) => slab.id === "b")).toMatchObject({ x: 3000, y: 0 });
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
});

test("Touch单指拖板仍正常且一次Undo恢复（PRD 45/74）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const slab = page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]');
  const svg = page.locator("svg[data-floor-canvas-fit]");
  const box = await slab.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await slab.dispatchEvent("pointerdown", { pointerId: 95, pointerType: "touch", isPrimary: true, buttons: 1, clientX: startX, clientY: startY, bubbles: true });
  await svg.dispatchEvent("pointermove", { pointerId: 95, pointerType: "touch", buttons: 1, clientX: startX + 120, clientY: startY, bubbles: true });
  await expect(page.locator("[data-drag-preview]")).toHaveCount(1);
  await svg.dispatchEvent("pointerup", { pointerId: 95, pointerType: "touch", buttons: 0, clientX: startX + 120, clientY: startY, bubbles: true });
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBeGreaterThan(0);
  const movedX = (await savedSlabs(page))[0]?.x;
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(0);
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
  await page.getByRole("button", { name: "重做" }).click();
  await expect.poll(async () => (await savedSlabs(page))[0]?.x ?? 0).toBe(movedX);
});

test.describe("触摸设备", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("Atomic Boundary触摸命中宽度≥32px且点击边界不触发Pan/拖板（PRD 81）", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    const boundary = page.locator("[data-atomic-boundary-id]").first();
    await expect(boundary).toHaveCount(1);
    const hitWidth = Number(await boundary.getAttribute("data-atomic-hit-width"));
    expect(hitWidth).toBeGreaterThanOrEqual(32);
    await boundary.dispatchEvent("pointerdown", { pointerId: 91, pointerType: "touch", isPrimary: true, buttons: 1, bubbles: true });
    await expect(page.locator("[data-selected-atomic-id]")).toHaveCount(1);
    await boundary.dispatchEvent("pointerup", { pointerId: 91, pointerType: "touch", buttons: 0, bubbles: true });
    await page.waitForTimeout(400);
    const slabs = await savedSlabs(page);
    expect(slabs[0]).toMatchObject({ x: 0, y: 0 });
  });
});

test("Wide Desktop 1920×1080不受1500px限宽，Canvas成为视觉主角（PRD 98）", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorInspectorCollapsed");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const main = page.getByRole("main");
  const grid = page.getByTestId("floor-workspace-grid");
  const canvas = page.getByTestId("floor-canvas-card");
  const mainBox = await main.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(mainBox!.width).toBeGreaterThan(1500);
  // 默认 Canvas First：Canvas 占 grid 的 70% 以上（Rail 52 + Inspector 370 除外）。
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  const gridBox = await grid.boundingBox();
  expect(gridBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThan(gridBox!.width * 0.7);
});

test.describe("大尺寸触摸设备", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("Large Touch 1366×1024使用Touch布局而非桌面三栏（PRD 99-100）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorInspectorCollapsed");
      localStorage.removeItem("floorNavigatorCollapsed");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    // 触摸输入：主要按钮≥44px，即使宽度≥1280。
    const box = await page.getByRole("button", { name: "移动" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Navigator/Inspector 不占布局宽度：Canvas≈Grid宽度。
    const grid = page.getByTestId("floor-workspace-grid");
    const canvas = page.getByTestId("floor-canvas-card");
    const gridBox = await grid.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(gridBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThan(gridBox!.width * 0.85);
    await expect(page.getByTestId("floor-workspace-navigator")).toHaveCount(0);
    await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
  });
});

test("Compact Navigator Rail不丢对象：12板区+3洞口均可通过Overlay访问（PRD 107-108）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    const slabs = Array.from({ length: 12 }, (_, index) => ({
      id: `s${String(index + 1).padStart(2, "0")}`,
      name: `板区${String(index + 1).padStart(2, "0")}`,
      type: "room",
      x: (index % 4) * 3000,
      y: Math.floor(index / 4) * 2400,
      width: 3000,
      height: 2400,
    }));
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs,
        openings: [
          { id: "o1", name: "楼梯间", type: "stair", x: 3600, y: 3000, width: 900, height: 900 },
          { id: "o2", name: "井道", type: "shaft", x: 9300, y: 5400, width: 600, height: 600 },
          { id: "o3", name: "挑空", type: "void", x: 6000, y: 6000, width: 1200, height: 1200 },
        ],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorInspectorCollapsed");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 默认 Rail：不再渲染第9块以后的截断列表，而是功能按钮。
  await expect(page.getByRole("button", { name: "导航-对象" })).toBeVisible();
  await page.getByRole("button", { name: "导航-对象" }).click();
  const drawer = page.getByTestId("floor-workspace-left-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[data-navigator-object-id^="s"]')).toHaveCount(12);
  await expect(drawer.locator('[data-navigator-object-id="s12"]')).toBeVisible();
  await drawer.locator('[data-navigator-object-id="s12"]').click();
  await expect(page.getByRole("button", { name: "选择板区 板区12" })).toHaveAttribute("stroke", "#2563eb");
  // 洞口经Rail→Overlay访问。
  await page.getByRole("button", { name: "导航-洞口" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[data-navigator-object-id="o3"]')).toBeVisible();
});

test("PLOT有效面积扩大：宽≥90% SVG、高≥85% SVG（PRD 113）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const svg = page.locator("svg[data-floor-canvas-fit]");
  const plotWidth = Number(await svg.getAttribute("data-plot-width"));
  const plotHeight = Number(await svg.getAttribute("data-plot-height"));
  expect(plotWidth / 1000).toBeGreaterThanOrEqual(0.9);
  expect(plotHeight / 650).toBeGreaterThanOrEqual(0.85);
});
