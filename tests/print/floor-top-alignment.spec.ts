import { expect, test } from "@playwright/test";

const DRAFT_KEY = "rebarviz:floor-rebar:draft:v1";
const TOP_KEY = "rebarviz:floor-rebar:top:v1";
const ROLE_KEY = "rebarviz:floor-rebar:role:v1";
const BOTTOM_KEY = "rebarviz:floor-rebar:bottom:v1";

test("Floor Top Through Alignment V2：板区7→板区2南北向通墙自动统一相位", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, topKey, roleKey, bottomKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区7", type: "room", x: 0, y: 0, width: 3600, height: 3600 },
          { id: "b", name: "板区2", type: "room", x: 0, y: 3600, width: 3350, height: 4000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: 10,
      },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        topAnchorExtra: 250,
        defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200, xExtraMode: "both", yExtraMode: "both" },
        slabOverrides: {},
        throughPaths: [
          { id: "through-02", name: "通墙02", direction: "y", slabIds: ["a", "b"], bandStartMm: 0, bandEndMm: 3350, enabled: true },
        ],
      },
    }));
    localStorage.setItem(roleKey, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: { mainDirectionOverrides: { "role:a": "x" } } }));
    localStorage.removeItem(bottomKey);
  }, { draftKey: DRAFT_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, bottomKey: BOTTOM_KEY });
  await page.reload();

  await page.getByRole("button", { name: "3. 面筋", exact: true }).click();
  await expect(page.getByText("正式面筋结果有效")).toBeVisible();
  await expect(page.getByText(/普通面筋位置或根数不一致/)).toHaveCount(0);
  const status = page.getByTestId("through-alignment-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("排筋相位：已统一");
  await expect(status).toContainText("共享相位：100");
  await expect(page.getByText(/有效通墙筋/).first()).toBeVisible();
});

test("Floor Top Through Alignment V2：间距冲突提示待协调", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calculator/floor");
  await page.evaluate(({ draftKey, topKey, roleKey, bottomKey }) => {
    localStorage.setItem(draftKey, JSON.stringify({
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      state: {
        coordinateModel: "net-layout-v1",
        slabs: [
          { id: "a", name: "板区7", type: "room", x: 0, y: 0, width: 3600, height: 3600 },
          { id: "b", name: "板区2", type: "room", x: 0, y: 3600, width: 3350, height: 4000 },
        ],
        openings: [],
        supportRules: [],
        innerWallThickness: 240,
        outerWallThickness: 370,
        snapDistanceMm: 150,
        overlapToleranceMm: 10,
      },
    }));
    localStorage.setItem(topKey, JSON.stringify({
      schemaVersion: 4,
      savedAt: new Date().toISOString(),
      roleReviewRequired: false,
      state: {
        countMode: "project",
        topAnchorExtra: 250,
        defaults: { mainDiameter: 10, secondaryDiameter: 10, xSpacing: 200, ySpacing: 200, xExtraMode: "both", yExtraMode: "both" },
        slabOverrides: { b: { ySpacing: 150 } },
        throughPaths: [
          { id: "through-02", name: "通墙02", direction: "y", slabIds: ["a", "b"], bandStartMm: 0, bandEndMm: 3350, enabled: true },
        ],
      },
    }));
    localStorage.setItem(roleKey, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), state: { mainDirectionOverrides: { "role:a": "x" } } }));
    localStorage.removeItem(bottomKey);
  }, { draftKey: DRAFT_KEY, topKey: TOP_KEY, roleKey: ROLE_KEY, bottomKey: BOTTOM_KEY });
  await page.reload();

  await page.getByRole("button", { name: "3. 面筋", exact: true }).click();
  await expect(page.getByText("排筋相位：待协调")).toBeVisible();
  await expect(page.getByText(/间距不一致，无法建立统一通墙排筋相位/).first()).toBeVisible();
});
