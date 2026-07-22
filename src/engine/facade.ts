import {
  EnginePlugin,
  Game,
  GameCallbacks,
  GameOptions,
  STEP_MS,
  Viewport,
  createGame,
} from "./game.js";
import type { KeyCode } from "./keycodes.js";
import type { Rect } from "./game.js";
import { applyFullscreen } from "../fullscreen.js";
import { drawText, type TextHAlign, type TextVAlign } from "../text.js";

type Point = { x: number; y: number };

/** Polled keyboard state. `down` is level-triggered (held); `pressed` and
 *  `released` are edge-triggered and true for exactly one update step per
 *  physical transition — that's why no `onKeyDown` callback is needed.
 *
 *    if (Minimotor.Keys.down("ArrowLeft")) move();   // held
 *    if (Minimotor.Keys.pressed("Space"))  jump();   // this step only
 *    if (Minimotor.Keys.released("KeyR"))  letGo(); */
export interface Keys {
  /** True while the key is held. */
  down(code: KeyCode): boolean;
  /** True for one update step when the key goes down (ignores auto-repeat). */
  pressed(code: KeyCode): boolean;
  /** True for one update step when the key goes up. */
  released(code: KeyCode): boolean;
}

/** Polled pointer (mouse + touch) in logical CSS pixels, relative to the
 *  canvas. `pressed`/`released` are edge-triggered like `Keys`. */
export interface Pointer {
  /** Logical x within the canvas; -1 before the first event. */
  readonly x: number;
  /** Logical y within the canvas; -1 before the first event. */
  readonly y: number;
  /** True when the latest pointer position lies inside the canvas. */
  readonly inside: boolean;
  /** True while a button/touch is held. */
  readonly down: boolean;
  /** True for one update step when the press begins. */
  readonly pressed: boolean;
  /** True for one update step when the press ends. */
  readonly released: boolean;
  /** True for the whole rendered frame in which the press ended. `released`
   *  is consumed by the fixed steps before `draw` runs — draw-phase hit
   *  testing (`UI.button`) reads this instead. */
  readonly frameReleased: boolean;
  /** True for the whole rendered frame in which a press began — the
   *  draw-phase counterpart of `pressed` (drag starts in `UI.scrollbar`). */
  readonly framePressed: boolean;
  /** Wheel scroll this frame in logical px (positive = down). Accumulated
   *  across the frame's wheel events, cleared at frame end. */
  readonly wheel: number;
}

// ---------- Global default-engine facade ----------
// The whole engine is reached as `Minimotor.*` namespaces backed by ONE default
// game built by `Stage.init()`. Game code reads these instead of importing a
// game instance. `createGame()` above stays for isolated instances (tests).

let defaultGame: Game | null = null;

/** Clear the default-game slot if `g` holds it — called from a game's own
 *  `destroy()` in game.ts, which can't reassign this imported binding. */
export function clearDefaultGame(g: Game): void {
  if (defaultGame === g) defaultGame = null;
}

function requireDefault(): Game {
  if (!defaultGame) {
    throw new Error(
      "Minimotor: call Minimotor.Stage.init(canvas) before using Stage / Loop / Keys / Pointer / Draw",
    );
  }
  return defaultGame;
}

/** Everything `GameOptions` offers except the canvas (Stage.init's first
 *  argument), plus document-level concerns that only make sense for the
 *  default game. */
export type StageOptions = Omit<GameOptions, "canvas"> & {
  /** Inject the fullscreen stylesheet (fill the window, no scrollbars,
   *  safe-area handling) before building the game. */
  fullscreen?: boolean;
};

/** Canvas / viewport / screen. `init` builds the default engine and returns
 *  its viewport — a LIVE object (same identity forever, mutated on resize),
 *  so `view.w` / `view.h` / `view.dpr` never go stale. */
