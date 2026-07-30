import { applyFullscreen, preventNavigation } from "../fullscreen.js";
import { createClockApi, type ClockApi } from "../clock.js";
import type { Keys, Pointer } from "./input.js";
import type { KeyCode } from "./keycodes.js";
import { createDraw, type DrawApi } from "./draw.js";
import { createLoop, type LoopApi } from "./loop.js";

// ---------- Runtime ----------
// One private canvas runtime backs each public app. App code receives the
// PascalCase services assembled by `createApp()` at the bottom of this file.
//
// Convention: read input (`Keys`/`Pointer`) in `update`, draw (`Draw.ctx`) in
// `draw`. It isn't type-enforced, but edge input (`pressed`/`released`) is only
// meaningful per fixed update step.

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
  /** The backing canvas element (sized to the full window × `dpr`). */
  canvas: HTMLCanvasElement;
  /** The canvas 2D context, pre-set to the base logical→device transform. */
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
  /** Wall-clock ms spent in every fixed update step run this frame. */
  updateMs: number;
  /** Wall-clock ms spent in this frame's `draw`. */
  drawMs: number;
  /** How many fixed steps ran this frame (0 when idle, >1 when catching up). */
  steps: number;
}

/** An isolated built app. Its state (`keys`, `ctx`, …) is read directly. */
export interface Runtime {
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
  /** Real time since the previous rendered frame, in milliseconds. */
  readonly frameDelta: number;
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
  resolution?: { w: number; h: number };
  /** Letterbox bar color (only with `resolution`). Default "#000". */
  barColor?: string;
  /** Auto-pause while a coarse-pointer device is held in portrait. Default
   *  false. */
  pauseOnPortrait?: boolean;
}

export const STEP_MS = 1000 / 60;

// Two fresh presses within this window count as a double-press / double-click;
// the pointer variant also requires the second press to land within
// DOUBLE_CLICK_SLOP logical px of the first.
const DOUBLE_PRESS_MS = 300;
const DOUBLE_CLICK_SLOP = 24;

/** Spiral-of-death guard: at most this many catch-up steps per frame; any
 *  further backlog is dropped (better a one-off slow-motion hitch than a
 *  feedback loop of ever-longer frames). */
const MAX_CATCHUP_STEPS = 5;

const DEFAULT_PREVENT_KEYS = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** Build the low-level canvas runtime used by `createApp()`. */
export function createRuntime(options: RuntimeOptions): Runtime {
  return buildRuntime(options);
}

// Canvas → runtime registry. An app-bound UI uses its rendering context to
// reach the right pointer/viewport/cursor, so two apps remain isolated.
const appsByCanvas = new WeakMap<HTMLCanvasElement, Runtime>();

/** The app bound to `canvas`, or `null` — isolated instances included. */
export function appForCanvas(canvas: HTMLCanvasElement): Runtime | null {
  return appsByCanvas.get(canvas) ?? null;
}

function resolveCanvas(canvas: string | HTMLCanvasElement): HTMLCanvasElement {
  if (typeof canvas !== "string") return canvas;
  const el = document.getElementById(canvas);
  if (!el) throw new Error(`Minimotor: canvas "#${canvas}" not found in the DOM`);
  return el as HTMLCanvasElement;
}

