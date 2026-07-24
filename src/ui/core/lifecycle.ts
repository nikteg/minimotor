import { focusEndFrame, markFocusTrap, padNav, resetFocus, wireFocusKeyboard } from "./focus.js";
import { setBegunCtx } from "./context.js";
import { idScopes } from "./identity.js";
import { resetUiScale } from "./input.js";
import { setTheme } from "./theme.js";
import { Loop } from "../../engine/index.js";

// ---------- Per-frame runtime ----------
// The immediate-mode kernel's frame loop: overlay-capture flags, the `ensureWired`
// housekeeping that drives the fixed step + frame end, and the hook registries
// that let widgets built on top hang their own step/frame-end/reset work off the
// loop WITHOUT the kernel importing them (a core→widget cycle). Widgets register;
// this file owns the ordering. Nothing widget-specific lives here.

// ---------- Overlay capture ----------
// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
export let overlaySeen = false; // an overlay ran this frame

export let overlayActive = false; // an overlay ran last frame → block the background

export let inOverlayPass = false; // the rest of the frame belongs to the overlay

/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  the overlay widgets (popover/modal), which can't reassign the imported flags. */
export function enterOverlay(): void {
  overlaySeen = true;
  markFocusTrap();
  inOverlayPass = true;
}

export let wired = false;

// ---------- Frame-lifecycle hooks -------------------------------------------
// The kernel owns the frame loop; widgets built on top hang their per-step aging,
// deferred overlay draws, frame-end cleanup and test-reset off these registries
// rather than the kernel importing them. Core stays dependency-free; this file
// owns the ordering.
type LifecycleHook = () => void;
const stepHooks: LifecycleHook[] = [];
const overlayPassHooks: LifecycleHook[] = [];
const frameEndHooks: LifecycleHook[] = [];
const resetHooks: LifecycleHook[] = [];

/** Register a fixed-step update — aging float-text pools, the spinner phase, … */
export function onStep(fn: LifecycleHook): void {
  if (!stepHooks.includes(fn)) stepHooks.push(fn);
}

/** Register a deferred overlay-pass draw — run at frame-end BEFORE the focus
 *  registry closes, so a menu drawn now still registers its focusables. */
export function onOverlayPass(fn: LifecycleHook): void {
  if (!overlayPassHooks.includes(fn)) overlayPassHooks.push(fn);
}

/** Register frame-end cleanup — native editor eviction, per-frame seen-sets,
 *  tooltip hover-stability, drag cancel. Run after the overlay focus trap. */
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
      padNav();
      for (const hook of stepHooks) hook();
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
      // Widget frame-end cleanup (editor eviction, tooltip stability, drag cancel).
      for (const hook of frameEndHooks) hook();
    });
    wired = true;
  } catch {
    // no default game yet
  }
}

/** Reset theme, overlay state and Loop wiring, then every widget's registered
 *  reset — for tests. */
export function _reset(): void {
  setTheme({});
  overlaySeen = false;
  overlayActive = false;
  inOverlayPass = false;
  for (const hook of resetHooks) hook();
  resetFocus();
  resetUiScale();
  idScopes.length = 0;
  setBegunCtx(null);
  wired = false;
}
