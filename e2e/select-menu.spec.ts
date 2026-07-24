import { test, expect, type Page } from "@playwright/test";

// The City select's drop menu must SCROLL — wheel, mouse drag and touch swipe —
// against the real ui-gallery page. Geometry comes from the layout-capture
// harness (window.__uiGallery), behavior from getState().city: after scrolling,
// clicking the menu's top row must pick the city that scrolled into it.
//
// Menu geometry (see select.ts drawSelectMenu): 8 visible rows of 30px inside a
// 2px pad; it opens 2px under the control (flipping above when clipped). City
// starts at "Tokyo" (index 21 of 24), so the menu OPENS pinned near its bottom
// (offset 480 = max) and every test scrolls it back UP.

interface Entry {
  kind: string;
  id?: string;
  rect: { x: number; y: number; w: number; h: number };
  screenRect: { x: number; y: number; w: number; h: number };
  scale: number;
}

const ITEM_H = 30;

const getTree = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => window.__uiGallery!.layoutTree() as unknown[]) as Promise<Entry[]>;
const getCity = (page: Page): Promise<string> =>
  page.evaluate(() => window.__uiGallery!.getState().city);

async function openGallery(page: Page): Promise<void> {
  // Tall enough that the City select and its menu sit fully inside the board.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/ui-gallery/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiGallery);
  await page.evaluate(() => window.__uiGallery!.layoutCapture(true));
  await expect.poll(async () => (await getTree(page)).length).toBeGreaterThan(0);
}

// The open menu's LIST region in the layout tree (`<select id>:menu`), or null
// while the menu is closed.
async function menuRect(
  page: Page,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const tree = await getTree(page);
  return tree.find((e) => e.id === "ui-gallery:select-city:menu")?.screenRect ?? null;
}

// The open menu's row buttons — id-less row-high buttons inside the menu list's
// screen rect (the menu is an overlay ABOVE the board, so nothing else is drawn
// there). Returned as row-top offsets from the list's top edge, sorted.
async function menuRowYs(page: Page): Promise<number[]> {
  const [tree, menu] = await Promise.all([getTree(page), menuRect(page)]);
  if (!menu) return [];
  return tree
    .filter(
      (e) =>
        e.kind === "button" &&
        !e.id &&
        Math.abs(e.screenRect.h - ITEM_H) < 0.5 &&
        Math.abs(e.screenRect.x - menu.x) < 0.5 &&
        e.screenRect.y > menu.y - ITEM_H &&
        e.screenRect.y < menu.y + menu.h,
    )
    .map((e) => e.screenRect.y - menu.y)
    .sort((a, b) => a - b);
}

// Click the City select and wait for its drop menu (the row buttons) to appear.
async function openCityMenu(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const sel = (await getTree(page)).find((e) => e.id === "ui-gallery:select-city");
  expect(sel).toBeDefined();
  const r = sel!.screenRect;
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await expect.poll(() => menuRowYs(page).then((ys) => ys.length)).toBeGreaterThanOrEqual(8);
  return (await menuRect(page))!;
}

test("the canvas is a gesture surface — native touch panning can't steal swipes", async ({
  page,
}) => {
  // Without touch-action:none, iOS Safari claims a touch drag on the canvas
  // for native panning and kills it with pointercancel after a few px — the
  // select menu (and every scroll region) becomes unswipeable on a phone.
  // Chromium can't reproduce that takeover, so pin the property itself.
  await openGallery(page);
  const style = await page.evaluate(() => {
    const c = document.querySelector("canvas#game")!;
    const s = getComputedStyle(c);
    return { touchAction: s.touchAction, userSelect: s.userSelect };
  });
  expect(style.touchAction).toBe("none");
  expect(style.userSelect).toBe("none");
});

