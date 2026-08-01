import { test, expect, type Page } from "@playwright/test";

// Text selection and the clipboard for `UI.textInput`, against the real
// ui-gallery page.
//
// The widget draws on canvas but delegates editing to a hidden native element,
// so these are the only tests that can prove the two agree: the assertions read
// BOTH the app-visible value (`__uiGallery.getState()`) and the native
// element's live `value`/`selectionStart`/`selectionEnd`. A bug where the
// canvas mirror and the element disagree — or where a canvas-side selection
// write never reaches the element the clipboard copies from — shows up as those
// two disagreeing, which is exactly what pixel tests cannot see.
//
// Geometry comes from the layout-capture harness, never from hardcoded coords.

interface Entry {
  kind: string;
  id?: string;
  rect: { x: number; y: number; w: number; h: number };
  screenRect: { x: number; y: number; w: number; h: number };
  scale: number;
}

type Rect = Entry["screenRect"];

/** The live hidden editor's value + selection, or null when none is mounted. */
interface Native {
  tag: string;
  value: string;
  start: number;
  end: number;
  dir: string;
}

const nativeState = (page: Page): Promise<Native | null> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "[data-minimotor-ui]",
    );
    if (!el) return null;
    return {
      tag: el.tagName.toLowerCase(),
      value: el.value,
      start: el.selectionStart ?? -1,
      end: el.selectionEnd ?? -1,
      dir: el.selectionDirection ?? "none",
    };
  });

const selectedText = async (page: Page): Promise<string> => {
  const n = await nativeState(page);
  return n ? n.value.slice(n.start, n.end) : "";
};

const getState = (page: Page) => page.evaluate(() => window.__uiGallery!.getState());

async function openGallery(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto("/ui-gallery/");
  await expect(page.locator("canvas#game")).toBeVisible();
  await page.waitForFunction(() => !!window.__uiGallery);
  await page.evaluate(() => window.__uiGallery!.layoutCapture(true));
  await expect
    .poll(async () => (await field(page, "ui-gallery:input-name")).r.w)
    .toBeGreaterThan(0);
}

/** A field's on-screen box, plus the UI scale it was drawn at. */
async function field(page: Page, id: string): Promise<{ r: Rect; scale: number }> {
  const tree = (await page.evaluate(() => window.__uiGallery!.layoutTree())) as unknown as Entry[];
  const e = tree.find((entry) => entry.id === id);
  return { r: e?.screenRect ?? { x: 0, y: 0, w: 0, h: 0 }, scale: e?.scale ?? 1 };
}

/** Wait past the engine's 300ms double-press window. A drag that starts too
 *  soon after the click that focused the field is read as a double-click, which
 *  selects a WORD instead of starting a drag — a real user never types between
 *  the two, but a test does. */
const pastDoubleClick = (page: Page) => page.waitForTimeout(400);

/** Let the game loop observe the pointer. The widget is immediate-mode: it can
 *  only read a pointer position once per frame, so a synthetic press-move-release
 *  delivered inside a single rAF is a CLICK to it, not a drag. Real drags always
 *  span frames; these waits make the synthetic ones span frames too. */
const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

/** Press at `fromX`, drag to (`toX`, `toY`) and release — one observable frame
 *  per step. Returns once the release has been seen. */
async function dragSelect(
  page: Page,
  fromX: number,
  y: number,
  toX: number,
  toY = y,
): Promise<void> {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await nextFrame(page);
  await page.mouse.move(toX, toY, { steps: 8 });
  await nextFrame(page);
  await page.mouse.up();
  await nextFrame(page);
}

/** Click into a field and wait for its hidden editor to mount and focus. */
async function focusField(page: Page, id: string): Promise<{ r: Rect; scale: number }> {
  const f = await field(page, id);
  await page.mouse.click(f.r.x + 12 * f.scale, f.r.y + f.r.h / 2);
  await expect.poll(() => nativeState(page).then((n) => n?.tag ?? null)).not.toBeNull();
  return f;
}

/** Screen x of the caret slot before character `index`. Measured through the
 *  gallery harness in the ACTIVE theme's font — a hardcoded metric would break
 *  on every theme switch, and the canvas's own `measureText` reports whatever
 *  font the last draw call happened to leave set. */
async function caretX(
  page: Page,
  f: { r: Rect; scale: number },
  text: string,
  index: number,
): Promise<number> {
  const w = await page.evaluate(
    (s: string) => window.__uiGallery!.textWidth(s),
    text.slice(0, index),
  );
  // The field insets its text by 9px of frame plus the theme's text padding
  // (0 in the gallery's themes), in UI px — scaled to screen here.
  return f.r.x + (9 + w) * f.scale;
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("typing lands in both the native element and the app's value", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Zelda");

  await expect.poll(() => getState(page).then((s) => s.name)).toBe("Zelda");
  expect(await nativeState(page)).toMatchObject({ tag: "input", value: "Zelda" });
});

