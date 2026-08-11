import { test, expect, type Page } from "@playwright/test";

// UI-scale verification against the real ui-gallery page, through the
// window.__uiGallery hook (see samples/ui-gallery/ui-gallery.ts): the layout
// tree comes from UI.layoutCapture/UI.layoutTree, so the assertions run on the
// geometry the UI actually resolved — no pixel scraping.

interface Entry {
  kind: string;
  id?: string;
  rect: { x: number; y: number; w: number; h: number };
  screenRect: { x: number; y: number; w: number; h: number };
  scale: number;
}

const getTree = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => window.__uiGallery!.layoutTree() as unknown[]) as Promise<Entry[]>;

async function openGallery(page: Page): Promise<void> {
  // Taller than the default 720: the board must keep its first column's
  // sliders inside the scroll clip even at 1.5× so they stay clickable.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/ui-gallery/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiGallery);
  await page.evaluate(() => window.__uiGallery!.layoutCapture(true));
  await expect.poll(async () => (await getTree(page)).length).toBeGreaterThan(0);
}

test("the UI-scale slider DRAGS — the value follows the pointer, not just the press", async ({
  page,
}) => {
  await openGallery(page);
  // The header slider is native screen space, but its width is now the
  // field's auto-filled header column rather than a hardcoded slot.
  const scaleSlider = (await getTree(page)).find((e) => e.id === "ui-gallery:ui-scale")!;
  const trackY = scaleSlider.screenRect.y + scaleSlider.screenRect.h / 2;
  await page.mouse.move(scaleSlider.screenRect.x + scaleSlider.screenRect.w * 0.8, trackY);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__uiGallery!.getState().uiScale)).not.toBe(1); // the press jumped the value
  const pressed = await page.evaluate(() => window.__uiGallery!.getState().uiScale);
  // Drag left in steps WITHOUT releasing, ending before the track start so the
  // value clamps to the range minimum — the buggy slider dropped its drag after
  // one frame (clipped sliders on the board cleared the shared drag state), so
  // the value would stay frozen at the press value.
  for (const fraction of [0.55, 0.25, 0.01]) {
    await page.mouse.move(scaleSlider.screenRect.x + scaleSlider.screenRect.w * fraction, trackY);
    await page.waitForTimeout(50);
  }
  const dragged = await page.evaluate(() => window.__uiGallery!.getState().uiScale);
  await page.mouse.up();
  expect(dragged).toBe(0.75); // followed the drag all the way to the minimum
  expect(dragged).not.toBe(pressed);
});

test("changing the UI scale keeps the layout consistent (nothing at unscaled positions)", async ({
  page,
}) => {
  await openGallery(page);
  const treeAt1 = await getTree(page);
  // At scale 1 everything maps 1:1.
  for (const e of treeAt1) {
    expect(e.scale).toBe(1);
    expect(e.screenRect).toEqual(e.rect);
  }

  await page.evaluate(() => window.__uiGallery!.setScale(1.5));
  await expect
    .poll(async () => (await getTree(page)).filter((e) => e.scale === 1.5).length)
    .toBeGreaterThan(0);
  const tree = await getTree(page);

  // The header slider stays native (scale 1, unmoved between scales).
  const headerAt1 = treeAt1.find((e) => e.id === "ui-gallery:ui-scale")!;
  const header = tree.find((e) => e.id === "ui-gallery:ui-scale")!;
  expect(header.scale).toBe(1);
  expect(header.screenRect).toEqual(headerAt1.screenRect);

  // Every board entry is scaled: its screen rect is exactly 1.5 × its
  // reference rect (the factor form scales around the origin), so nothing can
  // sit at an unscaled position.
  const board = tree.filter((e) => e.scale === 1.5);
  expect(board.length).toBeGreaterThan(20); // panels, sliders, buttons, texts…
  for (const e of board) {
    expect(Math.abs(e.screenRect.x - e.rect.x * 1.5)).toBeLessThan(0.001);
    expect(Math.abs(e.screenRect.y - e.rect.y * 1.5)).toBeLessThan(0.001);
    expect(Math.abs(e.screenRect.w - e.rect.w * 1.5)).toBeLessThan(0.001);
    expect(Math.abs(e.screenRect.h - e.rect.h * 1.5)).toBeLessThan(0.001);
  }
  // The wrap layout REFLOWS instead of spilling: every scaled PANEL still fits
  // the window width. (Widgets inside scroll regions legitimately extend past
  // their clip — the horizontal-scroll demo row — so only boxes are checked.)
  const width = await page.evaluate(() => window.innerWidth);
  for (const e of board.filter((b) => b.kind === "panel")) {
    expect(e.screenRect.x + e.screenRect.w).toBeLessThanOrEqual(width + 0.5);
  }
});

test("a scaled widget is hit at its ON-SCREEN position", async ({ page }) => {
  await openGallery(page);
  await page.evaluate(() => window.__uiGallery!.setScale(1.5));
  await expect
    .poll(async () => (await getTree(page)).filter((e) => e.scale === 1.5).length)
    .toBeGreaterThan(0);
  // Click the board's volume slider on its DRAWN track (75% along the slot) —
  // the click lands only if pointer mapping matches the scaled drawing.
  const vol = (await getTree(page)).find((e) => e.id === "ui-gallery:sl-volume")!;
  expect(vol).toBeDefined();
  const x = vol.screenRect.x + vol.screenRect.w * 0.75;
  const y = vol.screenRect.y + vol.screenRect.h / 2;
  await page.mouse.click(x, y);
  await expect
    .poll(() => page.evaluate(() => window.__uiGallery!.getState().volume))
    .toBeGreaterThan(70); // was 65; a track click at ~75% jumps well above it
});
