import { Loop } from "../engine/index.js";

// ---------- Screen shake ----------
// A decaying random offset to translate the scene by, for impact/juice.

/** A live screen-shake offset. `x`/`y` are the current jitter; `add` triggers a
 *  shake; `advance(dt)` ages it (linear falloff to zero over the duration). */
export interface ShakeState {
  readonly x: number;
  readonly y: number;
  /** True while a shake is still playing out. */
  readonly active: boolean;
  /** Start/refresh a shake: `amplitude` px, fading over `durationMs`. Stacks by
   *  taking the stronger amplitude and restarting the fade. */
  add(amplitude: number, durationMs: number): void;
  /** Advance the shake by `dt` ms, re-rolling the offset. */
  advance(dt: number): void;
}

/** Create an independent screen-shake. Pure (drive `advance` yourself); the
 *  default `Camera.shake` wires one to the loop's fixed step. `rng` is injectable
 *  for tests. */
export function createShake(rng: () => number = Math.random): ShakeState {
  let amp = 0;
  let duration = 0;
  let elapsed = 0;
  let ox = 0;
  let oy = 0;
  return {
    get x() {
      return ox;
    },
    get y() {
      return oy;
    },
    get active() {
      return elapsed < duration;
    },
    add(amplitude, durationMs) {
      amp = Math.max(amp, amplitude);
      duration = durationMs;
      elapsed = 0;
    },
    advance(dt) {
      if (elapsed >= duration) {
        amp = 0;
        ox = 0;
        oy = 0;
        return;
      }
      elapsed += dt;
      const k = Math.max(0, 1 - elapsed / duration); // linear falloff
      ox = (rng() * 2 - 1) * amp * k;
      oy = (rng() * 2 - 1) * amp * k;
    },
  };
}

// Default facade: one shake, aged on the loop's fixed step (so it pauses with
// the loop and is frame-rate independent).
let defaultShake = createShake();

let shakeWired = false;

function ensureShakeWired(): void {
  if (shakeWired) return;
  shakeWired = true;
  Loop.onStep(() => defaultShake.advance(Loop.step));
}

/** The default screen-shake, driven by the loop. Trigger with
 *  `Camera.shake(amplitude, durationMs)`, then translate your scene by
 *  `Camera.shakeX` / `Camera.shakeY` before drawing. */
export function shake(amplitude: number, durationMs: number): void {
  ensureShakeWired();
  defaultShake.add(amplitude, durationMs);
}

/** Current horizontal shake offset (px). */
export function shakeX(): number {
  return defaultShake.x;
}

/** Current vertical shake offset (px). */
export function shakeY(): number {
  return defaultShake.y;
}

/** Reset the default shake and its loop wiring — for tests. */
export function _resetShake(): void {
  defaultShake = createShake();
  shakeWired = false;
}
