import type { Finding, Rect } from "./analyze.js";
import type { Pixels } from "./png.js";
import { type Grid, type Sockets } from "./tiles.js";
/** Direction indices match `TileModel.allowed` in src/procgen/wfc.ts. */
export declare const DIRECTIONS: readonly ["up", "right", "down", "left"];
export type Direction = (typeof DIRECTIONS)[number];
export interface TileNode {
    column: number;
    row: number;
    rect: Rect;
    sockets: Sockets;
}
export interface TileGraph {
    nodes: TileNode[];
    /** `allowed[(dir * n + a) * n + b]` is 1 when tile `b` may sit `dir`-ward of
     *  tile `a`, with dir indexing `DIRECTIONS`. */
    allowed: Uint8Array;
    /** How many distinct sockets each side presents across the sheet. */
    alphabet: Record<keyof Sockets, number>;
    /** Fraction of ordered tile pairs that may abut, per direction. */
    density: Record<Direction, number>;
}
/** Derive the adjacency relation of a tile sheet from its pixels alone.
 *
 *  Fully transparent cells are skipped: an empty cell is atlas padding, not a
 *  tile, and letting it join the alphabet makes every socket count meaningless. */
export declare function inferAdjacency(image: Pixels, grid: Grid, size: {
    cols: number;
    rows: number;
}): TileGraph;
/** Report what the inferred relation says about the sheet. */
export declare function adjacencyFindings(graph: TileGraph, name?: string): Finding[];
/** Bridge the inferred relation into the engine's own WFC model, so a sheet can
 *  be handed to `synthesize` (src/procgen/wfc.ts) without any declared rules.
 *
 *  Glyphs come from the private use area purely to guarantee distinctness — a
 *  `TileModel` only requires that its tiles be distinct strings. */
export declare function toTileModel(graph: TileGraph): {
    tiles: string[];
    weights: number[];
    allowed: Uint8Array;
};