test("wheel over the open City menu scrolls it (and the top row picks right)", async ({ page }) => {
  await openGallery(page);
  const menu = await openCityMenu(page);
  // Opens pinned at max (Tokyo centered → clamped to offset 480). Wheel UP by
  // exactly 8 rows: 480 → 240, so row index 8 — "London" — lands exactly at the
  // top of the menu.
  await page.mouse.move(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await page.mouse.wheel(0, -8 * ITEM_H);
  await page.waitForTimeout(100);
  await page.mouse.click(menu.x + menu.w / 2, menu.y + ITEM_H / 2);
  await expect.poll(() => getCity(page)).toBe("London");
});

test("mouse-dragging the open City menu scrolls it and does not close it", async ({ page }) => {
  await openGallery(page);
  const menu = await openCityMenu(page);
  const before = await menuRowYs(page);
  // Drag downward (content scrolls up) from the menu's center, past the 6px
  // drag threshold, without releasing between moves.
  const cx = menu.x + menu.w / 2;
  const cy = menu.y + menu.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (const dy of [20, 45, 70, 96]) {
    await page.mouse.move(cx, cy + dy);
    await page.waitForTimeout(40);
  }
  const after = await menuRowYs(page);
  await page.mouse.up();
  expect(after.length).toBeGreaterThanOrEqual(8); // still open mid-drag
  // The rows moved: a 96px pull from offset 480 lands off the 30px grid, so
  // the row pattern must differ from the opening one.
  expect(after).not.toEqual(before);
  await page.waitForTimeout(100);
  // ...and the release that ended the drag didn't close the menu (or pick).
  expect((await menuRowYs(page)).length).toBeGreaterThanOrEqual(8);
  expect(await getCity(page)).toBe("Tokyo");
});

// A touch swipe from (x, y) moving `dy` down (negative = up), via CDP — the
// browser turns it into the pointer events (pointerType "touch") a phone sends.
async function touchSwipe(page: Page, x: number, y: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = (py: number) => [{ x, y: py, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y) });
  for (const step of [0.2, 0.45, 0.7, 1]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(y + dy * step),
    });
    await page.waitForTimeout(40);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function touchTap(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("touch-swiping the open City menu scrolls it and does not close it", async ({ page }) => {
  await openGallery(page);
  const menu = await openCityMenu(page);
  const before = await menuRowYs(page);
  const cx = menu.x + menu.w / 2;
  const cy = menu.y + menu.h / 2;
  // Synthesize a real touch swipe through CDP — the browser turns it into the
  // pointer events (pointerType "touch") a phone would send.
  const cdp = await page.context().newCDPSession(page);
  const point = (y: number) => [{ x: cx, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(cy) });
  for (const dy of [20, 45, 70, 96]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(cy + dy) });
    await page.waitForTimeout(40);
  }
  const after = await menuRowYs(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(after.length).toBeGreaterThanOrEqual(8); // still open mid-swipe
  expect(after).not.toEqual(before); // ...and the rows moved
  await page.waitForTimeout(150);
  expect((await menuRowYs(page)).length).toBeGreaterThanOrEqual(8); // lift didn't close it
  expect(await getCity(page)).toBe("Tokyo");
});

