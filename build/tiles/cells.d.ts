import type { Cell, CellOrientation, DualLayer } from "./types.js";
export declare const ONE_CELL: readonly [1, 1];
/** Blit one cell, honouring `Tiles.orient`'s flip/turn. The unoriented case is
 *  the hot path and goes straight to the pixel-snapping blit; oriented cells
 *  pay one save/restore, and a quarter-turn drops snapping (the rotated
 *  transform has no axis-aligned pixel grid to snap to). */
export declare function blitCell(ctx: CanvasRenderingContext2D, cell: Cell, x: number, y: number, w: number, h: number): void;
/** Is this skin value a dual-grid layer rather than a plain cell? */
export declare function isDualLayer(value: Cell | DualLayer): value is DualLayer;
/** Mirror/rotate a cell at draw time. Returns a new `Cell`; the source rect is
 *  untouched, so it composes with `region`, `pick`, LDtk and Tiled cells alike.
 *
 *      const rightRamp = ts.ramp;
 *      const leftRamp = Tiles.orient(ts.ramp, { flipX: true });
 */
export declare function orient(cell: Cell, opts: CellOrientation): Cell;
/** Deterministic hash of cell coords → [0, 1) — integer multiply-xor
 *  avalanche, far cheaper than the old Math.sin trick and just as stable. */
export declare function cellHash(cx: number, cy: number): number;
/** Parse an ASCII grid into a level — the string IS the level file. Legend
 *  glyphs carry semantics only (`solid`, `oneWay`, `slope`, `tags` — plain
 *  JSON facts). A multi-character glyph consumes that many horizontal cells
 *  and infers its span width, so `"//"` can draw a two-cell slope. Longest
 *  glyph wins. `"."` and space are empty; any OTHER single character is a
 *  spawn marker you query with `spawns`/`spawnOne`. The result is pure data: paint it with
 *  `Draw.tiles(level, skin)`, collide against it with
 *  `Collision.moveAndSlide(player, level)` (it's a `SolidSource`).
 *
 *      const level = Tiles.grid(`
 *        P.....
 *        ..--..
 *        ######
 *      `, { size: 16, legend: { "#": { solid: true }, "-": { oneWay: true } } });
 *      const start = level.spawnOne("P"); // tile-center Vec2 of the P marker
 */
