import type { App } from "@src/engine/index.js";
import { registerUiApp } from "@src/ui/core/state.js";

const noop = (): void => {};
const unsubscribe = (): void => {};

/** Frame-end handlers registered by the kernel, per test app — so a test can
 *  run TWO frames and see per-frame state (the wheel claim, the pointer cache)
 *  actually reset in between. */
const frameHandlers = new WeakMap<App, (() => void)[]>();
/** Fixed-step handlers, the counterpart of `frameHandlers`. Anything that reads
 *  a one-step-long input edge — the press origin, gamepad nav — runs here. */
const stepHandlers = new WeakMap<App, (() => void)[]>();

/** Run one frame boundary for a test app: everything `app.onFrame` collected.
 *  Without this a test is always inside frame one, and any bug about state
 *  surviving into frame two is invisible. */
export function endTestFrame(app: App): void {
  for (const h of frameHandlers.get(app) ?? []) h();
}

/** Run one fixed step for a test app, which is where the kernel samples input
 *  edges. A test that sets `app.Pointer.pressed` and never calls this is
 *  describing a press the UI never saw. */
export function stepTestApp(app: App): void {
  for (const h of stepHandlers.get(app) ?? []) h();
}

/** An explicit app boundary for low-level widget tests. */
export function createTestUiApp(ctx: CanvasRenderingContext2D): App {
  const handlers: (() => void)[] = [];
  const steps: (() => void)[] = [];
  const canvas = (ctx.canvas ?? {
    width: 0,
    height: 0,
    style: {},
    hasAttribute: () => true,
    addEventListener: noop,
  }) as HTMLCanvasElement;
  const app = {
    ctx,
    viewport: {
      canvas,
      ctx,
      w: canvas.width ?? 0,
      h: canvas.height ?? 0,
      dpr: 1,
      safeLeft: 0,
      safeTop: 0,
      safeRight: 0,
      safeBottom: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    Pointer: {
      x: -1,
      y: -1,
      inside: false,
      down: false,
      pressed: false,
      released: false,
      doublePressed: false,
      framePressed: false,
      frameReleased: false,
      frameDoublePressed: false,
      wheel: 0,
    },
    Loop: {
      run: noop,
      pause: noop,
      resume: noop,
      stop: noop,
      onStep: () => unsubscribe,
      onStepStart: () => unsubscribe,
      onFrame: () => unsubscribe,
      step: 1000 / 60,
      steps: 0,
      frameDelta: 0,
      interpolation: 0,
      paused: false,
      timings: { updateMs: 0, drawMs: 0, steps: 0 },
    },
    resetTransform: noop,
    setCursor: noop,
    onStep: (fn: () => void) => {
      steps.push(fn);
      return unsubscribe;
    },
    onFrame: (fn: () => void) => {
      handlers.push(fn);
      return unsubscribe;
    },
  } as unknown as App;
  frameHandlers.set(app, handlers);
  stepHandlers.set(app, steps);

  return registerUiApp(app);
}
