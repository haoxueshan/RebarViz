import { expect, test } from "@playwright/test";

test("Geometry V2.1支持板区、洞口、支承切换和草稿恢复", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.removeItem("rebarviz:floor-rebar:draft:v1");
    localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
  });
  await page.reload();
  await expect(page.getByText("FloorRebarCalculator · Geometry V2.1 + Bottom/Top Rebar + Role V1.1")).toBeVisible();
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
  await page.evaluate(() => {
    localStorage.removeItem("rebarviz:floor-rebar:draft:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
  });
  await page.reload();
  const widthInput = page.getByLabel("东西向净尺寸");
  await widthInput.fill("");
  await expect(widthInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/旧数值不会被当作当前输入提交/)).toBeVisible();
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("Bottom V1合并continuous、显示地筋料单并恢复独立设置", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.removeItem("rebarviz:floor-rebar:draft:v1");
    localStorage.removeItem("rebarviz:floor-rebar:bottom:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
  });
  await page.reload();
  await page.getByRole("button", { name: "连续楼板", exact: true }).click();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await expect(page.getByRole("heading", { name: "整层地筋默认规格" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "整层地筋料单" })).toBeVisible();
  await expect(page.getByText("8.540m").first()).toBeVisible();
  await expect(page.getByText("正式地筋结果有效")).toBeVisible();

  const selects = page.getByLabel("根数算法");
  await selects.selectOption("floor");
  const mainDiameter = page.getByLabel("主筋直径").first();
  await mainDiameter.fill("14");
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("rebarviz:floor-rebar:bottom:v1") ?? "null"));
  expect(stored).toMatchObject({ schemaVersion: 3, roleReviewRequired: false, state: { countMode: "floor", defaults: { mainDiameter: 14 } } });

  await page.reload();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await expect(page.getByLabel("根数算法")).toHaveValue("floor");
  await expect(page.getByLabel("主筋直径").first()).toHaveValue("14");
});

test("Bottom数字空草稿阻止旧值生成正式结果", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => localStorage.removeItem("rebarviz:floor-rebar:bottom:v1"));
  await page.reload();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  const spacing = page.getByLabel("东西向间距").first();
  await spacing.fill("");
  await expect(spacing).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("地筋结果无效")).toBeVisible();
  await expect(page.getByText(/未使用旧值计算/)).toBeVisible();
});

test("Bottom V1.1迁移复核后，局部continuous与inner-wall同时生成长短Piece", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 4000, height: 4000 },
          { id: "b", name: "板区B", type: "room", x: 4000, y: 0, width: 4000, height: 4000 },
        ],
        openings: [],
        supportRules: [{
          id: "partial-continuous",
          target: { kind: "slab-edge", slabId: "a", side: "east", range: { mode: "offset", startMm: 0, endMm: 2000 } },
          support: "continuous",
        }],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.setItem("rebarviz:floor-rebar:bottom:v1", JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      state: {
        countMode: "project",
        defaults: { x: { diameter: 12, spacing: 1000 }, y: { diameter: 10, spacing: 1000 } },
        slabOverrides: {},
      },
    }));
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
  });
  await page.reload();
  await page.getByRole("button", { name: /2\. 地筋/ }).click();
  await expect(page.getByText("地筋结果无效")).toBeVisible();
  await expect(page.getByText(/旧版本的东西\/南北向直径已迁移/).first()).toBeVisible();
  await page.getByRole("button", { name: "确认地筋主副筋规格" }).click();
  await expect(page.getByText("正式地筋结果有效")).toBeVisible();
  await expect(page.getByText("8.740m")).toBeVisible();
  await expect(page.getByText("4.610m")).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows.filter({ hasText: "8.740m" })).toContainText("2根");
  await expect(rows.filter({ hasText: "4.610m" })).toContainText("4根");
});

