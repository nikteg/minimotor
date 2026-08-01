// Sprite throughput benchmark — the measurement `docs/plan-gpu-rendering.md`
// asks for before any of the GPU work is worth starting.
//
// The question it answers is narrow and specific: at what N does
// `Draw.sprites` stop holding 60fps on THIS machine? If that number is
// comfortably above what a game built on the engine needs, stages 2–3 of the
// plan are premature and only the OffscreenCanvas work is worth shipping.
//
// Two things are measured, and they are not the same:
//
//   drawMs   time inside the draw callback — the renderer's own cost. Rises
//            monotonically with N and is the number to compare between
//            backends, because it is not clamped by the display.
//   frameMs  rAF to rAF. What the player feels, but it SATURATES at the
//            refresh interval: on a 60Hz panel every N from 1 to the wall
//            reads 16.7ms, and on a 120Hz one the wall is somewhere else
//            entirely. The verdict uses this, `drawMs` explains it.
//
// The ramp is an exponential search followed by a bisection, so it finds the
// wall in ~15 measurements instead of crawling. Each measurement throws away
// warmup frames (a resize of the sprite array perturbs the allocator and the
// first frames after it are not representative) and takes the MEDIAN of the
// rest — one GC pause must not decide the answer.
//
// Both sprite paths are here because `Draw.sprites` has two, and they differ
// by more than a constant: an unrotated, unscaled sprite takes
// `blitPixelAligned` directly, while any rotation/scale/flip pays a
// save/translate/rotate/restore around the same blit. A batcher collapses that
// difference entirely, so the gap between the two modes is itself an estimate
// of what stage 2 buys.
import { createPerformanceMonitoring } from "minimotor/performance";
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import * as Sprites from "minimotor/sprites";
import type { DrawSprite } from "minimotor";

const game = createApp("game", { background: "#0b0e14" });
createPerformanceMonitoring(game);
const view = game.viewport;
const { Draw, Loop } = game;
const UI = createUI(game);

const SPRITE = 16;

// A flat texture, not a gradient: the benchmark measures blit throughput, and
// a fancy source image would only add a constant.
const tex = Sprites.getSprite("bench", SPRITE, view.dpr, (ctx) => {
  ctx.fillStyle = "#4ecdc4";
  ctx.fillRect(-SPRITE / 2, -SPRITE / 2, SPRITE, SPRITE);
  ctx.fillStyle = "#1d2b36";
  ctx.fillRect(-SPRITE / 2 + 3, -SPRITE / 2 + 3, SPRITE - 6, SPRITE - 6);
});

interface Mover extends DrawSprite {
  vx: number;
  vy: number;
  spin: number;
}

const sprites: Mover[] = [];
let mode: "blit" | "transform" = "blit";
let culling = false;

/** Grow or shrink the population in place. Reusing the objects keeps the
 *  measurement about drawing rather than about allocation. */
function resize(n: number): void {
  while (sprites.length > n) sprites.pop();
  while (sprites.length < n) {
    sprites.push({
      img: tex,
      x: Math.random() * view.w,
      y: Math.random() * view.h,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      rot: 0,
      spin: (Math.random() - 0.5) * 0.1,
    });
  }
}

function step(): void {
  const spin = mode === "transform";
  for (const s of sprites) {
    s.x += s.vx;
    s.y += s.vy;
    if (s.x < 0 || s.x > view.w) s.vx = -s.vx;
    if (s.y < 0 || s.y > view.h) s.vy = -s.vy;
    s.rot = spin ? (s.rot ?? 0) + s.spin : 0;
  }
}

// ---- measurement ----------------------------------------------------------

const WARMUP = 20;
const SAMPLES = 40;
/** 60fps. The plan states the target; it is not derived from the display, or
 *  a 120Hz panel would silently answer a different question. */
const BUDGET_MS = 1000 / 60;

class Window {
  private readonly values: number[] = [];
  private skip = WARMUP;

  reset(): void {
    this.values.length = 0;
    this.skip = WARMUP;
  }
  push(ms: number): void {
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    this.values.push(ms);
    if (this.values.length > SAMPLES) this.values.shift();
  }
  get full(): boolean {
    return this.values.length >= SAMPLES;
  }
  /** Median, not mean: a single GC pause in a 40-frame window must not decide
   *  where the wall is. */
  get median(): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
  }
}

const drawWindow = new Window();
const frameWindow = new Window();
let lastFrame = 0;

interface Verdict {
  /** Largest N that held the budget. */
  n: number;
  drawMs: number;
  frameMs: number;
  mode: string;
}

