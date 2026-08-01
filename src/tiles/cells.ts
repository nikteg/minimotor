// ---------- Cell helpers ----------
// The small shared vocabulary the grid, the tileset and the Tiled importer all
// need: how a cell is blitted once orientation is taken into account, and the
// coordinate hash the seeded selectors use. The empty-glyph rule lives in
// `./glyphs`, which has no imports so `procgen` can share it.

import { blitPixelAligned } from "@src/engine/pixel-raster.js";
import type { Cell, CellOrientation, DualLayer } from "./types.js";

export const ONE_CELL = [1, 1] as const;

/** Blit one cell, honouring `Tiles.orient`'s flip/turn. The unoriented case is
 *  the hot path and goes straight to the pixel-snapping blit; oriented cells
 *  pay one save/restore, and a quarter-turn drops snapping (the rotated
 *  transform has no axis-aligned pixel grid to snap to). */
export function blitCell(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const turn = cell.turn ?? 0;
  if (turn === 0 && !cell.flipX && !cell.flipY) {
    blitPixelAligned(ctx, cell.image, cell.sx, cell.sy, cell.sw, cell.sh, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (turn !== 0) ctx.rotate((turn * Math.PI) / 2);
  ctx.scale(cell.flipX ? -1 : 1, cell.flipY ? -1 : 1);
  // An odd quarter-turn swaps the axes, so draw h×w to land a w×h footprint.
  const dw = turn % 2 === 0 ? w : h;
  const dh = turn % 2 === 0 ? h : w;
  blitPixelAligned(ctx, cell.image, cell.sx, cell.sy, cell.sw, cell.sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/** Is this skin value a dual-grid layer rather than a plain cell? */
export function isDualLayer(value: Cell | DualLayer): value is DualLayer {
  return typeof (value as DualLayer).dual === "function";
}

/** Mirror/rotate a cell at draw time. Returns a new `Cell`; the source rect is
 *  untouched, so it composes with `region`, `pick`, LDtk and Tiled cells alike.
 *
 *      const rightRamp = ts.ramp;
 *      const leftRamp = Tiles.orient(ts.ramp, { flipX: true });
 */
export function orient(cell: Cell, opts: CellOrientation): Cell {
  const turn = (((opts.turn ?? 0) + (cell.turn ?? 0)) % 4) as 0 | 1 | 2 | 3;
  return {
    ...cell,
    flipX: (opts.flipX ?? false) !== (cell.flipX ?? false),
    flipY: (opts.flipY ?? false) !== (cell.flipY ?? false),
    turn,
  };
}

/** Deterministic hash of cell coords → [0, 1) — integer multiply-xor
 *  avalanche, far cheaper than the old Math.sin trick and just as stable. */
export function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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
