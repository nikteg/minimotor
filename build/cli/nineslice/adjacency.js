// ---------- Socket inference over a tile sheet ----------
//
// `analyzeAutotile` checks a set whose layout you already know: you hand it the
// neighbour mask each tile answers and it verifies the pixels agree. That is the
// wrong way round for the common case, which is a sheet somebody downloaded
// whose layout convention nobody wrote down.
//
// This module goes the other way. It reads every tile's four edge strips,
// interns them, and lets the equivalence classes *be* the socket alphabet — the
// same step Wave Function Collapse calls adjacency extraction. The result is a
// `TileModel`-shaped `allowed[dir][a][b]` relation (see src/procgen/wfc.ts),
// derived from pixels with nothing declared.
//
// Two things fall straight out of that relation and need no solver:
//
//   * A tile with no legal neighbour on some side can never be placed there.
//     Usually that means orphan art, or a tile cut one pixel off its grid.
//   * How dense the relation is. A sheet whose tiles almost never match is not
//     necessarily broken — it may just be drawn with detailed edges that this
//     strict equality cannot see through. Density is reported so that reading
//     is available rather than assumed.
//
// The strictness is the known limit. Two tiles that abut perfectly well can have
// non-identical facing columns — dithering, anti-aliasing, deliberate variation.
// Equality finds the flat-boundary tilesets autotiling is usually built from and
// stays quiet about the rest, which is the safe direction to be wrong in.
import { cellRect, sockets } from "./tiles.js";
/** Direction indices match `TileModel.allowed` in src/procgen/wfc.ts. */
export const DIRECTIONS = ["up", "right", "down", "left"];
const isEmpty = (image, rect) => {
    for (let y = 0; y < rect.sh; y++) {
        for (let x = 0; x < rect.sw; x++) {
            if (image.data[((rect.sy + y) * image.width + rect.sx + x) * 4 + 3] !== 0)
                return false;
        }
    }
    return true;
};
/** Derive the adjacency relation of a tile sheet from its pixels alone.
 *
 *  Fully transparent cells are skipped: an empty cell is atlas padding, not a
 *  tile, and letting it join the alphabet makes every socket count meaningless. */
export function inferAdjacency(image, grid, size) {
    const nodes = [];
    for (let row = 0; row < size.rows; row++) {
        for (let column = 0; column < size.cols; column++) {
            const rect = cellRect(grid, column, row);
            if (rect.sx + rect.sw > image.width || rect.sy + rect.sh > image.height)
                continue;
            if (isEmpty(image, rect))
                continue;
            nodes.push({ column, row, rect, sockets: sockets(image, rect) });
        }
    }
    const n = nodes.length;
    const allowed = new Uint8Array(DIRECTIONS.length * n * n);
    const set = (dir, a, b) => {
        allowed[(dir * n + a) * n + b] = 1;
    };
    for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
            // `b` sits dir-ward of `a`, so the two strips that end up facing each
            // other have to name the same socket.
            if (nodes[b].sockets.south === nodes[a].sockets.north)
                set(0, a, b);
            if (nodes[a].sockets.east === nodes[b].sockets.west)
                set(1, a, b);
            if (nodes[a].sockets.south === nodes[b].sockets.north)
                set(2, a, b);
            if (nodes[b].sockets.east === nodes[a].sockets.west)
                set(3, a, b);
        }
    }
    const count = (side) => new Set(nodes.map((node) => node.sockets[side])).size;
    const pairs = Math.max(1, n * n);
    const density = {};
    DIRECTIONS.forEach((direction, dir) => {
        let total = 0;
        for (let i = 0; i < n * n; i++)
            total += allowed[dir * n * n + i];
        density[direction] = total / pairs;
    });
    return {
        nodes,
        allowed,
        alphabet: {
            north: count("north"),
            east: count("east"),
            south: count("south"),
            west: count("west"),
        },
        density,
    };
}
const OPPOSITE = {
    up: "north",
    right: "east",
    down: "south",
    left: "west",
};
/** Report what the inferred relation says about the sheet. */
export function adjacencyFindings(graph, name = "sheet") {
    const findings = [];
    const n = graph.nodes.length;
    if (n === 0) {
        return [
            {
                level: "error",
                region: name,
                code: "no-tiles",
                message: "every cell in the grid is fully transparent — check --grid against the atlas",
            },
        ];
    }
    // A sheet whose tiles almost never match is the signal that edge equality is
    // the wrong reading of this art, not that the art is broken. Say so once,
    // rather than emitting a dead-tile finding for every tile in the sheet.
    const sparse = DIRECTIONS.every((direction) => graph.density[direction] < 0.02);
    if (sparse) {
        findings.push({
            level: "info",
            region: name,
            code: "sparse-adjacency",
            message: `${n} tiles, but under 2% of tile pairs share a facing edge exactly ` +
                `(${DIRECTIONS.map((d) => `${d} ${(graph.density[d] * 100).toFixed(1)}%`).join(", ")}). ` +
                `This sheet's tiles most likely meet on detailed edges rather than flat ones, which ` +
                `exact socket matching cannot read — treat the dead-tile results below as unreliable.`,
        });
    }
    for (const direction of DIRECTIONS) {
        const dir = DIRECTIONS.indexOf(direction);
        const dead = [];
        for (let a = 0; a < n; a++) {
            let any = false;
            for (let b = 0; b < n && !any; b++)
                any = graph.allowed[(dir * n + a) * n + b] === 1;
            if (!any)
                dead.push(`${graph.nodes[a].column},${graph.nodes[a].row}`);
        }
        if (!dead.length)
            continue;
        findings.push({
            level: sparse ? "info" : "warning",
            region: name,
            code: "dead-side",
            message: `${dead.length} tile(s) present a ${OPPOSITE[direction]} edge no other tile in the sheet ` +
                `answers, so nothing may be placed ${direction} of them: ${dead.slice(0, 12).join(" ")}` +
                `${dead.length > 12 ? ` … and ${dead.length - 12} more` : ""}`,
        });
    }
    return findings;
}
/** Bridge the inferred relation into the engine's own WFC model, so a sheet can
 *  be handed to `synthesize` (src/procgen/wfc.ts) without any declared rules.
 *
 *  Glyphs come from the private use area purely to guarantee distinctness — a
 *  `TileModel` only requires that its tiles be distinct strings. */
export function toTileModel(graph) {
    return {
        tiles: graph.nodes.map((_, index) => String.fromCharCode(0xe000 + index)),
        weights: graph.nodes.map(() => 1),
        allowed: graph.allowed,
    };
}
