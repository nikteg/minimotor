// ---------- Overlapping WFC ----------
// The other half of Wave Function Collapse, and the half that makes output
// actually LOOK like the sample.
//
// `analyze` (in ./wfc) learns rules between single glyphs: "floor may sit right
// of wall". That is enough to never produce an illegal join, and not nearly
// enough to reproduce a MOTIF. Draw a sample with 2x2 water pools ringed by
// stone and the tiled model happily gives you back one-cell puddles and stone
// noise, because every join in that mess was individually legal.
//
// The overlapping model raises the unit of legality from a cell to an N x N
// WINDOW. It slides an N x N frame over the sample, collects every distinct
// window as a "pattern", and works out which patterns may overlap which — two
// patterns are compatible in a direction when the cells they share, once
// offset, agree exactly. A 2x2 pool is then a fact the model holds directly,
// not something it has to rediscover cell by cell.
//
// WHY THIS FILE IS SHORT
//
// A `TileModel` is "opaque tiles + weights + an allowed[dir][a][b] table". That
// describes a pattern set exactly as well as it describes a glyph set — so this
// file only BUILDS a model, and `synthesize` collapses it unchanged. Min-entropy
// choice, AC-3 propagation, restart-on-contradiction, `fixed`, `attempts` and
// per-cell `weights` all keep working with no new solver and no new bugs.
//
//     const { model, render } = Procgen.overlapping(sample, { n: 3 });
//     const grid = render(Procgen.synthesize(model, { cols, rows, seed }));
//
// COST
//
// Patterns grow with sample size and `symmetry`, and the compatibility table is
// `4 x patterns^2` bytes. A 10x10 sample at n=3 gives 64 patterns (16 KB); the
// same sample at `symmetry: 8` gives up to 512 (1 MB). `maxPatterns` stops that
// running away silently.
//
// LIMITS, HONESTLY
//
//   - A small, highly-structured sample can be RIGID: raise n far enough and
//     the only legal tilings are translations of the sample itself, so every
//     seed gives the same picture shifted and weights do nothing. The 8x8 pool
//     in the tests does this at n=3. If output looks like your sample on repeat,
//     lower `n` or draw a sample with more ways to rearrange its parts.
//   - No OUTSIDE/`edge` rule. Which patterns may touch the border is a separate
//     mechanism from the tiled model's, and is not implemented; ring the output
//     with `sealEdges` instead.
//   - `steer` targets glyphs, and this model's tiles are patterns, so the two do
//     not compose directly. Use `glyphWeights` below to convert a per-glyph
//     preference into per-pattern weights.
//   - Still no idea whether the exit is reachable. `repair` still runs last.
import { asGrid, cols, makeGrid, rows } from "./grid.js";
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** Separator inside a pattern key. Cells are usually one character, but a
 *  `CharGrid` may hold multi-character glyphs, so keys are joined rather than
 *  concatenated — otherwise "ab"+"c" and "a"+"bc" would collide. */
const SEP = "";
/** Learn an overlapping model from a hand-drawn sample.
 *
 *      const { model, render } = Procgen.overlapping(room, { n: 3 });
 *      const grid = Procgen.repair(
 *        render(Procgen.synthesize(model, { cols: 60, rows: 40, seed })),
 *      );
 */
