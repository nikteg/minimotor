import type { Keys, Pointer } from "./facade.js";
import { clearDefaultGame } from "./facade.js";
import type { KeyCode } from "./keycodes.js";

// ---------- Minimal game framework ----------
// The engine is reached through PascalCase `Minimotor.*` namespaces, all backed
// by ONE default game that `Stage.init()` builds. Game code never imports an
// instance and never threads a per-frame context — it reads the namespaces:
//
//     const vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
//
//     Minimotor.Loop.run({
//       update() { if (Minimotor.Keys.pressed("Space")) jump(); },
//       draw()   { Minimotor.Draw.ctx.clearRect(0, 0, vp.w, vp.h); },
//     });
//
// `createGame()` below returns an isolated `Game` and stays exported for tests
// (and anyone who genuinely needs multiple independent games). The namespaces
// are thin facades over the default instance it produces.
//
// Convention: read input (`Keys`/`Pointer`) in `update`, draw (`Draw.ctx`) in
// `draw`. It isn't type-enforced, but edge input (`pressed`/`released`) is only
// meaningful per fixed update step.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Logical width. Fills the window, or the fixed `resolution.w` when the
   *  stage is letterboxed. */
  w: number;
  /** Logical height (see `w`). */
  h: number;
  /** Device pixel ratio (capped at 2 for perf) */
  dpr: number;
  /** Safe area left inset (notch etc.) */
  safeLeft: number;
  /** Safe area top inset */
  safeTop: number;
  /** Base device→canvas transform (dpr × letterbox scale, plus bar offset).
   *  Everything draws under this; `resetTransform(ctx)` re-applies it after a
   *  camera block. `scale` is 1 (offset 0) when the stage isn't letterboxed. */
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Plugins hook into the game lifecycle; each hook receives the `Game`.
 *  Register with the builder's `use()` or `Loop.use()`. */
export interface EnginePlugin {
  name: string;
  /** Called once after the canvas is ready, before the first frame. */
  onInit?: (game: Game) => void;
  /** Called once per frame, before the user's update step(s). */
  beforeUpdate?: (game: Game) => void;
  /** Called once per frame, after the user's update step(s). */
  afterUpdate?: (game: Game) => void;
  /** Called before the user's draw. */
  beforeDraw?: (game: Game) => void;
  /** Called after the user's draw. */
  afterDraw?: (game: Game) => void;
  /** Called after a viewport resize. */
  onResize?: (game: Game) => void;
}

/** The per-frame callbacks. Input is read from the polled namespaces
 *  (`Minimotor.Keys` / `Minimotor.Pointer`) or, for an isolated game, its
 *  props. */
export interface GameCallbacks {
  /** Fixed-timestep simulation. May run 0..N times per rendered frame; every
   *  call represents exactly one fixed step (1000/60 ms), so THE STEP IS THE
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
  updateMs: number;
  drawMs: number;
  steps: number;
}

/** An isolated built game. Its state (`keys`, `ctx`, …) is read directly; the
 *  `Minimotor.*` namespaces expose the same surface on the default instance. */
export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly keys: Keys;
  readonly pointer: Pointer;
  /** Real time since the previous frame, in fixed steps. */
  readonly frameScale: number;
  /** Render interpolation factor 0..1: how far the unsimulated remainder of
   *  real time has progressed into the next fixed step. Draw at
   *  `prev + (curr - prev) * alpha` for stutter-free motion on non-60 Hz
   *  displays. */
  readonly alpha: number;
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
   *  themselves — call it each frame the hover holds. */
  setCursor(cursor: string): void;
  /** Re-apply the base (letterbox) transform: logical coords → device pixels.
   *  Screen-space UI calls this to escape a camera block back to the letterbox
   *  base (not raw device space). */
  resetTransform(): void;
  /** Register a plugin after build (calls its `onInit` immediately). */
  use(plugin: EnginePlugin): void;
  /** Register callbacks and start the loop (idempotent restart of callbacks). */
  run(callbacks: GameCallbacks): Game;
  /** Freeze updates; `draw` keeps running so overlays can render. */
  pause(): void;
  /** Resume from a `pause()`. */
  resume(): void;
  /** Stop the loop entirely. A later `run()` restarts it with a fresh clock. */
  stop(): void;
  /** Tear the game down: stop the loop and remove every window/canvas listener
   *  it registered. The instance is unusable afterwards. Needed for tests,
   *  hot-reload, and re-running `Stage.init`. */
  destroy(): void;
}

