// ---------- Camera ----------
// A camera is a LENS: it maps a world rect onto a screen rect. The default
// camera maps its visible world slice onto the whole canvas; `Draw.*` calls
// inside `Camera.render(fn)` are world space, everything outside is screen space.
// Extra lenses (`createLens`) map onto screen sub-rects via `into` for
// minimaps and split screen.
//
// Advancement is pull-based (API_PLAN law 4): follow damping and shake fold
// forward by the number of fixed steps elapsed since the last read. Dropped
// cameras cost nothing and GC away with their owning game or standalone lens.

import { type Game, type DrawApi, type Rect } from "../engine/index.js";
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
  /** View size the lens maps onto. Required for standalone lenses. */
  view: { w: number; h: number };
  /** Fixed-step source — injectable for tests and standalone lenses. */
  steps: () => number;
  /** Renderer used by `render`/`layer`. */
  draw: DrawApi;
}

/** Options for `Camera.render` — the screen sub-rect (`into`) the lens maps onto. */
export interface RenderOptions {
  /** Destination rect in SCREEN space. The lens maps its world rect into
   *  this rect (uniform scale, centered) and clips to it. Omitted: the whole
   *  canvas. */
  into?: Rect;
}

/** Options for `toWorld` / `toScreen`. */
export interface ScreenMapOptions {
  /** The SAME screen sub-rect the lens was rendered `into`. A lens drawn into
   *  a sub-rect (minimap, split screen) maps world→screen with a different
   *  scale and offset than a full-canvas one, so picking through it must say
   *  which rect it means. Omit for a full-canvas lens. */
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
    opts?: Omit<CameraOptions, "follow" | "view" | "steps" | "draw">,
  ): void;
  /** Jump straight to the desired position (scene entry — no visible lerp). */
  snap(): void;
  /** Impact shake: `amplitude` px decaying linearly over `ms`. */
  shake(amplitude: number, ms: number): void;
  /** Screen point → world point. `Camera.toWorld(Pointer)` is mouse picking.
   *  Accounts for zoom, shake and the pixel snap — it inverts exactly the
   *  transform `render` applied. For a lens rendered into a screen sub-rect,
   *  pass that rect as `opts.into`. Returns a new vector unless `out` is
   *  supplied for allocation-free hot paths. */
  toWorld(p: Vec2, out?: Vec2 | null, opts?: ScreenMapOptions): Vec2;
  /** World point → screen point (off-screen markers, HUD callouts). The
   *  inverse of `toWorld`; same `opts.into` rule. */
  toScreen(p: Vec2, out?: Vec2 | null, opts?: ScreenMapOptions): Vec2;
  /** Run `fn` with this lens applied: `Draw.*` inside is world space. */
  render(fn: () => void): void;
  render(opts: RenderOptions, fn: () => void): void;
  /** Parallax: run `fn` with this camera's translation scaled by `factor`
   *  (0 = screen-fixed, 1 = world). Call at the top level, not inside
   *  `render` — it applies the camera itself, at reduced strength. */
  layer(factor: number, fn: () => void): void;
}

