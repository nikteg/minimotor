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
  /** Fill color. Default "#fff". */
  color?: string;
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

function rect(x: number, y: number, w: number, h: number, color: string): void;
function rect(rect: Rect, color: string): void;
function rect(a: number | Rect, b: number | string, c?: number, d?: number, e?: string): void {
  const ctx = requireDefault().ctx;
  if (typeof a === "number") {
    ctx.fillStyle = e!;
    ctx.fillRect(a, b as number, c!, d!);
  } else {
    ctx.fillStyle = b as string;
    ctx.fillRect(a.x, a.y, a.w, a.h);
  }
}

function circle(x: number, y: number, r: number, color: string): void;
function circle(pos: Point, r: number, color: string): void;
function circle(a: number | Point, b: number, c: number | string, d?: string): void {
  const ctx = requireDefault().ctx;
  const [x, y, r, color] =
    typeof a === "number" ? [a, b, c as number, d!] : [a.x, a.y, b, c as string];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function line(x1: number, y1: number, x2: number, y2: number, color: string, width?: number): void;
function line(a: Point, b: Point, color: string, width?: number): void;
function line(
  a: number | Point,
  b: number | Point,
  c?: number | string,
  d?: number | string,
  e?: string,
  f?: number,
): void {
  const ctx = requireDefault().ctx;
  let x1: number, y1: number, x2: number, y2: number, color: string, width: number;
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
    color = c as string;
    width = (d as number | undefined) ?? 1;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
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
  text,
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
