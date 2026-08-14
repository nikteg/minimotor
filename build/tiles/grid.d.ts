import type { GridOptions, Level, TileSpec, TileWorld, TileWorldOptions } from "./types.js";
export declare function grid<L extends Record<string, TileSpec>>(source: string | readonly (readonly string[])[], options: GridOptions<L>): Level<keyof L & string>;
/** Build a multi-level world directly from ordinary tile strings. Portal
 * endpoints are marker cells (`"level:P"`); `between` creates the common
 * bidirectional door pair while `from`/`to` creates a one-way link. */
export declare function world<const M extends Record<string, string>, L extends Record<string, TileSpec>>(maps: M, options: TileWorldOptions<keyof M & string, L>): TileWorld<keyof M & string, keyof L & string>;
