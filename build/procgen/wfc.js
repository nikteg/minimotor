// ---------- Adjacency synthesis (Wave Function Collapse / Model Synthesis) ----------
// Draw ONE room by hand; get a hundred more that never break its local rules.
//
//   `analyze` reads a sample char grid and counts, for every pair of glyphs,
//   whether one may sit above/right/below/left of the other, plus how often
//   each glyph occurs. That is the whole model — plain counted data.
//
//   `synthesize` fills a fresh grid with glyphs consistent with that model:
//   collapse the least-uncertain cell, propagate the consequences, repeat.
//
// This gives TEXTURE, not STRUCTURE. It reliably produces walls that meet
// floors correctly and never a floating half-corridor; it has no idea whether
// the exit is reachable. Pair it with `dungeon`/`rooms` for layout and `repair`
// for connectivity — see the module doc in `index.ts`.
import { createRng } from "../rng/index.js";
import { asGrid, cloneGrid, cols, glyphs, makeGrid, rows } from "./grid.js";
/** Neighbour directions, in the order the model indexes them. */
const UP = 0;
const RIGHT = 1;
const DOWN = 2;
const LEFT = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** The virtual glyph standing for "off the edge of the grid". It is a tile in
 *  the model so adjacency can talk about it, but `synthesize` never places it.
 *  Reserved: do not use it in your own legends. */
export const OUTSIDE = "\u0000";
/** Learn a `TileModel` from a hand-drawn sample. The sample may be a char grid
 *  or the newline-separated text of one:
 *
 *      const model = Procgen.analyze(`
 *        #####
 *        #...#
 *        #.#.#
 *        #####`, { edge: true });
 */
export function analyze(sample, options = {}) {
    const grid = asGrid(sample);
    const width = cols(grid);
    const height = rows(grid);
    if (width === 0 || height === 0)
        throw new Error("Procgen.analyze: the sample is empty");
    const tiles = glyphs(grid);
    if (tiles.includes(OUTSIDE)) {
        throw new Error("Procgen.analyze: the sample uses the reserved OUTSIDE glyph");
    }
    const wantEdge = options.edge === true && options.wrap !== true;
    if (wantEdge)
        tiles.push(OUTSIDE);
    const index = new Map(tiles.map((glyph, i) => [glyph, i]));
    const size = tiles.length;
    const weights = Array.from({ length: size }).fill(0);
    const allowed = new Uint8Array(4 * size * size);
    /** Record that `b` may sit `dir`-ward of `a`, and the mirror of that fact. */
    const link = (dir, a, b) => {
        allowed[(dir * size + a) * size + b] = 1;
        allowed[(((dir + 2) % 4) * size + b) * size + a] = 1;
    };
    const outside = wantEdge ? index.get(OUTSIDE) : -1;
    // Beyond the outside is more outside, so corners work out.
    if (outside >= 0)
        for (let dir = 0; dir < 4; dir++)
            link(dir, outside, outside);
    const scan = (source, countWeights) => {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const a = index.get(source[y][x]);
                if (countWeights)
                    weights[a]++;
                for (let dir = 0; dir < 4; dir++) {
                    let nx = x + DX[dir];
                    let ny = y + DY[dir];
                    const off = nx < 0 || ny < 0 || nx >= width || ny >= height;
                    if (off && options.wrap) {
                        nx = (nx + width) % width;
                        ny = (ny + height) % height;
                    }
                    else if (off) {
                        if (outside >= 0)
                            link(dir, a, outside);
                        continue;
                    }
                    link(dir, a, index.get(source[ny][nx]));
                }
            }
        }
    };
    scan(grid, true);
    if (options.mirror) {
        scan(grid.map((row) => row.slice().reverse()), false);
    }
    return { tiles, weights, allowed, ...(wantEdge ? { edge: true } : {}) };
}
/** Build a model from rules you write out yourself, rather than from a sample.
 *  `adjacent` lists `[a, dir, b]` triples meaning "b may sit dir-ward of a";
 *  every pair is recorded in both directions, so list each once. */
