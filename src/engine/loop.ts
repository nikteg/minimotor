import type { AppCallbacks, Runtime, FrameTimings } from "./app.js";

export interface LoopApi {
  run(callbacks: AppCallbacks): void;
  pause(): void;
  resume(): void;
  stop(): void;
  onStep(handler: () => void): () => void;
  onStepStart(handler: () => void): () => void;
  onFrame(handler: () => void): () => void;
  readonly step: number;
  readonly steps: number;
  readonly frameDelta: number;
  readonly interpolation: number;
  readonly paused: boolean;
  readonly timings: FrameTimings;
}

/** Create loop controls permanently bound to one app. */
export function createLoop(app: Runtime): LoopApi {
  return {
    run(callbacks) {
      app.run(callbacks);
    },
    pause() {
      app.pause();
    },
    resume() {
      app.resume();
    },
    stop() {
      app.stop();
    },
    onStep(handler) {
      return app.onStep(handler);
    },
    onStepStart(handler) {
      return app.onStepStart(handler);
    },
    onFrame(handler) {
      return app.onFrame(handler);
    },
    get step() {
      return app.step;
    },
    get steps() {
      return app.steps;
    },
    get frameDelta() {
      return app.frameDelta;
    },
    get interpolation() {
      return app.interpolation;
    },
    get paused() {
      return app.paused;
    },
    get timings() {
      return app.timings;
    },
  };
}