export function overlapping(sample, options = {}) {
    const grid = asGrid(sample);
    const width = cols(grid);
    const height = rows(grid);
    if (width === 0 || height === 0)
        throw new Error("Procgen.overlapping: the sample is empty");
    const n = options.n ?? 3;
    if (!Number.isInteger(n) || n < 2) {
        throw new Error("Procgen.overlapping: n must be an integer of at least 2");
    }
    const periodic = options.periodic ?? true;
    const symmetry = options.symmetry ?? 1;
    if (![1, 2, 4, 8].includes(symmetry)) {
        throw new Error("Procgen.overlapping: symmetry must be 1, 2, 4 or 8");
    }
    if (!periodic && (width < n || height < n)) {
        throw new Error(`Procgen.overlapping: a ${width}x${height} sample is smaller than the ${n}x${n} window ` +
            `(use periodic: true, or a smaller n)`);
    }
    const maxPatterns = options.maxPatterns ?? 4096;
    // ---- collect distinct windows, counting how often each occurs ----
    const keys = [];
    const patterns = [];
    const weights = [];
    const byKey = new Map();
    const add = (window, count) => {
        const key = window.map((row) => row.join(SEP)).join(SEP);
        const known = byKey.get(key);
        if (known !== undefined) {
            weights[known] += count;
            return;
        }
        byKey.set(key, keys.length);
        keys.push(key);
        patterns.push(window);
        weights.push(count);
    };
    const lastX = periodic ? width : width - n + 1;
    const lastY = periodic ? height : height - n + 1;
    for (let y = 0; y < lastY; y++) {
        for (let x = 0; x < lastX; x++) {
            const window = Array.from({ length: n }, (_, dy) => Array.from({ length: n }, (_, dx) => grid[(y + dy) % height][(x + dx) % width]));
            // The original counts toward the weight; its transforms are alternatives
            // the author did not draw, so they enter with weight but never inflate
            // the original's share.
            for (const variant of transforms(window, symmetry))
                add(variant, 1);
        }
    }
    const found = keys.length;
    if (found > maxPatterns) {
        throw new Error(`Procgen.overlapping: ${found} patterns exceeds maxPatterns ${maxPatterns} — ` +
            `use a smaller sample, a smaller n, or less symmetry`);
    }
    // ---- compatibility: do two patterns agree on the cells they share? ----
    // Pattern `b` sits `dir`-ward of `a`, so `b` is offset by (dx, dy). They are
    // compatible when every cell inside BOTH windows holds the same glyph.
    const table = new Uint8Array(4 * found * found);
    for (let dir = 0; dir < 4; dir++) {
        const dx = DX[dir];
        const dy = DY[dir];
        for (let a = 0; a < found; a++) {
            for (let b = 0; b < found; b++) {
                if (agrees(patterns[a], patterns[b], dx, dy, n)) {
                    table[(dir * found + a) * found + b] = 1;
                }
            }
        }
    }
    // ---- drop patterns that can never be placed ----
    // A pattern with no legal neighbour in some direction cannot appear anywhere
    // in an unbounded grid. Leaving it in is not merely wasteful: the solver may
    // pick it, and then contradict one step later. Removing one can strand
    // another (it was that one's only support), so iterate to a fixpoint. This is
    // the difference between "the model is sparse" and "the model is a trap".
    const alive = new Uint8Array(found).fill(1);
    for (let changed = true; changed;) {
        changed = false;
        for (let a = 0; a < found; a++) {
            if (!alive[a])
                continue;
            for (let dir = 0; dir < 4; dir++) {
                let supported = false;
                for (let b = 0; b < found && !supported; b++) {
                    if (alive[b] && table[(dir * found + a) * found + b])
                        supported = true;
                }
                if (!supported) {
                    alive[a] = 0;
                    changed = true;
                    break;
                }
            }
        }
    }
    const keep = [];
    for (let a = 0; a < found; a++)
        if (alive[a])
            keep.push(a);
    const size = keep.length;
    if (size === 0) {
        throw new Error("Procgen.overlapping: no pattern can tile the plane — " +
            "the sample is too small or too irregular for this n" +
            (periodic ? "" : " (try periodic: true)"));
    }
    const size2 = size * size;
    const allowed = new Uint8Array(4 * size2);
    for (let dir = 0; dir < 4; dir++) {
        for (let a = 0; a < size; a++) {
            for (let b = 0; b < size; b++) {
                allowed[dir * size2 + a * size + b] = table[(dir * found + keep[a]) * found + keep[b]];
            }
        }
    }
    const liveKeys = keep.map((a) => keys[a]);
    const livePatterns = keep.map((a) => patterns[a]);
    const liveWeights = keep.map((a) => weights[a]);
    const index = new Map(liveKeys.map((key, i) => [key, i]));
    const model = { tiles: liveKeys, weights: liveWeights, allowed };
    return {
        model,
        patterns: livePatterns,
        n,
        render(collapsed) {
            const outWidth = cols(collapsed);
            const outHeight = rows(collapsed);
            const out = makeGrid(Math.max(1, outWidth), Math.max(1, outHeight), " ");
            for (let y = 0; y < outHeight; y++) {
                for (let x = 0; x < outWidth; x++) {
                    const at = index.get(collapsed[y][x]);
                    // A cell that is not one of our pattern keys passes through untouched,
                    // so a caller may mark up the grid before rendering.
                    out[y][x] = at === undefined ? collapsed[y][x] : livePatterns[at][0][0];
                }
            }
            return out;
        },
    };
}
/** Per-pattern weights expressing a per-GLYPH preference, so the overlapping
 *  model can be aimed the way `steer` aims the tiled one. Each pattern's
 *  multiplier is the product over its cells of that glyph's preference, so a
 *  pattern made entirely of a favoured glyph is favoured most.
 *
 *      // twice as much water, half as much stone
 *      const weights = Procgen.glyphWeights(built, { "~": 2, "#": 0.5 });
 *      Procgen.synthesize(built.model, { cols, rows, seed, weights });
 */
export function glyphWeights(built, preference, options) {
    const size = built.model.tiles.length;
    const perPattern = built.patterns.map((pattern) => {
        let scale = 1;
        for (const row of pattern) {
            for (const glyph of row)
                scale *= preference[glyph] ?? 1;
        }
        // A zero would be a hard ban; keep it merely unlikely so the solver still
        // has somewhere to go when the rules leave it no choice.
        return Math.max(1e-6, scale);
    });
    const cells = options.cols * options.rows;
    const weights = new Float32Array(cells * size);
    for (let cell = 0; cell < cells; cell++) {
        for (let t = 0; t < size; t++)
            weights[cell * size + t] = perPattern[t];
    }
    return weights;
}
/** Do `a` and `b` agree everywhere their windows overlap, with `b` shifted by
 *  (dx, dy)? Cells of `b` outside `a` are unconstrained — that is the whole
 *  point of an OVERLAPPING model. */
function agrees(a, b, dx, dy, n) {
    const x0 = Math.max(0, dx);
    const y0 = Math.max(0, dy);
    const x1 = Math.min(n, n + dx);
    const y1 = Math.min(n, n + dy);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            if (a[y][x] !== b[y - dy][x - dx])
                return false;
        }
    }
    return true;
}
/** The requested subgroup of the square's symmetries, original first. */
function transforms(window, symmetry) {
    if (symmetry === 1)
        return [window];
    const mirror = (g) => g.map((row) => row.slice().reverse());
    const turn = (g) => g[0].map((_, x) => g.map((row) => row[x]).reverse());
    if (symmetry === 2)
        return [window, mirror(window)];
    const rotations = [window];
    for (let i = 1; i < 4; i++)
        rotations.push(turn(rotations[i - 1]));
    return symmetry === 4 ? rotations : [...rotations, ...rotations.map(mirror)];
}
