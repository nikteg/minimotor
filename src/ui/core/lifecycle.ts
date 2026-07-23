import { focusEndFrame, markFocusTrap, padNav, resetFocus, wireFocusKeyboard } from "./focus.js";
import { setBegunCtx, uiCtx } from "./context.js";
import { idScopes } from "./identity.js";
import { centeredText, drawBox, setTheme, theme, uiFont } from "./theme.js";
import { Loop, Pointer, Stage } from "../../engine/index.js";

// ---------- Drag state (shared: widgets set it, the frame loop cancels it) ----
export interface ActiveDrag {
  sourceId: string;
  payload: unknown;
  offsetX: number;
  offsetY: number;
}

export let activeDrag: ActiveDrag | null = null;

/** Set/clear the active drag from the dragdrop widgets (they can't reassign an
 *  imported binding). */
export function setActiveDrag(d: ActiveDrag | null): void {
  activeDrag = d;
}

/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  the overlay widgets (popover/modal), which can't reassign the imported flags. */
export function enterOverlay(): void {
  overlaySeen = true;
  markFocusTrap();
  inOverlayPass = true;
}

// ---------- Overlay capture ----------

// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
export let overlaySeen = false; // an overlay ran this frame

export let overlayActive = false; // an overlay ran last frame → block the background

export let inOverlayPass = false; // the rest of the frame belongs to the overlay

// ---------- Floating text ----------

/** Options for a floating text. */
export interface FloatTextOptions {
  /** Rise speed in px/s (negative = up). Default -50. */
  vy?: number;
  /** Lifetime in ms. Default 900. */
  life?: number;
  /** Fill color. Default "#fff". */
  color?: string;
  /** Font. Default "bold 14px monospace". */
  font?: string;
}

export interface FloatText {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  remaining: number;
  color: string;
  font: string;
}

/** A pool of rising, fading texts. Pure — drive `advance(dt)` yourself (the
 *  `UI` facade wires it to the fixed step for you). */
export interface FloatTextManager {
  /** Spawn a rising text at `(x, y)`; `opts` tunes drift/lifetime/color/font. */
  spawn(text: string, x: number, y: number, opts?: FloatTextOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Remove every text at once. */
  clear(): void;
  /** Number of live texts currently in the pool. */
  readonly size: number;
}

/** Create a fresh, empty `FloatTextManager` pool. The `UI` facade keeps a
 *  shared one (`UI.floatText`); make your own for an isolated set of texts. */
export function createFloatText(): FloatTextManager {
  const texts: FloatText[] = [];
  return {
    spawn(text, x, y, opts = {}) {
      texts.push({
        text,
        x,
        y,
        vy: opts.vy ?? -50,
        life: opts.life ?? 900,
        remaining: opts.life ?? 900,
        color: opts.color ?? "#fff",
        font: opts.font ?? "bold 14px monospace",
      });
    },

    advance(dt) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.remaining -= dt;
        if (t.remaining <= 0) {
          texts.splice(i, 1);
          continue;
        }
        t.y += (t.vy * dt) / 1000;
      }
    },

    draw(ctx) {
      if (texts.length === 0) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of texts) {
        // Full strength, then fade out over the last half of the lifetime.
        ctx.globalAlpha = Math.min(1, (2 * t.remaining) / t.life);
        ctx.fillStyle = t.color;
        ctx.font = t.font;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    },

    clear() {
      texts.length = 0;
    },

    get size() {
      return texts.length;
    },
  };
}

// ---------- Tooltip ----------

export let tipRequest: string | null = null; // asked for this frame

export let tipShown: { text: string; since: number } | null = null; // hover-stable

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(msg: string): void {
  ensureWired();
  tipRequest = msg;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export function drawTips(maybeCtx?: CanvasRenderingContext2D): void {
  const ctx = maybeCtx ?? uiCtx();
  if (!tipShown || performance.now() - tipShown.since < 350) return;
  const msg = tipShown.text;
  const vp = Stage.viewport;
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(msg).width + 16;
  const h = 24;
  let x = Pointer.x + 14;
  let y = Pointer.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = Pointer.y - 8 - h;
  drawBox(ctx, x, y, w, h, {
    fill: theme.panelBg,
    stroke: theme.border,
    border: 1,
    radius: Math.min(theme.radius, 6),
  });
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, msg, x + 8, y + h / 2);
  ctx.restore();
}

