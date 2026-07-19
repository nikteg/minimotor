"use strict";

// ---------- Minimal game framework ----------
// Game loop, canvas setup, collision helpers and viewport management.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical width in CSS pixels */
  w: number;
  /** Logical height in CSS pixels */
  h: number;
  /** Device pixel ratio (capped at 2 for perf) */
  dpr: number;
  /** Safe area left inset (notch etc.) */
  safeLeft: number;
  /** Safe area top inset */
  safeTop: number;
}

export interface EngineShape {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  viewport: Viewport | null;
  onUpdate: (() => void) | null;
  onDraw: (() => void) | null;
  onKeyDown?: (code: string) => void;
  onResize?: (vp: Viewport) => void;
  lastTime: number;
  accumulator: number;
  frameScale: number;
  readonly STEP_MS: number;
  paused: boolean;
  loop: (time: number) => void;
  initCanvas(selector: string): Viewport;
  init(canvas: HTMLCanvasElement): void;
  start(update: () => void, draw: () => void): void;
  /** Pause the engine when a mobile device is held in portrait */
  pauseOnPortrait(): void;
}

function readViewport(canvas: HTMLCanvasElement): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rootStyle = getComputedStyle(document.documentElement);
  let safeLeft = parseFloat(rootStyle.getPropertyValue("--sai-left")) || 0;
  const safeTop = parseFloat(rootStyle.getPropertyValue("--sai-top")) || 0;

  // iPhone notch detection: the same inset appears on both sides in landscape.
  // 90 = notch left, -90 / 270 = notch right.
  if (/iPhone/.test(navigator.userAgent)) {
    let angle: number | null = null;
    const win = window as unknown as { orientation?: number };
    if (typeof win.orientation === "number") angle = win.orientation;
    else if (screen.orientation && typeof screen.orientation.angle === "number")
      angle = screen.orientation.angle;
    if (angle === -90 || angle === 270) {
      safeLeft = 0;
      document.documentElement.dataset.notch = "right";
    } else if (angle === 90) {
      document.documentElement.dataset.notch = "left";
    } else {
      document.documentElement.dataset.notch = "none";
    }
  }

  return { canvas, ctx, w, h, dpr, safeLeft, safeTop };
}

export const Engine: EngineShape = {
  canvas: null,
  ctx: null,
  viewport: null,
  onUpdate: null,
  onDraw: null,
  lastTime: 0,
  accumulator: 0,
  frameScale: 1,
  STEP_MS: 1000 / 60,
  paused: false,

  initCanvas(selector: string): Viewport {
    const canvas = document.getElementById(selector) as HTMLCanvasElement;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.viewport = readViewport(canvas);

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      if (this.onKeyDown) this.onKeyDown(e.code);
    });

    const onResize = () => {
      this.viewport = readViewport(canvas);
      this.onResize?.(this.viewport);
    };
    window.addEventListener("resize", onResize);
    // iOS doesn't fire resize on 180° rotation between landscape orientations
    const orient = () => {
      onResize();
      setTimeout(onResize, 300);
    };
    window.addEventListener("orientationchange", orient);
    if (screen.orientation?.addEventListener) screen.orientation.addEventListener("change", orient);

    return this.viewport;
  },

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
    this.loop = this.loop.bind(this);
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

  pauseOnPortrait() {
    const mq = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
    const apply = () => {
      this.paused = mq.matches;
    };
    mq.addEventListener?.("change", apply);
    apply();
  },
};

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
