import type { KeyCode } from "./keycodes.js";

/** Polled keyboard state. `down` is level-triggered (held); `pressed` and
 *  `released` are edge-triggered and true for exactly one update step per
 *  physical transition — that's why no `onKeyDown` callback is needed.
 *
 *    if (app.Keys.down("ArrowLeft")) move();   // held
 *    if (app.Keys.pressed("Space"))  jump();   // this step only
 *    if (app.Keys.released("KeyR"))  letGo(); */
export interface Keys {
  /** True while the key is held. */
  down(code: KeyCode): boolean;
  /** True for one update step when the key goes down (ignores auto-repeat). */
  pressed(code: KeyCode): boolean;
  /** True for one update step when the key goes up. */
  released(code: KeyCode): boolean;
  /** True for one update step when the key is pressed twice in quick
   *  succession (within ~300ms) — double-tap a direction to dash, etc. Auto-
   *  repeat doesn't count; the second tap also fires `pressed`. */
  doublePressed(code: KeyCode): boolean;
  /** Layout-aware `KeyboardEvent.key` state. Use this for text-like shortcuts
   *  such as `"?"` that live on different physical keys across keyboard
   *  layouts. Game controls should normally use `down(code)` instead. */
  keyDown(key: string): boolean;
  /** Layout-aware press edge; the `key` counterpart of `pressed(code)`. */
  keyPressed(key: string): boolean;
  /** Layout-aware release edge; the `key` counterpart of `released(code)`. */
  keyReleased(key: string): boolean;
}

/** One currently-down pointer. Coordinates are logical CSS pixels in the same
 *  space as `Pointer.x` / `Pointer.y`. */
export interface PointerTouch {
  /** `PointerEvent.pointerId`. */
  readonly id: number;
  /** Logical x within the canvas. */
  readonly x: number;
  /** Logical y within the canvas. */
  readonly y: number;
  /** Always `true` while the entry is in `Pointer.touches`. */
  readonly down: boolean;
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
  /** True for one update step on a double-click — the OS double-click interval
   *  (native `dblclick`), or a fast/touch second press within ~300ms close to
   *  the first. Read inside `update`; draw-phase UI reads `frameDoublePressed`. */
  readonly doublePressed: boolean;
  /** True for the whole rendered frame in which a double-click happened — the
   *  draw-phase counterpart of `doublePressed` (text fields select a word on
   *  it). `doublePressed` is consumed by the fixed steps before `draw` runs. */
  readonly frameDoublePressed: boolean;
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
  /** The SECONDARY (right) mouse button, tracked apart from `down`/`pressed`
   *  so a right-drag can mean something other than a left one — orbiting a
   *  camera, a context action — without the UI seeing a click.
   *
   *  `down`/`pressed`/`released` above are the primary button and every touch;
   *  the right button sets only these. Nothing on a touchscreen produces them.
   *  The canvas swallows its own `contextmenu`, so a right-drag that starts on
   *  it is the app's to use. */
  readonly secondary: SecondaryButton;
  /** Currently-down pointers (touches and a pressed mouse). Empty when none
   *  are held — a hovering mouse does not appear here. `x`/`y`/`down` still
   *  track the primary pointer: the first active touch, or the mouse. */
  readonly touches: readonly PointerTouch[];
}

/** The right mouse button's own edges, mirroring `Pointer`'s primary ones. */
export interface SecondaryButton {
  /** True while the right button is held. */
  readonly down: boolean;
  /** True for one update step when the right press begins. */
  readonly pressed: boolean;
  /** True for one update step when the right press ends. */
  readonly released: boolean;
}
