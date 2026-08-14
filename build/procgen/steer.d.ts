import { type CellRect } from "./grid.js";
import { type TileModel } from "./wfc.js";
export interface SteerTarget {
    /** The glyph being aimed at. Must be one of the model's tiles. */
    glyph: string;
    /** Either a single fraction — "this share of the region should be this
     *  glyph" — or a per-cell function returning the desired local density at
     *  `(x, y)`, which is how you write a ramp:
     *
     *      { glyph: "#", share: (x) => x / cols }   // denser toward the right
     */
    share: number | ((x: number, y: number) => number);
    /** Restrict the target to a rectangle of cells. Whole grid when omitted. */
    region?: CellRect;
    /** Relative importance against the other targets and against `adjacency`.
     *  Default 1, which is already enough to hit a target closely; the scale is
     *  per cell, so the same weight means the same thing on any grid size. */
    weight?: number;
}
export interface SteerOptions {
    /** Grid width the weights are for — must match the later `synthesize`. */
    cols: number;
    /** Grid height the weights are for. */
    rows: number;
    /** What to aim at. With none, `steer` only enforces adjacency and returns a
     *  near-uniform field. */
    targets?: readonly SteerTarget[];
    /** Importance of keeping the blur locally legal. Default 0.1 — deliberately
     *  small, because this term is minimised by a field that is entirely ONE
     *  glyph (nothing ever joins illegally if nothing ever changes). At weight 1
     *  that pull beats a target of weight 1 and floods the grid with whatever
     *  glyph the sample joined to itself most freely. Zero drops it entirely and
     *  hits the targets exactly; `synthesize` still enforces real legality, so
     *  zero is a reasonable choice and not a correctness risk. */
    adjacency?: number;
    /** Descent steps. Default 120. */
    steps?: number;
    /** Step size for the exponentiated-gradient update. Default 0.35. */
    rate?: number;
    /** How hard to push the field toward a decision by the end, annealed in over
     *  the run. Default 0 — the field stays soft, which is what `synthesize`
     *  wants, since it does the deciding itself and a near-one-hot field would
     *  leave it no legal room to manoeuvre. Raise it (0.5 is decisive) only when
     *  you intend to read `field` and round it yourself. Unlike the other terms
     *  this one acts per cell, so it is a strong dial. */
    sharpen?: number;
    /** Smallest weight any glyph keeps, so steering never accidentally BANS one
     *  (a zero weight is a hard ban in `synthesize`). Default 0.001. */
    floor?: number;
}
export interface SteerResult {
    /** Per-cell tile weight multipliers, laid out `[(y*cols + x) * T + tile]` —
     *  pass straight to `synthesize` as `weights`. 1 is neutral. */
    weights: Float32Array;
    /** Total loss after each step. It should decrease; if it does not, the
     *  targets are contradictory or `rate` is too high. */
    history: number[];
    /** The soft field itself, same layout, each cell's row summing to 1. Useful
     *  for debug overlays — draw it and you can see what the optimiser decided. */
    field: Float32Array;
}
/** Optimise a soft per-cell glyph distribution toward `targets`, and return it
 *  as weights for `synthesize`.
 *
 *      const model = Procgen.analyze(sample, { edge: true });
 *      const { weights } = Procgen.steer(model, {
 *        cols: 60, rows: 40,
 *        targets: [
 *          { glyph: "~", share: 0.15 },                    // 15% water overall
 *          { glyph: "#", share: (x) => x / 60 },           // rock ramps rightward
 *        ],
 *      });
 *      const grid = Procgen.repair(
 *        Procgen.synthesize(model, { cols: 60, rows: 40, seed, weights }),
 *      );
 */
export declare function steer(model: TileModel, options: SteerOptions): SteerResult;
/** A per-cell target that ramps linearly across the grid — the common case for
 *  difficulty and density gradients.
 *
 *      Procgen.steer(model, { cols, rows, targets: [
 *        { glyph: "#", share: Procgen.ramp("x", 0.2, 0.6, cols) },
 *      ]});
 */
export declare function ramp(axis: "x" | "y", from: number, to: number, span: number): (x: number, y: number) => number;
