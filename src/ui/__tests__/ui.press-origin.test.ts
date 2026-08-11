// A click is a press and a release on the same widget. Before `pressOrigin`
// the release was the whole of it, so a drag that began on the world behind a
// HUD — or on a different button — fired whatever happened to be under the
// pointer when it came up.
import { beforeEach, describe, expect, it } from "vitest";
import { buttonState, pressOrigin } from "@src/ui/core/input.js";
import { _reset } from "@src/ui/core/lifecycle.js";
import { selectUiApp } from "@src/ui/core/state.js";
import { createTestUiApp, stepTestApp } from "./app-fixture.js";
import type { App } from "@src/engine/index.js";

const RECT = { x: 100, y: 100, w: 80, h: 40 };
const OTHER = { x: 300, y: 100, w: 80, h: 40 };
const INSIDE = { x: 140, y: 120 };
const RELEASE = { down: false, released: true };

function press(app: App, x: number, y: number): void {
  const p = app.Pointer as unknown as { x: number; y: number; pressed: boolean };
  p.x = x;
  p.y = y;
  p.pressed = true;
  stepTestApp(app);
  p.pressed = false;
}

describe("buttonState press origin", () => {
  beforeEach(() => _reset());

  it("takes a click only when the press began on the widget", () => {
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }, { x: 140, y: 120 }).clicked).toBe(true);
    // The press was on the world behind the HUD; the release drifted onto the
    // button. Nothing about that is this button's click.
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }, { x: 600, y: 400 }).clicked).toBe(false);
  });

  it("still counts a press that wanders off the widget and comes back", () => {
    // The pointer left and returned; both ends are on the button, which is what
    // every other toolkit calls a click too.
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }, { x: 101, y: 101 }).clicked).toBe(true);
  });

  it("leaves hover and active alone — only the click edge is gated", () => {
    const away = { x: 600, y: 400 };
    expect(buttonState(RECT, { ...INSIDE, down: true, released: false }, away)).toEqual({
      hover: true,
      active: true,
      clicked: false,
    });
  });

  it("reads the origin off the app's own press when none is passed", () => {
    const app = createTestUiApp({} as CanvasRenderingContext2D);
    selectUiApp(app);
    // `pressOrigin` wires the step hook on first ask, so nothing is recorded
    // until something has looked — which is exactly when it starts to matter.
    expect(pressOrigin()).toBeNull();

    press(app, 140, 120);
    expect(pressOrigin()).toEqual({ x: 140, y: 120 });
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }).clicked).toBe(true);
    // The same release, on the button the gesture did NOT start on.
    expect(buttonState(OTHER, { x: 340, y: 120, ...RELEASE }).clicked).toBe(false);

    press(app, 340, 120);
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }).clicked).toBe(false);
    expect(buttonState(OTHER, { x: 340, y: 120, ...RELEASE }).clicked).toBe(true);
  });

  it("survives the release step, where the pointer is already up", () => {
    // The origin is overwritten by the next press and never cleared. Clearing
    // it on "not down" would wipe it in the very step that needs it, because
    // the release edge and `down === false` arrive together.
    const app = createTestUiApp({} as CanvasRenderingContext2D);
    selectUiApp(app);
    void pressOrigin();
    press(app, 140, 120);
    stepTestApp(app);
    stepTestApp(app);
    expect(pressOrigin()).toEqual({ x: 140, y: 120 });
  });

  it("opts out with an explicit null, and before the first press of a session", () => {
    // Null is what a caller using `buttonState` as a bare hit test wants, and
    // what a session that has never seen a press honestly reports.
    expect(buttonState(RECT, { ...INSIDE, ...RELEASE }, null).clicked).toBe(true);
    expect(pressOrigin()).toBeNull();
  });
});
