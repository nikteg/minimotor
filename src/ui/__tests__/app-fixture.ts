import type { App } from "@src/engine/index.js";
import { registerUiApp } from "@src/ui/core/state.js";

const noop = (): void => {};
const unsubscribe = (): void => {};

/** An explicit app boundary for low-level widget tests. */
export function createTestUiApp(ctx: CanvasRenderingContext2D): App {
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
    onStep: () => unsubscribe,
    onFrame: () => unsubscribe,
  } as unknown as App;

  return registerUiApp(app);
}
