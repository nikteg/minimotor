import { type ClockApi } from "../clock/index.js";
import type { Keys, Pointer } from "./input.js";
import type { SceneRenderer } from "./render/target.js";
import type { KeyCode } from "./keycodes.js";
import { type DrawApi } from "./draw.js";
import { type LoopApi } from "./loop.js";
/** An axis-aligned rectangle: `x`/`y` top-left, `w`/`h` size. */
export interface Rect {
    /** Left edge. */
    x: number;
    /** Top edge. */
    y: number;
    /** Width. */
    w: number;
    /** Height. */
    h: number;
}
/** The live canvas surface: element, 2D context, logical size, DPR, safe-area
 *  insets, and the base letterbox transform. */
export interface Viewport {
    /** The backing canvas element (sized to the window × `dpr`, or to the
     *  element's CSS box when `fullscreen` is false). */
    canvas: HTMLCanvasElement;
    /** The canvas 2D context, pre-set to the base logical→device transform. */
    ctx: CanvasRenderingContext2D;
    /** Logical width. Fills the window (or the canvas CSS box when not
     *  fullscreen), or the fixed `resolution.w` when the stage is letterboxed. */
    w: number;
    /** Logical height (see `w`). */
    h: number;
    /** Device pixel ratio (capped at 2 for perf) */
    dpr: number;
    /** Safe area left inset (notch etc.) */
    safeLeft: number;
    /** Safe area top inset */
    safeTop: number;
    /** Safe area right inset */
    safeRight: number;
    /** Safe area bottom inset (home indicator etc.) */
    safeBottom: number;
    /** Base device→canvas transform (dpr × letterbox scale, plus bar offset).
     *  Everything draws under this; `resetTransform(ctx)` re-applies it after a
     *  camera block. `scale` is 1 (offset 0) when the stage isn't letterboxed. */
    scale: number;
    /** Letterbox bar offset in canvas-CSS px, left edge (0 when not letterboxed). */
    offsetX: number;
    /** Letterbox bar offset in canvas-CSS px, top edge (0 when not letterboxed). */
    offsetY: number;
}
/** The per-frame callbacks. Input is read from the app's polled services. */
export interface AppCallbacks {
    /** Fixed-timestep simulation. May run 0..N times per rendered frame; every
     *  call represents exactly one configured fixed step, so THE STEP IS THE
     *  TIME UNIT — write constants in px/step and px/step². Read `Loop.step`
     *  when real milliseconds are needed. */
    update: () => void;
    /** Render. Runs once per rendered frame with the drawing context (the raw
     *  escape hatch — idiomatic code uses `Draw.*` and doesn't take it). */
    draw: (ctx: CanvasRenderingContext2D) => void;
}
/** How long the last frame's work took, measured by the engine.
 *  `updateMs` covers every fixed step run that frame; `steps` is how many ran
 *  (0 on idle frames, >1 when catching up). */
export interface FrameTimings {
    /** Wall-clock ms spent in every fixed update step run this frame. */
    updateMs: number;
    /** Wall-clock ms spent in this frame's `draw`. */
    drawMs: number;
    /** How many fixed steps ran this frame (0 when idle, >1 when catching up). */
    steps: number;
}
/** An isolated built app. Its state (`keys`, `ctx`, …) is read directly. */
export interface Runtime {
    /** Length of one fixed simulation step in ms — `1000 / fps`. Read this
     *  rather than assuming 60Hz: anything advancing per step scales with it. */
    readonly step: number;
    /** The backing canvas element. */
    readonly canvas: HTMLCanvasElement;
    /** The 2D drawing context (`draw` gets the same one as its argument). */
    readonly ctx: CanvasRenderingContext2D;
    /** The live viewport (same object forever; fields mutate in place on resize). */
    readonly viewport: Viewport;
    /** Polled keyboard state — read in `update`. */
    readonly keys: Keys;
    /** Polled pointer state — read in `update`. */
    readonly pointer: Pointer;
    /** Which scene path this app bound. `"auto"` resolves to one of these. */
    readonly renderer: "canvas" | "webgl";
    /** WebGL2 scene layer, or `null` on the Canvas2D path. */
    readonly sceneRenderer: SceneRenderer | null;
    /** Real time since the previous rendered frame, in milliseconds. */
    readonly frameDelta: number;
    /** Draw-rate cap in frames per second; 0 is uncapped. Settable at run time,
     *  so a game can put it behind a setting. */
    maxFps: number;
    /** How far the unsimulated remainder has progressed between the previous and
     * current fixed states, from 0 to 1. Render at
     * `prev + (curr - prev) * interpolation` for smooth motion. */
    readonly interpolation: number;
    /** Fixed updates completed by this app since it was created. */
    readonly steps: number;
    /** True while paused: `update` is frozen but `draw` keeps running. */
    readonly paused: boolean;
    /** Last frame's update/draw cost (see `FrameTimings`). The same object is
     *  mutated each frame — read, don't hold. */
    readonly timings: FrameTimings;
    /** Subscribe to viewport changes (resize / orientation); returns unsubscribe. */
    onResize(handler: (vp: Viewport) => void): () => void;
    /** Subscribe to each fixed update step (runs after the user's `update`, before
     *  edge input is cleared). Deterministic — used by Clock/Tween. Returns
     *  unsubscribe. */
    onStep(handler: () => void): () => void;
    /** Subscribe to the *start* of each fixed step (runs before the user's
     *  `update`). For sampling poll-only inputs (gamepads) so the same step's
     *  update sees fresh state. Returns unsubscribe. */
    onStepStart(handler: () => void): () => void;
    /** Subscribe to the end of each rendered frame (after `draw`, while the
     *  frame-scoped input flags are still readable). Runs on paused frames too.
     *  For per-frame housekeeping (immediate-mode UI state). Returns
     *  unsubscribe. */
    onFrame(handler: () => void): () => void;
    /** Request a CSS cursor for THIS frame (e.g. `"pointer"` over a clickable).
     *  Applied at frame end and reset every frame, so hover cursors clear
     *  themselves — call it each frame the hover holds. `priority` (default 0)
     *  breaks ties when several are requested: highest wins. */
    setCursor(cursor: string, priority?: number): void;
    /** Re-apply the base (letterbox) transform: logical coords → device pixels.
     *  Screen-space UI calls this to escape a camera block back to the letterbox
     *  base (not raw device space). */
    resetTransform(): void;
    /** Register a teardown to run on `destroy()`. Returns an unsubscribe, so a
     *  capability that is torn down early doesn't leave a stale handler behind. */
    onDestroy(handler: () => void): () => void;
    /** Register callbacks and start the loop (idempotent restart of callbacks). */
    run(callbacks: AppCallbacks): Runtime;
    /** Freeze updates; `draw` keeps running so overlays can render. */
    pause(): void;
    /** Resume from a `pause()`. */
    resume(): void;
    /** Stop the loop entirely. A later `run()` restarts it with a fresh clock. */
    stop(): void;
    /** Tear the app down: stop the loop and remove every window/canvas listener
     *  it registered. The instance is unusable afterwards. Needed for tests,
     *  hot-reload, and replacing an app instance. */
    destroy(): void;
}
/** Config for building an app instance — canvas, resolution, and input/clear
 *  behavior. */
