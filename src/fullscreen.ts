// ---------- Fullscreen styling ----------
// CSS that makes the canvas fill the viewport without scrollbars,
// handles safe-area insets, and prevents touch/overscroll interference.

/** Minimal CSS string to include in a <style> tag or inline. */
export const fullscreenCSS = `
  /* Publish the safe-area insets as custom properties so the engine's
     readViewport can letterbox INSIDE the notch-free rectangle. These are only
     non-zero when the viewport meta carries viewport-fit=cover (ensureViewportMeta). */
  :root {
    --sai-top: env(safe-area-inset-top, 0px);
    --sai-right: env(safe-area-inset-right, 0px);
    --sai-bottom: env(safe-area-inset-bottom, 0px);
    --sai-left: env(safe-area-inset-left, 0px);
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #000; touch-action: none;
    overscroll-behavior: none;
    /* No hold-to-select / callout / magnifier hijacking touches (iOS). */
    -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none;
  }
  canvas {
    display: block;
    position: absolute;
    top: 0; left: 0;
    /* Kill browser gestures on the canvas itself (double-tap / pinch / long-press
       zoom on iOS) — html/body alone don't cover a touch that lands on the canvas.
       The safe-area insets are handled by the letterbox transform, not by shifting
       the canvas, so it stays a clean full-window surface. */
    touch-action: none;
    -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none;
  }
`;

/** Ensure a mobile-friendly viewport meta: `viewport-fit=cover` (so the
 *  `env(safe-area-inset-*)` values are non-zero on notched iOS) and no user
 *  zoom (a fullscreen canvas app shouldn't pinch/double-tap-zoom). Patches an existing tag or
 *  creates one. */
function ensureViewportMeta(): void {
  const content =
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "viewport";
    document.head.appendChild(meta);
  }
  meta.content = content;
}

let zoomGuardsWired = false;
let lastTouchEnd = 0;
let lastTouchStart = 0;

// A native editing surface, where the OS text selection / callout is wanted.
function isFormField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true
  );
}

/** Block the ways iOS zooms/selects a canvas view that CSS/meta can't. iOS ignores
 *  `maximum-scale`/`user-scalable=no` and still runs its own gestures under
 *  `touch-action:none`, so:
 *  - pinch-zoom → swallow `gesturestart`/`change`/`end`.
 *  - double-tap zoom → cancel the SECOND tap's `touchend`.
 *  - the double-tap-and-HOLD "magnifying glass" loupe (a text-selection gesture
 *    that appears during the hold, before touchend) → cancel the second tap's
 *    `touchstart` and any `selectstart`.
 *  All guards are scoped to NON form fields (so a native <input>/<textarea> keeps
 *  its keyboard + selection) and only the SECOND tap of a double-tap is touched,
 *  so single taps — including the tap that focuses a field — still work. None of
 *  this cancels `pointerdown`, so the engine's input and its pointerdown-timing
 *  double-tap detection are unaffected. Idempotent. */
function preventZoomGestures(): void {
  if (zoomGuardsWired || typeof window === "undefined") return;
  zoomGuardsWired = true;
  const stop = (e: Event) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    window.addEventListener(type, stop, { passive: false });
  }
  document.addEventListener(
    "touchstart",
    (e) => {
      const now = performance.now();
      const isDoubleTap = now - lastTouchStart <= 300;
      lastTouchStart = now;
      // Second tap of a double-tap (single finger, not a form field): stop iOS
      // from starting its selection/magnifier gesture on the hold.
      if (isDoubleTap && e.touches.length === 1 && !isFormField(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    "touchend",
    (e) => {
      const now = performance.now();
      if (now - lastTouchEnd <= 300 && !isFormField(e.target)) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
  // The loupe is the text-selection magnifier; stop a selection from starting
  // anywhere but a real field, which suppresses the loupe without touching input.
  document.addEventListener("selectstart", (e) => {
    if (!isFormField(e.target)) e.preventDefault();
  });
}

/** Inject fullscreen styles into the document <head>, fix the viewport meta and
 *  block zoom gestures. Safe to call multiple times (idempotent). */
export function applyFullscreen(): void {
  if (typeof document === "undefined") return;
  ensureViewportMeta();
  preventZoomGestures();
  const id = "minimotor-fullscreen";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = fullscreenCSS;
  document.head.appendChild(style);
}

// ---------- Navigation guard ----------

let navWheel: ((e: WheelEvent) => void) | null = null;

/** Stop stray browser navigation — the back/forward the OS fires on a two-finger
 *  trackpad swipe or a touch overscroll — so the app doesn't lose its state to an
 *  accidental gesture. Sets `overscroll-behavior: none` on the document and
 *  swallows horizontal-dominant wheel events (the trackpad swipe-back signal);
 *  vertical scrolling and the engine's own wheel input are untouched. Pass
 *  `false` to release. Idempotent. */
export function preventNavigation(prevent = true): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (prevent) {
    root.style.overscrollBehavior = "none";
    if (document.body) document.body.style.overscrollBehavior = "none";
    if (!navWheel) {
      navWheel = (e) => {
        // A horizontal-dominant wheel is the trackpad back/forward swipe.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
      };
      window.addEventListener("wheel", navWheel, { passive: false });
    }
  } else {
    root.style.overscrollBehavior = "";
    if (document.body) document.body.style.overscrollBehavior = "";
    if (navWheel) {
      window.removeEventListener("wheel", navWheel);
      navWheel = null;
    }
  }
}