export const Stage = {
  init(canvas: string | HTMLCanvasElement, opts: StageOptions = {}): Viewport {
    // Re-init replaces the default game — tear the old one down first so its
    // rAF loop and window listeners don't leak.
    defaultGame?.destroy();
    if (opts.fullscreen) applyFullscreen();
    defaultGame = createGame({ canvas, ...opts });
    return defaultGame.viewport;
  },
  get viewport(): Viewport {
    return requireDefault().viewport;
  },
  get canvas(): HTMLCanvasElement {
    return requireDefault().canvas;
  },
  /** Inject the fullscreen stylesheet (idempotent). */
  fullscreen(): void {
    applyFullscreen();
  },
  /** Re-apply the base (letterbox) transform — see `Game.resetTransform`.
   *  Screen-space widgets use this to escape a camera block. */
  resetTransform(): void {
    requireDefault().resetTransform();
  },
  onResize(handler: (vp: Viewport) => void): () => void {
    return requireDefault().onResize(handler);
  },
};

/** The game loop. */
export const Loop = {
  run(callbacks: GameCallbacks): void {
    requireDefault().run(callbacks);
  },
  pause(): void {
    requireDefault().pause();
  },
  resume(): void {
    requireDefault().resume();
  },
  stop(): void {
    requireDefault().stop();
  },
  use(plugin: EnginePlugin): void {
    requireDefault().use(plugin);
  },
  /** Subscribe to each fixed update step; returns unsubscribe. */
  onStep(handler: () => void): () => void {
    return requireDefault().onStep(handler);
  },
  /** Subscribe to the start of each fixed step (before `update`); returns
   *  unsubscribe. */
  onStepStart(handler: () => void): () => void {
    return requireDefault().onStepStart(handler);
  },
  /** Subscribe to the end of each rendered frame; returns unsubscribe. */
  onFrame(handler: () => void): () => void {
    return requireDefault().onFrame(handler);
  },
  /** Request a CSS cursor for this frame (reset every frame) — see
   *  `Game.setCursor`. */
  setCursor(cursor: string): void {
    requireDefault().setCursor(cursor);
  },
  /** Fixed update timestep in milliseconds (1000 / 60). */
  get step(): number {
    return STEP_MS;
  },
  /** Render interpolation factor 0..1 — see `Game.alpha`. */
  get alpha(): number {
    return requireDefault().alpha;
  },
};

/** Options for `Draw.text` — plain ambient-space text (world-anchored damage
 *  numbers, name tags). For themed, screen-space HUD text use `UI.text`. */
export interface DrawTextOptions {
  x: number;
  y: number;
  /** Font size in px (monospace). Default 16. */
  size?: number;
  /** Full CSS font string — overrides `size`. */
  font?: string;
  /** Fill. A CSS color, or a gradient from `Draw.linear`/`Draw.radial`. Default "#fff". */
  color?: Fill;
  /** Horizontal anchor of `x`. Default "left". */
  align?: TextHAlign;
  /** Vertical anchor of `y`. Default "top". */
  baseline?: TextVAlign;
}

// ---------- Ambient-space drawing primitives ----------
// Draw.* renders in the AMBIENT coordinate space: screen at the top level,
// world inside `Camera.render` blocks (the camera sets the ctx transform).
// Data never draws itself — this is the only namespace that knows what a
// canvas is. Geometry takes positional args for literals plus a structural
// overload (anything with the fields IS the shape).

/** A fill: a CSS color string, or a gradient from `Draw.linear`/`Draw.radial`. */
export type Fill = string | CanvasGradient;

/** Gradient color stops: `[offset 0..1, color]` pairs. */
export type GradientStops = Array<[number, string]>;

function rect(x: number, y: number, w: number, h: number, color: Fill): void;
function rect(rect: Rect, color: Fill): void;
function rect(a: number | Rect, b: number | Fill, c?: number, d?: number, e?: Fill): void {
  const ctx = requireDefault().ctx;
  if (typeof a === "number") {
    ctx.fillStyle = e!;
    ctx.fillRect(a, b as number, c!, d!);
  } else {
    ctx.fillStyle = b as Fill;
    ctx.fillRect(a.x, a.y, a.w, a.h);
  }
}

