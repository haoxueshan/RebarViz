import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";

async function savedSlabs(page: import("@playwright/test").Page): Promise<Array<{ id: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate((draftKey) => {
    const record = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
    return record.state?.slabs ?? [];
  }, DRAFT_KEY);
}

test("桌面默认Canvas First：Inspector Overlay打开/关闭不压缩Canvas且不写业务Storage（V4）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorWorkspaceInspectorOpen");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 无用户设置：桌面首次 Canvas First，Inspector 默认关闭。
  const canvas = page.locator("[data-testid='floor-canvas-card']");
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
  const before = await canvas.boundingBox();
  expect(before).not.toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorWorkspaceInspectorOpen"))).toBeNull();
  // 打开 Inspector → Overlay，Canvas 宽度不变，UI状态不写入正式Storage。
  await page.getByTestId("open-inspector-handle").click();
  await expect(page.getByTestId("floor-workspace-inspector")).toBeVisible();
  const after = await canvas.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorWorkspaceInspectorOpen"))).toBeNull();
  await page.getByRole("button", { name: "关闭参数面板" }).click();
  await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
  await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorWorkspaceInspectorOpen"))).toBeNull();
  await page.reload();
  await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
});

test("Fullscreen：进入隐藏页面组件，退出恢复且FloorPlan不变", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const appBar = page.getByTestId("floor-workspace-app-bar");
  // UI V5：工作区内部 App Bar 已删除（与全局 Header 重复）。
  await expect(appBar).toHaveCount(0);
  // 先放大到125%，验证Fullscreen进入/退出保持Viewport（PRD 70）。
  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  await page.getByRole("button", { name: "全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toBeVisible();
  await expect(appBar).toHaveCount(0);
  await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  await page.getByRole("button", { name: "退出全屏画布" }).click();
  await expect(page.getByTestId("floor-fullscreen-canvas")).toHaveCount(0);
  await expect(appBar).toHaveCount(0);
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
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.waitForTimeout(250);
  await page.evaluate(() => localStorage.setItem("floorWorkspaceInspectorOpen", "true"));
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
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
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
  // Smart Join V1.3.2：磁吸连接候选接管 Quick Dock 预览，内墙 240 与结果完全一致。
  const joinPreview = page.locator("[data-floor-join-preview]");
  await expect(joinPreview).toHaveCount(1);
  await expect(joinPreview).toHaveAttribute("data-join-support", "inner-wall");
  await expect(page.locator("[data-floor-join-wall-preview]")).toHaveAttribute("data-wall-thickness-mm", "240");
  await expect(joinPreview).toContainText("释放以连接");
  await expect(joinPreview).toContainText("内墙240mm");
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
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
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
  await expect(page.locator("[data-floor-join-preview]")).toHaveCount(1);
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
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
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
    localStorage.removeItem("floorWorkspaceInspectorOpen");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 无用户设置时平板默认收起Inspector（Canvas First）。
  const inspector = page.getByTestId("floor-workspace-inspector");
  await expect(inspector).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("floorWorkspaceInspectorOpen"))).toBeNull();
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
  // V4：Workflow / Current Object / Status 常驻后，Canvas仍占横屏主体。
  expect(svgBox!.height).toBeGreaterThanOrEqual(460);
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
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
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

test("Wide Desktop 1920×1080 Dock布局：Navigator+Canvas+Inspector三列且Canvas最大（V5）", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorWorkspaceInspectorOpen");
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
  // Wide：Navigator 完整 Dock、Inspector 默认 Dock 展开、无浮动属性按钮。
  const wideNavigator = page.getByTestId("floor-wide-navigator");
  const wideInspector = page.getByTestId("floor-wide-inspector");
  await expect(wideNavigator).toBeVisible();
  await expect(wideInspector).toBeVisible();
  await expect(page.getByTestId("open-inspector-handle")).toHaveCount(0);
  const navBox = await wideNavigator.boundingBox();
  const inspectorBox = await wideInspector.boundingBox();
  expect(navBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  // Inspector 不覆盖 Canvas；Canvas 是最大区域。
  expect(navBox!.x).toBeLessThan(canvasBox!.x);
  expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(inspectorBox!.x + 1);
  expect(canvasBox!.width).toBeGreaterThan(inspectorBox!.width);
  expect(canvasBox!.width).toBeGreaterThan(navBox!.width);
});

test.describe("大尺寸触摸设备", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("Large Touch 1366×1024使用Touch布局而非桌面三栏（PRD 99-100）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
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
    localStorage.removeItem("floorWorkspaceInspectorOpen");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  // 默认 Rail：不再渲染第9块以后的截断列表，而是功能按钮。
  await expect(page.getByRole("button", { name: "导航-对象" })).toBeVisible();
  await page.getByRole("button", { name: "导航-对象" }).click();
  const palette = page.getByTestId("floor-navigator-palette");
  await expect(palette).toBeVisible();
  await expect(palette.locator('[data-navigator-object-id^="s"]')).toHaveCount(12);
  await expect(palette.locator('[data-navigator-object-id="s12"]')).toBeVisible();
  await palette.locator('[data-navigator-object-id="s12"]').click();
  await expect(page.getByRole("button", { name: "选择板区 板区12" })).toHaveAttribute("stroke", "#2563eb");
  // 洞口经Rail→Overlay访问。
  await page.getByRole("button", { name: "导航-洞口" }).click();
  await expect(palette).toBeVisible();
  await expect(palette.locator('[data-navigator-object-id="o3"]')).toBeVisible();
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

test.describe("UI V3.1 Layout Logic Finalization", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("1440×900 Touch仍使用Touch Workspace：无Desktop Rail/Handle（PRD 43）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
      localStorage.removeItem("floorNavigatorCollapsed");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    // 不能因为 xl 宽度出现 Desktop Navigator Rail / Inspector Handle。
    await expect(page.getByTestId("floor-workspace-navigator")).toHaveCount(0);
    await expect(page.getByTestId("open-inspector-handle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导航-对象" })).toHaveCount(0);
    // Canvas 单列：宽度≈Grid。
    const grid = page.getByTestId("floor-workspace-grid");
    const canvas = page.getByTestId("floor-canvas-card");
    const gridBox = await grid.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(gridBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.width).toBeGreaterThan(gridBox!.width * 0.9);
  });

  test("1366×768 Touch Landscape：Canvas高度420~600且Toolbar可见（PRD 44）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
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
    // 短横屏不再强制600px最小高度。
    expect(box!.height).toBeGreaterThanOrEqual(400);
    expect(box!.height).toBeLessThanOrEqual(600);
    // 页面整体不超高：常驻 Status Bar 在首屏附近。
    const status = await page.getByTestId("floor-workspace-status-bar").boundingBox();
    expect(status).not.toBeNull();
    expect(status!.y).toBeLessThan(768 + 300);
  });

  test("Touch Inspector为Overlay：Canvas宽度不变且Body可滚动（PRD 45）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    const canvas = page.getByTestId("floor-canvas-card");
    const before = await canvas.boundingBox();
    expect(before).not.toBeNull();
    await page.getByRole("button", { name: "展开编辑" }).click();
    const inspector = page.getByTestId("floor-workspace-inspector");
    await expect(inspector).toBeVisible();
    const after = await canvas.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
    // Body 是滚动容器，不允许 xl:overflow-visible 溢出。
    const body = inspector.locator("div.min-h-0.flex-1");
    const scroll = await body.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
    expect(scroll.overflowY).toBe("auto");
    expect(scroll.scroll).toBeGreaterThanOrEqual(scroll.client);
  });

  test("Touch关闭Inspector后刷新仍保持Canvas First（PRD 47）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    await page.getByRole("button", { name: "展开编辑" }).click();
    await expect(page.getByTestId("floor-workspace-inspector")).toBeVisible();
    await page.getByRole("button", { name: "关闭参数面板" }).click();
    await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
    await expect(page.getByTestId("floor-canvas-card")).toBeVisible();
  });

  test("Touch选择对象后Navigator Drawer自动关闭并聚焦（PRD 52）", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      const slabs = Array.from({ length: 12 }, (_, index) => ({
        id: `s${String(index + 1).padStart(2, "0")}`,
        name: `板区${String(index + 1).padStart(2, "0")}`,
        type: "room",
        x: (index % 4) * 3000,
        y: Math.floor(index / 4) * 2400,
        width: 3000,
        height: 2400,
      }));
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
        schemaVersion: 2, savedAt: new Date().toISOString(),
        state: { coordinateModel: "net-layout-v1", slabs, openings: [], supportRules: [], innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150 },
      }));
      localStorage.removeItem("rebarviz:floor-rebar:role:v1");
    });
    await page.reload();

    await page.getByRole("button", { name: /当前：板区01/ }).click();
    const drawer = page.getByTestId("floor-workspace-left-drawer");
    await expect(drawer).toBeVisible();
    await drawer.locator('[data-navigator-object-id="s12"]').click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "选择板区 板区12" })).toHaveAttribute("stroke", "#2563eb");
    // 聚焦：V1.3.1 Ensure Visible——板区12在整层Fit下已可见，Viewport 完全不变。
    const canvasSvg = page.locator("svg[data-floor-canvas-fit]");
    await expect(canvasSvg).toHaveAttribute("data-viewport-center-x", "6360");
    await expect(canvasSvg).toHaveAttribute("data-viewport-center-y", "3840");
  });
});

