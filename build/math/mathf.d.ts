/** Linear interpolation from `a` to `b` by `t`. `t` is not clamped.
 *  Frame-rate-independent smoothing: `x = Mathf.lerp(x, target, 0.1)`. */
export declare function lerp(a: number, b: number, t: number): number;
/** Clamp `v` into the inclusive range [min, max]. */
export declare function clamp(v: number, min: number, max: number): number;
/** Move `v` toward `target` by at most `maxDelta` (never overshoots). The
 *  scalar sibling of `Goodies.approachAngle` — the basis of accel/decel toward
 *  a speed, a meter filling, a value snapping to a step. */
export declare function approach(v: number, target: number, maxDelta: number): number;
/** Frame-rate-independent exponential smoothing toward `target`: eases a
 *  fraction of the remaining distance each second, so the result is identical
 *  at 30fps and 144fps. `rate` is the sharpness (~how fast it converges).
 *  Use this instead of `v = lerp(v, target, k)` or `v *= 0.9` in `update`,
 *  which both depend on the step size. `dt` is the step in SECONDS. */
export declare function damp(current: number, target: number, rate: number, dt: number): number;
/** Shortest-arc interpolation between two angles (radians) by `t`, crossing the
 *  ±π seam correctly. For interpolating headings/rotations (e.g. networked
 *  entities) where a plain `lerp` would spin the long way round. */
export declare function lerpAngle(a: number, b: number, t: number): number;
/** Map `v` from range [inMin, inMax] onto [outMin, outMax] (no clamping). */
export declare function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
/** Smooth 0..1 oscillation from an angle (radians): `0.5 + 0.5·sin(angle)`.
 *  Drop-in for pulsing glow/alpha — pass a time-derived angle. */
export declare function pulse(angle: number): number;
/** Sine wave `amp·sin(angle)`, for bob/sway/wobble — pass a time-derived angle
 *  and add the result to a base position. `amp` defaults to 1. */
export declare function wave(angle: number, amp?: number): number;
/** Triangle bounce between `min` and `max` as `t` increases — like a ball
 *  reflecting off both ends (patrol paths, back-and-forth hazards, ping-pong
 *  cursors). `t` is a free-running counter (e.g. elapsed time or distance
 *  travelled), not a 0..1 phase; it's offset by `min`, so `t = min` lands on
 *  `min`. Continuous and never overshoots the bounds. */
export declare function pingPong(t: number, min: number, max: number): number;
/** Random float in [min, max). */
export declare function randRange(min: number, max: number): number;
/** Random integer in [min, max] — both ends inclusive. */
export declare function randInt(min: number, max: number): number;
/** Pick a uniformly-random element of `arr`. Typed `T` for ergonomics: an
 *  empty array returns `undefined` at runtime without the type saying so. */
export declare function randItem<T>(arr: readonly T[]): T;
/** Euclidean distance between two points. */
export declare function distance(ax: number, ay: number, bx: number, by: number): number;
/** Angle (radians) of the vector from a → b, as `atan2(dy, dx)`. */
export declare function angleBetween(ax: number, ay: number, bx: number, by: number): number;
/** No easing — constant rate. */
export declare function linear(t: number): number;
/** Accelerate from zero (quadratic). */
export declare function easeIn(t: number): number;
/** Decelerate to zero (quadratic). */
export declare function easeOut(t: number): number;
/** Accelerate then decelerate (quadratic). */
export declare function easeInOut(t: number): number;
/** Accelerate from zero, hard (quartic). The same shape as `easeIn` but with
 *  far more of the distance left until late — for something that should read
 *  as *building* rather than merely starting. */
export declare function quartIn(t: number): number;
/** Decelerate to zero, hard (quartic). Most of the distance is covered in the
 *  first third, so a move eased this way reads as *arriving* almost at once
 *  and then creeping the last little way. */
export declare function quartOut(t: number): number;
/** Wind up below zero, then shoot to the target. Something arriving with
 *  `backOut` reads as *placed*; the same motion with `easeOut` reads as
 *  merely stopping. Note the output leaves 0..1 — do not use it where the
 *  value is clamped, such as a colour channel. */
export declare function backOut(t: number): number;
/** Overshoot past the target, then settle back. The mirror of `backOut`, for
 *  something leaving rather than arriving. */
export declare function backIn(t: number): number;