function circle(x: number, y: number, r: number, color: Fill): void;
function circle(pos: Point, r: number, color: Fill): void;
function circle(a: number | Point, b: number, c: number | Fill, d?: Fill): void {
  const ctx = requireDefault().ctx;
  const [x, y, r, color] =
    typeof a === "number" ? [a, b, c as number, d!] : [a.x, a.y, b, c as Fill];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(x1: number, y1: number, x2: number, y2: number, color: Fill, width?: number): void;
function line(a: Point, b: Point, color: Fill, width?: number): void;
function line(
  a: number | Point,
  b: number | Point,
  c?: number | Fill,
  d?: number | Fill,
  e?: Fill,
  f?: number,
): void {
  const ctx = requireDefault().ctx;
  let x1: number, y1: number, x2: number, y2: number, color: Fill, width: number;
  if (typeof a === "number") {
    x1 = a;
    y1 = b as number;
    x2 = c as number;
    y2 = d as number;
    color = e!;
    width = f ?? 1;
  } else {
    x1 = a.x;
    y1 = a.y;
    x2 = (b as Point).x;
    y2 = (b as Point).y;
    color = c as Fill;
    width = (d as number | undefined) ?? 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A linear-gradient fill from (x0,y0) to (x1,y1). Pass the result as any
 *  `Draw`/`UI` color: `Draw.rect(r, Draw.linear(0, 0, 0, h, [[0,"#0af"],[1,"#014"]]))`. */
function linear(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: GradientStops,
): CanvasGradient {
  const ctx = requireDefault().ctx;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

/** A radial-gradient fill from the inner circle (x0,y0,r0) to the outer
 *  (x1,y1,r1). A 3-arg center form covers the common concentric case. */
function radial(cx: number, cy: number, r: number, stops: GradientStops): CanvasGradient;
function radial(
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: GradientStops,
): CanvasGradient;
function radial(
  x0: number,
  y0: number,
  r0: number,
  a?: number | GradientStops,
  y1?: number,
  r1?: number,
  b?: GradientStops,
): CanvasGradient {
  const ctx = requireDefault().ctx;
  const g = Array.isArray(a)
    ? ctx.createRadialGradient(x0, y0, 0, x0, y0, r0)
    : ctx.createRadialGradient(x0, y0, r0, a as number, y1!, r1!);
  for (const [at, color] of Array.isArray(a) ? a : b!) g.addColorStop(at, color);
  return g;
}

/** Run `fn` with a global opacity multiplier applied (nests correctly and
 *  restores after) — fade-outs, ghosts, dimmed layers without touching ctx. */
function opacity(value: number, fn: () => void): void {
  const ctx = requireDefault().ctx;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * value;
  try {
    fn();
  } finally {
    ctx.globalAlpha = prev;
  }
}

/** Anything Draw.sprite can render: a sheet cursor (`heroSheet.play(...)`)
 *  or any object exposing a source rect + image. Structural on purpose —
 *  the engine's anim cursors qualify without an import. */
export interface SpriteLike {
  readonly rect: { sx: number; sy: number; sw: number; sh: number };
  readonly sheet: { image: CanvasImageSource };
}

export interface DrawSpriteOptions {
  /** Mirror horizontally (facing). */
  flipX?: boolean;
  flipY?: boolean;
  /** Squash & stretch. Anchored at the rect's bottom-center (feet planted),
   *  the natural pivot for landing squash. Default 1. */
  scaleX?: number;
  scaleY?: number;
  /** Rotation in radians about the same anchor. */
  rot?: number;
  /** Opacity 0..1 (ghosts). */
  alpha?: number;
}

function sprite(spr: SpriteLike, at: Rect, opts: DrawSpriteOptions = {}): void {
  const ctx = requireDefault().ctx;
  const r = spr.rect;
  ctx.save();
  // Nearest-neighbour: interpolated sampling bleeds edge pixels from the
  // ADJACENT sheet cells into the frame (ghost lines above heads); pixel
  // art wants crisp scaling anyway.
  ctx.imageSmoothingEnabled = false;
  ctx.translate(at.x + at.w / 2, at.y + at.h); // bottom-center anchor
  ctx.scale((opts.flipX ? -1 : 1) * (opts.scaleX ?? 1), (opts.flipY ? -1 : 1) * (opts.scaleY ?? 1));
  if (opts.rot) ctx.rotate(opts.rot);
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.drawImage(spr.sheet.image, r.sx, r.sy, r.sw, r.sh, -at.w / 2, -at.h, at.w, at.h);
  ctx.restore();
}

// ---------- Batch sprite rendering ----------
// The z-sorted blit-many renderer. It lives HERE, not on the ECS (Draw owns
// rendering; data never draws itself). It takes any iterable of sprite-shaped
// DATA — an ECS Sprite store (`Draw.sprites(ecs.dense(Sprites.Sprite))`), a
// plain array, whatever — so nothing is coupled to the ECS. `DrawSprite` is
// structural, so `Sprites.SpriteData` satisfies it with no import either way.

type BlitImage = CanvasImageSource & { width: number; height: number; logicalSize?: number };

/** One entry the batch renderer can blit. The ECS `Sprite` component's data
 *  matches this structurally. */
export interface DrawSprite {
  x: number;
  y: number;
  img: BlitImage;
  w?: number;
  h?: number;
  ax?: number;
  ay?: number;
  rot?: number;
  scale?: number;
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number;
  z?: number;
  visible?: boolean;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  px?: number;
  py?: number;
}

export interface DrawSpritesOptions {
  /** Interpolation factor 0..1 (`Loop.alpha`): blends px/py→x/y for stutter-
   *  free motion on non-60 Hz displays. */
  alpha?: number;
  /** Visible world rect — sprites fully outside are skipped before transform. */
  view?: { x: number; y: number; w: number; h: number };
}

const spriteScratch: DrawSprite[] = [];

/** Blit an iterable of sprites, sorted by `z` (ties keep order). Honors
 *  anchor/rotation/scale/flip/alpha/visibility, culls to `view`, and
 *  interpolates px/py when `opts.alpha` is given. */
function sprites(list: Iterable<DrawSprite>, opts: DrawSpritesOptions = {}): void {
  const ctx = requireDefault().ctx;
  const lerp = opts.alpha;
  const view = opts.view;

  spriteScratch.length = 0;
  for (const s of list) spriteScratch.push(s);

  let ordered = true;
  for (let i = 1; i < spriteScratch.length; i++) {
    if ((spriteScratch[i].z ?? 0) < (spriteScratch[i - 1].z ?? 0)) {
      ordered = false;
      break;
    }
  }
  if (!ordered) spriteScratch.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  let ctxAlpha = 1;
  for (const s of spriteScratch) {
    if (s.visible === false) continue;
    const alpha = s.alpha ?? 1;
    if (alpha <= 0) continue;

    const img = s.img;
    const clipped = s.sw !== undefined && s.sh !== undefined;
    const w = s.w ?? (clipped ? s.sw! : (img.logicalSize ?? img.width));
    const h = s.h ?? (clipped ? s.sh! : (img.logicalSize ?? img.height));
    const ax = s.ax ?? 0.5;
    const ay = s.ay ?? 0.5;
    const rot = s.rot ?? 0;
    const scale = s.scale ?? 1;
    const flipX = s.flipX === true;
    const flipY = s.flipY === true;

    let x = s.x;
    let y = s.y;
    if (lerp !== undefined && s.px !== undefined && s.py !== undefined) {
      x = s.px + (s.x - s.px) * lerp;
      y = s.py + (s.y - s.py) * lerp;
    }

    if (view) {
      const ext = (w + h) * scale;
      if (
        x + ext < view.x ||
        x - ext > view.x + view.w ||
        y + ext < view.y ||
        y - ext > view.y + view.h
      ) {
        continue;
      }
    }

    if (alpha !== ctxAlpha) {
      ctx.globalAlpha = alpha;
      ctxAlpha = alpha;
    }

    if (rot === 0 && scale === 1 && !flipX && !flipY) {
      if (clipped) {
        ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, x - ax * w, y - ay * h, w, h);
      } else {
        ctx.drawImage(img, x - ax * w, y - ay * h, w, h);
      }
    } else {
      ctx.save();
      ctx.translate(x, y);
      if (rot !== 0) ctx.rotate(rot);
      const kx = scale * (flipX ? -1 : 1);
      const ky = scale * (flipY ? -1 : 1);
      if (kx !== 1 || ky !== 1) ctx.scale(kx, ky);
      if (clipped) {
        ctx.drawImage(img, s.sx ?? 0, s.sy ?? 0, s.sw!, s.sh!, -ax * w, -ay * h, w, h);
      } else {
        ctx.drawImage(img, -ax * w, -ay * h, w, h);
      }
      ctx.restore();
    }
  }
  if (ctxAlpha !== 1) ctx.globalAlpha = 1;
}

/** Anything Draw.tiles can render — levels expose a `render` channel; the
 *  game calls this instead (data never draws itself). Generic so the skin
 *  type-checks against the level's legend. */
export interface TilesLike<S> {
  render(ctx: CanvasRenderingContext2D, skin: S): void;
}

function tiles<S>(level: TilesLike<S>, skin: S): void {
  level.render(requireDefault().ctx, skin);
}

/** Anything Draw.particles can render — particle systems expose a `render`
 *  channel; the game calls this instead (data never draws itself). */
export interface ParticleLike {
  render(ctx: CanvasRenderingContext2D): void;
}

function particles(sys: ParticleLike): void {
  sys.render(requireDefault().ctx);
}

function text(str: string, opts: DrawTextOptions): void {
  const ctx = requireDefault().ctx;
  drawText(ctx, str, opts.x, opts.y, {
    font: opts.font ?? (opts.size !== undefined ? `${opts.size}px monospace` : undefined),
    color: opts.color,
    align: opts.align,
    baseline: opts.baseline,
  });
}

/** Rendering: ambient-space primitives (screen at top level, world inside
 *  `Camera.render`) plus the raw `ctx` escape hatch. */
export const Draw = {
  get ctx(): CanvasRenderingContext2D {
    return requireDefault().ctx;
  },
  get frameScale(): number {
    return requireDefault().frameScale;
  },
  /** Render interpolation factor 0..1 — see `Game.alpha`. */
  get alpha(): number {
    return requireDefault().alpha;
  },
  rect,
  circle,
  line,
  linear,
  radial,
  opacity,
  text,
  sprite,
  sprites,
  tiles,
  particles,
};

/** Polled keyboard — read inside `update`. */
export const Keys: Keys = {
  down: (code) => requireDefault().keys.down(code),
  pressed: (code) => requireDefault().keys.pressed(code),
  released: (code) => requireDefault().keys.released(code),
};

/** Polled pointer — read inside `update`. */
export const Pointer: Pointer = {
  get x() {
    return requireDefault().pointer.x;
  },
  get y() {
    return requireDefault().pointer.y;
  },
  get inside() {
    return requireDefault().pointer.inside;
  },
  get down() {
    return requireDefault().pointer.down;
  },
  get pressed() {
    return requireDefault().pointer.pressed;
  },
  get released() {
    return requireDefault().pointer.released;
  },
  get frameReleased() {
    return requireDefault().pointer.frameReleased;
  },
  get framePressed() {
    return requireDefault().pointer.framePressed;
  },
  get wheel() {
    return requireDefault().pointer.wheel;
  },
};

/** Mouse-oriented alias for the normalized canvas-relative pointer position. */
export const Mouse: Pointer = Pointer;
