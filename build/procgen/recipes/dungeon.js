// ---------- Recipe: the locked-door dungeon ----------
// A RECIPE, not a primitive. Everything under `recipes/` encodes one game's
// conventions, and this one encodes a very specific and very old convention:
// you enter here, the way on is locked, the key is down that side branch, the
// exit is the far end.
//
// That is a genre, not a technique, which is exactly why it lives out here
// rather than beside `caves` and `synthesize`. The reusable half — "which room
// is the far end, what is the route, what hangs off it" — is `../graph`, and
// this file is only the part that decides those things mean a door and a key.
//
// Copy it and change your mind about any of it. It is roughly ninety lines and
// it calls nothing private.
import { createRng } from "../../rng/index.js";
import { put } from "../grid.js";
import { rooms } from "../rooms.js";
import { branchesBefore, topology } from "../graph.js";
/** Generate a dungeon with a real progression: entrance, critical path, locked
 *  doors with keys placed before them, side branches and a few loops.
 *
 *      const dungeon = Procgen.dungeon({ cols: 64, rows: 48, seed: 7, locks: 2 });
 *      const level = Tiles.grid(dungeon.grid, { size: 16, legend });
 */
export function dungeon(options) {
    const rng = createRng(options.seed ?? 0);
    const wall = options.wall ?? "#";
    const floor = options.floor ?? ".";
    const layout = rooms({
        cols: options.cols,
        rows: options.rows,
        seed: options.seed,
        minPartition: options.minPartition,
        minRoom: options.minRoom,
        maxDepth: options.maxDepth,
        wall,
        floor,
    });
    const grid = layout.grid;
    const placed = layout.rooms;
    const links = layout.links.slice();
    if (placed.length < 2) {
        const only = placed[0];
        return {
            grid,
            rooms: placed,
            links,
            critical: only ? [0] : [],
            entrance: only,
            exit: only,
            locks: [],
        };
    }
    // ---- extra edges, so the graph has loops rather than being a pure tree ----
    const extra = Math.round((options.loops ?? 0.15) * placed.length);
    for (let i = 0; i < extra; i++) {
        const a = rng.integer(0, placed.length - 1);
        const nearest = nearestRoom(placed, a, links);
        if (nearest < 0)
            continue;
        links.push([a, nearest]);
        carveCorridor(grid, placed[a], placed[nearest], floor);
    }
    // ---- entrance and exit: the graph's two most distant rooms ----
    const shape = topology(placed.length, links);
    const critical = shape.main;
    const entrance = placed[shape.start];
    const exit = placed[shape.end];
    put(grid, entrance.cx, entrance.cy, options.entrance ?? "S");
    put(grid, exit.cx, exit.cy, options.exit ?? "E");
    // ---- locks: a door on the critical path, its key on a branch before it ----
    const locks = [];
    const wanted = options.locks ?? 1;
    // Which critical-path steps are still available to lock. Skip the very first
    // step: the player needs somewhere to look for the key.
    const steps = [];
    for (let i = 1; i < critical.length; i++)
        steps.push(i);
    shuffleInPlace(steps, rng);
    const usedKeyRooms = new Set([shape.start, shape.end]);
    for (const step of steps) {
        if (locks.length >= wanted)
            break;
        const before = critical[step - 1];
        const after = critical[step];
        // The key must be reachable WITHOUT passing the door, so look for a branch
        // room hanging off the critical path strictly before this step.
        const candidates = branchesBefore(shape, step, usedKeyRooms);
        if (candidates.length === 0)
            continue;
        const keyRoom = candidates[rng.integer(0, candidates.length - 1)];
        usedKeyRooms.add(keyRoom);
        // The door goes on the corridor cell where it leaves the earlier room.
        const at = doorCell(placed[before], placed[after]);
        put(grid, at.x, at.y, options.door ?? "D");
        const keyAt = { x: placed[keyRoom].cx, y: placed[keyRoom].cy };
        put(grid, keyAt.x, keyAt.y, options.key ?? "k");
        locks.push({ between: [before, after], at, keyRoom, keyAt });
    }
    return { grid, rooms: placed, links, critical, entrance, exit, locks };
}
/** Nearest room to `from` that it is not already linked to. */
function nearestRoom(placed, from, links) {
    const linked = new Set([from]);
    for (const [a, b] of links) {
        if (a === from)
            linked.add(b);
        if (b === from)
            linked.add(a);
    }
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < placed.length; i++) {
        if (linked.has(i))
            continue;
        const dist = Math.abs(placed[i].cx - placed[from].cx) + Math.abs(placed[i].cy - placed[from].cy);
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}
/** Where a door should sit on the corridor leaving `from` toward `to`: one step
 *  outside the earlier room, on the leg the corridor actually starts with. */
function doorCell(from, to) {
    const stepX = Math.sign(to.cx - from.cx);
    if (stepX !== 0) {
        const edge = stepX > 0 ? from.x + from.w : from.x - 1;
        return { x: edge, y: from.cy };
    }
    const stepY = Math.sign(to.cy - from.cy);
    const edge = stepY > 0 ? from.y + from.h : from.y - 1;
    return { x: from.cx, y: edge };
}
function carveCorridor(grid, a, b, floor) {
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
function shuffleInPlace(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = rng.integer(0, i);
        [items[i], items[j]] = [items[j], items[i]];
    }
}
/** The marker glyphs `dungeon` writes, as the "also walkable" list every
 *  downstream pass needs. `repair` and `measure` must treat these as floor or
 *  the guarantee would happily wall the exit in. */
export const DUNGEON_MARKERS = { alsoWalkable: ["S", "E", "D", "k"] };