test("Top V1普通内墙增加、continuous贯穿并恢复独立设置", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.removeItem("rebarviz:floor-rebar:draft:v1");
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.setItem("rebarviz:floor-rebar:role:v1", JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      state: { mainDirectionOverrides: { "role:floor-slab-b": "x" } },
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByRole("heading", { name: "整层普通面筋默认规格" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "整层普通面筋料单" })).toBeVisible();
  await expect(page.getByText("正式面筋结果有效")).toBeVisible();
  await expect(page.getByText("5.060m")).toBeVisible();

  await page.getByRole("button", { name: /1\. 楼层/ }).click();
  await page.getByRole("button", { name: "连续楼板", exact: true }).click();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByText("8.540m")).toBeVisible();

  await page.getByLabel("根数算法").selectOption("floor");
  await page.getByLabel("面筋内墙端增加值").fill("300");
  await page.getByLabel("东西向增加端").selectOption("end");
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("rebarviz:floor-rebar:top:v1") ?? "null"));
  expect(stored).toMatchObject({
    schemaVersion: 3,
    roleReviewRequired: false,
    state: {
      countMode: "floor",
      topAnchorExtra: 300,
      defaults: { xExtraMode: "end" },
    },
  });

  await page.reload();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByLabel("根数算法")).toHaveValue("floor");
  await expect(page.getByLabel("面筋内墙端增加值")).toHaveValue("300");
  await expect(page.getByLabel("东西向增加端")).toHaveValue("end");
});

test("Top V1楼梯间Opening裁断Piece且洞口边改内墙后增加下料长度", async ({ page }) => {
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [{ id: "a", name: "板区A", type: "room", x: 0, y: 0, width: 6000, height: 6000 }],
        openings: [{ id: "o", name: "楼梯间", type: "stair", x: 2000, y: 2000, width: 2000, height: 2000 }],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
      },
    }));
    localStorage.setItem("rebarviz:floor-rebar:top:v1", JSON.stringify({
      schemaVersion: 3,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        topAnchorExtra: 250,
        defaults: {
          mainDiameter: 10,
          secondaryDiameter: 10,
          xSpacing: 1000,
          ySpacing: 1000,
          xExtraMode: "both",
          yExtraMode: "both",
        },
        slabOverrides: {},
      },
    }));
    localStorage.setItem("rebarviz:floor-rebar:role:v1", JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      state: { mainDirectionOverrides: { "role:a": "x" } },
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByText("正式面筋结果有效")).toBeVisible();
  await expect(page.getByText("理论面筋线").locator("..")).toContainText("12");
  await expect(page.getByText("实际下料件").locator("..")).toContainText("16");
  await expect(page.getByText("2.370m").first()).toBeVisible();

  await page.getByRole("button", { name: /1\. 楼层/ }).click();
  await page.getByRole("button", { name: "选择洞口 楼梯间" }).click();
  await page.getByRole("button", { name: "按内墙" }).first().click();
  await page.getByRole("button", { name: /3\. 面筋/ }).click();
  await expect(page.getByText("2.860m").first()).toBeVisible();
});

test("Top数字空草稿阻止旧值计算且390px页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.removeItem("rebarviz:floor-rebar:top:v1");
    localStorage.removeItem("rebarviz:floor-rebar:role:v1");
  });
  await page.reload();
  await page.getByRole("button", { name: "面筋", exact: true }).click();
  const extra = page.getByLabel("面筋内墙端增加值");
  await extra.fill("");
  await expect(extra).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("面筋结果无效")).toBeVisible();
  await expect(page.getByText(/未使用旧值计算/)).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("正方形主筋方向人工选择由地筋和面筋共享，390px无页面溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calculator/floor");
  await page.evaluate(() => {
    localStorage.setItem("rebarviz:floor-rebar:draft:v1", JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [{ id: "square", name: "正方形板区", type: "room", x: 0, y: 0, width: 4000, height: 4000 }],
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
  });
  await page.reload();
  await page.getByRole("button", { name: "地筋", exact: true }).click();
  await expect(page.getByText("地筋结果无效")).toBeVisible();
  await expect(page.getByText(/两个方向净跨相同/).first()).toBeVisible();
  await page.getByLabel("东西向主筋").check();
  await expect(page.getByText("正式地筋结果有效")).toBeVisible();

  await page.getByRole("button", { name: "面筋", exact: true }).click();
  await expect(page.getByLabel("东西向主筋")).toBeChecked();
  await expect(page.getByText("正式面筋结果有效")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
