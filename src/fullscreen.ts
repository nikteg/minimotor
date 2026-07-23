// ---------- Fullscreen styling ----------
// CSS that makes the canvas fill the viewport without scrollbars,
// handles safe-area insets, and prevents touch/overscroll interference.

/** Minimal CSS string to include in a <style> tag or inline. */
export const fullscreenCSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #000; touch-action: none;
    overscroll-behavior: none;
  }
  canvas {
    display: block;
    position: absolute;
    /* top/left twice on purpose: the first is the fallback for browsers that
       drop the env() declarations entirely. */
    top: 0; left: 0;
    /* safe-area insets push canvas edges away from notches */
    top: env(safe-area-inset-top, 0px);
    left: env(safe-area-inset-left, 0px);
  }
`;

/** Inject fullscreen styles into the document <head>.
 *  Safe to call multiple times (idempotent). */
export function applyFullscreen(): void {
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
