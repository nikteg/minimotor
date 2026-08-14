import { type Rng } from "../rng/index.js";
/** One archived candidate: the best found so far for its behaviour cell. */
export interface Elite<T> {
    /** The candidate itself — normally a `CharGrid`. */
    candidate: T;
    /** Its fitness. Higher is better. */
    fitness: number;
    /** Its measured behaviour, each in [0, 1]. */
    measures: number[];
    /** Which archive cell it occupies, one index per measure. */
    cell: number[];
}
export interface Archive<T> {
    /** Every occupied cell, best fitness first. */
    elites: Array<Elite<T>>;
    /** The single fittest candidate found, or null if nothing was accepted. */
    best: Elite<T> | null;
    /** Occupied cells as a fraction of the archive — how much of the behaviour
     *  space this generator can actually reach. */
    coverage: number;
    /** Archive resolution per measure. */
    resolution: number[];
    /** The elite at a behaviour cell, or null when that cell is empty. */
    at(...cell: number[]): Elite<T> | null;
    /** Candidates evaluated to build this archive. */
    evaluated: number;
}
export interface IlluminateOptions<T> {
    /** Build a fresh random candidate. Called for the first `initial` rounds and
     *  whenever there is nothing to mutate yet. */
    create(rng: Rng): T;
    /** Vary an existing elite. Omit to search purely by fresh candidates, which
     *  is slower to converge but perfectly valid. */
    mutate?(parent: T, rng: Rng): T;
    /** Higher is better. Return `-Infinity` to reject a candidate outright. */
    fitness(candidate: T): number;
    /** One function per archive axis, each returning a value in [0, 1]. Values
     *  outside that range are clamped. Two or three axes is the sweet spot. */
    measures: ReadonlyArray<(candidate: T) => number>;
    /** Buckets per axis — a number for all, or one per axis. Default 8. */
    resolution?: number | readonly number[];
    /** Candidates to evaluate. Default 200. */
    iterations?: number;
    /** Fresh random candidates before mutation begins. Default a quarter of
     *  `iterations`, minimum 1. */
    initial?: number;
    /** Seed. The same seed gives the same archive. */
    seed?: number;
}
/** Search a behaviour space and keep the best candidate in each region of it.
 *
 *      const archive = Procgen.illuminate({
 *        create: (rng) => Procgen.repair(Procgen.caves({ cols: 48, rows: 32, seed: rng.seed })),
 *        mutate: (parent, rng) => Procgen.resynthesize(parent, model, { ... }),
 *        fitness: (grid) => Procgen.longestPath(grid),
 *        measures: [
 *          (grid) => Procgen.openness(grid),
 *          (grid) => Procgen.corridorRatio(grid),
 *        ],
 *        iterations: 300,
 *      });
 *      const twistyAndOpen = archive.at(6, 6);
 */
export declare function illuminate<T>(options: IlluminateOptions<T>): Archive<T>;