test("with the board itself scrolled (short window), the wheel goes to the menu, not the board", async ({
  page,
}) => {
  // The user-reported case: the board's own overflow scrollbar is present and
  // the board is mid-scroll. The open menu's wheel must scroll the MENU — the
  // board (dead background under an overlay) must not move. The bug: the outer
  // scroll column's end-of-body wheel claim ran after the select's
  // enterOverlay enlivened the pointer, so the background stole every wheel.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/ui-gallery/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiGallery);
  await page.evaluate(() => window.__uiGallery!.layoutCapture(true));
  await expect.poll(async () => (await getTree(page)).length).toBeGreaterThan(0);

  // Wheel the board down until the City select is comfortably visible.
  const selRect = async () =>
    (await getTree(page)).find((e) => e.id === "ui-gallery:select-city")?.screenRect;
  await page.mouse.move(400, 400);
  for (let i = 0; i < 20; i++) {
    const r = await selRect();
    if (r && r.y > 100 && r.y + r.h < 500) break;
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }
  const menu = await openCityMenu(page);
  const selBefore = (await selRect())!;

  // Wheel UP 8 rows over the menu: offset 480 → 240 puts "London" at the top.
  await page.mouse.move(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await page.mouse.wheel(0, -8 * ITEM_H);
  await page.waitForTimeout(100);
  expect((await selRect())!.y).toBe(selBefore.y); // the board did NOT move
  await page.mouse.click(menu.x + menu.w / 2, menu.y + ITEM_H / 2);
  await expect.poll(() => getCity(page)).toBe("London"); // ...and the menu DID
});

test("a menu drag that lifts over the select control leaves the menu open", async ({ page }) => {
  await openGallery(page);
  const menu = await openCityMenu(page);
  const sel = (await getTree(page)).find((e) => e.id === "ui-gallery:select-city")!.screenRect;
  // Drag from the menu's first row UP onto the control (the natural end of a
  // downward scroll gesture on touch) and lift there. The release ends a
  // scroll drag — it must not toggle the menu closed or pick a row.
  const x = menu.x + menu.w / 2;
  await page.mouse.move(x, menu.y + 15);
  await page.mouse.down();
  for (const y of [menu.y + 5, menu.y - 10, sel.y + sel.h / 2]) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect((await menuRowYs(page)).length).toBeGreaterThanOrEqual(8); // still open
  expect(await getCity(page)).toBe("Tokyo");
  // A REAL click on the control still toggles the menu closed.
  await page.mouse.click(sel.x + sel.w / 2, sel.y + sel.h / 2);
  await expect.poll(() => menuRect(page)).toBeNull();
});

test("the City menu still scrolls with the board zoomed (UI scale 1.5)", async ({ page }) => {
  await openGallery(page);
  await page.evaluate(() => window.__uiGallery!.setScale(1.5));
  await expect
    .poll(async () => (await getTree(page)).filter((e) => e.scale === 1.5).length)
    .toBeGreaterThan(0);
  const menu = await openCityMenu(page);
  // Wheel exactly 8 rows up (the overlay menu itself stays unscaled), then the
  // top row must be "London" — same arithmetic as the unscaled wheel test.
  await page.mouse.move(menu.x + menu.w / 2, menu.y + menu.h / 2);
  await page.mouse.wheel(0, -8 * ITEM_H);
  await page.waitForTimeout(100);
  await page.mouse.click(menu.x + menu.w / 2, menu.y + ITEM_H / 2);
  await expect.poll(() => getCity(page)).toBe("London");
});

test("phone-sized flow: scroll the board to the City select, open it, swipe its menu", async ({
  page,
}) => {
  // An iPhone-ish viewport: the board is one column and the City select starts
  // BELOW the fold, so the flow is swipe board → tap select → swipe menu.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ui-gallery/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiGallery);
  await page.evaluate(() => window.__uiGallery!.layoutCapture(true));
  await expect.poll(async () => (await getTree(page)).length).toBeGreaterThan(0);

  // Swipe the board up until the select sits fully on screen (with room for a
  // tap), letting each fling settle before reading the layout again.
  const selRect = async () =>
    (await getTree(page)).find((e) => e.id === "ui-gallery:select-city")?.screenRect;
  for (let i = 0; i < 12; i++) {
    const r = await selRect();
    if (r && r.y > 90 && r.y + r.h < 700) break;
    await touchSwipe(page, 195, 600, -260);
    await page.waitForTimeout(700); // let the fling coast out
  }
  const r = (await selRect())!;
  expect(r.y).toBeGreaterThan(90);
  expect(r.y + r.h).toBeLessThan(700);

  // Tap to open the drop menu.
  await touchTap(page, r.x + r.w / 2, r.y + r.h / 2);
  await expect.poll(() => menuRowYs(page).then((ys) => ys.length)).toBeGreaterThanOrEqual(8);
  const menu = (await menuRect(page))!;

  // Swipe inside the menu: the rows must move and the menu must stay open.
  const before = await menuRowYs(page);
  await touchSwipe(page, menu.x + menu.w / 2, menu.y + menu.h / 2, 96);
  await page.waitForTimeout(700); // fling + settle
  const after = await menuRowYs(page);
  expect(after.length).toBeGreaterThanOrEqual(8);
  expect(after).not.toEqual(before);
  expect(await getCity(page)).toBe("Tokyo"); // swiping didn't pick a row
});
