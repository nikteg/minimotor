// ---------- Small math helpers ----------
// Interpolation and cheap oscillators for animation. Named `Mathf` (à la Unity)
// so `const { Mathf } = Minimotor` never shadows the global `Math`.

/** Linear interpolation from `a` to `b` by `t`. `t` is not clamped.
 *  Frame-rate-independent smoothing: `x = Mathf.lerp(x, target, 0.1)`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp `v` into the inclusive range [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Map `v` from range [inMin, inMax] onto [outMin, outMax] (no clamping). */
export function remap(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Smooth 0..1 oscillation from an angle (radians): `0.5 + 0.5·sin(angle)`.
 *  Drop-in for pulsing glow/alpha — pass a time-derived angle. */
export function pulse(angle: number): number {
  return 0.5 + 0.5 * Math.sin(angle);
}

/** Sine wave `amp·sin(angle)`, for bob/sway/wobble. */
export function wave(angle: number, amp = 1): number {
  return Math.sin(angle) * amp;
}

// ---------- Easing (0..1 → 0..1) ----------
// Suitable as the `ease` argument to Tween.to.

/** No easing — constant rate. */
export function linear(t: number): number {
  return t;
}
/** Accelerate from zero (quadratic). */
export function easeIn(t: number): number {
  return t * t;
}
/** Decelerate to zero (quadratic). */
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
/** Accelerate then decelerate (quadratic). */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
