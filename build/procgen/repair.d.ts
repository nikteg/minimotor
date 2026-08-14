import { type CharGrid, type CellRect } from "./grid.js";
export interface RepairOptions {
    /** Glyph that counts as walkable. Default ".". */
    floor?: string;
    /** Glyph to carve through when joining regions. Default "#". */
    wall?: string;
    /** Drop regions smaller than this instead of connecting them (they become
     *  wall). Default 0 — connect everything. */
    minRegion?: number;
    /** Keep only the largest region and wall off the rest, rather than digging
     *  tunnels between them. Default false. */
    discard?: boolean;
    /** Extra glyphs that also count as walkable when measuring regions — doors,
     *  water, ladders. */
    alsoWalkable?: readonly string[];
}
/** One connected walkable region. */
export interface Region {
    /** Every cell in the region. */
    cells: Array<{
        x: number;
        y: number;
    }>;
    /** Tight bounds around it, in cells. */
    bounds: CellRect;
}
/** Find every connected walkable region, largest first. */
export declare function regions(grid: CharGrid, options?: RepairOptions): Region[];
/** Guarantee every walkable cell is reachable from every other one. Small
 *  regions can be discarded (`minRegion`, `discard`); the rest are joined by
 *  carving straight L-shaped tunnels between the closest pair of cells. */
export declare function repair(grid: CharGrid, options?: RepairOptions): CharGrid;
/** Is every walkable cell reachable from every other? The check `repair`
 *  guarantees, exposed so tests and the CLI can assert it. */
export declare function isConnected(grid: CharGrid, options?: RepairOptions): boolean;
/** Wall off every cell of a region that touches the grid edge — useful after
 *  carving, when a tunnel has broken out of the level. */
export declare function sealEdges(grid: CharGrid, wall?: string): CharGrid;
/** Count the walkable neighbours of a cell — the primitive behind corridor and
 *  dead-end detection in `metrics`. */
export declare function openNeighbours(grid: CharGrid, x: number, y: number, floor?: string): number;
