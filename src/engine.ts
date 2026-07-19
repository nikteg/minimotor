"use strict";

// ---------- Minimal game framework ----------
// A simple engine with game loop, entities and collision helpers.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineShape {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  onUpdate: (() => void) | null;
  onDraw: (() => void) | null;
  onKeyDown?: (code: string) => void;
  lastTime: number;
  accumulator: number;
  // How long the latest frame was relative to a 60 Hz step (0.5 on a 120 Hz
  // display). Used by purely visual animations (e.g. background particles
  // that should move even on the start screen) so they keep uniform speed.
  frameScale: number;
  // Physics are tuned in "per frame" values for 60 fps. Therefore updates
  // run in fixed 60 Hz steps regardless of display refresh rate (120+ Hz
  // displays would otherwise get double game speed). Drawing still runs
  // every display frame.
  readonly STEP_MS: number;
  // Set when the game should not tick (rotate-screen hint on mobile in
  // portrait). Drawing continues so the view doesn't freeze, but time
  // stands still.
  paused: boolean;
  loop: (time: number) => void;
  init(canvas: HTMLCanvasElement): void;
  start(update: () => void, draw: () => void): void;
}

export const Engine: EngineShape = {
  canvas: null,
  ctx: null,
  onUpdate: null,
  onDraw: null,
  lastTime: 0,
  accumulator: 0,
  frameScale: 1,
  STEP_MS: 1000 / 60,
  paused: false,

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      if (this.onKeyDown) this.onKeyDown(e.code);
    });
  },

  start(update: () => void, draw: () => void) {
    this.onUpdate = update;
    this.onDraw = draw;
    this.loop = this.loop.bind(this); // bind once instead of every frame
    requestAnimationFrame(this.loop);
  },

  loop(time: number) {
    if (!this.lastTime) this.lastTime = time;
    if (this.paused) {
      this.lastTime = time;
      this.accumulator = 0;
      this.frameScale = 0;
      this.onDraw!();
      requestAnimationFrame(this.loop);
      return;
    }
    let elapsed = time - this.lastTime;
    this.lastTime = time;
    // After e.g. a tab switch elapsed can be huge - don't catch up,
    // it would cause a storm of updates (and unfair death).
    if (elapsed > 250) elapsed = 250;
    this.frameScale = elapsed / this.STEP_MS;
    this.accumulator += elapsed;
    while (this.accumulator >= this.STEP_MS) {
      this.onUpdate!();
      this.accumulator -= this.STEP_MS;
    }
    this.onDraw!();
    requestAnimationFrame(this.loop);
  },
};

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