function buildRuntime(options: RuntimeOptions): Runtime {
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

  // Touches on the app's canvas belong to the app (widgets run their own
  // scroll/drag physics). Without `touch-action:none`, mobile browsers claim a
  // touch drag for native panning/zoom — iOS Safari then fires `pointercancel`
  // and stops sending moves, so every swipe gesture dies after a few px. The
  // user-select/callout bits keep long presses from opening the iOS text
  // loupe/callout on the canvas. (The fullscreen CSS sets the same, page-wide.)
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";
  canvas.style.setProperty("-webkit-user-select", "none");
  canvas.style.setProperty("-webkit-touch-callout", "none");

  /** Re-apply the base (letterbox) transform — logical coords → device px.
   *  Used at frame start and by screen-space UI escaping a camera block. */
  const resetTransform = () => {
    // The letterbox offset is generally fractional; round the DEVICE-space
    // translation so the frame origin sits on a whole device pixel (logical
    // coordinates are untouched — only the origin snaps).
    ctx.setTransform(
      viewport.dpr * viewport.scale,
      0,
      0,
      viewport.dpr * viewport.scale,
      Math.round(viewport.dpr * viewport.offsetX),
      Math.round(viewport.dpr * viewport.offsetY),
    );
  };

  const clearFrame = () => {
    if (letterboxed) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = barColor;
      if (background) {
        // The play area gets its own `background` fill below — paint only the
        // actual bar strips (device px) instead of the whole canvas.
        const ox = Math.round(viewport.dpr * viewport.offsetX);
        const oy = Math.round(viewport.dpr * viewport.offsetY);
        const right = ox + viewport.w * viewport.scale * viewport.dpr;
        const bottom = oy + viewport.h * viewport.scale * viewport.dpr;
        if (ox > 0) ctx.fillRect(0, 0, ox, canvas.height);
        if (right < canvas.width) ctx.fillRect(right, 0, canvas.width - right, canvas.height);
        if (oy > 0) ctx.fillRect(0, 0, canvas.width, oy);
        if (bottom < canvas.height) ctx.fillRect(0, bottom, canvas.width, canvas.height - bottom);
      } else {
        // No background → the engine doesn't clear the play area; the full-
        // canvas bar fill doubles as the frame clear. Keep it.
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.restore();
    }
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, viewport.w, viewport.h);
    }
  };

  // Run the app's draw callback, clipped to the logical viewport when the
  // stage is letterboxed — otherwise a following camera or a world larger than
  // the stage spills past the WxH box into the bars.
  const drawClipped = () => {
    if (!letterboxed) {
      callbacks!.draw(ctx);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, viewport.w, viewport.h);
    ctx.clip();
    try {
      callbacks!.draw(ctx);
    } finally {
      ctx.restore();
    }
  };

  // ---- Input state (polled; edge sets are cleared once a step consumes them) ----
  const heldKeys = new Set<string>();
  const pressedKeys = new Set<string>();
  const releasedKeys = new Set<string>();
  // Double-press: a fresh press within DOUBLE_MS of the previous fresh press of
  // the same key (auto-repeat ignored). Cleared with the other edge sets, so
  // `doublePressed` is true for exactly one step, like `pressed`.
  const doublePressedKeys = new Set<string>();
  const lastKeyDownAt = new Map<string, number>();
  const heldKeyValues = new Set<string>();
  const pressedKeyValues = new Set<string>();
  const releasedKeyValues = new Set<string>();
  const keyValueByCode = new Map<string, string>();

  const keys: Keys = {
    down: (code) => heldKeys.has(code),
    pressed: (code) => pressedKeys.has(code),
    released: (code) => releasedKeys.has(code),
    doublePressed: (code) => doublePressedKeys.has(code),
    keyDown: (key) => heldKeyValues.has(key),
    keyPressed: (key) => pressedKeyValues.has(key),
    keyReleased: (key) => releasedKeyValues.has(key),
  };

  const ptr = {
    x: -1,
    y: -1,
    inside: false,
    down: false,
    pressed: false,
    released: false,
    doublePressed: false,
    frameDoublePressed: false,
    frameReleased: false,
    framePressed: false,
    wheel: 0,
  };
  let lastPointerDownAt = Number.NEGATIVE_INFINITY;
  let lastPointerDownX = 0;
  let lastPointerDownY = 0;
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
    get doublePressed() {
      return ptr.doublePressed;
    },
    get frameDoublePressed() {
      return ptr.frameDoublePressed;
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
  let frameDelta = STEP_MS;
  const timings: FrameTimings = { updateMs: 0, drawMs: 0, steps: 0 };
  let paused = false;
  let callbacks: AppCallbacks | null = null;
  let running = false;
  let destroyed = false;
  let lastTime = 0;
  let accumulator = 0;
  let stepsElapsed = 0;

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
    // Do not prevent Space/arrows or leak typing into app actions.
    if (editingText(e.target)) return;
    if (preventKeys.has(e.code)) e.preventDefault();
    if (!heldKeys.has(e.code)) {
      pressedKeys.add(e.code); // ignore auto-repeat
      pressedKeyValues.add(e.key);
      heldKeyValues.add(e.key);
      keyValueByCode.set(e.code, e.key);
      const t = performance.now();
      if (t - (lastKeyDownAt.get(e.code) ?? Number.NEGATIVE_INFINITY) <= DOUBLE_PRESS_MS) {
        doublePressedKeys.add(e.code);
      }
      lastKeyDownAt.set(e.code, t);
    }
    heldKeys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    heldKeys.delete(e.code); // also clear a held key if focus changed mid-hold
    const key = keyValueByCode.get(e.code) ?? e.key;
    keyValueByCode.delete(e.code);
    heldKeyValues.delete(key);
    if (editingText(e.target)) return;
    releasedKeys.add(e.code);
    releasedKeyValues.add(key);
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
  const markDoublePress = () => {
    ptr.doublePressed = true; // one update step (consumed like `pressed`)
    ptr.frameDoublePressed = true; // whole frame, for draw-phase UI
  };
  const onPointerDown = (e: PointerEvent) => {
    setPointer(e);
    const t = performance.now();
    // Fast-path / touch double-tap: a second press within DOUBLE_PRESS_MS and
    // close to the first. The native `dblclick` listener below additionally
    // fires on the OS's own double-click interval (usually wider) so a mouse
    // double-click matches the user's system setting exactly — the two union.
    if (
      t - lastPointerDownAt <= DOUBLE_PRESS_MS &&
      Math.hypot(ptr.x - lastPointerDownX, ptr.y - lastPointerDownY) <= DOUBLE_CLICK_SLOP
    ) {
      markDoublePress();
    }
    lastPointerDownAt = t;
    lastPointerDownX = ptr.x;
    lastPointerDownY = ptr.y;
    ptr.down = true;
    ptr.pressed = true;
    ptr.framePressed = true; // survives the steps; cleared at frame end
  };
  // The browser's `dblclick` respects the OS double-click SPEED and slop — the
  // faithful "same as on my system" window, which no API exposes to read.
  const onDblClick = (e: MouseEvent) => {
    setPointer(e);
    markDoublePress();
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
  // The browser stole the gesture mid-drag (system pan/zoom, a notification
  // pull, the iOS loupe): no pointerup ever comes, only this. Drop `down` so
  // in-flight drags end cleanly instead of sticking until the next tap — but
  // mint NO release edge (a canceled gesture must not read as a click). The
  // event's coordinates are unreliable per spec, so the position stays put.
  const onPointerCancel = () => {
    ptr.down = false;
  };
  // iOS runs its own zoom/selection gestures even under `touch-action:none`:
  // pinch (`gesturestart`/`change`/`end`), double-tap zoom (the second tap's
  // `touchend`) and the double-tap-and-HOLD loupe (the second tap's
  // `touchstart`, plus `selectstart`). Swallow them ON THE CANVAS ONLY —
  // unlike the fullscreen guards (page-wide, see fullscreen.ts), a windowed
  // canvas must leave the rest of the page's gestures alone. Pointer events
  // fire BEFORE their touch counterparts, so the engine's input — including
  // its pointerdown-timing double-press — is unaffected; and the UI's hidden
  // native editors are separate elements, so their taps never land here.
  let lastTouchStartAt = -Infinity;
  let lastTouchEndAt = -Infinity;
  const stopGesture = (e: Event) => e.preventDefault();
  const onTouchStart = (e: TouchEvent) => {
    const now = performance.now();
    if (now - lastTouchStartAt <= 300 && e.touches.length === 1) e.preventDefault();
    lastTouchStartAt = now;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const now = performance.now();
    if (now - lastTouchEndAt <= 300) e.preventDefault();
    lastTouchEndAt = now;
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("dblclick", onDblClick);
  window.addEventListener("pointermove", setPointer);
  canvas.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    canvas.addEventListener(type, stopGesture, { passive: false });
  }
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  canvas.addEventListener("touchend", onTouchEnd, { passive: false });
  canvas.addEventListener("selectstart", stopGesture);
  window.addEventListener("scroll", invalidateRect, true);

  /** Drop edge-triggered input once the update step it belongs to has run, so a
   *  press fires for exactly one step (never twice when a slow frame runs
   *  multiple steps). */
  function consumeEdges() {
    pressedKeys.clear();
    releasedKeys.clear();
    doublePressedKeys.clear();
    pressedKeyValues.clear();
    releasedKeyValues.clear();
    ptr.pressed = false;
    ptr.released = false;
    ptr.doublePressed = false;
  }

  const stepHandlers = new Set<() => void>();
  const stepStartHandlers = new Set<() => void>();
  const frameHandlers = new Set<() => void>();
  const destroyHandlers = new Set<() => void>();
  const resizeHandlers = new Set<(vp: Viewport) => void>();

  // Per-frame cursor request (setCursor): applied at frame end, then reset —
  // a hover cursor clears itself the frame the hover stops. The HIGHEST
  // priority wins (ties → last writer), so e.g. a drop target's "copy" beats a
  // drag source's "grabbing" no matter which draws first.
  let cursorRequest: string | null = null;
  let cursorPriority = -1;
  const endFrame = () => {
    for (const h of frameHandlers) h();
    const cursor = cursorRequest ?? "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    cursorRequest = null;
    cursorPriority = -1;
    ptr.frameReleased = false;
    ptr.framePressed = false;
    ptr.frameDoublePressed = false;
    ptr.wheel = 0;
  };
  // Raw resize events fire continuously during a window drag, and readViewport
  // touches the canvas backing store — coalesce to at most one readViewport
  // per animation frame (the running loop applies the flag at frame start; a
  // stopped/paused-loop stage schedules a one-off rAF so it still adapts).
  let resizeDirty = false;
  let resizeRaf = 0;
  const applyResize = () => {
    if (!resizeDirty) return;
    resizeDirty = false;
    Object.assign(viewport, readViewport(canvas, options.resolution)); // live: mutate in place
    canvasRect = null;
    for (const h of resizeHandlers) h(viewport);
  };
  const handleResize = () => {
    resizeDirty = true;
    if (running || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyResize();
    });
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

  let rafHandle = 0;
  function loop(time: number) {
    if (!running) return;
    // Schedule the next frame FIRST: an exception in the user's update()/draw()
    // then surfaces without silently killing the loop.
    rafHandle = requestAnimationFrame(loop);
    applyResize(); // coalesced viewport re-read (at most once per frame)
    if (!lastTime) lastTime = time;

    if (paused) {
      lastTime = time;
      accumulator = 0;
      frameDelta = 0;
      // No step will consume edge input while paused — drop it so a key pressed
      // mid-pause doesn't fire pressed() on the first step after resume().
      consumeEdges();
      clearFrame();
      drawClipped();
      endFrame(); // pause menus hit-test and scroll in draw too
      return;
    }

    let elapsed = time - lastTime;
    lastTime = time;
    if (elapsed > 250) elapsed = 250;
    frameDelta = elapsed;
    accumulator += elapsed;

    let steps = 0;
    const updStart = performance.now();
    while (accumulator >= STEP_MS) {
      if (++steps > MAX_CATCHUP_STEPS) {
        // Already this far behind, more catch-up only digs the hole deeper —
        // drop the backlog and let the app run slow-motion for one frame.
        accumulator = 0;
        break;
      }
      stepsElapsed += 1;
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

    clearFrame();
    const drawStart = performance.now();
    drawClipped();
    timings.drawMs = performance.now() - drawStart;
    endFrame();
  }

  const app: Runtime = {
    canvas,
    ctx,
    get viewport() {
      return viewport;
    },
    keys,
    pointer,
    get frameDelta() {
      return frameDelta;
    },
    get interpolation() {
      return accumulator / STEP_MS;
    },
    get steps() {
      return stepsElapsed;
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
    setCursor(cursor, priority = 0) {
      if (priority >= cursorPriority) {
        cursorRequest = cursor;
        cursorPriority = priority;
      }
    },
    resetTransform,
    onDestroy(handler) {
      destroyHandlers.add(handler);
      return () => destroyHandlers.delete(handler);
    },
    run(cb) {
      if (destroyed) throw new Error("Minimotor: this app was destroyed — build a new one");
      callbacks = cb;
      if (!running) {
        running = true;
        // Fresh clock: without this, a stop() → run() would see a huge elapsed
        // (up to the 250 ms cap) and fire a burst of catch-up steps.
        lastTime = 0;
        accumulator = 0;
        rafHandle = requestAnimationFrame(loop);
      }
      return app;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    stop() {
      running = false;
      // Cancel the pending frame: a stop() → run() within the same frame must
      // not end up with two scheduled loops.
      globalThis.cancelAnimationFrame?.(rafHandle);
      rafHandle = 0;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      globalThis.cancelAnimationFrame?.(rafHandle);
      rafHandle = 0;
      globalThis.cancelAnimationFrame?.(resizeRaf);
      resizeRaf = 0;
      canvas.style.cursor = "";
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointermove", setPointer);
      window.removeEventListener("scroll", invalidateRect, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrient);
      screen.orientation?.removeEventListener?.("change", handleOrient);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("wheel", onWheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        canvas.removeEventListener(type, stopGesture);
      }
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("selectstart", stopGesture);
      if (portraitMq && portraitApply) portraitMq.removeEventListener?.("change", portraitApply);
      for (const h of destroyHandlers) h();
      stepHandlers.clear();
      stepStartHandlers.clear();
      frameHandlers.clear();
      resizeHandlers.clear();
      destroyHandlers.clear();
      if (appsByCanvas.get(canvas) === app) appsByCanvas.delete(canvas);
    },
  };

  appsByCanvas.set(canvas, app);
  return app;
}

function readViewport(canvas: HTMLCanvasElement, resolution?: { w: number; h: number }): Viewport {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Reassigning canvas.width/height reallocates (and clears) the backing
  // store even when the value is unchanged — skip it when nothing moved.
  const deviceW = Math.round(winW * dpr);
  const deviceH = Math.round(winH * dpr);
  if (canvas.width !== deviceW) canvas.width = deviceW;
  if (canvas.height !== deviceH) canvas.height = deviceH;
  canvas.style.width = winW + "px";
  canvas.style.height = winH + "px";
  const ctx = canvas.getContext("2d")!;

  // Safe-area insets (from fullscreenCSS's `--sai-*` custom properties; non-zero
  // only when the viewport meta carries viewport-fit=cover, e.g. on notched iOS).
  const rootStyle = getComputedStyle(document.documentElement);
  const sai = (name: string) => parseFloat(rootStyle.getPropertyValue(name)) || 0;
  const safeTop = sai("--sai-top");
  const safeRight = sai("--sai-right");
  const safeBottom = sai("--sai-bottom");
  const safeLeft = sai("--sai-left");

  // iPhone landscape reports the notch inset on BOTH sides; tag which edge
  // actually holds it (dataset.notch) for anything that wants to know. The
  // letterbox itself centers within the symmetric insets, so the notch always
  // lands in a bar regardless of side.
  if (/iPhone/.test(navigator.userAgent)) {
    let angle: number | null = null;
    const win = window as unknown as { orientation?: number };
    if (typeof win.orientation === "number") angle = win.orientation;
    else if (screen.orientation && typeof screen.orientation.angle === "number")
      angle = screen.orientation.angle;
    document.documentElement.dataset.notch =
      angle === 90 ? "left" : angle === -90 || angle === 270 ? "right" : "none";
  }

  // The notch-free rectangle, in CSS px — the letterbox fits INSIDE this.
  const availX = safeLeft;
  const availY = safeTop;
  const availW = Math.max(1, winW - safeLeft - safeRight);
  const availH = Math.max(1, winH - safeTop - safeBottom);

  // Letterbox: a fixed logical resolution fitted (uniform, centered) into the
  // SAFE rectangle; otherwise the logical size IS the full window (apps inset
  // their own HUD using the reported safe insets).
  let w = winW;
  let h = winH;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  if (resolution) {
    w = resolution.w;
    h = resolution.h;
    scale = Math.min(availW / w, availH / h);
    offsetX = availX + (availW - w * scale) / 2;
    offsetY = availY + (availH - h * scale) / 2;
  }
  // Base transform maps logical coords → device pixels (dpr × letterbox).
  // The offset is rounded to a whole device pixel so drawing doesn't land on
  // subpixels (the fractional letterbox offset would otherwise blur everything).
  ctx.setTransform(
    dpr * scale,
    0,
    0,
    dpr * scale,
    Math.round(dpr * offsetX),
    Math.round(dpr * offsetY),
  );

  return {
    canvas,
    ctx,
    w,
    h,
    dpr,
    safeLeft,
    safeTop,
    safeRight,
    safeBottom,
    scale,
    offsetX,
    offsetY,
  };
}

// ---------- Public app ----------

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
export function createApp(canvas: string | HTMLCanvasElement, options: AppOptions = {}): App {
  if (options.fullscreen !== false) applyFullscreen();
  if (options.preventNavigation) preventNavigation(true);
  const {
    fullscreen: _fullscreen,
    preventNavigation: _navigation,
    pauseWhenHidden,
    pauseWhenBlurred,
    ...runtimeOptions
  } = options;
  const runtime = createRuntime({ canvas, ...runtimeOptions });
  let visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  let focused = typeof document === "undefined" || document.hasFocus();
  const app = {
    canvas: runtime.canvas,
    ctx: runtime.ctx,
    viewport: runtime.viewport,
    Draw: createDraw(runtime),
    Loop: createLoop(runtime),
    Clock: createClockApi(runtime),
    Keys: runtime.keys,
    Pointer: runtime.pointer,
    get timings() {
      return runtime.timings;
    },
    Mouse: runtime.pointer,
    get visible() {
      return visible;
    },
    get focused() {
      return focused;
    },
    resetTransform: () => runtime.resetTransform(),
    setCursor: (cursor: string, priority?: number) => runtime.setCursor(cursor, priority),
    onResize: (handler: Parameters<Runtime["onResize"]>[0]) => runtime.onResize(handler),
    onStep: (handler: () => void) => runtime.onStep(handler),
    onStepStart: (handler: () => void) => runtime.onStepStart(handler),
    onFrame: (handler: () => void) => runtime.onFrame(handler),
    onDestroy: (handler: () => void) => runtime.onDestroy(handler),
    destroy: () => runtime.destroy(),
  } satisfies App;

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    // Auto-pause has to be able to UNDO itself, or tabbing away freezes the app
    // for good. It also must not lift a pause it didn't cause, so it tracks
    // ownership: it resumes only the pause it took, and declines to take one
    // when the app is already paused by game code (a pause menu survives a tab
    // switch). The one ambiguity a single flag can't resolve — game code pausing
    // *while* auto-paused — resolves in favor of resuming.
    let pausedByLifecycle = false;
    const syncLifecycle = () => {
      visible = document.visibilityState !== "hidden";
      focused = document.hasFocus();
      const shouldPause = (pauseWhenHidden && !visible) || (pauseWhenBlurred && !focused);
      if (shouldPause) {
        if (!app.Loop.paused) {
          app.Loop.pause();
          pausedByLifecycle = true;
        }
      } else if (pausedByLifecycle) {
        pausedByLifecycle = false;
        app.Loop.resume();
      }
    };
    document.addEventListener("visibilitychange", syncLifecycle);
    window.addEventListener("focus", syncLifecycle);
    window.addEventListener("blur", syncLifecycle);
    runtime.onDestroy(() => {
      document.removeEventListener("visibilitychange", syncLifecycle);
      window.removeEventListener("focus", syncLifecycle);
      window.removeEventListener("blur", syncLifecycle);
    });
  }

  return app;
}