export function defineModel(spec) {
    const tiles = [...spec.tiles];
    const wantEdge = spec.edge !== undefined;
    if (wantEdge)
        tiles.push(OUTSIDE);
    const index = new Map(tiles.map((glyph, i) => [glyph, i]));
    const size = tiles.length;
    const allowed = new Uint8Array(4 * size * size);
    const dirs = { up: UP, right: RIGHT, down: DOWN, left: LEFT };
    const link = (d, ai, bi) => {
        allowed[(d * size + ai) * size + bi] = 1;
        allowed[(((d + 2) % 4) * size + bi) * size + ai] = 1;
    };
    for (const [a, dir, b] of spec.adjacent) {
        const ai = index.get(a);
        const bi = index.get(b);
        if (ai === undefined || bi === undefined) {
            throw new Error(`Procgen.defineModel: unknown glyph in rule ["${a}", "${dir}", "${b}"]`);
        }
        link(dirs[dir], ai, bi);
    }
    if (wantEdge) {
        const outside = index.get(OUTSIDE);
        for (let dir = 0; dir < 4; dir++)
            link(dir, outside, outside);
        for (const glyph of spec.edge) {
            const gi = index.get(glyph);
            if (gi === undefined)
                throw new Error(`Procgen.defineModel: unknown edge glyph "${glyph}"`);
            for (let dir = 0; dir < 4; dir++)
                link(dir, gi, outside);
        }
    }
    return {
        tiles,
        weights: tiles.map((glyph) => (glyph === OUTSIDE ? 0 : (spec.weights?.[glyph] ?? 1))),
        allowed,
        ...(wantEdge ? { edge: true } : {}),
    };
}
/** Fill a fresh grid with glyphs that never break the model's local rules.
 *  Throws if no consistent grid was found within `attempts` restarts, which
 *  usually means the model is too sparse — analyze a richer sample, or pass
 *  `mirror: true`. */
