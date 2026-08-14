import { EMPTY } from "../tiles/glyphs.js";
export { EMPTY };
/** A rectangular grid of legend glyphs — `grid[y][x]`. */
export type CharGrid = string[][];
/** A rectangular region in TILE coordinates (not world px). */
export interface CellRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** Column count of a grid (0 for an empty one). */
export declare function cols(grid: CharGrid): number;
/** Row count of a grid. */
export declare function rows(grid: CharGrid): number;
/** A `cols`×`rows` grid filled with one glyph. */
export declare function makeGrid(width: number, height: number, fill?: string): CharGrid;
/** An independent copy — generators never mutate their input. */
export declare function cloneGrid(grid: CharGrid): CharGrid;
/** The glyph at (x, y), or `outside` beyond the edges. */
export declare function at(grid: CharGrid, x: number, y: number, outside?: string): string;
/** Write a glyph, ignoring writes outside the grid. */
export declare function put(grid: CharGrid, x: number, y: number, glyph: string): void;
/** Fill a tile rect, clipped to the grid. */
export declare function fillRect(grid: CharGrid, rect: CellRect, glyph: string): void;
/** Render a grid as newline-joined text — the form `Tiles.grid` parses, and the
 *  form the CLI writes to disk. Only safe for single-character glyphs. */
export declare function toText(grid: CharGrid): string;
/** Parse newline-separated text back into a grid, padding short rows with
 *  `EMPTY` so the result is rectangular. Leading and trailing blank lines are
 *  dropped, matching `Tiles.grid`'s own parsing. */
export declare function fromText(text: string): CharGrid;
/** Accept either form wherever a sample or template is taken. */
export declare function asGrid(source: CharGrid | string): CharGrid;
/** Every distinct glyph, in first-seen (row-major) order so results are stable
 *  across runs and machines. */
export declare function glyphs(grid: CharGrid): string[];