export interface RuntimeOptions {
    /** Canvas element id (without `#`) or the element itself. */
    canvas: string | HTMLCanvasElement;
    /** Key codes whose default browser action (scrolling, etc.) is suppressed
     *  while the app runs. Default: Space + arrow keys. Pass `[]` to suppress
     *  nothing. */
    preventKeys?: KeyCode[];
    /** Backdrop color. When set, the ENGINE owns clearing: the canvas is
     *  filled with this color at the start of every frame (no `clearRect`
     *  boilerplate) and it is the single source of truth for the background —
     *  don't also set one in CSS. Omit to keep clearing in the app's hands. */
    background?: string;
    /** Fixed logical resolution. When set, the engine LETTERBOXES: it fits a
     *  `w×h` logical space into the window (uniform scale, centered, bars on
     *  the spare axis), reports `w`/`h` as the logical size, maps the pointer
     *  into logical coordinates, and scales all drawing — no manual
     *  save/translate/scale. */
    resolution?: {
        w: number;
        h: number;
    };
    /** Letterbox bar color (only with `resolution`). Default "#000". */
    barColor?: string;
    /** Auto-pause while a coarse-pointer device is held in portrait. Default
     *  false. */
    pauseOnPortrait?: boolean;
    /** How many fixed simulation steps run per second. Default 60. This sets the
     *  size of one `update()` — everything that advances per step (clocks,
     *  timers, tweens, particles, UI ageing) derives from it, so raising it
     *  makes the whole simulation finer-grained rather than just calling
     *  `update` more often.
     *
     *  It says nothing about drawing, which follows the display unless `maxFps`
     *  caps it. The two are separate clocks and neither bounds the other: a game
     *  can simulate at 120 and draw at 30, or the reverse.
     *
     *  Named for steps rather than frames because everywhere else in this engine
     *  — `Loop.step`, `Loop.steps`, `onStep` — a step is the unit, and because
     *  `fps` unqualified reads as the frames a player SEES. Unity spells the two
     *  `fixedDeltaTime` and `targetFrameRate`, Godot `physics_ticks_per_second`
     *  and `max_fps`; this is the same split. */
    stepsPerSecond?: number;
    /** @deprecated The old name for `stepsPerSecond`, still honoured so that
     *  existing games keep running. It was confusing next to `maxFps`: one was
     *  the simulation and the other the picture, and both said "fps". */
    fps?: number;
    /** Cap on how often the picture is DRAWN, in frames per second. Unset or 0
     *  draws on the display's own rhythm, which is the default and what a game
     *  normally wants.
     *
     *  `fps` here means what it means everywhere else — the frames a player
     *  sees. The simulation's rate is `stepsPerSecond`, and capping this one
     *  never changes how often the game thinks.
     *
     *  This is not the simulation rate — `fps` above is — and capping it does not
     *  slow the game down: the fixed-step catch-up still runs `update()` the same
     *  number of times per second, and only the drawing is skipped. That is the
     *  whole point on a laptop that is also running a dev server and a browser,
     *  where the scene render is what spins the fan.
     *
     *  A skipped frame skips the frame-end input roll with it, so a click that
     *  lands between two drawn frames is still there for the next one to see. The
     *  frame the app does draw gets a `frameDelta` covering the whole gap, so
     *  anything animating off it moves at the right speed rather than at the
     *  fraction of it that was drawn. */
    maxFps?: number;
    /** Scene backend. `"canvas"` (default) is the existing Canvas2D path with
     *  no extra canvas. `"webgl"` requires WebGL2 and draws `Draw.sprite` /
     *  `Draw.sprites` / `Draw.tiles` / `Draw.particles` on a stacked scene canvas.
     *  `"auto"` tries WebGL2 and falls back to canvas silently. The 2D WebGL
     *  canvas and a 3D `attachSceneLayer` do not compose — two WebGL contexts,
     *  undefined z-order. Pick one GL canvas as the scene, or keep HUD sprites
     *  on Canvas2D. */
    renderer?: "canvas" | "webgl" | "auto";
}
/** One completely isolated app. Optional systems bind directly to this object
 * through their own factories. */
