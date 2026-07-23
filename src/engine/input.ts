import { requireDefault } from "./default-game.js";
import type { KeyCode } from "./keycodes.js";

/** Polled keyboard state. `down` is level-triggered (held); `pressed` and
 *  `released` are edge-triggered and true for exactly one update step per
 *  physical transition — that's why no `onKeyDown` callback is needed.
 *
 *    if (Minimotor.Keys.down("ArrowLeft")) move();   // held
 *    if (Minimotor.Keys.pressed("Space"))  jump();   // this step only
 *    if (Minimotor.Keys.released("KeyR"))  letGo(); */
export interface Keys {
  /** True while the key is held. */
  down(code: KeyCode): boolean;
  /** True for one update step when the key goes down (ignores auto-repeat). */
  pressed(code: KeyCode): boolean;
  /** True for one update step when the key goes up. */
  released(code: KeyCode): boolean;
}

/** Polled pointer (mouse + touch) in logical CSS pixels, relative to the
 *  canvas. `pressed`/`released` are edge-triggered like `Keys`. */
export interface Pointer {
  /** Logical x within the canvas; -1 before the first event. */
  readonly x: number;
  /** Logical y within the canvas; -1 before the first event. */
  readonly y: number;
  /** True when the latest pointer position lies inside the canvas. */
  readonly inside: boolean;
  /** True while a button/touch is held. */
  readonly down: boolean;
  /** True for one update step when the press begins. */
  readonly pressed: boolean;
  /** True for one update step when the press ends. */
  readonly released: boolean;
  /** True for the whole rendered frame in which the press ended. `released`
   *  is consumed by the fixed steps before `draw` runs — draw-phase hit
   *  testing (`UI.button`) reads this instead. */
  readonly frameReleased: boolean;
  /** True for the whole rendered frame in which a press began — the
   *  draw-phase counterpart of `pressed` (drag starts in `UI.scrollbar`). */
  readonly framePressed: boolean;
  /** Wheel scroll this frame in logical px (positive = down). Accumulated
   *  across the frame's wheel events, cleared at frame end. */
  readonly wheel: number;
}

/** Polled keyboard — read inside `update`. */
export const Keys: Keys = {
  down: (code) => requireDefault().keys.down(code),
  pressed: (code) => requireDefault().keys.pressed(code),
  released: (code) => requireDefault().keys.released(code),
};

/** Polled pointer — read inside `update`. */
export const Pointer: Pointer = {
  get x() {
    return requireDefault().pointer.x;
  },
  get y() {
    return requireDefault().pointer.y;
  },
  get inside() {
    return requireDefault().pointer.inside;
  },
  get down() {
    return requireDefault().pointer.down;
  },
  get pressed() {
    return requireDefault().pointer.pressed;
  },
  get released() {
    return requireDefault().pointer.released;
  },
  get frameReleased() {
    return requireDefault().pointer.frameReleased;
  },
  get framePressed() {
    return requireDefault().pointer.framePressed;
  },
  get wheel() {
    return requireDefault().pointer.wheel;
  },
};

/** Mouse-oriented alias for the normalized canvas-relative pointer position. */
export const Mouse: Pointer = Pointer;
