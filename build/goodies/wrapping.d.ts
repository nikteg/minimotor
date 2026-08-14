/** Wrap `value` into `[0, max)`, including negative and multi-span values. */
export declare function wrap(value: number, max: number): number;
/** Wrap `value` into `[min, max)`, including negative and multi-span values. */
export declare function wrap(value: number, min: number, max: number): number;
/** Shortest signed displacement from `from` to `to` on a wrapping axis.
 * The result is in `[-size/2, size/2)`. */
export declare function wrappedDelta(from: number, to: number, size: number): number;
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
export declare function scrollColumns(scroll: number, spacing: number, width: number, cb: (screenX: number, worldSeed: number, index: number) => void, pad?: number): void;
/** Shortest distance between two points in a wrapping (toroidal) world. */
export declare function wrappedDistance(ax: number, ay: number, bx: number, by: number, worldW: number, worldH: number): number;
