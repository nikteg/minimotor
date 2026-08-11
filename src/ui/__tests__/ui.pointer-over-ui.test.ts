import { describe, expect, it } from "vitest";
import { buttonState, markPointerOverUi, pointerOverUi } from "@src/ui/core/input.js";
import { captureOverlay } from "@src/ui/core/lifecycle.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp, endTestFrame } from "./app-fixture.js";

// `pointerOverUi` is what keeps a game drawn UNDER its HUD from also acting on
// the presses the HUD is using — a click on a button that additionally orbits
// the camera behind it, or picks something out of the scene. The awkward part
// is the ORDER: an immediate-mode HUD is drawn after the world it covers, so
// the world asks the question a whole frame before this frame's widgets exist,
// and the answer has to span both.

function testApp() {
  const ctx = { canvas: { width: 800, height: 600 } } as unknown as CanvasRenderingContext2D;
  const app = createTestUiApp(ctx);
  selectUiApp(app);
  return app;
}

const RECT = { x: 100, y: 100, w: 80, h: 40 };
const IDLE = { down: false, released: false };

describe("pointerOverUi", () => {
  it("starts false and follows a widget's own hit test", () => {
    testApp();
    expect(pointerOverUi()).toBe(false);
    buttonState(RECT, { x: 0, y: 0, ...IDLE });
    expect(pointerOverUi()).toBe(false);
    buttonState(RECT, { x: 140, y: 120, ...IDLE });
    expect(pointerOverUi()).toBe(true);
  });

  it("answers for the frame just drawn, for a world that asks before the HUD", () => {
    // The whole point. Frame one draws a hovered button; frame two's world
    // reads the pointer BEFORE the UI runs and must still be told the button
    // is there.
    const app = testApp();
    buttonState(RECT, { x: 140, y: 120, ...IDLE });
    endTestFrame(app);
    selectUiApp(app);
    expect(pointerOverUi()).toBe(true);
  });

  it("clears once a frame goes by with nothing under the pointer", () => {
    const app = testApp();
    markPointerOverUi();
    endTestFrame(app);
    selectUiApp(app);
    expect(pointerOverUi()).toBe(true); // still last frame's answer
    endTestFrame(app);
    selectUiApp(app);
    expect(pointerOverUi()).toBe(false);
  });

  it("hands the whole screen to an overlay", () => {
    // A modal is up: the pointer belongs to the UI wherever it happens to be,
    // because the background is dead to it anyway.
    testApp();
    captureOverlay();
    expect(pointerOverUi()).toBe(true);
  });

  it("keeps two apps apart", () => {
    const a = testApp();
    const b = createTestUiApp({
      canvas: { width: 800, height: 600 },
    } as unknown as CanvasRenderingContext2D);
    selectUiApp(a);
    markPointerOverUi();
    selectUiApp(b);
    expect(pointerOverUi()).toBe(false);
    selectUiApp(a);
    expect(pointerOverUi()).toBe(true);
  });

  it("says nothing, rather than throwing, with no app selected", () => {
    // `buttonState` doubles as a plain hit-test helper, and a caller is free to
    // run it on a rect of its own outside any frame.
    const app = testApp();
    endTestFrame(app);
    expect(() => buttonState(RECT, { x: 140, y: 120, ...IDLE })).not.toThrow();
  });
});