// —— Desktop-only V3.1 用例（Rail 交互需要 Desktop Workspace）——
test("Navigator选择不Remount Canvas：实例ID与轴锁保持（PRD 53）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      const slabs = Array.from({ length: 4 }, (_, index) => ({
        id: `s${String(index + 1).padStart(2, "0")}`,
        name: `板区${String(index + 1).padStart(2, "0")}`,
        type: "room",
        x: index * 3000,
        y: 0,
        width: 2400,
        height: 2400,
      }));
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
        schemaVersion: 2, savedAt: new Date().toISOString(),
        state: { coordinateModel: "net-layout-v1", slabs, openings: [], supportRules: [], innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150 },
      }));
      localStorage.removeItem("rebarviz:floor-rebar:role:v1");
      localStorage.removeItem("floorWorkspaceInspectorOpen");
      localStorage.removeItem("floorNavigatorCollapsed");
    });
    await page.reload();

    const canvasCard = page.getByTestId("floor-canvas-card");
    const instanceBefore = await canvasCard.getAttribute("data-canvas-instance-id");
    // 放大到150%并锁水平轴。
    await page.getByRole("button", { name: "放大" }).click();
    await page.getByRole("button", { name: "放大" }).click();
    await page.getByRole("button", { name: "视图" }).click();
    await page.getByRole("button", { name: "水平移动" }).click();
    // Navigator Rail 选择板区04。
    await page.getByRole("button", { name: "导航-对象" }).click();
    const palette = page.getByTestId("floor-navigator-palette");
    await palette.locator('[data-navigator-object-id="s04"]').click();
    await expect(palette).toBeVisible();
    const instanceAfter = await canvasCard.getAttribute("data-canvas-instance-id");
    expect(instanceBefore).not.toBeNull();
    expect(instanceAfter).toBe(instanceBefore);
    // 轴锁保持水平：视图菜单内水平移动仍为按下状态。
    await page.getByRole("button", { name: "视图" }).click();
    await expect(page.getByRole("button", { name: "水平移动" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Navigator Rail分类定位：洞口/通墙Section直达（PRD 51）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(() => {
      localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
        schemaVersion: 2, savedAt: new Date().toISOString(),
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [{ id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 }],
          openings: [{ id: "o1", name: "楼梯间", type: "stair", x: 1000, y: 1000, width: 900, height: 900 }],
          supportRules: [], innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150,
        },
      }));
      localStorage.removeItem("rebarviz:floor-rebar:role:v1");
      localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    });
    await page.reload();

    // 洞口分类：只显示洞口 Section，板区 Section 不出现。
    await page.getByRole("button", { name: "导航-洞口" }).click();
    const palette = page.getByTestId("floor-navigator-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByText("洞口导航", { exact: true })).toBeVisible();
    await expect(palette.locator('[data-navigator-section="openings"]')).toBeVisible();
    await expect(palette.locator('[data-navigator-section="slabs"]')).toHaveCount(0);
    await expect(palette.locator('[data-navigator-object-id="o1"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // 对象分类：只显示板区 Section。
    await page.getByRole("button", { name: "导航-对象" }).click();
    await expect(palette.locator('[data-navigator-section="slabs"]')).toBeVisible();
    await expect(palette.locator('[data-navigator-section="openings"]')).toHaveCount(0);
  });

// —— Desktop-only V3.1 用例（Rail 交互需要 Desktop Workspace）——
test("查看问题统一打开Issue Center并可定位（V4）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.setItem(draftKey, JSON.stringify({
        schemaVersion: 2, savedAt: new Date().toISOString(),
        state: {
          coordinateModel: "net-layout-v1",
          slabs: [
            { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
            { id: "b", name: "板区B", type: "room", x: 3000, y: 2000, width: 3600, height: 3600 },
          ],
          openings: [], supportRules: [], innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150,
        },
      }));
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    // 首次进入 Inspector 关闭（Canvas First）。
    await expect(page.getByTestId("floor-workspace-inspector")).toHaveCount(0);
    const showIssues = page.getByRole("button", { name: /个问题$/ }).last();
    await expect(showIssues).toBeVisible();
    await showIssues.click();
    await expect(page.getByTestId("floor-issue-center")).toBeVisible();
    await expect(page.getByTestId("floor-issue-center").getByRole("button", { name: "定位" }).first()).toBeVisible();
  });

  test("View Popover在多个宽度完整显示且可点6项（PRD 48）", async ({ page }) => {
    for (const width of [1024, 1180, 1366, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/calculator/floor");
      await page.evaluate(({ draftKey, roleKey }) => {
        localStorage.removeItem(draftKey);
        localStorage.removeItem(roleKey);
        localStorage.removeItem("floorWorkspaceInspectorOpen");
      }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
      await page.reload();

      await page.getByRole("button", { name: "视图" }).click();
      const popover = page.getByTestId("canvas-view-popover");
      await expect(popover).toBeVisible();
      const box = await popover.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      for (const name of ["适合楼层", "选中", "查看全部", "自由移动", "水平移动", "垂直移动"]) {
        await expect(popover.getByRole("button", { name })).toBeVisible();
      }
      await popover.getByRole("button", { name: "查看全部" }).click();
      await expect(popover).toHaveCount(0);
    }
  });

test("Desktop Inspector Overlay不压缩Canvas（PRD 54）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.removeItem(roleKey);
    localStorage.removeItem("floorWorkspaceInspectorOpen");
    localStorage.removeItem("floorNavigatorCollapsed");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  const canvas = page.getByTestId("floor-canvas-card");
  const before = await canvas.boundingBox();
  expect(before).not.toBeNull();
  await page.getByTestId("open-inspector-handle").click();
  await expect(page.getByTestId("floor-workspace-inspector")).toBeVisible();
  const after = await canvas.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
});

test("Result Strip进入唯一BOM Workspace且主工作台不渲染完整表格（V4）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.removeItem(draftKey);
    localStorage.setItem(roleKey, JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      state: { mainDirectionOverrides: { "role:floor-slab-a": "x", "role:floor-slab-b": "x" } },
    }));
    localStorage.setItem("floorWorkspaceInspectorOpen", "true");
    localStorage.setItem("floorNavigatorCollapsed", "false");
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await expect(page.getByTestId("floor-live-summary")).toContainText("地筋有效");
  await expect(page.getByRole("heading", { name: "地筋料单" })).toHaveCount(0);
  await page.getByTestId("floor-live-summary").getByRole("button", { name: "查看料单" }).click();
  await expect(page.getByTestId("floor-bom-workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "地筋", exact: true }).last()).toHaveAttribute("aria-pressed", "true");
});

