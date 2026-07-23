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
 *  zoom (a game shouldn't pinch/double-tap-zoom). Patches an existing tag or
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

let gestureGuard: ((e: Event) => void) | null = null;

/** Swallow iOS pinch-zoom gestures (`gesturestart`/`change`/`end`) so the game
 *  view can't be zoomed on a two-finger pinch. Idempotent. */
function preventZoomGestures(): void {
  if (gestureGuard || typeof window === "undefined") return;
  gestureGuard = (e) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    window.addEventListener(type, gestureGuard, { passive: false });
  }
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
 *  trackpad swipe or a touch overscroll — so a game doesn't lose its state to an
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
