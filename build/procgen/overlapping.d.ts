import { type CharGrid } from "./grid.js";
import type { TileModel } from "./wfc.js";
export interface OverlappingOptions {
    /** Window size. Default 3. Larger reproduces bigger motifs and needs a bigger
     *  sample; 2 is barely more than the tiled model, 4+ gets strict fast. */
    n?: number;
    /** Read the sample as a torus, so windows wrap off its edges.
     *
     *  Default TRUE, and you almost certainly want it. A non-periodic sample
     *  yields the patterns of that one box's interior, and such a set usually
     *  cannot tile an unbounded plane at all — not "often fails", but fails on
     *  every seed, because no legal arrangement exists. Retrying cannot help.
     *  Wrapping closes the set under tiling. The cost is that the model learns
     *  joins between the sample's opposite edges, which the author never drew;
     *  set this false only when that matters more than generating anything, and
     *  expect to need `sealEdges` and a forgiving `attempts`. */
    periodic?: boolean;
    /** Add transformed copies of every pattern: 1 none, 2 mirrored, 4 rotations,
     *  8 the full dihedral group. Default 1 — the others multiply the pattern
     *  count and only make sense when your tiles are orientation-agnostic. */
    symmetry?: 1 | 2 | 4 | 8;
    /** Refuse to build a model bigger than this many patterns. Default 4096,
     *  which is a 64 MB compatibility table — well past useful. */
    maxPatterns?: number;
}
export interface OverlappingModel {
    /** Hand straight to `synthesize`. Its `tiles` are opaque pattern keys. */
    model: TileModel;
    /** Turn a grid of collapsed pattern keys back into glyphs, by taking each
     *  pattern's top-left cell. Output is the same size as the input. */
    render(grid: CharGrid): CharGrid;
    /** The patterns themselves, in tile order — pattern `i` as an n x n grid.
     *  Useful for debug overlays and for writing your own weighting. */
    patterns: readonly CharGrid[];
    /** Window size the model was built with. */
    n: number;
}
/** Learn an overlapping model from a hand-drawn sample.
 *
 *      const { model, render } = Procgen.overlapping(room, { n: 3 });
 *      const grid = Procgen.repair(
 *        render(Procgen.synthesize(model, { cols: 60, rows: 40, seed })),
 *      );
 */
export declare function overlapping(sample: CharGrid | string, options?: OverlappingOptions): OverlappingModel;
/** Per-pattern weights expressing a per-GLYPH preference, so the overlapping
 *  model can be aimed the way `steer` aims the tiled one. Each pattern's
 *  multiplier is the product over its cells of that glyph's preference, so a
 *  pattern made entirely of a favoured glyph is favoured most.
 *
 *      // twice as much water, half as much stone
 *      const weights = Procgen.glyphWeights(built, { "~": 2, "#": 0.5 });
 *      Procgen.synthesize(built.model, { cols, rows, seed, weights });
 */
export declare function glyphWeights(built: OverlappingModel, preference: Readonly<Record<string, number>>, options: {
    cols: number;
    rows: number;
}): Float32Array;