test("select-all then copy puts the field's text on the clipboard", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Hyrule");

  await page.keyboard.press("ControlOrMeta+a");
  await expect.poll(() => selectedText(page)).toBe("Hyrule");

  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Hyrule");
  // Copy must not disturb the field.
  await expect.poll(() => getState(page).then((s) => s.name)).toBe("Hyrule");
});

test("cut removes the selection from the field and leaves it on the clipboard", async ({
  page,
}) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Hyrule");

  // Select the first three characters with Shift+Home from the end.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowLeft"); // collapse to the start
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => selectedText(page)).toBe("Hyr");

  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Hyr");
  await expect.poll(() => getState(page).then((s) => s.name)).toBe("ule");
  expect(await nativeState(page)).toMatchObject({ value: "ule" });
});

test("paste inserts at the caret and replaces a selection", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Link");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");

  // Caret at the end, nothing selected: paste appends.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => getState(page).then((s) => s.name)).toBe("LinkLink");

  // With a selection: paste replaces it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => getState(page).then((s) => s.name)).toBe("Link");
});

test("paste is clamped by maxLength", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name"); // maxLength: 16
  await page.evaluate(() => navigator.clipboard.writeText("0123456789ABCDEFGHIJ"));
  await page.keyboard.press("ControlOrMeta+v");

  await expect.poll(() => getState(page).then((s) => s.name)).toBe("0123456789ABCDEF");
});

test("dragging across the field selects the dragged range", async ({ page }) => {
  await openGallery(page);
  const f = await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Hyrule");
  await expect.poll(() => nativeState(page).then((n) => n?.value)).toBe("Hyrule");

  await pastDoubleClick(page);
  const from = await caretX(page, f, "Hyrule", 0);
  const to = await caretX(page, f, "Hyrule", 3);
  await dragSelect(page, from, f.r.y + f.r.h / 2, to);

  await expect.poll(() => selectedText(page)).toBe("Hyr");
});

test("a drag-selection copies — the canvas write reaches the native element", async ({ page }) => {
  await openGallery(page);
  const f = await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Hyrule");
  await expect.poll(() => nativeState(page).then((n) => n?.value)).toBe("Hyrule");

  await pastDoubleClick(page);
  const from = await caretX(page, f, "Hyrule", 2);
  const to = await caretX(page, f, "Hyrule", 6);
  await dragSelect(page, from, f.r.y + f.r.h / 2, to);
  await expect.poll(() => selectedText(page)).toBe("rule");

  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("rule");
});

test("double-click selects the word under the pointer, not the whole field", async ({ page }) => {
  await openGallery(page);
  const f = await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("red green");
  await expect.poll(() => nativeState(page).then((n) => n?.value)).toBe("red green");

  // Inside "green" (chars 4..9).
  const x = await caretX(page, f, "red green", 6);
  await page.mouse.dblclick(x, f.r.y + f.r.h / 2);
  await expect.poll(() => selectedText(page)).toBe("green");
});

test("a drag that leaves the field keeps extending the selection", async ({ page }) => {
  await openGallery(page);
  const f = await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Hyrule");
  await expect.poll(() => nativeState(page).then((n) => n?.value)).toBe("Hyrule");

  await pastDoubleClick(page);
  const from = await caretX(page, f, "Hyrule", 2);
  const y = f.r.y + f.r.h / 2;
  // Well past the right edge AND below the field — a real drag overshoots, and
  // the selection must keep tracking outside the field's clip region.
  await dragSelect(page, from, y, f.r.x + f.r.w + 200, y + 120);

  await expect.poll(() => selectedText(page)).toBe("rule");
});

test("clicking away commits the value and drops the editor", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-name");
  await page.keyboard.type("Zelda");

  const notes = await field(page, "ui-gallery:input-notes");
  await pastDoubleClick(page);
  await page.mouse.click(notes.r.x + 12 * notes.scale, notes.r.y + 10 * notes.scale);
  await nextFrame(page);

  await expect.poll(() => nativeState(page).then((n) => n?.tag ?? null)).toBe("textarea");
  await expect.poll(() => getState(page).then((s) => s.name)).toBe("Zelda");
});

test("the multiline field selects, cuts and pastes across lines", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-notes");
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");

  await expect.poll(() => nativeState(page).then((n) => n?.value)).toBe("one\ntwo");

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("one\ntwo");
  await expect.poll(() => getState(page).then((s) => s.notes)).toBe("");

  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => getState(page).then((s) => s.notes)).toBe("one\ntwo");
});

test("Enter in the multiline field inserts a newline instead of submitting", async ({ page }) => {
  await openGallery(page);
  await focusField(page, "ui-gallery:input-notes");
  await page.keyboard.type("a");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");

  await expect.poll(() => getState(page).then((s) => s.notes)).toBe("a\nb");
  // The editor must still be alive — Enter must not have blurred it.
  expect(await nativeState(page)).toMatchObject({ tag: "textarea" });
});
