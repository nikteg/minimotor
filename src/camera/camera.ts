// ---------- Camera ----------
// A camera is a LENS: it maps a world rect onto a screen rect. The default
// camera (the `Camera` facade) always exists — identity until configured — and
// maps its visible world slice onto the whole canvas; `Draw.*` calls inside
// `Camera.render(fn)` are world space, everything outside is screen space.
// Extra lenses (`createCamera`) map onto screen sub-rects via `into` for
// minimaps and split screen.
//
// Advancement is pull-based (API_PLAN law 4): follow damping and shake fold
// forward by the number of fixed steps elapsed since the last read. Dropped
// cameras cost nothing and GC away; the default camera is a platform facade
// and lives forever.

import { Draw, Stage, stepNow, type Rect } from "../engine/index.js";
import type { Vec2 } from "../vec2.js";
import { clamp } from "../mathf.js";

/** Anything with a position; a Rect-shaped target is followed by its center. */
export type FollowTarget = { x: number; y: number; w?: number; h?: number };

/** Config for a camera lens — world bounds, follow/deadzone/damping, zoom, fit. */
export interface CameraOptions {
  /** World rect the camera clamps its view to; `{w, h}` means origin 0,0.
   *  Omit for an unclamped camera. */
  world?: Rect | { w: number; h: number };
  /** Follow target (see `FollowTarget`). Retarget any time via `follow()`. */
  follow?: FollowTarget | null;
  /** Dead-zone box (world px), centered in the view: the target roams inside
   *  it freely; the camera moves only to keep it inside. Default: none. */
  deadzone?: { w?: number; h?: number };
  /** Per-step lerp factor toward the desired position (ease-out feel).
   *  1 = rigid lock. Default 0.15. */
  damping?: number;
  /** Magnification. >1 zooms in. Default 1. */
  zoom?: number;
  /** Static lens: always frame this whole rect (minimap). Overrides
   *  follow/damping/zoom. `{w, h}` means origin 0,0. */
  fit?: Rect | { w: number; h: number };
  /** View size the lens maps onto. Defaults to the live `Stage.viewport`
   *  (pass explicitly for camera math without a running engine). */
  view?: { w: number; h: number };
  /** Fixed-step source — injectable for tests. Defaults to the engine's
   *  step counter. */
  steps?: () => number;
}

/** Options for `Camera.render` — the screen sub-rect (`into`) the lens maps onto. */
export interface RenderOptions {
  /** Destination rect in SCREEN space. The lens maps its world rect into
   *  this rect (uniform scale, centered) and clips to it. Omitted: the whole
   *  canvas. */
  into?: Rect;
}

/** A world→screen lens: position, zoom, follow, shake, and space conversions. */
export interface CameraLens {
  /** Top-left of the visible world rect (before shake). */
  x: number;
  /** Top-left `y` of the visible world rect (before shake). */
  y: number;
  /** Magnification. `>1` zooms in; `1` is identity. */
  zoom: number;
  /** The visible world rect — culling, minimap viewfinders. Reused scratch
   *  object: read, don't hold. */
  readonly rect: Rect;
  /** Set/replace the follow target and optionally reconfigure. */
  follow(
    target: FollowTarget | null,
    opts?: Omit<CameraOptions, "follow" | "view" | "steps">,
  ): void;
  /** Jump straight to the desired position (scene entry — no visible lerp). */
  snap(): void;
  /** Impact shake: `amplitude` px decaying linearly over `ms`. */
  shake(amplitude: number, ms: number): void;
  /** Screen point → world point. `Camera.toWorld(Pointer)` is mouse picking. */
  toWorld(p: Vec2, out?: Vec2): Vec2;
  /** World point → screen point (off-screen markers, HUD callouts). */
  toScreen(p: Vec2, out?: Vec2): Vec2;
  /** Run `fn` with this lens applied: `Draw.*` inside is world space. */
  render(fn: () => void): void;
  render(opts: RenderOptions, fn: () => void): void;
  /** Parallax: run `fn` with this camera's translation scaled by `factor`
   *  (0 = screen-fixed, 1 = world). Call at the top level, not inside
   *  `render` — it applies the camera itself, at reduced strength. */
  layer(factor: number, fn: () => void): void;
}