export interface CameraApi extends CameraLens {
  /** Create another lens bound to the same game renderer, viewport, and clock. */
  create(options?: Omit<CameraOptions, "view" | "steps" | "draw">): CameraLens;
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

/** The world→screen affine a lens applies: `screen = scale * world + t`. */
interface Mapping {
  scale: number;
  tx: number;
  ty: number;
}

export function createLens(options: CameraOptions): CameraLens {
  const steps = options.steps;
  const draw = options.draw;
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
  // Per-lens scratch for the hot pull paths (fold runs per elapsed step, and
  // mapping runs on every render/pick) — these never escape the call.
  const scratchTarget = { x: 0, y: 0 };
  const scratchDesired = { x: 0, y: 0 };
  const scratchShake = { x: 0, y: 0 };
  const scratchMap: Mapping = { scale: 1, tx: 0, ty: 0 };

  function view(): { w: number; h: number } {
    return options.view;
  }

  function targetPoint(): { x: number; y: number } {
    const t = target!;
    scratchTarget.x = t.x + (t.w ?? 0) / 2;
    scratchTarget.y = t.y + (t.h ?? 0) / 2;
    return scratchTarget;
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
    scratchDesired.x = wantX;
    scratchDesired.y = wantY;
    return scratchDesired;
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

  /** Is a shake still inside its fade window? Asked directly rather than
   *  inferred from a nonzero offset — `wobble` legitimately returns 0 on some
   *  steps, and treating those as "no shake" drops a live one. */
  function shakeLive(now: number): boolean {
    return shakeAmp > 0 && now - shakeStart < shakeSteps;
  }

  function shakeOffset(): { x: number; y: number } {
    const now = steps();
    if (!shakeLive(now)) {
      scratchShake.x = 0;
      scratchShake.y = 0;
      return scratchShake;
    }
    const k = 1 - (now - shakeStart) / shakeSteps; // linear falloff
    scratchShake.x = shakeAmp * k * wobble(now * 1.7 + 0.3);
    scratchShake.y = shakeAmp * k * wobble(now * 2.3 + 7.1);
    return scratchShake;
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

  /** The lens's world→screen affine, `screen = scale * world + t`, written
   *  into `out`. THE single definition of this camera's mapping: `applyLens`
   *  pushes it onto the canvas and `toWorld`/`toScreen` invert it, so a pick
   *  can never disagree with what was actually drawn (shake and the pixel snap
   *  included). Folds pending steps via `visibleRect`. */
  function mapping(into: Rect | null, out: Mapping): Mapping {
    const r = visibleRect();
    const sh = shakeOffset();
    if (into) {
      const s = Math.min(into.w / r.w, into.h / r.h); // uniform, letterboxed
      out.scale = s;
      out.tx = into.x + (into.w - r.w * s) / 2 - s * (r.x + sh.x);
      out.ty = into.y + (into.h - r.h * s) / 2 - s * (r.y + sh.y);
    } else {
      const z = state.zoom;
      out.scale = z;
      // Whole-pixel translate: keeps integer world geometry on integer device
      // pixels — no tile seams, no sprite shimmer. Snap AFTER the zoom, in
      // device space: rounding the world coordinate first would quantize
      // camera motion to zoom-sized jumps (3 px at zoom 3), which is worse
      // than not snapping. A sub-device-pixel quantize is imperceptible.
      out.tx = -Math.round((state.x + sh.x) * z);
      out.ty = -Math.round((state.y + sh.y) * z);
    }
    return out;
  }

  function applyLens(ctx: CanvasRenderingContext2D, into: Rect | null): void {
    if (into) {
      ctx.beginPath();
      ctx.rect(into.x, into.y, into.w, into.h);
      ctx.clip();
    }
    const m = mapping(into, scratchMap);
    ctx.translate(m.tx, m.ty);
    ctx.scale(m.scale, m.scale);
  }

  function render(a: RenderOptions | (() => void), b?: () => void): void {
    const [opts, fn] = typeof a === "function" ? [{} as RenderOptions, a] : [a, b!];
    const ctx = draw.ctx;
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
      shakeAmp = Math.max(shakeLive(now) ? shakeAmp : 0, amplitude);
      shakeStart = now;
      shakeSteps = Math.max(1, Math.round(ms * STEPS_PER_MS));
    },
    toWorld(p, out, opts) {
      const m = mapping(opts?.into ?? null, scratchMap);
      const o = out ?? { x: 0, y: 0 };
      o.x = (p.x - m.tx) / m.scale;
      o.y = (p.y - m.ty) / m.scale;
      return o;
    },
    toScreen(p, out, opts) {
      const m = mapping(opts?.into ?? null, scratchMap);
      const o = out ?? { x: 0, y: 0 };
      o.x = m.scale * p.x + m.tx;
      o.y = m.scale * p.y + m.ty;
      return o;
    },
    render,
    layer(factor, fn) {
      fold();
      const sh = shakeOffset();
      const ctx = draw.ctx;
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

/** Create the primary camera namespace for one explicit game. */
export function createCamera(game: Game): CameraApi {
  const base = { view: game.viewport, steps: () => game.Loop.steps, draw: game.Draw };
  const lens = createLens(base);
  return {
    follow: lens.follow.bind(lens),
    render: lens.render.bind(lens),
    create(opts: Omit<CameraOptions, "view" | "steps" | "draw"> = {}) {
      return createLens({ ...base, ...opts });
    },
    layer: lens.layer.bind(lens),
    shake: lens.shake.bind(lens),
    snap: lens.snap.bind(lens),
    toWorld: lens.toWorld.bind(lens),
    toScreen: lens.toScreen.bind(lens),
    get x() {
      return lens.x;
    },
    set x(value: number) {
      lens.x = value;
    },
    get y() {
      return lens.y;
    },
    set y(value: number) {
      lens.y = value;
    },
    get zoom() {
      return lens.zoom;
    },
    set zoom(value: number) {
      lens.zoom = value;
    },
    get rect() {
      return lens.rect;
    },
  };
}
