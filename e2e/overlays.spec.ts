import { expect, test } from "@playwright/test";

// The perf HUD and the debug overlay were the only two real users of the removed
// plugin draw hooks; both now paint from `app.onFrame`. These check they still
// reach the canvas, since a subscription that silently never fires would leave
// every other test passing.

test("the perf HUD paints over the finished frame", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/ascent/");
  await expect(page.locator("canvas")).toBeVisible();

  // The HUD anchors top-right in WINDOW space, above the letterbox bars. Sample
  // that corner and wait for it to stop being uniform background.
  const corner = async () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas")!;
      const ctx = c.getContext("2d")!;
      const w = Math.min(220, c.width);
      const { data } = ctx.getImageData(c.width - w, 0, w, Math.min(90, c.height));
      const colors = new Set<string>();
      for (let i = 0; i + 3 < data.length; i += 4 * 7) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
      }
      return colors.size;
    });

  await expect.poll(corner, { timeout: 6000 }).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
