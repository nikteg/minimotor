// ---------- Room layouts ----------
// Two classic, deterministic layout generators. Neither is clever, and that is
// the point: rooms and corridors are STRUCTURE, and structure is much easier to
// get right by construction than to find by search.
//
//   `rooms`  — recursive binary-space partition; one room per leaf, siblings
//              joined by an L corridor. Predictable, always connected.
//   `chunks` — hand-authored room templates stitched on a coarse grid with a
//              guaranteed path carved through them (the Spelunky method).
//              A human authored every tile the player sees.
import { createRng } from "../rng/index.js";
import { asGrid, cols, fillRect, makeGrid, put, rows, } from "./grid.js";
/** Carve BSP rooms joined by L-shaped corridors. Always fully connected. */
export function rooms(options) {
    const width = options.cols;
    const height = options.rows;
    const wall = options.wall ?? "#";
    const floor = options.floor ?? ".";
    const minPartition = options.minPartition ?? 8;
    const minRoom = options.minRoom ?? 3;
    const maxDepth = options.maxDepth ?? 5;
    const rng = createRng(options.seed ?? 0);
    const grid = makeGrid(width, height, wall);
    const placed = [];
    const links = [];
    /** Split a partition, or place a room in it, and return that room. */
    const split = (area, depth) => {
        const canSplitX = area.w >= minPartition * 2;
        const canSplitY = area.h >= minPartition * 2;
        if (depth < maxDepth && (canSplitX || canSplitY)) {
            // Split the longer axis, with a jittered cut so rooms differ in size.
            const vertical = canSplitX && (!canSplitY || area.w >= area.h);
            const span = vertical ? area.w : area.h;
            const cut = rng.integer(minPartition, span - minPartition);
            const first = vertical
                ? { x: area.x, y: area.y, w: cut, h: area.h }
                : { x: area.x, y: area.y, w: area.w, h: cut };
            const second = vertical
                ? { x: area.x + cut, y: area.y, w: area.w - cut, h: area.h }
                : { x: area.x, y: area.y + cut, w: area.w, h: area.h - cut };
            const a = split(first, depth + 1);
            const b = split(second, depth + 1);
            corridor(grid, a, b, floor);
            links.push([a.id, b.id]);
            return rng.random() < 0.5 ? a : b;
        }
        // Leaf: inset a room, leaving at least one cell of rock on every side.
        const maxW = Math.max(minRoom, area.w - 2);
        const maxH = Math.max(minRoom, area.h - 2);
        const w = Math.min(maxW, rng.integer(minRoom, Math.max(minRoom, maxW)));
        const h = Math.min(maxH, rng.integer(minRoom, Math.max(minRoom, maxH)));
        const x = area.x + 1 + rng.integer(0, Math.max(0, area.w - w - 2));
        const y = area.y + 1 + rng.integer(0, Math.max(0, area.h - h - 2));
        const room = {
            id: placed.length,
            x,
            y,
            w,
            h,
            cx: x + (w >> 1),
            cy: y + (h >> 1),
        };
        fillRect(grid, room, floor);
        placed.push(room);
        return room;
    };
    split({ x: 0, y: 0, w: width, h: height }, 0);
    return { grid, rooms: placed, links };
}
/** Dig an L corridor between two room centres — across, then down. */
function corridor(grid, a, b, floor) {
    const stepX = Math.sign(b.cx - a.cx);
    const stepY = Math.sign(b.cy - a.cy);
    let x = a.cx;
    let y = a.cy;
    while (x !== b.cx) {
        put(grid, x, y, floor);
        x += stepX;
    }
    while (y !== b.cy) {
        put(grid, x, y, floor);
        y += stepY;
    }
    put(grid, x, y, floor);
}
/** Stitch hand-authored templates on a coarse grid and carve a guaranteed path
 *  through them: a drunkard's walk from a random top chunk to the bottom row,
 *  opening a doorway wherever the path crosses a chunk boundary.
 *
 *  Everything the player sees was drawn by a person; only the arrangement and
 *  the doorways are generated. That is why it holds up better than most
 *  fully-generated layouts. */
export function chunks(options) {
    if (options.templates.length === 0) {
        throw new Error("Procgen.chunks: at least one template is required");
    }
    const templates = options.templates.map((template) => asGrid(template));
    const tw = cols(templates[0]);
    const th = rows(templates[0]);
    for (const template of templates) {
        if (cols(template) !== tw || rows(template) !== th) {
            throw new Error("Procgen.chunks: every template must be the same size");
        }
    }
    if (tw < 3 || th < 3)
        throw new Error("Procgen.chunks: templates must be at least 3×3");
    const across = options.cols;
    const down = options.rows;
    const floor = options.floor ?? ".";
    const rng = createRng(options.seed ?? 0);
    const grid = makeGrid(across * tw, down * th, options.offPath ?? floor);
    // ---- walk the solution path: wander sideways, drop a row, repeat ----
    const path = [];
    let cx = rng.integer(0, across - 1);
    for (let cy = 0; cy < down; cy++) {
        path.push({ x: cx, y: cy });
        if (cy === down - 1)
            break;
        // Sidesteps before dropping, never revisiting a chunk on this row.
        const steps = rng.integer(0, Math.max(0, across - 1));
        const direction = rng.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < steps; i++) {
            const next = cx + direction;
            if (next < 0 || next >= across)
                break;
            cx = next;
            path.push({ x: cx, y: cy });
        }
    }
    const onPath = new Set(path.map((chunk) => `${chunk.x},${chunk.y}`));
    for (let cy = 0; cy < down; cy++) {
        for (let cx2 = 0; cx2 < across; cx2++) {
            if (options.offPath !== undefined && !onPath.has(`${cx2},${cy}`))
                continue;
            stamp(grid, rng.choose(templates), cx2 * tw, cy * th);
        }
    }
    // ---- carve the guaranteed path, centre to centre ----
    // Punching a hole in the shared wall is not enough: a template's interior may
    // not reach that hole (a pillar right behind it, say). Carving all the way
    // between chunk centres opens the doorway AND the run up to it, so the path
    // is walkable whatever the templates look like.
    for (let i = 1; i < path.length; i++) {
        const from = centreOf(path[i - 1], tw, th);
        const to = centreOf(path[i], tw, th);
        const stepX = Math.sign(to.x - from.x);
        const stepY = Math.sign(to.y - from.y);
        let x = from.x;
        let y = from.y;
        put(grid, x, y, floor);
        while (x !== to.x) {
            x += stepX;
            put(grid, x, y, floor);
        }
        while (y !== to.y) {
            y += stepY;
            put(grid, x, y, floor);
        }
    }
    const entrance = centreOf(path[0], tw, th);
    const exit = centreOf(path[path.length - 1], tw, th);
    put(grid, entrance.x, entrance.y, options.entrance ?? "S");
    put(grid, exit.x, exit.y, options.exit ?? "E");
    return { grid, path, entrance, exit };
}
/** The cell at the centre of a chunk. */
function centreOf(chunk, tw, th) {
    return { x: chunk.x * tw + (tw >> 1), y: chunk.y * th + (th >> 1) };
}
/** Copy a template into the grid at a cell offset. */
function stamp(grid, template, x0, y0) {
    for (let y = 0; y < template.length; y++) {
        for (let x = 0; x < template[y].length; x++)
            put(grid, x0 + x, y0 + y, template[y][x]);
    }
}
/** The bounds of a room, for callers that want to place content inside it. */
export function roomBounds(room) {
    return { x: room.x, y: room.y, w: room.w, h: room.h };
}
