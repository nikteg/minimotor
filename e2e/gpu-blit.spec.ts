import { expect, test, type Page } from "@playwright/test";

// Canvas2D vs WebGL2 sprite batcher: the same 8×8 checker at 4× must match
// pixel-for-pixel once composited. Screenshot the page (not the overlay
// <canvas>) so the stacked scene canvas is included.

test.use({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });

async function frame(page: Page, renderer: "canvas" | "webgl") {
  const errors: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onError);
  await page.goto(`/gpu-blit/?renderer=${renderer}`);
  await expect
    .poll(async () => page.evaluate(() => window.__gpuBlit?.ready === true), { timeout: 5000 })
    .toBe(true);
  const bound = await page.evaluate(() => window.__gpuBlit?.renderer);
  expect(bound).toBe(renderer);
  expect(errors).toEqual([]);
  page.off("pageerror", onError);
  return page.screenshot({ type: "png" });
}

test("WebGL2 sprite batcher matches Canvas2D for an unrotated checker", async ({ page }) => {
  const a = await frame(page, "canvas");
  const b = await frame(page, "webgl");
  expect(a.equals(b)).toBe(true);
});

declare global {
  interface Window {
    __gpuBlit?: { renderer: "canvas" | "webgl"; ready: boolean };
  }
}
