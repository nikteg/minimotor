import { test, expect } from "@playwright/test";

test("minimal sample loads and renders square", async ({ page }) => {
  await page.goto("/samples/minimal/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  // Move the square
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  // Canvas should still be there
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("pong sample loads and plays", async ({ page }) => {
  await page.goto("/samples/pong/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(2000);
  // Ball should bounce; move paddle
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  await expect(page.locator("canvas#game")).toBeVisible();
});

test("particles sample spawns on click", async ({ page }) => {
  await page.goto("/samples/particles/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForTimeout(500);
  // Click to spawn particles
  const canvas = page.locator("canvas#game");
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(500);
  await expect(canvas).toBeVisible();
});
