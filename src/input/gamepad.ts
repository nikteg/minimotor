import { Loop } from "../engine/index.js";

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
  /** Axis value in -1..1 with a 0.15 deadzone applied (0 when unplugged).
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
  try {
    Loop.onStepStart(() => {
      for (const pad of defaultPads.values()) pad.poll();
    });
    padsWired = true;
  } catch {
    // No default app yet — polling retries wiring on the next gamepad() call.
  }
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
