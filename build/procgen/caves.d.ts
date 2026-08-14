import { type CharGrid } from "./grid.js";
export interface CaveOptions {
    /** Grid width in cells. */
    cols: number;
    /** Grid height in cells. */
    rows: number;
    /** Seed for the initial noise. */
    seed?: number;
    /** Fraction of cells that start as wall. Around 0.45 gives open caverns;
     *  above ~0.55 the map closes up into isolated pockets. Default 0.45. */
    fill?: number;
    /** Smoothing passes. Default 5 — more rounds off the walls further. */
    steps?: number;
    /** Wall neighbour count (of 8) at which an open cell becomes wall. Default 5. */
    birth?: number;
    /** Wall neighbour count at or above which a wall cell stays wall. Default 4. */
    survive?: number;
    /** Glyph for wall cells. Default "#". */
    wall?: string;
    /** Glyph for open cells. Default ".". */
    floor?: string;
    /** Force a solid ring of wall around the edge. Default true. */
    border?: boolean;
}
/** Generate a cave. The result is organic but NOT guaranteed connected — run
 *  `repair` on it if the player has to reach everything:
 *
 *      const cave = Procgen.repair(Procgen.caves({ cols: 60, rows: 40, seed }));
 */
export declare function caves(options: CaveOptions): CharGrid;
