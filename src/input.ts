// ---------- Input helpers ----------
// Wire DOM buttons with touch+click support while keeping
// the keyboard usable (no focus steal).

/** Binds a button element to an action with touch+click+mousedown handling.
 *  mousedown+preventDefault stops the button from grabbing focus
 *  so the spacebar continues working after a click.
 *  Touch is handled directly in touchstart for reliable mobile response.
 *  Returns the element, or null if the id is missing from the DOM. */
export function wireButton(id: string, action: () => void): HTMLElement | null {
  const btn = document.getElementById(id);
  if (!btn) return null;
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      action();
    },
    { passive: false },
  );
  btn.addEventListener("click", () => {
    action();
    btn.blur();
  });
  return btn;
}

/** Prevent default touch behavior on a canvas so it doesn't steal
 *  focus from keyboard input. Call this once after canvas setup. */
export function preventTouchFocus(canvas: HTMLCanvasElement) {
  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
}