const STEPS_PER_MS = 60 / 1000;

/** Deterministic per-step jitter in [-1, 1] — pull-derived shake needs no
 *  stored randomness. */
function wobble(seed: number): number {
  const s = Math.sin(seed) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function normRect(r: Rect | { w: number; h: number }): Rect {
  return { x: (r as Rect).x ?? 0, y: (r as Rect).y ?? 0, w: r.w, h: r.h };
}

export function createCamera(options: CameraOptions = {}): CameraLens {
  const steps = options.steps ?? stepNow;
  let world = options.world ? normRect(options.world) : null;
  let target: FollowTarget | null = options.follow ?? null;
  let deadzone = options.deadzone ?? null;
  let damping = options.damping ?? 0.15;
  let fit = options.fit ? normRect(options.fit) : null;

  const state = { x: 0, y: 0, zoom: options.zoom ?? 1 };
  let lastStep = steps();
  // Shake as a birth certificate: offset derives from the step counter.
  let shakeAmp = 0;
  let shakeStart = 0;
  let shakeSteps = 0;

  const scratchRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const scratchVec: Vec2 = { x: 0, y: 0 };

  function view(): { w: number; h: number } {
    return options.view ?? Stage.viewport;
  }

  function targetPoint(): { x: number; y: number } {
    const t = target!;
    return { x: t.x + (t.w ?? 0) / 2, y: t.y + (t.h ?? 0) / 2 };
  }

  /** Where the camera wants its top-left, honoring deadzone + world clamp. */
  function desired(): { x: number; y: number } {
    const v = view();
    const effW = v.w / state.zoom;
    const effH = v.h / state.zoom;
    let wantX = state.x;
    let wantY = state.y;
    if (target) {
      const t = targetPoint();
      const dzW = deadzone?.w ?? 0;
      const dzH = deadzone?.h ?? 0;
      // The deadzone box, centered in the current view:
      const left = state.x + (effW - dzW) / 2;
      const right = left + dzW;
      const top = state.y + (effH - dzH) / 2;
      const bottom = top + dzH;
      if (t.x < left) wantX -= left - t.x;
      else if (t.x > right) wantX += t.x - right;
      if (t.y < top) wantY -= top - t.y;
      else if (t.y > bottom) wantY += t.y - bottom;
    }
    if (world) {
      // Center the world when it's smaller than the view; clamp otherwise.
      wantX =
        world.w < effW
          ? world.x + (world.w - effW) / 2
          : clamp(wantX, world.x, world.x + world.w - effW);
      wantY =
        world.h < effH
          ? world.y + (world.h - effH) / 2
          : clamp(wantY, world.y, world.y + world.h - effH);
    }
    return { x: wantX, y: wantY };
  }

  /** Fold forward by the steps elapsed since the last read. */
  function fold(): void {
    const now = steps();
    let n = now - lastStep;
    lastStep = now;
    if (fit) {
      const v = view();
      state.zoom = Math.min(v.w / fit.w, v.h / fit.h);
      state.x = fit.x;
      state.y = fit.y;
      return;
    }
    if (!target || n <= 0) return;
    if (n > 600) n = 600; // long-idle cap: converged long ago anyway
    while (n-- > 0) {
      const want = desired();
      state.x += (want.x - state.x) * damping;
      state.y += (want.y - state.y) * damping;
    }
  }

  function shakeOffset(): { x: number; y: number } {
    const now = steps();
    const t = now - shakeStart;
    if (shakeAmp <= 0 || t >= shakeSteps) return { x: 0, y: 0 };
    const k = 1 - t / shakeSteps; // linear falloff
    return {
      x: shakeAmp * k * wobble(now * 1.7 + 0.3),
      y: shakeAmp * k * wobble(now * 2.3 + 7.1),
    };
  }

  function visibleRect(): Rect {
    fold();
    const v = view();
    scratchRect.x = state.x;
    scratchRect.y = state.y;
    scratchRect.w = fit ? fit.w : v.w / state.zoom;
    scratchRect.h = fit ? fit.h : v.h / state.zoom;
    return scratchRect;
  }

  function applyLens(ctx: CanvasRenderingContext2D, into: Rect | null): void {
    const r = visibleRect();
    const sh = shakeOffset();
    if (into) {
      ctx.beginPath();
      ctx.rect(into.x, into.y, into.w, into.h);
      ctx.clip();
      const s = Math.min(into.w / r.w, into.h / r.h); // uniform, letterboxed
      const tx = into.x + (into.w - r.w * s) / 2;
      const ty = into.y + (into.h - r.h * s) / 2;
      ctx.translate(tx, ty);
      ctx.scale(s, s);
      ctx.translate(-(r.x + sh.x), -(r.y + sh.y));
    } else {
      ctx.scale(state.zoom, state.zoom);
      // Whole-pixel translate: keeps integer world geometry on integer
      // device pixels — no tile seams, no sprite shimmer. A <1px quantize
      // of camera motion is imperceptible.
      ctx.translate(-Math.round(state.x + sh.x), -Math.round(state.y + sh.y));
    }
  }

  function render(a: RenderOptions | (() => void), b?: () => void): void {
    const [opts, fn] = typeof a === "function" ? [{} as RenderOptions, a] : [a, b!];
    const ctx = Draw.ctx;
    ctx.save();
    applyLens(ctx, opts.into ?? null);
    try {
      fn();
    } finally {
      ctx.restore();
    }
  }

  const cam: CameraLens = {
    get x() {
      fold();
      return state.x;
    },
    set x(v: number) {
      fold();
      state.x = v;
    },
    get y() {
      fold();
      return state.y;
    },
    set y(v: number) {
      fold();
      state.y = v;
    },
    get zoom() {
      return state.zoom;
    },
    set zoom(v: number) {
      state.zoom = v;
    },
    get rect() {
      return visibleRect();
    },
    follow(t, opts = {}) {
      target = t;
      if (opts.world !== undefined) world = opts.world ? normRect(opts.world) : null;
      if (opts.deadzone !== undefined) deadzone = opts.deadzone;
      if (opts.damping !== undefined) damping = opts.damping;
      if (opts.zoom !== undefined) state.zoom = opts.zoom;
      if (opts.fit !== undefined) fit = opts.fit ? normRect(opts.fit) : null;
      lastStep = steps();
    },
    snap() {
      fold();
      if (target) {
        const want = desired();
        state.x = want.x;
        state.y = want.y;
      }
    },
    shake(amplitude, ms) {
      const now = steps();
      // Stack by keeping the stronger amplitude, restarting the fade.
      shakeAmp = Math.max(shakeOffset().x !== 0 || shakeOffset().y !== 0 ? shakeAmp : 0, amplitude);
      shakeStart = now;
      shakeSteps = Math.max(1, Math.round(ms * STEPS_PER_MS));
    },
    toWorld(p, out) {
      fold();
      const o = out ?? scratchVec;
      o.x = p.x / state.zoom + state.x;
      o.y = p.y / state.zoom + state.y;
      return o;
    },
    toScreen(p, out) {
      fold();
      const o = out ?? scratchVec;
      o.x = (p.x - state.x) * state.zoom;
      o.y = (p.y - state.y) * state.zoom;
      return o;
    },
    render,
    layer(factor, fn) {
      fold();
      const sh = shakeOffset();
      const ctx = Draw.ctx;
      ctx.save();
      ctx.translate(
        -Math.round((state.x + sh.x) * factor * state.zoom),
        -Math.round((state.y + sh.y) * factor * state.zoom),
      );
      try {
        fn();
      } finally {
        ctx.restore();
      }
    },
  };
  return cam;
}

// ---------- The default camera (platform facade) ----------

let defaultCamera: CameraLens | null = null;

function def(): CameraLens {
  return (defaultCamera ??= createCamera());
}

/** Reset the default camera — for tests and full re-inits. */
export function _resetCamera(): void {
  defaultCamera = null;
}

/** World block: `Draw.*` inside `fn` is world space under a camera.
 *  `render(fn)` = the default camera onto the whole canvas;
 *  `render(cam, fn)` = an explicit lens; `render(cam, { into }, fn)` = a
 *  lens into a screen sub-rect (minimap, split screen). */
function facadeRender(fn: () => void): void;
function facadeRender(cam: CameraLens, fn: () => void): void;
function facadeRender(cam: CameraLens, opts: RenderOptions, fn: () => void): void;
function facadeRender(
  fnOrCam: (() => void) | CameraLens,
  fnOrOpts?: (() => void) | RenderOptions,
  maybeFn?: () => void,
): void {
  if (typeof fnOrCam === "function") return def().render(fnOrCam);
  if (typeof fnOrOpts === "function") return fnOrCam.render(fnOrOpts);
  return fnOrCam.render(fnOrOpts ?? {}, maybeFn!);
}

/** The always-existing default camera. Identity (0, 0, zoom 1) until
 *  configured — games that never touch it render pure screen space.
 *
 *    Camera.follow(player);                  // once, at setup
 *    Camera.render(() => drawWorld());       // per frame: world space inside
 *    Draw.text("HUD", { x: 8, y: 8 });       // outside: screen space
 */
export const Camera = {
  /** Configure the default camera to follow `target` (see `CameraLens`). */
  follow(
    target: FollowTarget | null,
    opts?: Omit<CameraOptions, "follow" | "view" | "steps">,
  ): void {
    def().follow(target, opts);
  },
  render: facadeRender,
  /** Create an independent camera lens (minimaps, split screen, picture-in-
   *  picture) — separate from the default camera. Render it with
   *  `Camera.render(lens, { into }, fn)`. */
  create(opts?: CameraOptions): CameraLens {
    return createCamera(opts);
  },
  /** Parallax layer at `factor` strength of the default camera. */
  layer(factor: number, fn: () => void): void {
    def().layer(factor, fn);
  },
  /** Impact shake on the default camera: `amplitude` px decaying linearly
   *  over `ms`. Restacking keeps the stronger amplitude and restarts the fade. */
  shake(amplitude: number, ms: number): void {
    def().shake(amplitude, ms);
  },
  /** Jump the default camera straight to its desired position (scene entry —
   *  no visible lerp). */
  snap(): void {
    def().snap();
  },
  /** Screen point → world point through the default camera.
   *  `Camera.toWorld(Pointer)` is mouse picking. */
  toWorld(p: Vec2, out?: Vec2): Vec2 {
    return def().toWorld(p, out);
  },
  /** World point → screen point through the default camera (off-screen
   *  markers, HUD callouts). */
  toScreen(p: Vec2, out?: Vec2): Vec2 {
    return def().toScreen(p, out);
  },
  /** Top-left `x` of the default camera's visible world rect (before shake).
   *  Reading folds pending steps forward; writing sets it directly. */
  get x(): number {
    return def().x;
  },
  set x(v: number) {
    def().x = v;
  },
  /** Top-left `y` of the default camera's visible world rect (before shake).
   *  Reading folds pending steps forward; writing sets it directly. */
  get y(): number {
    return def().y;
  },
  set y(v: number) {
    def().y = v;
  },
  /** Default camera magnification. `>1` zooms in; `1` is identity. */
  get zoom(): number {
    return def().zoom;
  },
  set zoom(v: number) {
    def().zoom = v;
  },
  /** The default camera's visible world rect — culling, minimap viewfinders.
   *  Reused scratch object: read, don't hold. */
  get rect(): Rect {
    return def().rect;
  },
};
