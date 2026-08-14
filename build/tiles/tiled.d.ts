import type { Level, TiledGridOptions, TiledSet } from "./types.js";
/** Read a `.tsj` tileset without translating it into engine-specific atlas
 * coordinates. Tile class/type (or a string `name` property) becomes the
 * stable lookup name. Tiled custom properties `cols` and `rows` opt a tile
 * into a multi-cell atlas stamp. */
declare function tiledSet(image: CanvasImageSource, source: unknown): TiledSet;
/** Turn a finite or chunked Tiled tile layer into the same semantic `Level`
 * returned by `Tiles.grid`. Rendering still comes from a separate skin. */
declare function tiledGrid<L extends Record<number, string>>(source: unknown, options: TiledGridOptions<L>): Level<L[keyof L] & string>;
/** Standard Tiled JSON adapters. */
export declare const Tiled: Readonly<{
    set: typeof tiledSet;
    grid: typeof tiledGrid;
}>;
export {};
