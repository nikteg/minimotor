import { type CharGrid } from "../grid.js";
import { type Room } from "../rooms.js";
export interface DungeonOptions {
    /** Grid width in cells. */
    cols: number;
    /** Grid height in cells. */
    rows: number;
    /** Seed for layout, locks and keys. */
    seed?: number;
    /** Locked doors to place along the critical path. Default 1. Each needs a
     *  branch room before it to hide the key in; extras are dropped silently
     *  when the layout has no room for them (reported in `result.locks`). */
    locks?: number;
    /** Extra non-tree corridors to add, as a fraction of the room count.
     *  Default 0.15 — enough for a loop or two. */
    loops?: number;
    /** Glyph for solid rock. Default "#". */
    wall?: string;
    /** Glyph for floor. Default ".". */
    floor?: string;
    /** Marker glyph for the entrance. Default "S". */
    entrance?: string;
    /** Marker glyph for the exit. Default "E". */
    exit?: string;
    /** Glyph for a locked door. Default "D". */
    door?: string;
    /** Glyph for a key. Default "k". */
    key?: string;
    /** Passed through to `rooms`. */
    minPartition?: number;
    minRoom?: number;
    maxDepth?: number;
}
/** One locked door and the room its key sits in. */
export interface Lock {
    /** The corridor the door blocks, as a room-index pair. */
    between: readonly [number, number];
    /** Cell the door glyph was written to. */
    at: {
        x: number;
        y: number;
    };
    /** Room index holding the key. */
    keyRoom: number;
    /** Cell the key glyph was written to. */
    keyAt: {
        x: number;
        y: number;
    };
}
export interface DungeonResult {
    grid: CharGrid;
    rooms: Room[];
    /** Every corridor, as room-index pairs. */
    links: Array<readonly [number, number]>;
    /** Room indices from entrance to exit, in order. */
    critical: number[];
    entrance: Room;
    exit: Room;
    locks: Lock[];
}
/** Generate a dungeon with a real progression: entrance, critical path, locked
 *  doors with keys placed before them, side branches and a few loops.
 *
 *      const dungeon = Procgen.dungeon({ cols: 64, rows: 48, seed: 7, locks: 2 });
 *      const level = Tiles.grid(dungeon.grid, { size: 16, legend });
 */
export declare function dungeon(options: DungeonOptions): DungeonResult;
/** The marker glyphs `dungeon` writes, as the "also walkable" list every
 *  downstream pass needs. `repair` and `measure` must treat these as floor or
 *  the guarantee would happily wall the exit in. */
export declare const DUNGEON_MARKERS: {
    readonly alsoWalkable: readonly ["S", "E", "D", "k"];
};
