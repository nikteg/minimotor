// ---------- Fullscreen styling ----------
// CSS that makes the canvas fill the viewport without scrollbars,
// handles safe-area insets, and prevents touch/overscroll interference.

/** Minimal CSS string to include in a <style> tag or inline. */
export const fullscreenCSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #000; touch-action: none;
    -webkit-overflow-scrolling: none;
    overscroll-behavior: none;
  }
  canvas {
    display: block;
    position: absolute;
    top: 0; left: 0;
    /* safe-area insets push canvas edges away from notches */
    top: env(safe-area-inset-top, 0px);
    left: env(safe-area-inset-left, 0px);
    right: env(safe-area-inset-right, 0px);
    bottom: env(safe-area-inset-bottom, 0px);
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
