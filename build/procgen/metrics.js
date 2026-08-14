// ---------- Level metrics ----------
// Pure numbers describing a char grid. They exist so generation can be AIMED:
// a fitness function for `illuminate`, a behaviour descriptor for a MAP-Elites
// axis, a target for `steer`, or just an assertion in a test ("no seed of this
// generator may produce a level under 40 steps long").
//
// All of these are cheap and exact. Nothing here runs a game — a metric only
// knows what is visible in the grid.
import { cols, rows } from "./grid.js";
/** Bit-per-cell walkability mask; the shared basis of every metric below. */
function walkableMask(grid, options) {
    const width = cols(grid);
    const height = rows(grid);
    const walkable = new Set([options.floor ?? ".", ...(options.alsoWalkable ?? [])]);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++)
            mask[y * width + x] = walkable.has(grid[y][x]) ? 1 : 0;
    }
    return mask;
}
/** Four-way BFS over walkable cells. Returns step distance from the sources,
 *  or -1 for unreachable cells. Typed arrays throughout: MAP-Elites calls this
 *  thousands of times. */
function bfs(mask, width, height, sources) {
    const dist = new Int32Array(mask.length).fill(-1);
    const queue = new Int32Array(mask.length);
    let tail = 0;
    for (const source of sources) {
        if (source < 0 || source >= mask.length || !mask[source] || dist[source] >= 0)
            continue;
        dist[source] = 0;
        queue[tail++] = source;
    }
    for (let head = 0; head < tail; head++) {
        const cell = queue[head];
        const cx = cell % width;
        const cy = (cell / width) | 0;
        if (cx > 0)
            tail = visit(cell - 1, cell, dist, mask, queue, tail);
        if (cx < width - 1)
            tail = visit(cell + 1, cell, dist, mask, queue, tail);
        if (cy > 0)
            tail = visit(cell - width, cell, dist, mask, queue, tail);
        if (cy < height - 1)
            tail = visit(cell + width, cell, dist, mask, queue, tail);
    }
    return dist;
}
function visit(next, from, dist, mask, queue, tail) {
    if (!mask[next] || dist[next] >= 0)
        return tail;
    dist[next] = dist[from] + 1;
    queue[tail] = next;
    return tail + 1;
}
/** Fraction of the grid held by each glyph — the frequencies `steer` targets. */
export function frequencies(grid) {
    const total = cols(grid) * rows(grid);
    const counts = {};
    for (const row of grid) {
        for (const glyph of row)
            counts[glyph] = (counts[glyph] ?? 0) + 1;
    }
    for (const glyph of Object.keys(counts))
        counts[glyph] /= total;
    return counts;
}
/** Fraction of the grid that is walkable at all. 0 is solid rock, 1 an
 *  empty field. Most playable levels land between 0.25 and 0.55. */
export function openness(grid, options = {}) {
    const mask = walkableMask(grid, options);
    let open = 0;
    for (let i = 0; i < mask.length; i++)
        open += mask[i];
    return mask.length === 0 ? 0 : open / mask.length;
}
/** Fraction of walkable cells reachable from the largest region. 1 means the
 *  level is fully connected; 0.6 means two fifths of it is stranded. */
export function reachableFraction(grid, options = {}) {
    const width = cols(grid);
    const height = rows(grid);
    const mask = walkableMask(grid, options);
    let total = 0;
    for (let i = 0; i < mask.length; i++)
        total += mask[i];
    if (total === 0)
        return 0;
    const visited = new Uint8Array(mask.length);
    let largest = 0;
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || visited[start])
            continue;
        const dist = bfs(mask, width, height, [start]);
        let count = 0;
        for (let i = 0; i < dist.length; i++) {
            if (dist[i] >= 0) {
                visited[i] = 1;
                count++;
            }
        }
        if (count > largest)
            largest = count;
    }
    return largest / total;
}
/** The longest walk in the level, in steps — its "how big does this feel"
 *  number. Computed by the standard double sweep (farthest cell from anywhere,
 *  then farthest cell from that), which is exact on tree-shaped layouts and a
 *  tight lower bound on looping ones. */
export function longestPath(grid, options = {}) {
    const width = cols(grid);
    const height = rows(grid);
    const mask = walkableMask(grid, options);
    let first = -1;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            first = i;
            break;
        }
    }
    if (first < 0)
        return 0;
    const away = bfs(mask, width, height, [first]);
    let far = first;
    for (let i = 0; i < away.length; i++)
        if (away[i] > away[far])
            far = i;
    const back = bfs(mask, width, height, [far]);
    let longest = 0;
    for (let i = 0; i < back.length; i++)
        if (back[i] > longest)
            longest = back[i];
    return longest;
}
/** Step distance between two cells, or `Infinity` when there is no route.
 *  This is the check to fail a level on, not a metric to optimize. */
export function pathLength(grid, from, to, options = {}) {
    const width = cols(grid);
    const height = rows(grid);
    const mask = walkableMask(grid, options);
    const dist = bfs(mask, width, height, [from.y * width + from.x]);
    const found = dist[to.y * width + to.x];
    return found === undefined || found < 0 ? Infinity : found;
}
/** Fraction of walkable cells that are corridor — exactly two open neighbours.
 *  High means twisty passages, low means open halls. A good MAP-Elites axis:
 *  it separates levels that play very differently at the same openness. */
export function corridorRatio(grid, options = {}) {
    const width = cols(grid);
    const height = rows(grid);
    const mask = walkableMask(grid, options);
    let open = 0;
    let corridor = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!mask[y * width + x])
                continue;
            open++;
            if (neighbours(mask, width, height, x, y) === 2)
                corridor++;
        }
    }
    return open === 0 ? 0 : corridor / open;
}
/** Walkable cells with exactly one open neighbour — cul-de-sacs. Somewhere to
 *  put treasure; too many and the level reads as a maze of chores. */
export function deadEnds(grid, options = {}) {
    const width = cols(grid);
    const height = rows(grid);
    const mask = walkableMask(grid, options);
    let count = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask[y * width + x] && neighbours(mask, width, height, x, y) === 1)
                count++;
        }
    }
    return count;
}
function neighbours(mask, width, height, x, y) {
    let open = 0;
    if (y > 0 && mask[(y - 1) * width + x])
        open++;
    if (x < width - 1 && mask[y * width + x + 1])
        open++;
    if (y < height - 1 && mask[(y + 1) * width + x])
        open++;
    if (x > 0 && mask[y * width + x - 1])
        open++;
    return open;
}
/** How mirror-symmetric the grid is left-to-right, from 0 to 1. Useful as a
 *  descriptor when you want a spread from "organic cave" to "built temple". */
export function symmetry(grid) {
    const width = cols(grid);
    const height = rows(grid);
    if (width === 0 || height === 0)
        return 1;
    let same = 0;
    let total = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width >> 1; x++) {
            total++;
            if (grid[y][x] === grid[y][width - 1 - x])
                same++;
        }
    }
    return total === 0 ? 1 : same / total;
}
/** Measure a grid once and hand back the whole set — the convenient input to
 *  a fitness function. */
export function measure(grid, options = {}) {
    return {
        openness: openness(grid, options),
        reachable: reachableFraction(grid, options),
        longestPath: longestPath(grid, options),
        corridorRatio: corridorRatio(grid, options),
        deadEnds: deadEnds(grid, options),
        symmetry: symmetry(grid),
        frequencies: frequencies(grid),
    };
}
