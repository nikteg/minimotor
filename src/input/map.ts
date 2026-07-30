// ---------- Input.map: named actions over fused devices ----------
// One typed map from action names to flat binding lists; keyboard codes and
// "pad:" prefixed gamepad codes side by side. Property access at the call
// site (`input.jump.pressed`), Godot-style `axis`/`vector` synthesis, and
// bindings that are plain JSON — a rebinding UI is data + Storage, not code.
//
//   const input = Input.map({
//     left:  ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
//     right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
//     jump:  ["Space", "pad:a"],
//   });
//   if (input.jump.pressed) jump();
//   player.vel.x = input.axis("left", "right") * SPEED;
//
// Zero wiring: nothing registers. Reads derive from `Keys` (already
// step-tracked by the engine) and the pad tracker, with pad edges folded
// per step on read (API_PLAN law 4).

import type { KeyCode } from "../engine/index.js";
import type { Vec2 } from "../vec2.js";
import { Buttons, type GamepadState } from "./gamepad.js";

/** Standard-mapping gamepad inputs by name (sticks as four directions). */
export type PadButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "l1"
  | "r1"
  | "l2"
  | "r2"
  | "select"
  | "start"
  | "l3"
  | "r3"
  | "dpad-up"
  | "dpad-down"
  | "dpad-left"
  | "dpad-right"
  | "lstick-up"
  | "lstick-down"
  | "lstick-left"
  | "lstick-right"
  | "rstick-up"
  | "rstick-down"
  | "rstick-left"
  | "rstick-right";

/** A gamepad binding string: a `PadButton` under the `pad:` prefix. */
export type PadCode = `pad:${PadButton}`;

/** One entry in an action's binding list: a key code or a pad code. */
export type Binding = KeyCode | PadCode;

/** Polled state of one named action. */
export interface ActionState {
  /** True while any binding is active. */
  readonly down: boolean;
  /** True for one update step when the action becomes active. */
  readonly pressed: boolean;
  /** True for one update step when the action goes inactive. */
  readonly released: boolean;
  /** Analog strength 0..1 — sticks report magnitude, keys/buttons snap to 1. */
  readonly value: number;
}

export interface InputMapMethods<A extends string> {
  /** -1..1 from an opposing action pair (Godot's `get_axis`): analog-aware,
   *  keys snap to ±1. */
  axis(negative: A, positive: A): number;
  /** Normalized movement vector from four actions (Godot's `get_vector`) —
   *  kills the 1.41× diagonal bug; analog magnitude preserved under 1.
   *  Returns a reused scratch object: read, don't hold. */
  vector(left: A, right: A, up: A, down: A): Vec2;
  /** Replace an action's bindings (rebinding UIs: this + `bindings` +
   *  `Storage`). */
  rebind(action: A, bindings: Binding[]): void;
  /** Suppress an action until all of its bindings are released. Use when UI
   * consumes a gameplay button (for example A resumes without also jumping). */
  consume(action: A): void;
  /** The current bindings — plain JSON, ready for `Storage.save`. */
  readonly bindings: Record<A, Binding[]>;
}

/** A typed action map from `map()`: each action name reads as an `ActionState`,
 *  plus the `axis`/`vector`/`rebind`/`bindings` methods. */
export type InputMap<A extends string> = { readonly [K in A]: ActionState } & InputMapMethods<A>;

const PAD_BUTTON_INDEX: Partial<Record<PadButton, number>> = {
  a: Buttons.A,
  b: Buttons.B,
  x: Buttons.X,
  y: Buttons.Y,
  l1: Buttons.L1,
  r1: Buttons.R1,
  l2: Buttons.L2,
  r2: Buttons.R2,
  select: Buttons.Select,
  start: Buttons.Start,
  l3: Buttons.L3,
  r3: Buttons.R3,
  "dpad-up": Buttons.DpadUp,
  "dpad-down": Buttons.DpadDown,
  "dpad-left": Buttons.DpadLeft,
  "dpad-right": Buttons.DpadRight,
};

// Stick directions: [axis index, sign]
const PAD_STICK: Partial<Record<PadButton, [number, 1 | -1]>> = {
  "lstick-left": [0, -1],
  "lstick-right": [0, 1],
  "lstick-up": [1, -1],
  "lstick-down": [1, 1],
  "rstick-left": [2, -1],
  "rstick-right": [2, 1],
  "rstick-up": [3, -1],
  "rstick-down": [3, 1],
};

const STICK_THRESHOLD = 0.3;

interface KeysLike {
  down(code: string): boolean;
  pressed(code: string): boolean;
  released(code: string): boolean;
}

/** Options for `map()`: injectable key, pad and step sources (mainly for tests). */
export interface InputMapOptions {
  /** Key source. App-bound `Input.map` injects `app.Keys`. */
  keys: KeysLike;
  /** Pad source. App-bound `Input.map` injects gamepad 0. */
  pad?: GamepadState | null;
  /** Fixed-step source. App-bound `Input.map` injects `app.Loop.steps`. */
  steps: () => number;
}

