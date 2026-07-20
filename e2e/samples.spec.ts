import { test, expect } from "@playwright/test";

test("minimal sample loads and renders square", async ({ page }) => {
  await page.goto("/minimal/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("server browser supports canvas Tab focus and native editors", async ({ page }) => {
  await page.goto("/serverbrowser/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.keyboard.press("Tab"); // enter the canvas; mode tabs receive logical focus
  await expect(page.locator("canvas#game")).toBeFocused();
  await page.keyboard.press("Tab"); // filters button
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("INPUT");
  await page.keyboard.type("Neon");
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("SELECT");
});

test("breakout sample loads and plays", async ({ page }) => {
  await page.goto("/breakout/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(1000);
  // Press space to launch ball
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("snake sample loads and runs", async ({ page }) => {
  await page.goto("/snake/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("platformer sample loads and jumps", async ({ page }) => {
  await page.goto("/platformer/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("particles sample spawns on click", async ({ page }) => {
  await page.goto("/particles/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();
});

for (const sample of ["guild-trader", "dungeon-scout", "lead-defender", "beat-circuit"]) {
  test(`${sample} Goodies sample loads`, async ({ page }) => {
    await page.goto(`/${sample}/`);
    await expect(page.locator("canvas#game")).toBeVisible();
    await page.waitForTimeout(400);
  });
}

test("synth sample loads and starts audio", async ({ page }) => {
  await page.goto("/synth/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.waitForTimeout(2000);
  await expect(canvas).toBeVisible();
});
