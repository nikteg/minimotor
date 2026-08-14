import { type CharGrid } from "./grid.js";
export interface MetricOptions {
    /** Glyph that counts as walkable. Default ".". */
    floor?: string;
    /** Extra glyphs that also count as walkable — doors, markers, water. */
    alsoWalkable?: readonly string[];
}
/** Fraction of the grid held by each glyph — the frequencies `steer` targets. */
export declare function frequencies(grid: CharGrid): Record<string, number>;
/** Fraction of the grid that is walkable at all. 0 is solid rock, 1 an
 *  empty field. Most playable levels land between 0.25 and 0.55. */
export declare function openness(grid: CharGrid, options?: MetricOptions): number;
/** Fraction of walkable cells reachable from the largest region. 1 means the
 *  level is fully connected; 0.6 means two fifths of it is stranded. */
export declare function reachableFraction(grid: CharGrid, options?: MetricOptions): number;
/** The longest walk in the level, in steps — its "how big does this feel"
 *  number. Computed by the standard double sweep (farthest cell from anywhere,
 *  then farthest cell from that), which is exact on tree-shaped layouts and a
 *  tight lower bound on looping ones. */
export declare function longestPath(grid: CharGrid, options?: MetricOptions): number;
/** Step distance between two cells, or `Infinity` when there is no route.
 *  This is the check to fail a level on, not a metric to optimize. */
export declare function pathLength(grid: CharGrid, from: {
    x: number;
    y: number;
}, to: {
    x: number;
    y: number;
}, options?: MetricOptions): number;
/** Fraction of walkable cells that are corridor — exactly two open neighbours.
 *  High means twisty passages, low means open halls. A good MAP-Elites axis:
 *  it separates levels that play very differently at the same openness. */
export declare function corridorRatio(grid: CharGrid, options?: MetricOptions): number;
/** Walkable cells with exactly one open neighbour — cul-de-sacs. Somewhere to
 *  put treasure; too many and the level reads as a maze of chores. */
export declare function deadEnds(grid: CharGrid, options?: MetricOptions): number;
/** How mirror-symmetric the grid is left-to-right, from 0 to 1. Useful as a
 *  descriptor when you want a spread from "organic cave" to "built temple". */
export declare function symmetry(grid: CharGrid): number;
/** Everything above, measured in one pass over the grid's masks. */
export interface Metrics {
    openness: number;
    reachable: number;
    longestPath: number;
    corridorRatio: number;
    deadEnds: number;
    symmetry: number;
    frequencies: Record<string, number>;
}
/** Measure a grid once and hand back the whole set — the convenient input to
 *  a fitness function. */
export declare function measure(grid: CharGrid, options?: MetricOptions): Metrics;
