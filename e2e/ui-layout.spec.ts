import { test, expect, type Page } from "@playwright/test";

// Layout invariants for the UI-heavy sample pages, through the window.__uiProbe
// hook (samples/shared/layout-probe.ts). `UI.layoutIssues()` reports children
// that spilled out of the container that laid them out — a container that
// failed to size to its content, whose children then paint over whatever comes
// after it. That is the synth-panel bug ("UI drawn on top of other UI"), and it
// is invisible to a screenshot diff unless you already know where to look.
//
// Clipping/scrolling containers and hand-positioned (x/y) rects are exempt by
// construction — see `layoutIssues` in src/ui/core/layout-capture.ts.

interface Issue {
  child: { kind: string; id?: string; rect: { x: number; y: number; w: number; h: number } };
  parent: { kind: string; id?: string };
  overflow: { left: number; top: number; right: number; bottom: number };
}

const describeIssue = (i: Issue): string =>
  `${i.child.kind}${i.child.id ? `#${i.child.id}` : ""} escapes ` +
  `${i.parent.kind}${i.parent.id ? `#${i.parent.id}` : ""} by ` +
  `${JSON.stringify(i.overflow)}`;

async function probe(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiProbe);
  await page.evaluate(() => window.__uiProbe!.capture(true));
  // Auto-sized containers settle over a few frames; wait for a captured frame.
  await expect.poll(() => page.evaluate(() => window.__uiProbe!.tree().length)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
}

const issues = (page: Page): Promise<Issue[]> =>
  page.evaluate(() => window.__uiProbe!.issues() as unknown[]) as Promise<Issue[]>;

for (const sample of [
  "synth",
  "serverbrowser",
  "guild-trader",
  "solitaire",
  "menu-nav",
  "ui-gallery",
]) {
  test(`${sample}: no widget escapes the container that placed it`, async ({ page }) => {
    await probe(page, `/${sample}/`);
    const found = await issues(page);
    expect(found.map(describeIssue)).toEqual([]);
  });
}

test("ui-gallery keeps its layout intact at 1.5× UI scale", async ({ page }) => {
  // Scale is where containment breaks: a container that measures its content in
  // one space and places it in another only misbehaves once the two differ.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await probe(page, "/ui-gallery/");
  await page.evaluate(() => window.__uiGallery!.setScale(1.5));
  await page.waitForTimeout(300);
  const found = await issues(page);
  expect(found.map(describeIssue)).toEqual([]);
});

test("Tab scrolls a focused widget in the gallery's scroll region into view", async ({ page }) => {
  // The reported bug: Tab reached widgets below the clip and left them there —
  // a focus ring nobody can see. The region must follow the focus.
  await page.setViewportSize({ width: 1280, height: 800 });
  await probe(page, "/ui-gallery/");
  await page.locator("canvas#game").click({ position: { x: 5, y: 5 } });
  let sawScrolled = false;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    const focus = await page.evaluate(() => {
      const id = window.__uiProbe!.focused();
      const e = window.__uiProbe!.tree().find((x) => x.id === id);
      return e ? { id, rect: e.screenRect } : null;
    });
    if (!focus) continue;
    const bottom = focus.rect.y + focus.rect.h;
    // Anything reachable by Tab has to be on screen once the reveal has run.
    expect(focus.rect.y, `${focus.id} sits above the viewport`).toBeGreaterThanOrEqual(-1);
    expect(bottom, `${focus.id} sits below the viewport`).toBeLessThanOrEqual(801);
    if (focus.rect.y > 300) sawScrolled = true;
  }
  // …and the walk really did reach into the scrolled board, not just the header.
  expect(sawScrolled).toBe(true);
});
