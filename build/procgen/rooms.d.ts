import { type CellRect, type CharGrid } from "./grid.js";
export interface RoomsOptions {
    /** Grid width in cells. */
    cols: number;
    /** Grid height in cells. */
    rows: number;
    /** Seed for the splits and room sizes. */
    seed?: number;
    /** Smallest partition that may still be split, in cells. Default 8. */
    minPartition?: number;
    /** Smallest room, in cells. Default 3. */
    minRoom?: number;
    /** How deep the partition may go. Default 5 (up to 32 rooms). */
    maxDepth?: number;
    /** Glyph for solid rock. Default "#". */
    wall?: string;
    /** Glyph for room and corridor floor. Default ".". */
    floor?: string;
}
/** A placed room, in cell coordinates. */
export interface Room extends CellRect {
    /** Index in `RoomsResult.rooms`. */
    id: number;
    /** Centre cell, where corridors meet. */
    cx: number;
    cy: number;
}
export interface RoomsResult {
    grid: CharGrid;
    rooms: Room[];
    /** Corridor connections as room-index pairs. */
    links: Array<readonly [number, number]>;
}
/** Carve BSP rooms joined by L-shaped corridors. Always fully connected. */
export declare function rooms(options: RoomsOptions): RoomsResult;
export interface ChunkOptions {
    /** Hand-authored room templates, all the same size. Char grids or text. */
    templates: ReadonlyArray<CharGrid | string>;
    /** Chunk columns in the finished level. */
    cols: number;
    /** Chunk rows in the finished level. */
    rows: number;
    /** Seed for template choice and the path walk. */
    seed?: number;
    /** Glyph carved to open a doorway between chunks. Default ".". */
    floor?: string;
    /** Glyph filling chunks the solution path never visits. When omitted, those
     *  chunks get a template too — set it to a wall glyph for solid rock. */
    offPath?: string;
    /** Marker written at the centre of the first path chunk. Default "S". */
    entrance?: string;
    /** Marker written at the centre of the last path chunk. Default "E". */
    exit?: string;
}
export interface ChunkResult {
    grid: CharGrid;
    /** Chunk coordinates the guaranteed path runs through, start to finish. */
    path: Array<{
        x: number;
        y: number;
    }>;
    /** Cell coordinates of the entrance and exit markers. */
    entrance: {
        x: number;
        y: number;
    };
    exit: {
        x: number;
        y: number;
    };
}
/** Stitch hand-authored templates on a coarse grid and carve a guaranteed path
 *  through them: a drunkard's walk from a random top chunk to the bottom row,
 *  opening a doorway wherever the path crosses a chunk boundary.
 *
 *  Everything the player sees was drawn by a person; only the arrangement and
 *  the doorways are generated. That is why it holds up better than most
 *  fully-generated layouts. */
export declare function chunks(options: ChunkOptions): ChunkResult;
/** The bounds of a room, for callers that want to place content inside it. */
export declare function roomBounds(room: Room): CellRect;