test("Command Bar底部考虑Safe Area且出现后主要图纸不被完全遮挡（PRD 49-50）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, roleKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2, savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4200, height: 3600 },
          { id: "b", name: "板区B", type: "room", x: 0, y: 3605, width: 3600, height: 3600 },
        ],
        openings: [], supportRules: [], innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150, overlapToleranceMm: 0,
      },
    }));
    localStorage.removeItem(roleKey);
  }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
  await page.reload();

  await page.getByRole("button", { name: "拼接", exact: true }).click();
  await page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区B"]').click();
  await page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]').click();
  await page.locator('[data-dock-side="north"]').dispatchEvent("pointerover");
  await page.locator('[data-dock-side="north"]').dispatchEvent("pointerdown");
  const panel = page.getByTestId("dock-confirm-panel");
  await expect(panel).toBeVisible();

  // Command Bar 位于 Canvas 内部且底边距视口底部 >=12px（safe-area 由 CSS env 提供）。
  const svgBox = await page.locator("svg[data-floor-canvas-fit]").boundingBox();
  const panelBox = await panel.boundingBox();
  expect(svgBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(svgBox!.x);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(svgBox!.x + svgBox!.width + 1);
  const gap = await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="dock-confirm-panel"]')?.parentElement;
    if (!wrapper) return "";
    return getComputedStyle(wrapper).bottom;
  });
  // CSS 使用 calc(12px + env(safe-area-inset-bottom))；无 safe-area 时计算为 12px。
  expect(gap).toBe("12px");

  // 显示选中：主对象应位于 Command Bar 上方可视区域（视口平移保护）。
  await page.getByRole("button", { name: "视图" }).click();
  await page.getByRole("button", { name: "选中" }).click();
  const slabBox = await page.locator('[data-floor-layer="slabs"] rect[aria-label="选择板区 板区A"]').boundingBox();
  expect(slabBox).not.toBeNull();
  // 主对象主体位于 Command Bar 上方可视区域（不被完全遮挡）。
  expect(slabBox!.y + slabBox!.height / 2).toBeLessThan(panelBox!.y);
});