export interface App {
    readonly canvas: HTMLCanvasElement;
    readonly ctx: CanvasRenderingContext2D;
    readonly viewport: Viewport;
    readonly Draw: DrawApi;
    readonly Loop: LoopApi;
    readonly Clock: ClockApi;
    readonly Keys: Keys;
    readonly Pointer: Pointer;
    readonly Mouse: Pointer;
    /** Which scene path this app bound. `"canvas"` is the default 2D path;
     *  `"webgl"` means sprite/sprites/tiles/particles draw on the stacked GL canvas. */
    readonly renderer: "canvas" | "webgl";
    readonly visible: boolean;
    readonly focused: boolean;
    /** Last frame's update/draw cost. Same object mutated each frame — read,
     *  don't hold. */
    readonly timings: FrameTimings;
    resetTransform(): void;
    setCursor(cursor: string, priority?: number): void;
    onResize(handler: Parameters<Runtime["onResize"]>[0]): () => void;
    /** Subscribe to each fixed update step (after the game's `update`, before edge
     *  input is cleared) — the hook for anything that must advance exactly once
     *  per simulated step, so a catch-up frame ticks it for every step it runs. */
    onStep(handler: () => void): () => void;
    /** Subscribe to the START of each fixed step, before the game's `update`. For
     *  sampling poll-only inputs so the same step sees fresh state. */
    onStepStart(handler: () => void): () => void;
    /** Subscribe to the end of each rendered frame, after `draw` and while the
     *  frame-scoped input flags are still readable. Runs on paused frames too —
     *  the hook for debug overlays and immediate-mode UI housekeeping. */
    onFrame(handler: () => void): () => void;
    onDestroy(handler: () => void): () => void;
    destroy(): void;
}
export interface AppOptions extends Omit<RuntimeOptions, "canvas"> {
    /** Let the engine own the page's styling so the canvas is a clean full-window
     *  surface: zero margin/padding, no scrollbars or overscroll, no text
     *  selection or iOS zoom/loupe gestures stealing touches, and the safe-area
     *  insets published as the `--sai-*` custom properties the letterbox reads.
     *  Default **true**.
     *
     *  It has to be on by default to be correct: a page that doesn't do this keeps
     *  the browser's 8px body margin around the canvas (so the canvas, sized to
     *  `innerWidth`/`innerHeight`, overflows into scrollbars), and
     *  `viewport.safeLeft`/`safeTop` read 0 forever because nothing defines the
     *  properties they come from.
     *
     *  Pass `false` when the page already owns its layout — a game with DOM
     *  overlays and its own stylesheet, or a canvas embedded in a larger page.
     *  The backing store then follows the canvas element's CSS box
     *  (`clientWidth`/`clientHeight`) instead of `innerWidth`/`innerHeight`.
     *  The rules are injected into `<head>` at construction, i.e. after a linked
     *  stylesheet, so at equal specificity they would win. `applyFullscreen()` is
     *  exported for applying them yourself, later or conditionally. */
    fullscreen?: boolean;
    /** Swallow the browser navigation the OS fires on a two-finger trackpad swipe
     *  or a touch overscroll, so a stray gesture can't drop the player out of the
     *  game. Default false. */
    preventNavigation?: boolean;
    /** Auto-pause while the page is hidden (tab switch, minimize), and resume
     *  when it comes back. Only the pause it owns is lifted — if game code paused
     *  for its own menu, returning to the tab leaves that pause alone. */
    pauseWhenHidden?: boolean;
    /** Auto-pause while the window is unfocused, and resume on refocus. Same
     *  ownership rule as `pauseWhenHidden`. */
    pauseWhenBlurred?: boolean;
}
/** Create one isolated app. */
export declare function createApp(canvas: string | HTMLCanvasElement, { fullscreen, preventNavigation: navigation, pauseWhenHidden, pauseWhenBlurred, ...runtimeOptions }?: AppOptions): App;