// Exponential search up, then bisect. `lo` is the biggest N known to hold the
// budget, `hi` the smallest known to miss it.
let ramping = false;
let lo = 0;
let hi = 0;
let target = 1000;
let verdict: Verdict | null = null;

function startRamp(): void {
  ramping = true;
  verdict = null;
  lo = 0;
  hi = 0;
  target = 1000;
  resize(target);
  drawWindow.reset();
  frameWindow.reset();
}

function rampStep(): void {
  if (!frameWindow.full) return;
  const held = frameWindow.median <= BUDGET_MS;
  if (held) lo = target;
  else hi = target;

  if (hi === 0) {
    target *= 2; // still climbing — no upper bound found yet
  } else {
    // Within 5% (or 250 sprites) is precise enough to make a decision on.
    if (hi - lo <= Math.max(250, lo * 0.05)) {
      ramping = false;
      verdict = {
        n: lo,
        drawMs: drawWindow.median,
        frameMs: frameWindow.median,
        mode: `${mode}${culling ? " + cull" : ""}`,
      };
      resize(lo);
      drawWindow.reset();
      frameWindow.reset();
      return;
    }
    target = Math.round((lo + hi) / 2);
  }
  resize(target);
  drawWindow.reset();
  frameWindow.reset();
}

// ---- headless driver ------------------------------------------------------
// A Playwright spec drives the ramp and reads the verdict; the numbers in the
// plan should come from a real machine, but CI can at least catch a
// regression against its own baseline.
declare global {
  interface Window {
    __bench?: {
      run(options?: { mode?: "blit" | "transform"; cull?: boolean }): void;
      result(): Verdict | null;
      busy(): boolean;
      setCount(n: number): void;
      sample(): { n: number; drawMs: number; frameMs: number } | null;
    };
  }
}
window.__bench = {
  run: (options) => {
    if (options?.mode) mode = options.mode;
    if (options?.cull !== undefined) culling = options.cull;
    startRamp();
  },
  result: () => verdict,
  busy: () => ramping,
  setCount: (n) => {
    resize(n);
    drawWindow.reset();
    frameWindow.reset();
  },
  sample: () =>
    frameWindow.full
      ? {
          n: sprites.length,
          drawMs: drawWindow.median,
          frameMs: frameWindow.median,
        }
      : null,
};

resize(target);

Loop.run({
  update() {
    step();
  },

  draw() {
    const now = performance.now();
    if (lastFrame !== 0) frameWindow.push(now - lastFrame);
    lastFrame = now;

    Draw.sprites(sprites, culling ? { view: { x: 0, y: 0, w: view.w, h: view.h } } : undefined);
    // Measured around the sprite call only — the UI below is chrome, and
    // counting it would tax the thing under test with the cost of reporting
    // on it.
    drawWindow.push(performance.now() - now);

    if (ramping) rampStep();

    UI.panel({ x: 12, y: 12, w: 300, title: "SPRITE THROUGHPUT" }, () => {
      UI.text(`sprites  ${sprites.length.toLocaleString()}`, { size: 13 });
      UI.text(`draw     ${drawWindow.median.toFixed(2)} ms`, { size: 13 });
      UI.text(`frame    ${frameWindow.median.toFixed(2)} ms`, { size: 13 });
      UI.text(`mode     ${mode}${culling ? " + cull" : ""}`, {
        color: "dim",
        size: 12,
      });

      UI.row({ gap: 8 }, () => {
        if (UI.button({ label: ramping ? "…" : "Find wall", disabled: ramping })) startRamp();
        if (UI.button({ label: mode === "blit" ? "Blit" : "Rotate" })) {
          mode = mode === "blit" ? "transform" : "blit";
        }
        if (UI.button({ label: culling ? "Cull on" : "Cull off" })) culling = !culling;
      });
      UI.row({ gap: 8 }, () => {
        if (UI.button({ label: "−1k" })) resize(Math.max(0, sprites.length - 1000));
        if (UI.button({ label: "+1k" })) resize(sprites.length + 1000);
      });

      if (verdict) {
        UI.text(`60fps wall: ${verdict.n.toLocaleString()} sprites`, {
          color: "accent",
          size: 14,
        });
        UI.text(`at ${verdict.drawMs.toFixed(2)} ms of draw · ${verdict.mode}`, {
          color: "dim",
          size: 12,
        });
      } else if (ramping) {
        UI.text(`searching · lo ${lo} hi ${hi || "?"}`, {
          color: "dim",
          size: 12,
        });
      }
    });
  },
});
