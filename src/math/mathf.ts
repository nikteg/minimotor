// ---------- Scalar math helpers ----------
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

/** Move `v` toward `target` by at most `maxDelta` (never overshoots). The
 *  scalar sibling of `Goodies.approachAngle` — the basis of accel/decel toward
 *  a speed, a meter filling, a value snapping to a step. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return target;
}

/** Frame-rate-independent exponential smoothing toward `target`: eases a
 *  fraction of the remaining distance each second, so the result is identical
 *  at 30fps and 144fps. `rate` is the sharpness (~how fast it converges).
 *  Use this instead of `v = lerp(v, target, k)` or `v *= 0.9` in `update`,
 *  which both depend on the step size. `dt` is the step in SECONDS. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Shortest-arc interpolation between two angles (radians) by `t`, crossing the
 *  ±π seam correctly. For interpolating headings/rotations (e.g. networked
 *  entities) where a plain `lerp` would spin the long way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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

/** Sine wave `amp·sin(angle)`, for bob/sway/wobble — pass a time-derived angle
 *  and add the result to a base position. `amp` defaults to 1. */
export function wave(angle: number, amp = 1): number {
  return Math.sin(angle) * amp;
}

/** Triangle bounce between `min` and `max` as `t` increases — like a ball
 *  reflecting off both ends (patrol paths, back-and-forth hazards, ping-pong
 *  cursors). `t` is a free-running counter (e.g. elapsed time or distance
 *  travelled), not a 0..1 phase; it's offset by `min`, so `t = min` lands on
 *  `min`. Continuous and never overshoots the bounds. */
export function pingPong(t: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const m = (((t - min) % (2 * range)) + 2 * range) % (2 * range);
  return min + (m <= range ? m : 2 * range - m);
}

// ---------- Randomness ----------
// Convenience wrappers over Math.random (not seeded — for spawn jitter, visual
// variety and the like, not deterministic simulation).

/** Random float in [min, max). */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] — both ends inclusive. */
export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pick a uniformly-random element of `arr`. Typed `T` for ergonomics: an
 *  empty array returns `undefined` at runtime without the type saying so. */
export function randItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Geometry ----------

/** Euclidean distance between two points. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Angle (radians) of the vector from a → b, as `atan2(dy, dx)`. */
export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

// ---------- Easing (0..1 → 0..1) ----------
// Suitable as the `ease` option of `Anim.animate`.

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

/** Accelerate from zero, hard (quartic). The same shape as `easeIn` but with
 *  far more of the distance left until late — for something that should read
 *  as *building* rather than merely starting. */
export function quartIn(t: number): number {
  return t * t * t * t;
}
/** Decelerate to zero, hard (quartic). Most of the distance is covered in the
 *  first third, so a move eased this way reads as *arriving* almost at once
 *  and then creeping the last little way. */
export function quartOut(t: number): number {
  return 1 - (1 - t) ** 4;
}

/** The overshoot constant every implementation of the back easings uses. It
 *  is not derived from anything — 1.70158 makes the curve overshoot by about
 *  10%, and it became the shared value because the original Penner easings
 *  picked it. */
const BACK = 1.70158;

/** Wind up below zero, then shoot to the target. Something arriving with
 *  `backOut` reads as *placed*; the same motion with `easeOut` reads as
 *  merely stopping. Note the output leaves 0..1 — do not use it where the
 *  value is clamped, such as a colour channel. */
export function backOut(t: number): number {
  const s = t - 1;
  return s * s * ((BACK + 1) * s + BACK) + 1;
}
/** Overshoot past the target, then settle back. The mirror of `backOut`, for
 *  something leaving rather than arriving. */
export function backIn(t: number): number {
  return t * t * ((BACK + 1) * t - BACK);
}