export interface GameOptions {
  /** Canvas element id (without `#`) or the element itself. */
  canvas: string | HTMLCanvasElement;
  /** Key codes whose default browser action (scrolling, etc.) is suppressed
   *  while the game runs. Default: Space + arrow keys. Pass `[]` to suppress
   *  nothing. */
  preventKeys?: KeyCode[];
  /** Backdrop color. When set, the ENGINE owns clearing: the canvas is
   *  filled with this color at the start of every frame (no `clearRect`
   *  boilerplate) and it is the single source of truth for the background —
   *  don't also set one in CSS. Omit to keep clearing in game hands. */
  background?: string;
  /** Fixed logical resolution. When set, the engine LETTERBOXES: it fits a
   *  `w×h` logical space into the window (uniform scale, centered, bars on
   *  the spare axis), reports `w`/`h` as the logical size, maps the pointer
   *  into logical coordinates, and scales all drawing — no manual
   *  save/translate/scale. */
  resolution?: { w: number; h: number };
  /** Letterbox bar color (only with `resolution`). Default "#000". */
  barColor?: string;
  /** Lifecycle plugins (e.g. `Perf.plugin()`). */
  plugins?: EnginePlugin[];
  /** Auto-pause while a coarse-pointer device is held in portrait. */
  pauseOnPortrait?: boolean;
}

export const STEP_MS = 1000 / 60;

// Global fixed-step counter: the engine's heartbeat, shared by every game
// instance (in practice one runs at a time). Pull-based content (cameras,
// motions, cursors) folds forward by "steps elapsed since my last read"
// instead of registering step handlers — see API_PLAN law 4.
let globalSteps = 0;

/** Number of fixed update steps executed since module load. Monotonic; the
 *  time base for pull-derived content. */
export function stepNow(): number {
  return globalSteps;
}

function advanceStepCounter(): void {
  globalSteps += 1;
}

/** Spiral-of-death guard: at most this many catch-up steps per frame; any
 *  further backlog is dropped (better a one-off slow-motion hitch than a
 *  feedback loop of ever-longer frames). */
const MAX_CATCHUP_STEPS = 5;

const DEFAULT_PREVENT_KEYS = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** Create an isolated game. Prefer `Minimotor.Stage.init()` for app code;
 *  this stays exported for tests and multi-game scenarios. */
export function createGame(options: GameOptions): Game {
  return buildGame(options);
}

function resolveCanvas(canvas: string | HTMLCanvasElement): HTMLCanvasElement {
  if (typeof canvas !== "string") return canvas;
  const el = document.getElementById(canvas);
  if (!el) throw new Error(`Minimotor: canvas "#${canvas}" not found in the DOM`);
  return el as HTMLCanvasElement;
}

