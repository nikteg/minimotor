import { getDefaultApp, requireDefault, setDefaultApp } from "./default-app.js";
import {
  createApp,
  type EnginePlugin,
  type App,
  type AppCallbacks,
  type AppOptions,
  STEP_MS,
  type Viewport,
} from "./app.js";
import { applyFullscreen, preventNavigation } from "../fullscreen.js";

/** Everything `AppOptions` offers except the canvas (Stage.init's first
 *  argument), plus document-level concerns that only make sense for the
 *  default app. */
export type StageOptions = Omit<AppOptions, "canvas"> & {
  /** Inject the fullscreen stylesheet (fill the window, no scrollbars,
   *  safe-area handling) before building the app. */
  fullscreen?: boolean;
  /** Block accidental browser navigation (trackpad swipe-back, touch
   *  overscroll) so a stray gesture can't drop the game — see
   *  `Stage.preventNavigation`. */
  preventNavigation?: boolean;
};

/** Canvas / viewport / screen. `init` builds the default engine and returns
 *  its viewport — a LIVE object (same identity forever, mutated on resize),
 *  so `view.w` / `view.h` / `view.dpr` never go stale. */
export const Stage = {
  /** Build the default instance and start driving `Stage`/`Loop`/`Draw` — call
   *  this once, first. `canvas` is a `<canvas>` element or its id. Returns the
   *  LIVE `Viewport` (a stable object mutated on resize, so `view.w`/`view.h`
   *  never go stale). Options include `background` (engine clears each frame),
   *  `resolution` (fixed logical size, letterboxed), `fullscreen` and
   *  `plugins`. Calling it again tears down the previous default and replaces
   *  it.
   *
   *    const view = Stage.init("game", { background: "#111" }); */
  init(canvas: string | HTMLCanvasElement, opts: StageOptions = {}): Viewport {
    // Re-init replaces the default app — tear the old one down first so its
    // rAF loop and window listeners don't leak.
    getDefaultApp()?.destroy();
    if (opts.fullscreen) applyFullscreen();
    if (opts.preventNavigation) preventNavigation(true);
    const app = createApp({ canvas, ...opts });
    setDefaultApp(app);
    return app.viewport;
  },
  /** Build an ISOLATED instance (its own loop, input and canvas) instead of the
   *  shared default that `init` sets up — for tests, or running several
   *  independent instances on one page. Read its state off the returned handle
   *  rather than the `Stage`/`Loop`/`Draw` facades. */
  create(opts: AppOptions): App {
    return createApp(opts);
  },
  /** The LIVE viewport — the same object `init` returned, mutated in place on
   *  resize. Read `viewport.w`/`viewport.h` (logical size), `dpr`, safe-area
   *  insets. */
  get viewport(): Viewport {
    return requireDefault().viewport;
  },
  /** The backing `<canvas>` element (escape hatch for direct DOM access). */
  get canvas(): HTMLCanvasElement {
    return requireDefault().canvas;
  },
  /** Inject the fullscreen stylesheet (idempotent). */
  fullscreen(): void {
    applyFullscreen();
  },
  /** Block accidental browser navigation while playing — the back/forward the
   *  browser fires on a two-finger trackpad swipe or a touch overscroll — so a
   *  stray gesture can't unload the game. Pass `false` to release. Idempotent. */
  preventNavigation(prevent = true): void {
    preventNavigation(prevent);
  },
  /** Re-apply the base (letterbox) transform — see `App.resetTransform`.
   *  Screen-space widgets use this to escape a camera block. */
  resetTransform(): void {
    requireDefault().resetTransform();
  },
  /** Request a CSS cursor for THIS frame (`"pointer"`, `"grab"`, `"text"`,
   *  `"none"`, …) — see `App.setCursor`. Reset every frame, so hover cursors
   *  clear themselves; call it each frame the state holds. Higher `priority`
   *  (default 0) wins when several are requested. The cursor is a canvas
   *  presentation concern, so it lives on `Stage` (which owns the canvas) — not
   *  `Loop`. `UI.setCursor` forwards here for widget code. */
  setCursor(cursor: string, priority?: number): void {
    requireDefault().setCursor(cursor, priority);
  },
  /** Run `handler` whenever the viewport changes (window resize, orientation,
   *  DPR change) — for re-laying-out UI or re-baking sized sprites. Returns an
   *  unsubscribe function. The viewport itself is live, so simple games rarely
   *  need this. */
  onResize(handler: (vp: Viewport) => void): () => void {
    return requireDefault().onResize(handler);
  },
};

/** The fixed-timestep game loop, driving the default instance: `Loop.run`
 *  starts it, `Loop.pause`/`Loop.resume` freeze the simulation (drawing
 *  continues, so pause overlays render), and `Loop.step` is the fixed update
 *  timestep in ms — write speeds in px/step and gravity in px/step². */
export const Loop = {
  /** Start the loop with your `update` (fixed step) and `draw` (per frame)
   *  callbacks — the heart of every game. Pass a `Scenes` stack here too (it
   *  IS an `AppCallbacks`). Idempotent: calling again swaps the callbacks.
   *
   *    Loop.run({ update() { … }, draw() { … } }); */
  run(callbacks: AppCallbacks): void {
    requireDefault().run(callbacks);
  },
  /** Freeze `update` (simulation stops); `draw` keeps running so pause overlays
   *  still render. Resume with `resume`. */
  pause(): void {
    requireDefault().pause();
  },
  /** Resume updates after `pause`. */
  resume(): void {
    requireDefault().resume();
  },
  /** Stop the loop entirely (no more update/draw). A later `run` restarts it
   *  with a fresh clock. */
  stop(): void {
    requireDefault().stop();
  },
  /** Register an `EnginePlugin` (e.g. `Perf.plugin()`) after `init` — its
   *  lifecycle hooks fire from the next frame. */
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
  /** Fixed update timestep in milliseconds (1000 / 60). */
  get step(): number {
    return STEP_MS;
  },
  /** Render interpolation factor 0..1 — see `App.alpha`. */
  get alpha(): number {
    return requireDefault().alpha;
  },
};
