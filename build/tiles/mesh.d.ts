import type { Rect } from "../engine/index.js";
/** Tile-grid dimensions the meshing and indexing are relative to. */
export interface GridDims {
    cols: number;
    rows: number;
    /** World size of one tile, px. */
    size: number;
}
export interface MergedIndex<R extends Rect> {
    rects: R[];
    /** Tile row → indices of every rect covering it. */
    byRow: number[][];
    /** Per-query dedupe stamp: one rect can sit in several row buckets. */
    seen: Int32Array;
    epoch: number;
    /** Widest rect in the index — how far left of the query a rect can start
     *  and still reach it, which bounds the binary search in each bucket. */
    maxWidth: number;
}
/** Greedy-mesh a membership grid. Runs are grown right first, then down when
 *  `mergeDown` (never for one-way platforms). */
export declare function mesh(dims: GridDims, member: Uint8Array, mergeDown: boolean, make: (cx: number, cy: number, w: number, h: number) => void): void;
/** Sort row-major and bucket by tile row, each bucket ordered by x, so a
 *  query touches only its row band and only the columns it overlaps. */
export declare function indexRects<R extends Rect>(dims: GridDims, rects: R[]): MergedIndex<R>;
/** Append every indexed rect overlapping `area` to `out`, each at most once. */
export declare function queryIndex<R extends Rect>(dims: GridDims, index: MergedIndex<R>, area: Rect, out: R[]): R[];
