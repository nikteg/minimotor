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

/** Fire device haptics via the Vibration API. `pattern` is a duration in ms or
 *  an on/off pattern (`[on, off, on, …]`). Returns true if the buzz was
 *  accepted. Safe everywhere: no-ops (returns false) where vibration is
 *  unsupported — desktop, iOS Safari — so callers never need to feature-detect. */
export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}
