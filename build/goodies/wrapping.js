// ---------- Wrapping (toroidal) worlds ----------
// Asteroids-style wrap-around space: math for values and points that loop at
// the world edges. The shortest-path helpers are what make chase/aim code on a
// torus correct — a naive `b - a` takes the long way around half the time.
export function wrap(value, minOrMax, maybeMax) {
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
export function wrappedDelta(from, to, size) {
    return wrap(to - from + size / 2, size) - size / 2;
}
/** Walk the columns of an endlessly scrolling strip — ground texture, fence
 *  posts, parallax trees, star fields.
 *
 *  Only the columns on screen are visited, so cost does not grow with how far
 *  the world has scrolled. The callback gets three numbers:
 *
 *    screenX    where to draw this column
 *    worldSeed  the column's position in WORLD space — stable across scroll
 *               wraps, so seeding procedural shapes with it keeps them from
 *               shimmering every time the offset resets
 *    index      the column's integer index (worldSeed / spacing), for picking
 *               out of an array or alternating a pattern
 *
 *  `pad` extends iteration by N columns past each edge so props wider than
 *  `spacing` do not pop in at the borders.
 *
 *    Goodies.scrollColumns(distance, 40, view.w, (x, seed) => {
 *      Draw.rect(x, groundY, 16, 8, seed % 80 === 0 ? "#555" : "#444");
 *    });
 */
export function scrollColumns(scroll, spacing, width, cb, pad = 1) {
    if (!(spacing > 0) || !Number.isFinite(spacing)) {
        throw new RangeError("Goodies.scrollColumns: spacing must be finite and greater than 0");
    }
    const offset = wrap(scroll, spacing);
    const colBase = Math.floor(scroll / spacing) * spacing;
    // `-spacing * pad` is -0 when pad is 0; `|| 0` keeps -0 out of the callback.
    for (let bx = -spacing * pad || 0; bx < width + spacing * pad; bx += spacing) {
        cb(bx - offset, bx + colBase, Math.round((bx + colBase) / spacing));
    }
}
/** Shortest distance between two points in a wrapping (toroidal) world. */
export function wrappedDistance(ax, ay, bx, by, worldW, worldH) {
    return Math.hypot(wrappedDelta(ax, bx, worldW), wrappedDelta(ay, by, worldH));
}
