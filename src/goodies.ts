// ---------- Essential game recipes ----------
// Goodies is Minimotor's intentional grab bag: familiar, dependency-free
// recipes that recur across arcade, grid, platformer, shooter, roguelike and
// other genres. Unlike low-level Mathf primitives, a Goodie may encode a small
// piece of game-domain knowledge. Recipes stay optional, composable and tested;
// games can use one without adopting a framework or prescribed architecture.

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
