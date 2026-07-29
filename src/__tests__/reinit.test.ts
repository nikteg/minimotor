import { describe, it, expect, beforeEach, vi } from "vitest";
import { App, Loop, createApp } from "../engine/index.js";
import { Clock } from "../clock.js";
import { ensureWired, onFrameEnd, _reset as resetUi } from "../ui/core/index.js";

// `App.init()` is documented as re-callable — it tears the previous default
// app down and installs a new one. Anything that registered a handler on the
// OLD app's loop (the Clock timer driver, the UI kernel's frame-end
// housekeeping) has to re-attach, or it goes silently dead: no error, no
// failing assertion anywhere else, just timers that never fire and a UI whose
// pointer cache never clears. These are the regression tests for that.

let rafCallback: ((t: number) => void) | null = null;
const origGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return origGetContext.call(this, type);
    return {
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      canvas: this,
    } as unknown as CanvasRenderingContext2D;
  };
  rafCallback = null;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  Clock._reset();
  resetUi();
});

/** Drive one animation frame. NOTE: the loop's `if (!lastTime) lastTime = time`
 *  means a first tick at t=0 yields zero elapsed and runs no steps — always
 *  drive with non-zero timestamps. */
function tick(time: number): void {
  const cb = rafCallback;
  rafCallback = null;
  cb?.(time);
}

/** Two frames far enough apart to run the loop's max catch-up steps. */
function runFrames(): void {
  tick(16);
  tick(400);
}

function makeCanvas(id: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.id = id;
  document.body.appendChild(canvas);
  return canvas;
}

describe("App.init() re-init", () => {
  it("keeps Clock timers firing on the new app", () => {
    makeCanvas("re-a");
    makeCanvas("re-b");

    App.init("re-a");
    let firedOnA = 0;
    Clock.world.every(Loop.step, () => firedOnA++);
    Loop.run({ update() {}, draw() {} });
    runFrames();
    expect(firedOnA).toBeGreaterThan(0);

    // Re-init: the app the timer driver wired onto is destroyed here.
    App.init("re-b");
    let firedOnB = 0;
    Clock.world.every(Loop.step, () => firedOnB++);
    Loop.run({ update() {}, draw() {} });
    runFrames();
    expect(firedOnB).toBeGreaterThan(0);
  });

  it("re-drives timers scheduled BEFORE the re-init", () => {
    makeCanvas("re-c");
    makeCanvas("re-d");

    App.init("re-c");
    let fired = 0;
    // Scheduled against the first app, never re-registered afterwards.
    Clock.world.every(Loop.step, () => fired++);
    Loop.run({ update() {}, draw() {} });
    runFrames();
    const beforeReinit = fired;

    App.init("re-d");
    Loop.run({ update() {}, draw() {} });
    runFrames();
    expect(fired).toBeGreaterThan(beforeReinit);
  });

  it("keeps UI frame-end housekeeping running on the new app", () => {
    makeCanvas("re-e");
    makeCanvas("re-f");

    App.init("re-e");
    let ran = 0;
    onFrameEnd(() => ran++);
    ensureWired();
    Loop.run({ update() {}, draw() {} });
    runFrames();
    expect(ran).toBeGreaterThan(0);

    App.init("re-f");
    ran = 0;
    ensureWired();
    Loop.run({ update() {}, draw() {} });
    runFrames();
    expect(ran).toBeGreaterThan(0);
  });
});

describe("app.destroy()", () => {
  it("drops every handler set, including frame handlers", () => {
    const canvas = makeCanvas("destroy-a");
    const app = createApp({ canvas });

    let steps = 0;
    let frames = 0;
    let stepStarts = 0;
    app.onStep(() => steps++);
    app.onStepStart(() => stepStarts++);
    app.onFrame(() => frames++);
    app.run({ update() {}, draw() {} });
    runFrames();
    expect(steps).toBeGreaterThan(0);
    expect(stepStarts).toBeGreaterThan(0);
    expect(frames).toBeGreaterThan(0);

    app.destroy();
    const after = { steps, frames, stepStarts };
    // A rAF still in flight must find no handlers left to call.
    tick(800);
    expect(steps).toBe(after.steps);
    expect(stepStarts).toBe(after.stepStarts);
    expect(frames).toBe(after.frames);
  });
});
