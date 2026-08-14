import { type Finding, type Rect } from "./analyze.js";
import type { Pixels } from "./png.js";
export interface Grid {
    /** Origin of the first tile in the atlas. */
    x: number;
    y: number;
    tile: {
        w: number;
        h: number;
    };
    /** Gap between tiles, for sheets that were not de-gutted. */
    spacing?: number;
}
/** Rect of one tile in a grid, by column and row. */
export declare const cellRect: (grid: Grid, column: number, row: number) => Rect;
/** The four edge strips of a tile, interned so two tiles that present the same
 *  edge share a socket id. This is what makes an autotile set checkable: every
 *  tile that claims "solid on the north side" must present the same north
 *  socket, or the set will not join up however the rules place it. */
export interface Sockets {
    north: string;
    south: string;
    west: string;
    east: string;
}
/** Read a tile's four edge sockets. */
export declare const sockets: (image: Pixels, rect: Rect) => Sockets;
/** Names of the nine cells, in the order a 3×3 frame reads. */
export declare const FRAME_CELLS: readonly [readonly ["topLeft", "top", "topRight"], readonly ["left", "centre", "right"], readonly ["bottomLeft", "bottom", "bottomRight"]];
/** Where each of the nine cells sits, when the frame is gathered from tiles
 *  scattered around an atlas rather than laid out as a contiguous 3×3. */
export type FrameCells = readonly (readonly [number, number])[][];
/** Verify a frame assembled from nine tiles on a grid.
 *
 *  Pass `cells` when the nine tiles are scattered around the atlas rather than
 *  laid out as a contiguous 3×3; the frame is assembled from wherever they are
 *  and checked as a unit.
 *
 *  Note what this cannot tell you: whether a corner was gathered from the wrong
 *  place. A corner is drawn once and repeats nothing, so any art at all is
 *  self-consistent there. Only the cells that repeat — the edges and the
 *  centre — carry a checkable constraint. */
export declare function analyzeTileFrame(image: Pixels, grid: Grid, cells?: FrameCells, name?: string): Finding[];
/** Verify an autotile set: every tile in the set, indexed by neighbour mask.
 *
 *  A blob/wang set only works if tiles that claim the same neighbour state
 *  present the same socket, because the rule engine will place any of them
 *  against any other. Rather than encode a particular 16- or 47-tile layout,
 *  this takes the mask each tile is meant to answer and derives what its four
 *  sockets have to agree with — so it checks a set in whatever order the sheet
 *  happens to store it. */
export declare function analyzeAutotile(image: Pixels, grid: Grid, tiles: readonly {
    mask: number;
    column: number;
    row: number;
}[], name?: string): Finding[];