export function synthesize(model, options) {
    const width = options.cols;
    const height = options.rows;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error("Procgen.synthesize: cols and rows must be positive integers");
    }
    const size = model.tiles.length;
    if (size === 0)
        throw new Error("Procgen.synthesize: the model has no tiles");
    if (options.weights && options.weights.length !== width * height * size) {
        throw new Error(`Procgen.synthesize: weights must hold cols*rows*${size} values, got ${options.weights.length}`);
    }
    const attempts = options.attempts ?? 12;
    for (let attempt = 0; attempt < attempts; attempt++) {
        // Decorrelate the restarts without asking the caller for more seeds.
        const grid = collapse(model, options, ((options.seed ?? 0) + attempt * 0x9e3779b1) | 0);
        if (grid)
            return grid;
    }
    throw new Error(`Procgen.synthesize: no consistent layout after ${attempts} attempts — the model may be too sparse`);
}
/** One collapse run. Returns null on a contradiction so the caller can retry. */
function collapse(model, options, seed) {
    const width = options.cols;
    const height = options.rows;
    const size = model.tiles.length;
    const cells = width * height;
    const allowed = model.allowed;
    const rng = createRng(seed >>> 0);
    const wave = new Uint8Array(cells * size).fill(1);
    const open = new Int32Array(cells).fill(size);
    const sumW = new Float64Array(cells);
    const sumWLogW = new Float64Array(cells);
    // Bumped on every removal so stale heap entries can be recognised and
    // dropped instead of maintaining a decrease-key.
    const version = new Int32Array(cells);
    const stack = [];
    const weightAt = (cell, tile) => {
        const base = model.weights[tile];
        return options.weights ? base * options.weights[cell * size + tile] : base;
    };
    // ---- lazy min-heap over cell entropy ----
    const heapE = [];
    const heapC = [];
    const heapV = [];
    function heapPush(entropy, cell, stamp) {
        let i = heapE.length;
        heapE.push(entropy);
        heapC.push(cell);
        heapV.push(stamp);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heapE[parent] <= heapE[i])
                break;
            swapHeap(parent, i);
            i = parent;
        }
    }
    function swapHeap(a, b) {
        [heapE[a], heapE[b]] = [heapE[b], heapE[a]];
        [heapC[a], heapC[b]] = [heapC[b], heapC[a]];
        [heapV[a], heapV[b]] = [heapV[b], heapV[a]];
    }
    function heapPop() {
        // Skip entries whose cell has since changed or collapsed.
        while (heapE.length > 0) {
            const cell = heapC[0];
            const stamp = heapV[0];
            const last = heapE.length - 1;
            swapHeap(0, last);
            heapE.pop();
            heapC.pop();
            heapV.pop();
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let small = i;
                if (l < heapE.length && heapE[l] < heapE[small])
                    small = l;
                if (r < heapE.length && heapE[r] < heapE[small])
                    small = r;
                if (small === i)
                    break;
                swapHeap(small, i);
                i = small;
            }
            if (stamp === version[cell] && open[cell] > 1)
                return cell;
        }
        return -1;
    }
    function reheap(cell) {
        if (open[cell] <= 1)
            return;
        // Shannon entropy of the cell's remaining weighted options, jittered so
        // ties break differently per seed instead of always favouring low indices.
        // A cell left holding only unweighted glyphs (a border glyph the sample
        // never actually contained) falls back to a plain count.
        const entropy = sumW[cell] > 0 ? Math.log(sumW[cell]) - sumWLogW[cell] / sumW[cell] : Math.log(open[cell]);
        heapPush(entropy - rng.random() * 1e-6, cell, version[cell]);
    }
    /** Rule out one tile at one cell. Returns false on a contradiction. */
    function remove(cell, tile) {
        const at = cell * size + tile;
        if (!wave[at])
            return true;
        wave[at] = 0;
        open[cell]--;
        const w = weightAt(cell, tile);
        if (w > 0) {
            sumW[cell] -= w;
            sumWLogW[cell] -= w * Math.log(w);
        }
        version[cell]++;
        if (open[cell] === 0)
            return false;
        stack.push(cell);
        reheap(cell);
        return true;
    }
    // Reused across propagation steps: the union of what `cell` permits `dir`-ward.
    const support = new Uint8Array(size);
    function propagate() {
        while (stack.length > 0) {
            const cell = stack.pop();
            const cx = cell % width;
            const cy = (cell / width) | 0;
            for (let dir = 0; dir < 4; dir++) {
                const nx = cx + DX[dir];
                const ny = cy + DY[dir];
                if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                    continue;
                const neighbour = ny * width + nx;
                if (open[neighbour] === 1)
                    continue;
                support.fill(0);
                for (let s = 0; s < size; s++) {
                    if (!wave[cell * size + s])
                        continue;
                    const row = (dir * size + s) * size;
                    for (let t = 0; t < size; t++)
                        if (allowed[row + t])
                            support[t] = 1;
                }
                for (let t = 0; t < size; t++) {
                    if (!wave[neighbour * size + t] || support[t])
                        continue;
                    if (!remove(neighbour, t))
                        return false;
                }
            }
        }
        return true;
    }
    // ---- initial constraints ----
    for (let cell = 0; cell < cells; cell++) {
        for (let t = 0; t < size; t++) {
            const w = weightAt(cell, t);
            if (w > 0) {
                sumW[cell] += w;
                sumWLogW[cell] += w * Math.log(w);
            }
        }
    }
    // A zero weight forbids the glyph outright; do it before anything reads the
    // wave so the sums above stay consistent with what is actually possible.
    if (options.weights) {
        for (let cell = 0; cell < cells; cell++) {
            for (let t = 0; t < size; t++) {
                if (weightAt(cell, t) <= 0 && !remove(cell, t))
                    return null;
            }
        }
    }
    // OUTSIDE is a virtual tile: it says what may touch the border, but it is
    // never itself placed. Ban it everywhere first, then constrain the border.
    const outside = model.tiles.indexOf(OUTSIDE);
    if (outside >= 0) {
        for (let cell = 0; cell < cells; cell++) {
            if (!remove(cell, outside))
                return null;
        }
    }
    const useEdge = options.edge ?? model.edge === true;
    if (useEdge && outside >= 0) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1)
                    continue;
                const cell = y * width + x;
                for (let dir = 0; dir < 4; dir++) {
                    const nx = x + DX[dir];
                    const ny = y + DY[dir];
                    if (nx >= 0 && ny >= 0 && nx < width && ny < height)
                        continue;
                    for (let t = 0; t < size; t++) {
                        if (!wave[cell * size + t])
                            continue;
                        if (!allowed[(dir * size + t) * size + outside] && !remove(cell, t))
                            return null;
                    }
                }
            }
        }
    }
    for (const [x, y, glyph] of options.fixed ?? []) {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            throw new Error(`Procgen.synthesize: fixed cell (${x}, ${y}) is outside the grid`);
        }
        const keep = model.tiles.indexOf(glyph);
        if (keep < 0)
            throw new Error(`Procgen.synthesize: fixed glyph "${glyph}" is not in the model`);
        const cell = y * width + x;
        for (let t = 0; t < size; t++) {
            if (t !== keep && !remove(cell, t))
                return null;
        }
    }
    if (!propagate())
        return null;
    for (let cell = 0; cell < cells; cell++)
        reheap(cell);
    // ---- collapse ----
    for (;;) {
        const cell = heapPop();
        if (cell < 0)
            break;
        // Weighted pick over what is still possible; an all-zero-weight cell falls
        // back to a uniform pick so it still resolves.
        const total = sumW[cell] > 0 ? sumW[cell] : open[cell];
        const uniform = sumW[cell] <= 0;
        let roll = rng.random() * total;
        let chosen = -1;
        for (let t = 0; t < size; t++) {
            if (!wave[cell * size + t])
                continue;
            chosen = t;
            roll -= uniform ? 1 : weightAt(cell, t);
            if (roll <= 0)
                break;
        }
        if (chosen < 0)
            return null;
        for (let t = 0; t < size; t++) {
            if (t !== chosen && !remove(cell, t))
                return null;
        }
        if (!propagate())
            return null;
    }
    const out = makeGrid(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = y * width + x;
            let found = -1;
            for (let t = 0; t < size; t++) {
                if (wave[cell * size + t]) {
                    found = t;
                    break;
                }
            }
            if (found < 0)
                return null;
            out[y][x] = model.tiles[found];
        }
    }
    return out;
}
/** Regenerate a rectangular patch of an existing grid, keeping everything
 *  outside it and honouring the glyphs on the patch's border. Useful for
 *  "reroll this room" editor actions and for repairing a small broken area. */
