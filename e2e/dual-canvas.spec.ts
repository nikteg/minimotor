import { test, expect } from "@playwright/test";

// Two independent games on one page: the default game (canvas#game) and an
// isolated Stage.create instance (canvas#game2), each running its own UI via
// UI.begin(ctx). Clicking a button on one canvas must bump only ITS counter —
// input, focus and widget state stay per-game.
test("dual-canvas: two games' UIs work independently", async ({ page }) => {
  await page.goto("/dual-canvas/");
  const main = page.locator("canvas#game");
  const iso = page.locator("canvas#game2");
  await expect(main).toBeVisible();
  await expect(iso).toBeVisible();
  await page.waitForTimeout(300); // both loops running

  const counters = () => page.evaluate(() => window.__dual);

  // Click the default game's button (at 20,70 + 200x40 → center 120,90).
  await main.click({ position: { x: 120, y: 90 } });
  await expect.poll(async () => (await counters()).main).toBe(1);
  expect((await counters()).iso).toBe(0);

  // Click the isolated game's button — same widget coords, other canvas.
  await iso.click({ position: { x: 120, y: 90 } });
  await expect.poll(async () => (await counters()).iso).toBe(1);
  expect((await counters()).main).toBe(1);

  // And again on the first, to prove the first game still works after the
  // second one ran frames in between.
  await main.click({ position: { x: 120, y: 90 } });
  await expect.poll(async () => (await counters()).main).toBe(2);
  expect((await counters()).iso).toBe(1);
});

declare global {
  interface Window {
    __dual: { main: number; iso: number };
  }
}