test.describe("UI V5 工作台布局", () => {
  test("1280×800 Desktop：52px Rail + Canvas，无固定44px列，浮动属性按钮（V5）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    const grid = page.getByTestId("floor-workspace-grid");
    const canvas = page.getByTestId("floor-canvas-card");
    await expect(page.getByTestId("open-inspector-handle")).toBeVisible();
    const gridBox = await grid.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(gridBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    // 右侧不再存在固定 44px Inspector column：Canvas 占 grid 除 52px Rail 外全部。
    expect(canvasBox!.width).toBeGreaterThan(gridBox!.width - 80);
    // 浮动按钮打开 Inspector Overlay，Canvas 宽度不变。
    const before = canvasBox!.width;
    await page.getByTestId("open-inspector-handle").click();
    await expect(page.getByTestId("floor-inspector-overlay")).toBeVisible();
    const after = await (await canvas.boundingBox());
    expect(after).not.toBeNull();
    expect(Math.abs(after!.width - before)).toBeLessThan(1);
  });

  test("1600×900 Wide Dock：Navigator完整展开+Inspector Dock且不覆盖Canvas（V5）", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    const navigator = page.getByTestId("floor-wide-navigator");
    const inspector = page.getByTestId("floor-wide-inspector");
    const canvas = page.getByTestId("floor-canvas-card");
    await expect(navigator).toBeVisible();
    await expect(inspector).toBeVisible();
    await expect(navigator.locator('[data-navigator-object-id]').first()).toBeVisible();
    const navBox = await navigator.boundingBox();
    const canvasBox = await canvas.boundingBox();
    const inspectorBox = await inspector.boundingBox();
    expect(navBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(navBox!.width).toBeGreaterThanOrEqual(200);
    expect(inspectorBox!.width).toBeGreaterThanOrEqual(320);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(inspectorBox!.x + 1);
    expect(canvasBox!.width).toBeGreaterThan(inspectorBox!.width);
  });

  test("390×844 Phone：紧凑Toolbar+更多菜单+单层Inspector Header（V5）", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    // 紧凑 Toolbar：移动/拼接/多选 + 更多菜单；不展示完整撤销/缩放/视图/全屏按钮。
    await expect(page.getByRole("button", { name: "移动" })).toBeVisible();
    await expect(page.getByRole("button", { name: "拼接" })).toBeVisible();
    await expect(page.getByRole("button", { name: "多选" })).toBeVisible();
    await expect(page.getByTestId("floor-mobile-toolbar-more")).toBeVisible();
    await expect(page.getByRole("button", { name: "全屏画布" })).toHaveCount(0);
    // 更多菜单包含撤销/缩放/取景/锁轴。
    await page.getByTestId("floor-mobile-toolbar-more").click();
    const menu = page.getByTestId("floor-mobile-toolbar-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "适合楼层" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "水平移动" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "全屏画布" })).toBeVisible();
    await page.getByRole("button", { name: "关闭更多菜单" }).click();
    // 打开 Inspector：单层 Header（无外层“属性面板+关闭”行）。
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const inspector = page.getByTestId("floor-workspace-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "关闭" })).toBeVisible();
    await expect(page.getByText("属性面板")).toHaveCount(0);
    await expect(page.getByTestId("floor-mobile-inspector-sheet")).toBeVisible();
    // 无横向溢出。
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

  test("1366×768：无Workspace App Bar且只有一条Bottom Bar（V5）", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    await expect(page.getByTestId("floor-workspace-app-bar")).toHaveCount(0);
    await expect(page.getByTestId("floor-unified-status-bar")).toHaveCount(1);
    await expect(page.getByTestId("floor-workspace-status-bar")).toHaveCount(1);
    // Result Strip 已合并：不再单独渲染第二条底部区域。
    await expect(page.getByTestId("floor-unified-status-bar")).toBeVisible();
  });

  test("1024×768：Inspector开关不改变Canvas宽度且不重置Zoom（V5）", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/calculator/floor");
    await page.evaluate(({ draftKey, roleKey }) => {
      localStorage.removeItem(draftKey);
      localStorage.removeItem(roleKey);
      localStorage.removeItem("floorWorkspaceInspectorOpen");
    }, { draftKey: DRAFT_KEY, roleKey: ROLE_KEY });
    await page.reload();

    const canvas = page.getByTestId("floor-canvas-card");
    await page.getByRole("button", { name: "放大" }).click();
    await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
    const before = await canvas.boundingBox();
    expect(before).not.toBeNull();
    await page.getByRole("button", { name: "展开编辑" }).click();
    await expect(page.getByTestId("floor-workspace-inspector")).toBeVisible();
    const after = await canvas.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(1);
    await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
    await page.getByRole("button", { name: "收起编辑" }).click();
    await expect(page.getByTestId("canvas-zoom-percent")).toHaveText("125%");
  });
});