export function resynthesize(grid, model, patch) {
    const width = cols(grid);
    const height = rows(grid);
    const x0 = Math.max(0, patch.x);
    const y0 = Math.max(0, patch.y);
    const x1 = Math.min(width, patch.x + patch.w);
    const y1 = Math.min(height, patch.y + patch.h);
    if (x1 <= x0 || y1 <= y0)
        return cloneGrid(grid);
    // Grow the synthesized area by one cell and pin that ring to what is already
    // there, so the patch meets its surroundings legally.
    const gx0 = Math.max(0, x0 - 1);
    const gy0 = Math.max(0, y0 - 1);
    const gx1 = Math.min(width, x1 + 1);
    const gy1 = Math.min(height, y1 + 1);
    const fixed = [];
    for (let y = gy0; y < gy1; y++) {
        for (let x = gx0; x < gx1; x++) {
            if (x >= x0 && x < x1 && y >= y0 && y < y1)
                continue;
            fixed.push([x - gx0, y - gy0, grid[y][x]]);
        }
    }
    const patched = synthesize(model, {
        cols: gx1 - gx0,
        rows: gy1 - gy0,
        seed: patch.seed,
        attempts: patch.attempts,
        fixed,
        edge: false, // the pinned ring already states what the surroundings are
    });
    const out = cloneGrid(grid);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++)
            out[y][x] = patched[y - gy0][x - gx0];
    }
    return out;
}
