import { type CharGrid } from "./grid.js";
/** The virtual glyph standing for "off the edge of the grid". It is a tile in
 *  the model so adjacency can talk about it, but `synthesize` never places it.
 *  Reserved: do not use it in your own legends. */
export declare const OUTSIDE = "\0";
/** Counted local rules learned from a sample — plain, serializable data. */
export interface TileModel {
    /** Distinct glyphs, in first-seen order. Indices into this are "tiles".
     *  Includes `OUTSIDE` as the last entry when `edge` is set. */
    readonly tiles: readonly string[];
    /** How often each glyph occurred; drives the weighted collapse choice. */
    readonly weights: readonly number[];
    /** `allowed[(dir * T + a) * T + b]` is 1 when glyph `b` may sit `dir`-ward
     *  of glyph `a`, with dir 0 = up, 1 = right, 2 = down, 3 = left. */
    readonly allowed: Uint8Array;
    /** True when the model learned which glyphs may touch the outside. */
    readonly edge?: boolean;
}
export interface AnalyzeOptions {
    /** Also learn every adjacency from a horizontally mirrored copy of the
     *  sample. Doubles the rule coverage of a small, asymmetric sample. */
    mirror?: boolean;
    /** Treat the sample as a torus, so the glyphs on opposite edges constrain
     *  each other. Use for seamless textures, not for rooms with walls. */
    wrap?: boolean;
    /** Learn which glyphs are allowed to touch the OUTSIDE of the grid, from
     *  which glyphs sat on the sample's own edge. Draw a sample ringed with wall
     *  and generated levels wall themselves in too, instead of ending in a
     *  corridor sliced off at the border. Ignored when `wrap` is set. */
    edge?: boolean;
}
/** Learn a `TileModel` from a hand-drawn sample. The sample may be a char grid
 *  or the newline-separated text of one:
 *
 *      const model = Procgen.analyze(`
 *        #####
 *        #...#
 *        #.#.#
 *        #####`, { edge: true });
 */
export declare function analyze(sample: CharGrid | string, options?: AnalyzeOptions): TileModel;
/** Build a model from rules you write out yourself, rather than from a sample.
 *  `adjacent` lists `[a, dir, b]` triples meaning "b may sit dir-ward of a";
 *  every pair is recorded in both directions, so list each once. */
export declare function defineModel(spec: {
    tiles: readonly string[];
    weights?: Readonly<Record<string, number>>;
    adjacent: ReadonlyArray<readonly [string, "up" | "right" | "down" | "left", string]>;
    /** Glyphs allowed to touch the outside of the grid. Give this and the edges
     *  can only hold these, which is how a level walls itself in. */
    edge?: readonly string[];
}): TileModel;
export interface SynthesizeOptions {
    /** Output width in cells. */
    cols: number;
    /** Output height in cells. */
    rows: number;
    /** Seed for the collapse choices. The same seed and model always give the
     *  same grid, on every machine. */
    seed?: number;
    /** Per-cell tile weight multipliers, laid out `[(y * cols + x) * T + tile]`
     *  where T is `model.tiles.length` — this is what `steer` produces. A zero
     *  forbids that glyph in that cell outright. */
    weights?: Float32Array;
    /** Cells pinned before collapse: `[x, y, glyph]`. Use for a fixed entrance,
     *  a boss room, or to regenerate part of a level around what you keep. */
    fixed?: ReadonlyArray<readonly [x: number, y: number, glyph: string]>;
    /** Restarts allowed after a contradiction. Default 12. */
    attempts?: number;
    /** Override the model's edge rule. `false` leaves the grid's border
     *  unconstrained even for a model analyzed with `edge: true`. */
    edge?: boolean;
}
/** Fill a fresh grid with glyphs that never break the model's local rules.
 *  Throws if no consistent grid was found within `attempts` restarts, which
 *  usually means the model is too sparse — analyze a richer sample, or pass
 *  `mirror: true`. */
export declare function synthesize(model: TileModel, options: SynthesizeOptions): CharGrid;
/** Regenerate a rectangular patch of an existing grid, keeping everything
 *  outside it and honouring the glyphs on the patch's border. Useful for
 *  "reroll this room" editor actions and for repairing a small broken area. */
export declare function resynthesize(grid: CharGrid, model: TileModel, patch: {
    x: number;
    y: number;
    w: number;
    h: number;
    seed?: number;
    attempts?: number;
}): CharGrid;
