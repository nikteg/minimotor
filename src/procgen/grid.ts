// ---------- Char grids ----------
// Every generator in this module speaks ONE currency: a rectangular array of
// glyph strings, exactly what `Tiles.grid` already accepts as a level source.
// Nothing here touches a canvas, so generation runs identically in a browser,
// in Node behind the `mm` CLI, and on a server.

// The empty-glyph rule is `Tiles.grid`'s to define, so it is imported rather
// than restated. `@src/tiles/glyphs` has no imports of its own, so this costs
// nothing at runtime and keeps procgen canvas-free.
import { EMPTY } from "@src/tiles/glyphs.js";

export { EMPTY };

/** A rectangular grid of legend glyphs — `grid[y][x]`. */
export type CharGrid = string[][];

/** A rectangular region in TILE coordinates (not world px). */
export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Column count of a grid (0 for an empty one). */
export function cols(grid: CharGrid): number {
  return grid[0]?.length ?? 0;
}

/** Row count of a grid. */
export function rows(grid: CharGrid): number {
  return grid.length;
}

/** A `cols`×`rows` grid filled with one glyph. */
export function makeGrid(width: number, height: number, fill: string = EMPTY): CharGrid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Procgen: grid size must be positive integers");
  }
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

/** An independent copy — generators never mutate their input. */
export function cloneGrid(grid: CharGrid): CharGrid {
  return grid.map((row) => row.slice());
}

/** The glyph at (x, y), or `outside` beyond the edges. */
export function at(grid: CharGrid, x: number, y: number, outside: string = EMPTY): string {
  if (y < 0 || y >= grid.length) return outside;
  const row = grid[y];
  if (x < 0 || x >= row.length) return outside;
  return row[x];
}

/** Write a glyph, ignoring writes outside the grid. */
export function put(grid: CharGrid, x: number, y: number, glyph: string): void {
  if (y < 0 || y >= grid.length) return;
  if (x < 0 || x >= grid[y].length) return;
  grid[y][x] = glyph;
}

/** Fill a tile rect, clipped to the grid. */
export function fillRect(grid: CharGrid, rect: CellRect, glyph: string): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) put(grid, x, y, glyph);
  }
}

/** Render a grid as newline-joined text — the form `Tiles.grid` parses, and the
 *  form the CLI writes to disk. Only safe for single-character glyphs. */
export function toText(grid: CharGrid): string {
  return grid.map((row) => row.join("")).join("\n");
}

/** Parse newline-separated text back into a grid, padding short rows with
 *  `EMPTY` so the result is rectangular. Leading and trailing blank lines are
 *  dropped, matching `Tiles.grid`'s own parsing. */
export function fromText(text: string): CharGrid {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return lines.map((line) =>
    Array.from({ length: width }, (_, x) => (x < line.length ? line[x] : EMPTY)),
  );
}

/** Accept either form wherever a sample or template is taken. */
export function asGrid(source: CharGrid | string): CharGrid {
  return typeof source === "string" ? fromText(source) : cloneGrid(source);
}

/** Every distinct glyph, in first-seen (row-major) order so results are stable
 *  across runs and machines. */
export function glyphs(grid: CharGrid): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of grid) {
    for (const glyph of row) {
      if (seen.has(glyph)) continue;
      seen.add(glyph);
      out.push(glyph);
    }
  }
  return out;
}