/** Build a typed action map from a plain object: each key is an action name,
 *  each value a flat list of bindings — keyboard `KeyCode`s and `pad:`-prefixed
 *  `PadCode`s side by side. Action names become `ActionState` properties on the
 *  returned `InputMap`, alongside `axis`/`vector` synthesis, `rebind`, and the
 *  JSON-ready `bindings`. Strictly optional — raw `Keys` remains the floor.
 *
 *      const input = Input.map({
 *        left:  ["ArrowLeft", "KeyA", "pad:lstick-left"],
 *        right: ["ArrowRight", "KeyD", "pad:lstick-right"],
 *        jump:  ["Space", "pad:a"],
 *      });
 *      if (input.jump.pressed) jump();
 *      player.vel.x = input.axis("left", "right") * SPEED; */
export function map<A extends string>(
  bindings: Record<A, readonly Binding[]>,
  options: InputMapOptions,
): InputMap<A> {
  const steps = options.steps;
  const keySource = options.keys;
  const pad = (): GamepadState | null => options.pad ?? null;

  const store = {} as Record<A, Binding[]>;
  for (const name of Object.keys(bindings) as A[]) store[name] = [...bindings[name]];

  interface Fold {
    sampledStep: number;
    prevActive: boolean;
    curActive: boolean;
    curValue: number;
  }
  const folds = new Map<A, Fold>();
  const consumed = new Set<A>();
  const consumedReleaseStep = new Map<A, number>();

  function padActivity(name: A): { active: boolean; value: number } {
    const gp = pad();
    if (!gp || !gp.connected) return { active: false, value: 0 };
    let value = 0;
    for (const b of store[name]) {
      if (!b.startsWith("pad:")) continue;
      const button = b.slice(4) as PadButton;
      const idx = PAD_BUTTON_INDEX[button];
      if (idx !== undefined) {
        if (gp.down(idx)) value = Math.max(value, 1);
        continue;
      }
      const stick = PAD_STICK[button];
      if (stick) {
        const v = gp.axis(stick[0]) * stick[1];
        if (v > STICK_THRESHOLD) value = Math.max(value, Math.min(1, v));
      }
    }
    return { active: value > 0, value };
  }

  /** Per-step pad edge fold: on the first read of a new step, the previous
   *  step's activity shifts into `prevActive`. */
  function fold(name: A): Fold {
    let f = folds.get(name);
    if (!f) {
      f = { sampledStep: -1, prevActive: false, curActive: false, curValue: 0 };
      folds.set(name, f);
    }
    const now = steps();
    if (f.sampledStep !== now) {
      f.prevActive = f.sampledStep === now - 1 ? f.curActive : false;
      const a = padActivity(name);
      f.curActive = a.active;
      f.curValue = a.value;
      f.sampledStep = now;
    }
    return f;
  }

  function anyKey(name: A, check: (code: string) => boolean): boolean {
    for (const b of store[name]) {
      if (b.startsWith("pad:")) continue;
      if (check(b)) return true;
    }
    return false;
  }

  function suppressed(name: A): boolean {
    if (consumed.has(name)) {
      if (anyKey(name, (code) => keySource.down(code)) || padActivity(name).active) return true;
      consumed.delete(name);
      consumedReleaseStep.set(name, steps());
      return true;
    }
    if (consumedReleaseStep.get(name) === steps()) return true;
    consumedReleaseStep.delete(name);
    return false;
  }

  function actionState(name: A): ActionState {
    return {
      get down() {
        if (suppressed(name)) return false;
        return anyKey(name, (c) => keySource.down(c)) || fold(name).curActive;
      },
      get pressed() {
        if (suppressed(name)) return false;
        const f = fold(name);
        return anyKey(name, (c) => keySource.pressed(c)) || (f.curActive && !f.prevActive);
      },
      get released() {
        if (suppressed(name)) return false;
        const f = fold(name);
        return anyKey(name, (c) => keySource.released(c)) || (!f.curActive && f.prevActive);
      },
      get value() {
        if (suppressed(name)) return 0;
        const key = anyKey(name, (c) => keySource.down(c)) ? 1 : 0;
        return Math.max(key, fold(name).curValue);
      },
    };
  }

  const scratch: Vec2 = { x: 0, y: 0 };
  const actions = {} as Record<A, ActionState>;
  for (const name of Object.keys(store) as A[]) actions[name] = actionState(name);

  const axis = (negative: A, positive: A): number =>
    Math.max(-1, Math.min(1, actions[positive].value - actions[negative].value));

  // Methods are assembled last so an action named "axis" can't clobber them;
  // `bindings` is a live getter (defineProperty — Object.assign would
  // snapshot it).
  const result = Object.assign(actions, {
    axis,
    vector(left: A, right: A, up: A, down: A): Vec2 {
      scratch.x = axis(left, right);
      scratch.y = axis(up, down);
      const len = Math.hypot(scratch.x, scratch.y);
      if (len > 1) {
        scratch.x /= len;
        scratch.y /= len;
      }
      return scratch;
    },
    rebind(action: A, next: Binding[]): void {
      store[action] = [...next];
    },
    consume(action: A): void {
      consumed.add(action);
    },
  });
  Object.defineProperty(result, "bindings", {
    enumerable: false,
    get(): Record<A, Binding[]> {
      const out = {} as Record<A, Binding[]>;
      for (const name of Object.keys(store) as A[]) out[name] = [...store[name]];
      return out;
    },
  });
  return result as unknown as InputMap<A>;
}