// ---------- Default facade (aged by the default Loop's fixed step) ----------

export let floats = createFloatText();

export let spinAngle = 0;

export let wired = false;

// ---------- Frame-lifecycle hooks -------------------------------------------
// Widgets built ON TOP of the kernel (the native-backed select/textInput) need
// to hang deferred draws + cleanup off the frame loop that the kernel owns.
// Rather than have core import those widgets (a core→widget cycle), the widgets
// register their callbacks here. Core stays dependency-free; the lifecycle owns
// the ordering.
type LifecycleHook = () => void;
const overlayPassHooks: LifecycleHook[] = [];
const frameEndHooks: LifecycleHook[] = [];
const resetHooks: LifecycleHook[] = [];

/** Register a deferred overlay-pass draw — run at frame-end BEFORE the focus
 *  registry closes, so a menu drawn now still registers its focusables. */
export function onOverlayPass(fn: LifecycleHook): void {
  if (!overlayPassHooks.includes(fn)) overlayPassHooks.push(fn);
}

/** Register frame-end cleanup — evicting stale native editors and clearing the
 *  per-frame seen-sets. Run after the overlay focus trap. */
export function onFrameEnd(fn: LifecycleHook): void {
  if (!frameEndHooks.includes(fn)) frameEndHooks.push(fn);
}

/** Register test-reset cleanup, run by `_reset`. */
export function onReset(fn: LifecycleHook): void {
  if (!resetHooks.includes(fn)) resetHooks.push(fn);
}

export function ensureWired(): void {
  wireFocusKeyboard();
  if (wired) return;
  // Registering the loop hooks needs the default game; without one
  // (headless/tests) the calls throw — stay unwired and retry next call.
  try {
    Loop.onStep(() => {
      floats.advance(Loop.step);
      spinAngle += 0.12; // ~7 rad/s at 60 steps
      padNav();
    });
    // Frame-end housekeeping for the immediate-mode state machines.
    Loop.onFrame(() => {
      // Deferred overlays render above every ordinary widget in the user's
      // draw callback (and still see frame-scoped pointer release edges).
      for (const hook of overlayPassHooks) hook();
      setBegunCtx(null); // re-begin() each frame when overriding the ctx
      // Complete this frame's keyboard registry (after every widget, including
      // deferred overlays, registered) and run the overlay focus trap.
      focusEndFrame();
      // Overlay capture: what was drawn this frame gates input next frame.
      overlayActive = overlaySeen;
      overlaySeen = false;
      inOverlayPass = false;
      // Tooltip hover-stability: same text keeps its timer; a change restarts.
      if (tipRequest) {
        if (tipShown?.text !== tipRequest) {
          tipShown = { text: tipRequest, since: performance.now() };
        }
      } else {
        tipShown = null;
      }
      tipRequest = null;
      // Widget frame-end cleanup (native editor eviction, per-frame seen-sets).
      for (const hook of frameEndHooks) hook();
      // A release not consumed by any drop target cancels the drag.
      try {
        if (activeDrag && Pointer.frameReleased) activeDrag = null;
      } catch {
        activeDrag = null;
      }
    });
    wired = true;
  } catch {
    // no default game yet
  }
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloatText`. */
export function floatText(str: string, x: number, y: number, opts?: FloatTextOptions): void {
  ensureWired();
  floats.spawn(str, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloatText(ctx?: CanvasRenderingContext2D): void {
  floats.draw(ctx ?? uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloatText(): void {
  floats.clear();
}

/** Reset floats, theme and Loop wiring — for tests. */
export function _reset(): void {
  floats = createFloatText();
  setTheme({});
  tipRequest = null;
  tipShown = null;
  overlaySeen = false;
  overlayActive = false;
  inOverlayPass = false;
  activeDrag = null;
  for (const hook of resetHooks) hook();
  resetFocus();
  idScopes.length = 0;
  setBegunCtx(null);
  wired = false;
}
