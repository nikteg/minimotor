// ---------- Wrapping (toroidal) worlds ----------
// Asteroids-style wrap-around space: math for values and points that loop at
// the world edges. The shortest-path helpers are what make chase/aim code on a
// torus correct — a naive `b - a` takes the long way around half the time.

/** Wrap `value` into `[0, max)`, including negative and multi-span values. */
export function wrap(value: number, max: number): number;
/** Wrap `value` into `[min, max)`, including negative and multi-span values. */
export function wrap(value: number, min: number, max: number): number;
export function wrap(value: number, minOrMax: number, maybeMax?: number): number {
  const min = maybeMax === undefined ? 0 : minOrMax;
  const max = maybeMax === undefined ? minOrMax : maybeMax;
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) {
    throw new RangeError("Goodies.wrap: max must be finite and greater than min");
  }
  return ((((value - min) % span) + span) % span) + min;
}

/** Shortest signed displacement from `from` to `to` on a wrapping axis.
 * The result is in `[-size/2, size/2)`. */
export function wrappedDelta(from: number, to: number, size: number): number {
  return wrap(to - from + size / 2, size) - size / 2;
}

/** Shortest distance between two points in a wrapping (toroidal) world. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  worldW: number,
  worldH: number,
): number {
  return Math.hypot(wrappedDelta(ax, bx, worldW), wrappedDelta(ay, by, worldH));
}
