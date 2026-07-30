import { expect, test } from "@playwright/test";

// A canvas game has almost no DOM, so asserting that the <canvas> is visible
// proves nothing — that element lives in index.html and is there even when the
// game throws on its first line. These checks are the cheapest ones that
// actually fail when the game is dead: nothing threw, and the canvas has real
// pixels on it. jsdom can't run any of this (no getContext), which is why a real
// browser is worth its download.

/** Sampled canvas pixels: how many are opaque, and how many distinct colors. */
async function pixels(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas#game");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return { opaque: 0, colors: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<string>();
    let opaque = 0;
    // Stride whole pixels across the buffer rather than reading every one: a
    // window-sized canvas is millions of pixels and a sample is enough.
    for (let i = 0; i + 3 < data.length; i += 4 * 101) {
      if (data[i + 3]! > 0) opaque += 1;
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return { opaque, colors: colors.size };
  });
}

test("the game boots, runs, and draws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator("canvas#game")).toBeVisible();

  // Poll: the first frame lands a tick after load. Two or more colors means the
  // background was cleared AND something was drawn on top of it — the loop is
  // running, not just the page.
  await expect.poll(async () => (await pixels(page)).colors, { timeout: 5000 }).toBeGreaterThan(1);

  expect((await pixels(page)).opaque).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
