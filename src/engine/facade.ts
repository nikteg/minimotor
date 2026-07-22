import { EnginePlugin, Game, GameCallbacks, STEP_MS, Viewport, createGame } from "./game.js";
import type { KeyCode } from "./keycodes.js";

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

export interface StageOptions {
  /** Lifecycle plugins (e.g. `Perf.plugin()`). */
  plugins?: EnginePlugin[];
  /** Auto-pause while a coarse-pointer device is held in portrait. */
  pauseOnPortrait?: boolean;
  /** Key codes to `preventDefault()` on. Default: Space + arrow keys. */
  preventKeys?: KeyCode[];
}

/** Canvas / viewport / screen. `init` builds the default engine and returns
 *  its viewport so setup code can read `vp.w` / `vp.h` / `vp.dpr`. */
export const Stage = {
  init(canvas: string | HTMLCanvasElement, opts: StageOptions = {}): Viewport {
    // Re-init replaces the default game — tear the old one down first so its
    // rAF loop and window listeners don't leak.
    defaultGame?.destroy();
    let builder = createGame({ canvas, preventKeys: opts.preventKeys });
    if (opts.pauseOnPortrait) builder = builder.pauseOnPortrait();
    for (const p of opts.plugins ?? []) builder = builder.use(p);
    defaultGame = builder.build();
    return defaultGame.viewport;
  },
  get viewport(): Viewport {
    return requireDefault().viewport;
  },
  get canvas(): HTMLCanvasElement {
    return requireDefault().canvas;
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

/** Rendering handle — read inside `draw`. */
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
