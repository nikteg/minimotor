import { focusEndFrame, markFocusTrap, padNav, wireFocusKeyboard } from "./focus.js";
import { sweepCaches } from "./frame-cache.js";
import { clearPointerCache, markPointerOverUi, resetUiScale } from "./input.js";
import {
  allUiApps,
  clearUiApp,
  markUiAppWired,
  resetUiApps,
  uiApp,
  uiAppWired,
  uiSlot,
  withUiApp,
} from "./state.js";
import type { App } from "@src/engine/index.js";
import { setTheme } from "./theme.js";

// ---------- Per-frame lifecycle ----------
// The immediate-mode kernel's frame loop: overlay-capture flags, the `ensureWired`
// housekeeping that drives the fixed step + frame end, and the hook registries
// that let widgets built on top hang their own step/frame-end/reset work off the
// loop WITHOUT the kernel importing them (a core→widget cycle). Widgets register;
// this file owns the ordering. Nothing widget-specific lives here.
//
// Wiring is PER APP: each app hooks the loop of its own host app (the
// app behind the current context, so two games on
// one page each run their own overlay pass, focus close and cleanup — against
// their own state.

// ---------- Overlay capture ----------
// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
interface OverlayState {
  seen: boolean; // an overlay ran this frame
  active: boolean; // an overlay ran last frame → block the background
  inPass: boolean; // the rest of the frame belongs to the overlay
}

const overlay = uiSlot<OverlayState>(() => ({
  seen: false,
  active: false,
  inPass: false,
}));

/** An overlay is active for the current frame — background widgets must ignore
 *  the pointer. This includes an overlay captured during the ordinary draw
 *  pass and one carried over from the previous frame. */
export function isOverlayActive(): boolean {
  const o = overlay();
  return o.active || o.seen;
}

/** The rest of this frame belongs to an overlay opened this frame. */
export function isInOverlayPass(): boolean {
  return overlay().inPass;
}

/** Capture the background while an overlay is being deferred. The overlay's
 *  own controls are not live until `enterOverlay()` runs in the overlay pass. */
export function captureOverlay(focusVisible = false): void {
  const o = overlay();
  o.seen = true;
  // An overlay owns the whole screen, not just its own box: the background is
  // dead to the pointer while it is up, and a game drawn under the UI has to
  // treat the pointer as spoken for wherever it is. See `pointerOverUi`.
  markPointerOverUi();
  markFocusTrap(focusVisible);
}

/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  immediate overlays and by deferred overlays when their pass begins. */
export function enterOverlay(focusVisible = false): void {
  const o = overlay();
  captureOverlay(focusVisible);
  o.inPass = true;
}

// ---------- Frame-lifecycle hooks -------------------------------------------
// The kernel owns the frame loop; widgets built on top hang their per-step aging,
// deferred overlay draws, frame-end cleanup and test-reset off these registries
// rather than the kernel importing them. The registries are GLOBAL (module
// wiring); every registered function operates on the SELECTED app's state,
// and the kernel invokes them once per app.
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

/** Wrap one-time hook registration.
 *
 *  A widget can't register its lifecycle hooks at import time — that would wire
 *  the frame loop for a widget the game never draws — so each registers on its
 *  first draw and must then not register again. Five widgets had written the
 *  same module-level `let wired` guard; this is that guard:
 *
 *      const ensureHooks = lifecycleOnce(() => { onFrameEnd(sweep); onReset(clear); });
 *
 *  Module-scoped, deliberately, like the hook lists themselves: registration is
 *  idempotent per hook, and the hooks look up per-app state when they run. */
export function lifecycleOnce(register: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    register();
  };
}

/** Register test-reset cleanup, run by `_reset` (once per app — release
 *  DOM nodes here; plain slot state is dropped wholesale). */
export function onReset(fn: LifecycleHook): void {
  if (!resetHooks.includes(fn)) resetHooks.push(fn);
}

// One app's frame-end housekeeping, run from its host loop's onFrame.
function appFrameEnd(app: App): void {
  withUiApp(app, () => {
    // Deferred overlays render above every ordinary widget in the user's
    // draw callback (and still see frame-scoped pointer release edges).
    for (const hook of overlayPassHooks) hook();
    // Complete this frame's keyboard registry (after every widget, including
    // deferred overlays, registered) and run the overlay focus trap.
    focusEndFrame();
    // Overlay capture: what was drawn this frame gates input next frame.
    const o = overlay();
    o.active = o.seen;
    o.seen = false;
    o.inPass = false;
    // Widget frame-end cleanup (editor eviction, tooltip stability, drag cancel).
    for (const hook of frameEndHooks) hook();
    // The memoized pointer and the swept widget-state caches age per frame.
    clearPointerCache();
    sweepCaches();
  });
  // The frame is over — an active app stops being ambient so state can't
  // leak into the next frame (each frame re-selects its app).
  clearUiApp(app);
}

export function ensureWired(): void {
  wireFocusKeyboard();
  const app = uiApp();
  // Compare the APP, not a "wired once" flag: replacing a game destroys
  // the app these hooks live on and takes them with it. Re-attaching to the
  // new app here is what keeps the UI kernel alive across a re-init (without
  // it the pointer cache, overlay capture and focus registry all go dead).
  if (uiAppWired(app)) return;
  markUiAppWired(app);
  app.onStep(() => {
    withUiApp(app, () => {
      padNav();
      for (const hook of stepHooks) hook();
    });
  });
  // Frame-end housekeeping for the immediate-mode state machines.
  app.onFrame(() => appFrameEnd(app));
}

/** Reset the theme, global UI-scale settings, every app's widget state
 *  (running each app's registered resets first — they release DOM nodes)
 *  and the app wiring — for tests. */
export function _reset(): void {
  setTheme({});
  for (const app of allUiApps) {
    withUiApp(app, () => {
      for (const hook of resetHooks) hook();
    });
  }
  resetUiScale();
  resetUiApps();
}
