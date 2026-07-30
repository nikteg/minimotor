import { focusEndFrame, markFocusTrap, padNav, wireFocusKeyboard } from "./focus.js";
import { sweepCaches } from "./frame-cache.js";
import { clearPointerCache, resetUiScale } from "./input.js";
import {
  type UiRuntime,
  allRuntimes,
  currentRuntime,
  defaultUiRuntime,
  resetRuntimes,
  runtimeSlot,
  switchRuntime,
  uiApp,
  withRuntime,
} from "./runtime.js";
import { setTheme } from "./theme.js";

// ---------- Per-frame runtime ----------
// The immediate-mode kernel's frame loop: overlay-capture flags, the `ensureWired`
// housekeeping that drives the fixed step + frame end, and the hook registries
// that let widgets built on top hang their own step/frame-end/reset work off the
// loop WITHOUT the kernel importing them (a core→widget cycle). Widgets register;
// this file owns the ordering. Nothing widget-specific lives here.
//
// Wiring is PER RUNTIME: each runtime hooks the loop of its own host app (the
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

const overlay = runtimeSlot<OverlayState>(() => ({
  seen: false,
  active: false,
  inPass: false,
}));

/** An overlay ran LAST frame — background widgets must ignore the pointer. */
export function isOverlayActive(): boolean {
  return overlay().active;
}

/** The rest of this frame belongs to an overlay opened this frame. */
export function isInOverlayPass(): boolean {
  return overlay().inPass;
}

/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  the overlay widgets (popover/modal), which own the capture semantics. */
export function enterOverlay(focusVisible = false): void {
  const o = overlay();
  o.seen = true;
  markFocusTrap(focusVisible);
  o.inPass = true;
}

// ---------- Frame-lifecycle hooks -------------------------------------------
// The kernel owns the frame loop; widgets built on top hang their per-step aging,
// deferred overlay draws, frame-end cleanup and test-reset off these registries
// rather than the kernel importing them. The registries are GLOBAL (module
// wiring); every registered function operates on the CURRENT runtime's state,
// and the kernel invokes them once per runtime.
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

/** Register test-reset cleanup, run by `_reset` (once per runtime — release
 *  DOM nodes here; plain slot state is dropped wholesale). */
export function onReset(fn: LifecycleHook): void {
  if (!resetHooks.includes(fn)) resetHooks.push(fn);
}

// One runtime's frame-end housekeeping, run from its host loop's onFrame.
function runtimeFrameEnd(rt: UiRuntime): void {
  withRuntime(rt, () => {
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
  // The frame is over — a begun runtime stops being ambient so state can't
  // leak into the next frame (apps re-`begin()` each frame).
  if (currentRuntime() === rt) switchRuntime(defaultUiRuntime());
}

export function ensureWired(): void {
  wireFocusKeyboard();
  const rt = currentRuntime();
  // Wiring needs the runtime's host app; without one (headless/tests) stay
  // unwired and retry next call.
  const app = uiApp();
  if (!app) return;
  // Compare the APP, not a "wired once" flag: replacing a game destroys
  // the app these hooks live on and takes them with it. Re-attaching to the
  // new app here is what keeps the UI kernel alive across a re-init (without
  // it the pointer cache, overlay capture and focus registry all go dead).
  if (rt.wiredTo === app) return;
  rt.wiredTo = app;
  app.onStep(() => {
    withRuntime(rt, () => {
      padNav();
      for (const hook of stepHooks) hook();
    });
  });
  // Frame-end housekeeping for the immediate-mode state machines.
  app.onFrame(() => runtimeFrameEnd(rt));
}

/** Reset the theme, global UI-scale settings, every runtime's widget state
 *  (running each runtime's registered resets first — they release DOM nodes)
 *  and the runtime wiring — for tests. */
export function _reset(): void {
  setTheme({});
  for (const rt of allRuntimes) {
    withRuntime(rt, () => {
      for (const hook of resetHooks) hook();
    });
  }
  resetUiScale();
  resetRuntimes();
}
