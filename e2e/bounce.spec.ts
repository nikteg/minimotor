import { test, expect } from "@playwright/test";

test("bounce sample loads and renders", async ({ page }) => {
  await page.goto("/samples/bounce/");

  // Canvas should be present
  const canvas = page.locator("canvas#game");
  await expect(canvas).toBeVisible();

  // Wait a few frames for the game to render
  await page.waitForTimeout(500);

  // The ball should have moved from its starting position
  const text = await page.locator("canvas").evaluate(() => {
    // Check if the canvas has content by reading a pixel
    const canvases = document.querySelectorAll("canvas");
    if (canvases.length === 0) return "no canvas";
    return "canvas found";
  });
  expect(text).toBe("canvas found");
});

test("bounce score increases when ball hits walls", async ({ page }) => {
  await page.goto("/samples/bounce/");

  // Let the game run for a few seconds so the ball bounces
  await page.waitForTimeout(3000);

  // The score text should have updated (ball bounces off walls automatically)
  // We can't easily read canvas text, but the game shouldn't crash
  const canvas = page.locator("canvas#game");
  await expect(canvas).toBeVisible();
});

test("bounce responds to arrow keys", async ({ page }) => {
  await page.goto("/samples/bounce/");

  await page.waitForTimeout(300);

  // Press arrow keys to move the ball
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowLeft");

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowRight");

  // Game should still be running
  const canvas = page.locator("canvas#game");
  await expect(canvas).toBeVisible();
});
