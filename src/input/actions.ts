import { Keys } from "../engine/index.js";

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

/** Named-action view over the engine's `Keys`, so games stop hand-rolling
 *  "WASD or arrows" checks. Semantics match `Keys` exactly (edge-triggered
 *  `pressed`/`released` per fixed step — read inside `update`).
 *
 *    const input = Minimotor.Input.actions({
 *      left:  ["ArrowLeft", "KeyA"],
 *      right: ["ArrowRight", "KeyD"],
 *      jump:  ["Space", "KeyW"],
 *    });
 *    if (input.down("left")) move(-1);
 *    if (input.pressed("jump")) jump(); */
export function actions<A extends string>(
  map: Record<A, string[]>,
): {
  /** True while any bound key is held. */
  down(action: A): boolean;
  /** True for one update step when any bound key goes down. */
  pressed(action: A): boolean;
  /** True for one update step when any bound key goes up. */
  released(action: A): boolean;
} {
  const test = (action: A, check: (code: string) => boolean) => {
    const codes = map[action];
    if (!codes) return false;
    for (const code of codes) if (check(code)) return true;
    return false;
  };
  return {
    down: (a) => test(a, Keys.down),
    pressed: (a) => test(a, Keys.pressed),
    released: (a) => test(a, Keys.released),
  };
}

/** Keyboard state tracker — returns a live object where `keys["ArrowLeft"]`
 *  is `true` while that key is held. Independent of the Engine; safe to
 *  call anywhere.
 *  @deprecated Use the engine's `Keys` (or `Input.actions`) instead — this
 *  duplicates the held-key tracking with none of the edge semantics, and its
 *  listeners can never be removed. */
export function trackKeys(): Record<string, boolean> {
  const keys: Record<string, boolean> = {};
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });
  return keys;
}