function buildGame(options: GameOptions): Game {
  const plugins = [...(options.plugins ?? [])];
  const pauseOnPortrait = options.pauseOnPortrait ?? false;
  const canvas = resolveCanvas(options.canvas);
  // The viewport is a LIVE object: same identity forever, fields mutated in
  // place on resize — holders never go stale.
  const viewport = readViewport(canvas, options.resolution);
  const ctx = viewport.ctx;

  const background = options.background ?? null;
  const barColor = options.barColor ?? "#000";
  const letterboxed = !!options.resolution;
  if (background) canvas.style.background = background;

  /** Re-apply the base (letterbox) transform — logical coords → device px.
   *  Used at frame start and by screen-space UI escaping a camera block. */
  const resetTransform = () => {
    ctx.setTransform(
      viewport.dpr * viewport.scale,
      0,
      0,
      viewport.dpr * viewport.scale,
      viewport.dpr * viewport.offsetX,
      viewport.dpr * viewport.offsetY,
    );
  };

  const clearFrame = () => {
    if (letterboxed) {
      // Paint the bars (the whole device canvas), then the play area.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = barColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, viewport.w, viewport.h);
    }
  };

  // ---- Input state (polled; edge sets are cleared once a step consumes them) ----
  const heldKeys = new Set<string>();
  const pressedKeys = new Set<string>();
  const releasedKeys = new Set<string>();

  const keys: Keys = {
    down: (code) => heldKeys.has(code),
    pressed: (code) => pressedKeys.has(code),
    released: (code) => releasedKeys.has(code),
  };

  const ptr = {
    x: -1,
    y: -1,
    inside: false,
    down: false,
    pressed: false,
    released: false,
    frameReleased: false,
    framePressed: false,
    wheel: 0,
  };
  const pointer: Pointer = {
    get x() {
      return ptr.x;
    },
    get y() {
      return ptr.y;
    },
    get inside() {
      return ptr.inside;
    },
    get down() {
      return ptr.down;
    },
    get pressed() {
      return ptr.pressed;
    },
    get released() {
      return ptr.released;
    },
    get frameReleased() {
      return ptr.frameReleased;
    },
    get framePressed() {
      return ptr.framePressed;
    },
    get wheel() {
      return ptr.wheel;
    },
  };

  // ---- Frame state ----
  let frameScale = 1;
  const timings: FrameTimings = { updateMs: 0, drawMs: 0, steps: 0 };
  let paused = false;
  let callbacks: GameCallbacks | null = null;
  let running = false;
  let destroyed = false;
  let lastTime = 0;
  let accumulator = 0;

  const preventKeys = new Set(options.preventKeys ?? DEFAULT_PREVENT_KEYS);
  const editingText = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return (
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable)
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Native controls backing UI.textInput/UI.select own their keystrokes.
    // Do not prevent Space/arrows or leak typing into game actions.
    if (editingText(e.target)) return;
    if (preventKeys.has(e.code)) e.preventDefault();
    if (!heldKeys.has(e.code)) pressedKeys.add(e.code); // ignore auto-repeat
    heldKeys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    heldKeys.delete(e.code); // also clear a game key if focus changed mid-hold
    if (editingText(e.target)) return;
    releasedKeys.add(e.code);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // getBoundingClientRect forces a layout read; pointermove fires at 100+ Hz,
  // so cache the rect and re-read only after resize/scroll.
  let canvasRect: DOMRect | null = null;
  const invalidateRect = () => {
    canvasRect = null;
  };
  const setPointer = (e: { clientX: number; clientY: number }) => {
    if (!canvasRect) canvasRect = canvas.getBoundingClientRect();
    // Client → canvas-CSS px (normalize any CSS stretch), then invert the
    // letterbox base transform (offset + scale) to logical coordinates.
    const cw = canvas.width / viewport.dpr;
    const ch = canvas.height / viewport.dpr;
    const cssX = canvasRect.width > 0 ? ((e.clientX - canvasRect.left) * cw) / canvasRect.width : 0;
    const cssY =
      canvasRect.height > 0 ? ((e.clientY - canvasRect.top) * ch) / canvasRect.height : 0;
    ptr.x = (cssX - viewport.offsetX) / viewport.scale;
    ptr.y = (cssY - viewport.offsetY) / viewport.scale;
    ptr.inside = ptr.x >= 0 && ptr.y >= 0 && ptr.x <= viewport.w && ptr.y <= viewport.h;
  };
  const onPointerDown = (e: PointerEvent) => {
    setPointer(e);
    ptr.down = true;
    ptr.pressed = true;
    ptr.framePressed = true; // survives the steps; cleared at frame end
  };
  const onWheel = (e: WheelEvent) => {
    ptr.wheel += e.deltaY;
  };
  const onPointerUp = (e: PointerEvent) => {
    setPointer(e);
    ptr.down = false;
    ptr.released = true;
    ptr.frameReleased = true; // survives the steps; cleared at frame end
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", setPointer);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("scroll", invalidateRect, true);

  /** Drop edge-triggered input once the update step it belongs to has run, so a
   *  press fires for exactly one step (never twice when a slow frame runs
   *  multiple steps). */
  function consumeEdges() {
    pressedKeys.clear();
    releasedKeys.clear();
    ptr.pressed = false;
    ptr.released = false;
  }

  const stepHandlers = new Set<() => void>();
  const stepStartHandlers = new Set<() => void>();
  const frameHandlers = new Set<() => void>();
  const resizeHandlers = new Set<(vp: Viewport) => void>();

  // Per-frame cursor request (setCursor): applied at frame end, then reset —
  // a hover cursor clears itself the frame the hover stops.
  let cursorRequest: string | null = null;
  const endFrame = () => {
    for (const h of frameHandlers) h();
    const cursor = cursorRequest ?? "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    cursorRequest = null;
    ptr.frameReleased = false;
    ptr.framePressed = false;
    ptr.wheel = 0;
  };
  const handleResize = () => {
    Object.assign(viewport, readViewport(canvas, options.resolution)); // live: mutate in place
    canvasRect = null;
    for (const p of plugins) p.onResize?.(game);
    for (const h of resizeHandlers) h(viewport);
  };
  window.addEventListener("resize", handleResize);
  // iOS doesn't fire resize on 180° rotation between landscape orientations.
  const handleOrient = () => {
    handleResize();
    setTimeout(handleResize, 300);
  };
  window.addEventListener("orientationchange", handleOrient);
  screen.orientation?.addEventListener?.("change", handleOrient);

  let portraitMq: MediaQueryList | null = null;
  let portraitApply: (() => void) | null = null;
  if (pauseOnPortrait) {
    portraitMq = window.matchMedia("(orientation: portrait) and (pointer: coarse)");
    portraitApply = () => {
      paused = portraitMq!.matches;
    };
    portraitMq.addEventListener?.("change", portraitApply);
    portraitApply();
  }

  function loop(time: number) {
    if (!running) return;
    if (!lastTime) lastTime = time;

    if (paused) {
      lastTime = time;
      accumulator = 0;
      frameScale = 0;
      // No step will consume edge input while paused — drop it so a key pressed
      // mid-pause doesn't fire pressed() on the first step after resume().
      consumeEdges();
      clearFrame();
      for (const p of plugins) p.beforeDraw?.(game);
      callbacks!.draw(ctx);
      for (const p of plugins) p.afterDraw?.(game);
      endFrame(); // pause menus hit-test and scroll in draw too
      requestAnimationFrame(loop);
      return;
    }

    let elapsed = time - lastTime;
    lastTime = time;
    if (elapsed > 250) elapsed = 250;
    frameScale = elapsed / STEP_MS;
    accumulator += elapsed;

    for (const p of plugins) p.beforeUpdate?.(game);
    let steps = 0;
    const updStart = performance.now();
    while (accumulator >= STEP_MS) {
      if (++steps > MAX_CATCHUP_STEPS) {
        // Already this far behind, more catch-up only digs the hole deeper —
        // drop the backlog and let the game run slow-motion for one frame.
        accumulator = 0;
        break;
      }
      advanceStepCounter();
      for (const h of stepStartHandlers) h(); // poll-only inputs sample here
      callbacks!.update();
      for (const h of stepHandlers) h(); // timers / tweens advance one step
      // Each step observes the current press, then it's consumed — so pressed()
      // is true for exactly one step, even if this frame runs several.
      consumeEdges();
      accumulator -= STEP_MS;
    }
    timings.updateMs = performance.now() - updStart;
    timings.steps = Math.min(steps, MAX_CATCHUP_STEPS);
    for (const p of plugins) p.afterUpdate?.(game);

    clearFrame();
    for (const p of plugins) p.beforeDraw?.(game);
    const drawStart = performance.now();
    callbacks!.draw(ctx);
    timings.drawMs = performance.now() - drawStart;
    for (const p of plugins) p.afterDraw?.(game);
    endFrame();
    requestAnimationFrame(loop);
  }

  const game: Game = {
    canvas,
    ctx,
    get viewport() {
      return viewport;
    },
    keys,
    pointer,
    get frameScale() {
      return frameScale;
    },
    get alpha() {
      return accumulator / STEP_MS;
    },
    get paused() {
      return paused;
    },
    timings,
    onResize(handler) {
      resizeHandlers.add(handler);
      return () => resizeHandlers.delete(handler);
    },
    onStep(handler) {
      stepHandlers.add(handler);
      return () => stepHandlers.delete(handler);
    },
    onStepStart(handler) {
      stepStartHandlers.add(handler);
      return () => stepStartHandlers.delete(handler);
    },
    onFrame(handler) {
      frameHandlers.add(handler);
      return () => frameHandlers.delete(handler);
    },
    setCursor(cursor) {
      cursorRequest = cursor;
    },
    resetTransform,
    use(plugin) {
      plugins.push(plugin);
      plugin.onInit?.(game);
    },
    run(cb) {
      if (destroyed) throw new Error("Minimotor: this game was destroyed — build a new one");
      callbacks = cb;
      if (!running) {
        running = true;
        // Fresh clock: without this, a stop() → run() would see a huge elapsed
        // (up to the 250 ms cap) and fire a burst of catch-up steps.
        lastTime = 0;
        accumulator = 0;
        requestAnimationFrame(loop);
      }
      return game;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    stop() {
      running = false;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      canvas.style.cursor = "";
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", setPointer);
      window.removeEventListener("scroll", invalidateRect, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrient);
      screen.orientation?.removeEventListener?.("change", handleOrient);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("wheel", onWheel);
      if (portraitMq && portraitApply) portraitMq.removeEventListener?.("change", portraitApply);
      stepHandlers.clear();
      stepStartHandlers.clear();
      resizeHandlers.clear();
      clearDefaultGame(game);
    },
  };

  for (const p of plugins) p.onInit?.(game);
  return game;
}

function readViewport(canvas: HTMLCanvasElement, resolution?: { w: number; h: number }): Viewport {
  // Known quirk: the canvas is sized to the full window, but fullscreenCSS
  // offsets it by the safe-area insets — on a notched device the far edge
  // overflows by the inset. Draw HUD elements inside `safeLeft`/`safeTop`
  // and keep gameplay away from the extreme edges.
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(winW * dpr);
  canvas.height = Math.round(winH * dpr);
  canvas.style.width = winW + "px";
  canvas.style.height = winH + "px";
  const ctx = canvas.getContext("2d")!;

  // Letterbox: a fixed logical resolution fitted (uniform, centered) into the
  // window; otherwise the logical size IS the window and scale is 1.
  let w = winW;
  let h = winH;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  if (resolution) {
    w = resolution.w;
    h = resolution.h;
    scale = Math.min(winW / w, winH / h);
    offsetX = (winW - w * scale) / 2;
    offsetY = (winH - h * scale) / 2;
  }
  // Base transform maps logical coords → device pixels (dpr × letterbox).
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);

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

  return { canvas, ctx, w, h, dpr, safeLeft, safeTop, scale, offsetX, offsetY };
}
