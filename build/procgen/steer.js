// ---------- Gradient steering ----------
// Aiming `synthesize` at soft, global targets: "about 15% water", "denser
// toward the right", "this biome up here". Those are smooth, measurable
// properties of a whole grid, which is exactly the shape of problem gradient
// descent is good at — and exactly the shape `synthesize` cannot express, since
// its rules are all local.
//
// HOW THE DISCRETE PROBLEM IS MADE DIFFERENTIABLE
//
// "Is this cell grass or stone?" has no halfway, so there is no slope to
// follow. So during optimisation each cell holds a DISTRIBUTION over glyphs
// instead — 60% grass, 30% stone, 10% water — written as `P[cell][tile]` with
// each cell's row summing to 1. Every target below is then a smooth function of
// P with a gradient we can write down by hand:
//
//   adjacency   E = Σ_cells Σ_dirs Σ_{a,b} P[c][a] · illegal(dir,a,b) · P[nb][b]
//               ∂E/∂P[c][a] = Σ_dirs Σ_b illegal(dir,a,b) · P[nb][b]
//               — the expected number of rule-breaking joins.
//
//   share       E = w · |region| · (mean_region(P[·][g]) − target)²
//               ∂E/∂P[c][g] = 2w · (mean − target)
//
//   field       E = w · Σ_cells (P[c][g] − target(c))²   (a per-cell target)
//               ∂E/∂P[c][g] = 2w · (P[c][g] − target(c))
//
// Note the |region| factor on `share`: it makes the cost PER CELL, so a share
// target and a field target of equal weight pull equally hard on any one cell,
// and no term's strength depends on how big the grid is.
//
//   sharpness   E = τ · Σ P log P   (annealed up over the run)
//               ∂E/∂P = τ · (1 + log P)
//               — pulls the blur toward a decision near the end.
//
// The optimiser is EXPONENTIATED GRADIENT (mirror descent): `P ← P·exp(−ηg)`,
// then renormalise the row. Two lines, no projection step, and rows can never
// leave the simplex or go negative — which plain gradient descent would do
// constantly here.
//
// WHAT COMES OUT, AND WHY IT IS NOT THE LEVEL
//
// `steer` returns per-cell WEIGHTS, not a grid. They are handed to
// `synthesize`, which still enforces the hard adjacency rules, and `repair`
// still guarantees connectivity afterwards. Rounding the blur straight to a
// grid would give you something that looks plausible and is structurally
// broken — gradients can express "roughly this much water over there" and
// cannot express "the exit is reachable". Keeping them in the advisory role is
// the whole design.
import { OUTSIDE } from "./wfc.js";
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
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
export function steer(model, options) {
    const width = options.cols;
    const height = options.rows;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error("Procgen.steer: cols and rows must be positive integers");
    }
    const size = model.tiles.length;
    if (size === 0)
        throw new Error("Procgen.steer: the model has no tiles");
    const cells = width * height;
    const steps = options.steps ?? 120;
    const rate = options.rate ?? 0.35;
    const sharpen = options.sharpen ?? 0;
    const adjacencyWeight = options.adjacency ?? 0.1;
    const floor = options.floor ?? 0.001;
    // OUTSIDE is a virtual tile; it must never carry any probability mass.
    const outside = model.tiles.indexOf(OUTSIDE);
    const placeable = [];
    for (let t = 0; t < size; t++)
        if (t !== outside)
            placeable.push(t);
    if (placeable.length === 0)
        throw new Error("Procgen.steer: the model has no placeable tiles");
    const resolved = (options.targets ?? []).map((target) => {
        const tile = model.tiles.indexOf(target.glyph);
        if (tile < 0) {
            throw new Error(`Procgen.steer: target glyph "${target.glyph}" is not in the model`);
        }
        const region = target.region ?? { x: 0, y: 0, w: width, h: height };
        const x0 = Math.max(0, region.x);
        const y0 = Math.max(0, region.y);
        const x1 = Math.min(width, region.x + region.w);
        const y1 = Math.min(height, region.y + region.h);
        const count = Math.max(1, (x1 - x0) * (y1 - y0));
        return { tile, weight: target.weight ?? 1, share: target.share, x0, y0, x1, y1, count };
    });
    // `illegal[(dir*T + a)*T + b]` — the complement of the model's rules, which is
    // what the adjacency loss actually penalises.
    const illegal = new Uint8Array(model.allowed.length);
    for (let i = 0; i < illegal.length; i++)
        illegal[i] = model.allowed[i] ? 0 : 1;
    // Start uniform over the placeable tiles: no prior beyond "anything could go
    // anywhere", so the targets do all the shaping.
    const field = new Float32Array(cells * size);
    const start = 1 / placeable.length;
    for (let cell = 0; cell < cells; cell++) {
        for (const t of placeable)
            field[cell * size + t] = start;
    }
    const gradient = new Float64Array(cells * size);
    const history = [];
    for (let step = 0; step < steps; step++) {
        gradient.fill(0);
        let loss = 0;
        // ---- adjacency: expected rule-breaking joins, PER CELL ----
        // Every term below is written PER CELL — a cell's gradient depends on that
        // cell's error, never on how many cells there are. That is what makes
        // `weight` mean the same thing at 20x20 and 200x200, and what keeps the
        // three terms comparable to each other at equal weight.
        const adjacencyScale = adjacencyWeight;
        if (adjacencyWeight !== 0) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const cell = y * width + x;
                    for (let dir = 0; dir < 4; dir++) {
                        const nx = x + DX[dir];
                        const ny = y + DY[dir];
                        if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                            continue;
                        const neighbour = ny * width + nx;
                        for (const a of placeable) {
                            const row = (dir * size + a) * size;
                            let penalty = 0;
                            for (const b of placeable) {
                                if (illegal[row + b])
                                    penalty += field[neighbour * size + b];
                            }
                            if (penalty === 0)
                                continue;
                            // Each edge is visited from both ends, so the pair term is
                            // counted twice; halving keeps `loss` readable as "joins".
                            loss += adjacencyScale * field[cell * size + a] * penalty * 0.5;
                            gradient[cell * size + a] += adjacencyScale * penalty;
                        }
                    }
                }
            }
        }
        // ---- targets ----
        for (const target of resolved) {
            if (typeof target.share === "number") {
                // A share is a constraint on the region MEAN, so every cell in the
                // region shares one gradient.
                let mean = 0;
                for (let y = target.y0; y < target.y1; y++) {
                    for (let x = target.x0; x < target.x1; x++) {
                        mean += field[(y * width + x) * size + target.tile];
                    }
                }
                mean /= target.count;
                const error = mean - target.share;
                // Charged per cell in the region, so one mean target and one field
                // target of the same weight pull equally hard on any given cell.
                loss += target.weight * target.count * error * error;
                const slope = 2 * target.weight * error;
                for (let y = target.y0; y < target.y1; y++) {
                    for (let x = target.x0; x < target.x1; x++) {
                        gradient[(y * width + x) * size + target.tile] += slope;
                    }
                }
            }
            else {
                // A field target is per-cell, so each cell gets its own error.
                for (let y = target.y0; y < target.y1; y++) {
                    for (let x = target.x0; x < target.x1; x++) {
                        const at = (y * width + x) * size + target.tile;
                        const error = field[at] - target.share(x, y);
                        loss += target.weight * error * error;
                        gradient[at] += 2 * target.weight * error;
                    }
                }
            }
        }
        // ---- sharpening, annealed in so early steps stay free to explore ----
        const tau = sharpen * (step / Math.max(1, steps - 1));
        if (tau > 0) {
            for (let cell = 0; cell < cells; cell++) {
                for (const t of placeable) {
                    const p = field[cell * size + t];
                    if (p <= 0)
                        continue;
                    loss += tau * p * Math.log(p);
                    gradient[cell * size + t] += tau * (1 + Math.log(p));
                }
            }
        }
        // ---- exponentiated gradient: P ← P·exp(−ηg), renormalised per cell ----
        for (let cell = 0; cell < cells; cell++) {
            let total = 0;
            for (const t of placeable) {
                const at = cell * size + t;
                // A trust region on the step, not just a guard against flushing a cell
                // to zero. Mirror descent with a fixed rate oscillates once `rate·g`
                // grows past ~1, and it overshoots the target rather than reaching it —
                // a high `weight` would then score WORSE than a modest one, which is
                // not a dial anyone can reason about. Capping the exponent bounds each
                // step to ±28% either way, so raising a weight past the point where it
                // already converges simply stops changing anything.
                const exponent = Math.max(-0.25, Math.min(0.25, -rate * gradient[at]));
                const next = field[at] * Math.exp(exponent);
                field[at] = next;
                total += next;
            }
            if (total <= 0) {
                for (const t of placeable)
                    field[cell * size + t] = start;
                continue;
            }
            for (const t of placeable)
                field[cell * size + t] /= total;
        }
        history.push(loss);
    }
    // ---- hand back weights ----
    // `synthesize` MULTIPLIES these by the model's own glyph frequencies, so a
    // raw probability would be counted twice: a glyph that was rare in the sample
    // would stay rare however hard it was steered. Dividing the field by the
    // model's base share cancels that, and the product `base × weight` comes out
    // proportional to the field — which is what "target 25% water" has to mean.
    // A glyph the sample never contained has no base share to divide out, so it
    // falls back to a plain scale.
    const totalBase = placeable.reduce((sum, t) => sum + model.weights[t], 0);
    const weights = new Float32Array(cells * size);
    for (let cell = 0; cell < cells; cell++) {
        for (const t of placeable) {
            const share = totalBase > 0 ? model.weights[t] / totalBase : 0;
            const at = cell * size + t;
            weights[at] = Math.max(floor, share > 0 ? field[at] / share : field[at] * placeable.length);
        }
        // OUTSIDE stays at 0: synthesize treats that as a ban, which is correct —
        // it is never placed anyway.
    }
    return { weights, history, field };
}
/** A per-cell target that ramps linearly across the grid — the common case for
 *  difficulty and density gradients.
 *
 *      Procgen.steer(model, { cols, rows, targets: [
 *        { glyph: "#", share: Procgen.ramp("x", 0.2, 0.6, cols) },
 *      ]});
 */
export function ramp(axis, from, to, span) {
    const length = Math.max(1, span - 1);
    return (x, y) => {
        const along = (axis === "x" ? x : y) / length;
        return from + (to - from) * Math.min(1, Math.max(0, along));
    };
}
