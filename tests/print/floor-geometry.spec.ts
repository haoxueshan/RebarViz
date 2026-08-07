import { expect, test } from "@playwright/test";

test("Geometry V2支持板区、洞口、支承切换和V2草稿恢复", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => localStorage.removeItem("rebarviz:floor-rebar:draft:v1"));
  await page.reload();
  await expect(page.getByText("FloorRebarCalculator · 几何拓扑 V2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "整层板区平面" })).toBeVisible();

  await page.getByLabel("板区类型").selectOption("corridor");
  await page.getByRole("button", { name: "连续楼板", exact: true }).click();
  await expect(page.getByRole("button", { name: "连续楼板", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "添加洞口" }).click();
  await expect(page.getByRole("heading", { name: "洞口精确参数" })).toBeVisible();
  await page.getByLabel("洞口类型").selectOption("stair");
  await page.getByLabel("洞口名称").fill("楼梯间");
  const openingHandle = page.getByRole("button", { name: "选择洞口 楼梯间" });
  const openingBox = await openingHandle.boundingBox();
  expect(openingBox).not.toBeNull();
  if (openingBox) {
    await page.mouse.move(openingBox.x + openingBox.width / 2, openingBox.y + openingBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(openingBox.x + openingBox.width / 2 + 24, openingBox.y + openingBox.height / 2 + 12, { steps: 3 });
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "按内墙" }).first().click();
  await expect(page.getByRole("button", { name: "按内墙" }).first()).toHaveAttribute("aria-pressed", "true");

  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("rebarviz:floor-rebar:draft:v1") ?? "null"));
  expect(stored.schemaVersion).toBe(2);
  expect(stored.state.slabs[0].type).toBe("corridor");
  expect(stored.state.openings[0]).toMatchObject({ name: "楼梯间", type: "stair" });
  expect(stored.state.supportRules).toHaveLength(2);

  await page.reload();
  await expect(page.getByRole("button", { name: "选择洞口 楼梯间" })).toBeVisible();
  await page.getByRole("button", { name: "选择洞口 楼梯间" }).click();
  await expect(page.getByLabel("洞口名称")).toHaveValue("楼梯间");
  await expect(page.getByRole("button", { name: "按内墙" }).first()).toHaveAttribute("aria-pressed", "true");
});

test("数字空草稿明确无效且移动端没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calculator/floor");
  await page.evaluate(() => localStorage.removeItem("rebarviz:floor-rebar:draft:v1"));
  await page.reload();
  const widthInput = page.getByLabel("东西向净尺寸");
  await widthInput.fill("");
  await expect(widthInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/旧数值不会被当作当前输入提交/)).toBeVisible();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
