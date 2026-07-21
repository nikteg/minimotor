// ---------- Input helpers ----------
// Wire DOM buttons with touch+click support while keeping
// the keyboard usable (no focus steal), action mapping over `Keys`,
// and gamepad polling with the same edge semantics.

import { Keys, Loop } from "./engine/index.js";

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

// ---------- Gamepad ----------
// The Gamepad API is poll-only, so state is sampled at the start of every
// fixed step (`Loop.onStepStart`, before the user's `update`) and exposed with
// the same `down`/`pressed`/`released` edge semantics as `Keys`. Sampling
// before update means zero added latency: the step that runs sees the pad as
// it is right now.

/** Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping). */
export const Buttons = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  Select: 8,
  Start: 9,
  L3: 10,
  R3: 11,
  DpadUp: 12,
  DpadDown: 13,
  DpadLeft: 14,
  DpadRight: 15,
} as const;

/** Polled gamepad state. Read inside `update`, like `Keys`. */
export interface GamepadState {
  /** True while a pad is plugged in and reporting. */
  readonly connected: boolean;
  /** Axis value in -1..1 with a deadzone applied (0 when unplugged).
   *  Standard mapping: 0/1 = left stick X/Y, 2/3 = right stick X/Y. */
  axis(index: number): number;
  /** True while the button is held. */
  down(button: number): boolean;
  /** True for one update step when the button goes down. */
  pressed(button: number): boolean;
  /** True for one update step when the button goes up. */
  released(button: number): boolean;
}

const DEADZONE = 0.15;

/** Create a gamepad tracker fed by `read` (injectable for tests). Call `poll()`
 *  once per fixed step; the default `Input.gamepad()` facade wires this to
 *  `Loop.onStepStart` for you. */
export function createGamepadTracker(
  read: () => Gamepad | null | undefined,
): GamepadState & { poll(): void } {
  let connected = false;
  const held: boolean[] = [];
  const pressed: boolean[] = [];
  const released: boolean[] = [];
  const axes: number[] = [];

  return {
    get connected() {
      return connected;
    },
    axis: (i) => axes[i] ?? 0,
    down: (b) => held[b] === true,
    pressed: (b) => pressed[b] === true,
    released: (b) => released[b] === true,

    poll() {
      const gp = read();
      connected = !!gp && gp.connected !== false;
      if (!gp) {
        // Unplugged mid-hold: release everything exactly once.
        for (let i = 0; i < held.length; i++) {
          released[i] = held[i];
          pressed[i] = false;
          held[i] = false;
        }
        axes.length = 0;
        return;
      }
      for (let i = 0; i < gp.buttons.length; i++) {
        const now = gp.buttons[i]?.pressed === true;
        pressed[i] = now && !held[i];
        released[i] = !now && held[i] === true;
        held[i] = now;
      }
      for (let i = 0; i < gp.axes.length; i++) {
        const v = gp.axes[i];
        axes[i] = Math.abs(v) < DEADZONE ? 0 : v;
      }
    },
  };
}

// Default facade: one tracker per pad index, polled on the loop's fixed step.
const defaultPads = new Map<number, ReturnType<typeof createGamepadTracker>>();
let padsWired = false;

function ensurePadsWired(): void {
  if (padsWired) return;
  padsWired = true;
  Loop.onStepStart(() => {
    for (const pad of defaultPads.values()) pad.poll();
  });
}

/** The default gamepad (or pad `index`), polled on the loop's fixed step.
 *  Safe everywhere: reports `connected: false` and neutral inputs where the
 *  Gamepad API is unsupported or nothing is plugged in.
 *
 *    const pad = Minimotor.Input.gamepad();
 *    if (pad.pressed(Input.Buttons.A)) jump();
 *    player.x += pad.axis(0) * speed; */
export function gamepad(index = 0): GamepadState {
  ensurePadsWired();
  let pad = defaultPads.get(index);
  if (!pad) {
    pad = createGamepadTracker(() =>
      typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? navigator.getGamepads()[index]
        : null,
    );
    defaultPads.set(index, pad);
  }
  return pad;
}

/** Reset gamepad facade state and loop wiring — for tests. */
export function _resetGamepads(): void {
  defaultPads.clear();
  padsWired = false;
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
