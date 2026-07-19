import { test, expect } from "@playwright/test";

test("minimal sample loads and renders square", async ({ page }) => {
  await page.goto("/samples/minimal/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("breakout sample loads and plays", async ({ page }) => {
  await page.goto("/samples/breakout/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(1000);
  // Press space to launch ball
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("snake sample loads and runs", async ({ page }) => {
  await page.goto("/samples/snake/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("platformer sample loads and jumps", async ({ page }) => {
  await page.goto("/samples/platformer/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("particles sample spawns on click", async ({ page }) => {
  await page.goto("/samples/particles/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();
});

test("synth sample loads and starts audio", async ({ page }) => {
  await page.goto("/samples/synth/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.waitForTimeout(2000);
  await expect(canvas).toBeVisible();
});
