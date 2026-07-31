// ---------- Tiles ----------
// Three clean layers:
//
//   LEVEL = DATA.  `Tiles.grid(ascii, { size, legend })` — the ASCII grid IS
//   the source file. Legend glyphs are tiles with SEMANTICS ONLY (solid,
//   oneWay, slope, ladder, multi-cell span — plain JSON facts); "." and " "
//   are empty; any other char is a spawn MARKER the game queries (`spawns`,
//   `spawnOne`). The whole level definition is serializable and collides
//   server-side (no canvas anywhere).
//
//   TILESET = NAMED CELLS.  `Tiles.set(image, { size, names })` — the
//   space-indexed cousin of `Anim.fromGrid`, plus cell SELECTORS: `pick`
//   (coord-seeded variants), `anim` (clock-derived water), `auto9`/`auto16`
//   (neighbor-aware autotiling).
//
//   SKIN = THE OPTIONAL JOIN, AT THE DRAW SITE. A semantic grid uses a plain
//   `{ key: color | cell | selector | null }` map, allowing themes/minimaps.
//   An authored LDtk Tile/AutoLayer already owns its pixels and renders
//   directly with `Draw.tiles(layer)`.
//
// The level is a `SolidSource`: `Collision.moveAndSlide(player, level)` gets
// grid broadphase for free.

import type { DrawTilesOptions, Rect } from "@src/engine/index.js";
import { blitPixelAligned, fillPixelAligned } from "@src/engine/pixel-raster.js";
import type { LadderSource, SlopeDirection, Solid, SolidSource } from "@src/collision/index.js";
import type { PortalTransition } from "@src/portals/index.js";
import type { Vec2 } from "@src/math/vec2.js";
import type { ClockHandle } from "@src/clock/index.js";

/** Semantics of one legend glyph — plain JSON facts, no presentation. */
export interface TileSpec {
  /** Blocks movement (a `Solid` for slide/moveAndSlide). */
  solid?: boolean;
  /** Land on top, pass through from below/sides. */
  oneWay?: boolean;
  /** Walkable diagonal surface across this tile. */
  slope?: SlopeDirection;
  /** Climbable region; queried by `Collision.climbLadder`. The exposed top of
   *  each connected ladder automatically acts as a one-way standing surface. */
  ladder?: boolean;
  /** Set `false` when an exposed ladder top should not create its automatic
   *  one-way standing surface. Default true. */
  ladderTop?: boolean;
  /** Multi-cell semantic footprint `[columns, rows]`. This ASCII cell is its
   *  top-left anchor and the covered cells must be empty. It also defines a
   *  slope's ratio: `[2, 1]` is shallow, `[1, 1]` is a 45° ramp, and taller
   *  custom ratios remain possible. Default `[1, 1]`. */
  span?: readonly [columns: number, rows: number];
}

/** Options for `grid()` (exported as `Tiles.GridOptions`): tile `size` and char `legend`. */
export interface GridOptions<L extends Record<string, TileSpec>> {
  /** World size of one tile, in px. */
  size: number;
  /** glyph → semantics. Unknown single characters are spawn markers; "." and
   *  space are empty. Multi-character glyphs use longest-match parsing. */
  legend: L;
}

/** A level: pure data + queries. Rendering lives in `Draw.tiles`. */
export interface Level<C extends string = string> extends SolidSource, LadderSource {
  /** Tile size in px. */
  readonly size: number;
  /** Grid width in tiles. */
  readonly cols: number;
  /** Grid height in tiles. */
  readonly rows: number;
  /** The world rect (`cols*size` × `rows*size` at origin) — feed it to
   *  `Camera.follow({ world })` and `Vec2.clampRect`. */
  readonly rect: Rect;
  /** The legend glyph at its anchor cell ("." when covered, empty, or outside). */
  at(cx: number, cy: number): string;
  /** Semantic footprint for a legend glyph, including inferred glyph width. */
  span(char: string): readonly [columns: number, rows: number];
  /** Rewrite a cell (breakable blocks, doors). null/"." clears it. */
  set(cx: number, cy: number, char: C | string | null): void;
  /** Tile-center positions of every occurrence of a marker char. */
  spawns(char: string): Vec2[];
  /** The single occurrence of a marker char (throws when absent). */
  spawnOne(char: string): Vec2;
  /** Is the world point inside a solid tile? */
  solidAt(x: number, y: number): boolean;
  /** Is the world point inside a ladder tile? */
  ladderAt(x: number, y: number): boolean;
  /** SolidSource: appends the solid tiles near `area` into `out`. The rects
   *  are pooled — valid until the next call. */
  solidsNear(area: Rect, out: Solid[]): Solid[];
  /** LadderSource: appends ladder tiles near `area` to `out`. Rects are pooled
   * and valid until the next call. */
  laddersNear(area: Rect, out: Rect[]): Rect[];
  /** Renderer channel — call `Draw.tiles(level, skin)` instead. `opts.bake`
   *  blits a whole-level baked canvas for static layers (see
   *  `DrawTilesOptions`). */
  render(ctx: CanvasRenderingContext2D, skin: Skin<Level<C>>, opts?: DrawTilesOptions): void;
  /** Drop the baked layer (see `Draw.tiles`' `bake`) — call after changing
   *  the skin's underlying image or mutating cells. `set()` does it for you. */
  invalidate(): void;
  /** The legend (read-only semantics lookup). */
  readonly legend: Record<string, TileSpec>;
}

/** A resolved source cell of a tileset image. */
export interface Cell {
  /** The tileset image this cell is cut from. */
  image: CanvasImageSource;
  /** Source sub-rect x in `image`, px. */
  sx: number;
  /** Source sub-rect y in `image`, px. */
  sy: number;
  /** Source sub-rect width in `image`, px. */
  sw: number;
  /** Source sub-rect height in `image`, px. */
  sh: number;
  /** Destination width in level cells. Present on `TileSet.region(...)`. */
  cols?: number;
  /** Destination height in level cells. Present on `TileSet.region(...)`. */
  rows?: number;
}

/** Everything a selector may consider: the cell coords and whether a
 *  neighbor holds the SAME legend glyph (autotiling connectivity). */
export interface SelectorCell {
  /** Cell column. */
  cx: number;
  /** Cell row. */
  cy: number;
  /** The legend glyph at this cell. */
  char: string;
  /** True when the cell at (cx+dx, cy+dy) holds the same char. */
  neighbor(dx: number, dy: number): boolean;
  /** True when the neighboring cell is covered by solid semantics, including
   *  the non-anchor cells of a multi-cell slope span. */
  solid(dx: number, dy: number): boolean;
}

/** A cell selector: a pure function of (coords, neighbors, clock-derived
 *  time) → what to draw for this cell. */
export type Selector = (cell: SelectorCell) => Cell | string | null;

/** What a skin may say about a tile char: a flat color, a fixed cell, a
 *  selector, or null (deliberately invisible). */
export type SkinValue = string | Cell | Selector | null;

/** The skin type for a level — `satisfies Tiles.Skin<typeof level>` checks
 *  completeness against the legend. */
export type Skin<L> = L extends Level<infer C> ? Record<C, SkinValue> : never;

/** A named tileset cell or multi-cell region. */
export type TileSetEntry =
  | readonly [column: number, row: number]
  | readonly [column: number, row: number, columns: number, rows: number];

/** Options for `Tiles.set()`: source cell `size` and named cells/regions. */
export interface TileSetOptions<N extends string> {
  /** Source cell size in the image, px. */
  size: number;
  /** Descriptive name → `[column, row]` cell or
   *  `[column, row, columns, rows]` region. */
  names: Record<N, TileSetEntry>;
}

/** Optional diagonal cells for a 3×3 terrain family. These replace the center
 * cell when all four cardinal neighbors connect but one diagonal is open. */
export interface InnerCornerCells {
  topLeft?: Cell;
  topRight?: Cell;
  bottomRight?: Cell;
  bottomLeft?: Cell;
}

export interface Auto9Options {
  /** Atlas-cell gap between the 3×3 entries. Default 1. */
  stride?: number;
  /** Connect different glyphs when both are semantically solid. */
  connect?: "same" | "solid";
  /** Atlas cells for concave/inner corners omitted by a plain 3×3 grid. */
  innerCorners?: InnerCornerCells;
}

/** Named cells over a tileset image, plus the selector factories. */
export type TileSet<N extends string> = { readonly [K in N]: Cell } & {
  /** The cell at raw grid coords (escape hatch for unnamed cells). */
  cell(col: number, row: number): Cell;
  /** Crop a multi-cell source region and draw it over the same number of level
   *  cells. Useful for slopes, arches, doors, and other atlas stamps. */
  region(col: number, row: number, cols: number, rows: number): Cell;
  /** Per-cell random variant, seeded by cell coords — deterministic and
   *  stable every frame, zero stored state. `weights` matches `cells`. */
  pick(cells: Cell[], weights?: number[]): Selector;
  /** Clock-derived animated tile (water, lava). Phase-offset per cell so it
   *  shimmers instead of blinking in unison. */
  anim(cells: Cell[], opts: { fps?: number; clock: ClockHandle }): Selector;
  /** Conventional 3×3 terrain atlas: top/middle/bottom × left/middle/right.
   *  `stride` is the atlas-cell gap between entries (default 1). `connect:
   *  "solid"` joins different semantic tiles such as ground and slopes.
   *  `innerCorners` fills the diagonal cases a 3×3 atlas cannot encode. */
  auto9(base: Cell, opts?: Auto9Options): Selector;
  /** 16-cell bitmask autotiling: `base` is the top-left of a 4×4 block laid
   *  out row-major by neighbor mask (up=1, right=2, down=4, left=8). Cells
   *  connect to neighbors holding the same legend char. */
  auto16(base: Cell): Selector;
};

/** Tiled JSON property (`.tmj`/`.tsj`). Unknown fields are deliberately
 * accepted so files from newer Tiled versions remain usable. */
export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledTile {
  id: number;
  class?: string;
  type?: string;
  properties?: TiledProperty[];
  animation?: Array<{ tileid: number; duration: number }>;
}

export interface TiledTilesetJson {
  name?: string;
  tilewidth: number;
  tileheight: number;
  columns: number;
  margin?: number;
  spacing?: number;
  tilecount?: number;
  tiles?: TiledTile[];
  wangsets?: Array<{
    name: string;
    type?: "corner" | "edge" | "mixed";
    wangcolors?: Array<{ name: string; probability?: number }>;
    wangtiles?: Array<{ tileid: number; wangid: number[] }>;
  }>;
}

/** A tileset read directly from Tiled JSON. `named` uses a tile's class/type
 * or its `name` property; optional `cols`/`rows` properties make atlas stamps. */
export interface TiledSet {
  readonly json: TiledTilesetJson;
  tile(id: number): Cell;
  named(name: string): Cell;
  anim(nameOrId: string | number, clock: ClockHandle): Selector;
  wang(name: string, color?: string | number): Selector;
  pick(cells: Cell[], weights?: number[]): Selector;
  auto9(base: Cell, options?: Auto9Options): Selector;
  auto16(base: Cell): Selector;
}

export interface TiledMapJson {
  tilewidth: number;
  tileheight: number;
  width: number;
  height: number;
  infinite?: boolean;
  layers: Array<{
    name: string;
    type: string;
    width?: number;
    height?: number;
    data?: number[];
    chunks?: Array<{ x: number; y: number; width: number; height: number; data: number[] }>;
  }>;
}

export interface TiledGridOptions<L extends Record<number, string>> {
  layer: string;
  /** Local tileset tile id → level glyph. Flip flags are ignored for semantics. */
  tiles: L;
  legend: Record<L[keyof L] & string, TileSpec>;
  /** First GID of the relevant tileset. Default 1. */
  firstGid?: number;
}

export type TileWorldEndpoint<A extends string> = `${A}:${string}`;

interface TileWorldLinkOptions {
  transition?: PortalTransition;
  transitionMs?: number;
}

/** A bidirectional pair or one-way portal link between ASCII marker cells. */
export type TileWorldLink<A extends string> = TileWorldLinkOptions &
  (
    | {
        between: readonly [TileWorldEndpoint<A>, TileWorldEndpoint<A>];
        from?: never;
        to?: never;
      }
    | {
        from: TileWorldEndpoint<A>;
        to: TileWorldEndpoint<A>;
        between?: never;
      }
  );

export interface TileWorldOptions<
  A extends string,
  L extends Record<string, TileSpec>,
> extends GridOptions<L> {
  portals?: readonly TileWorldLink<A>[];
}

export interface TileWorldMarker<A extends string> extends Vec2 {
  area: A;
}

export interface TileWorldPortal<A extends string> extends Rect {
  to: { area: A; spawn: string; anchor: "feet" };
  transition?: PortalTransition;
  transitionMs?: number;
}

/** Multi-level ASCII world with the same structural portal API as LDtk. */
export interface TileWorld<A extends string, C extends string = string> {
  readonly areas: readonly A[];
  readonly first: A;
  level(area: A): Level<C>;
  markers(marker: string): TileWorldMarker<A>[];
  portals(area: A): readonly TileWorldPortal<A>[];
  resolve(destination: { area: A; spawn: string }): Vec2;
}

const EMPTY = ".";
const ONE_CELL = [1, 1] as const;

function isEmptyChar(ch: string): boolean {
  return ch === EMPTY || ch === " " || ch === "";
}

/** Deterministic hash of cell coords → [0, 1) — integer multiply-xor
 *  avalanche, far cheaper than the old Math.sin trick and just as stable. */
function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Parse an ASCII grid into a level — the string IS the level file. Legend
 *  glyphs carry semantics only (`solid`, `oneWay`, `slope`, `ladder` — plain
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
export function grid<L extends Record<string, TileSpec>>(
  source: string | readonly (readonly string[])[],
  options: GridOptions<L>,
): Level<keyof L & string> {
  type C = keyof L & string;
  const size = options.size;
  const legend = options.legend;
  const symbols = Object.keys(legend);
  const ascii = typeof source === "string";
  for (const symbol of symbols) {
    if (symbol.length === 0 || symbol === EMPTY || /^\s+$/.test(symbol)) {
      throw new Error(`Tiles.grid: legend keys cannot be empty or use reserved "." or whitespace`);
    }
  }
  const spans: Record<string, readonly [number, number]> = {};
  let cells: string[][];
  if (ascii) {
    const glyphs = symbols
      .filter((symbol) => symbol.length > 1)
      .sort((a, b) => b.length - a.length);
    // Rows: drop blank leading/trailing lines, keep interior spacing verbatim.
    const lines = source.split("\n");
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
    cells = lines.map((line) => {
      const row = Array.from({ length: width }, () => EMPTY);
      for (let cx = 0; cx < line.length;) {
        const raw = line[cx];
        if (isEmptyChar(raw)) {
          cx++;
          continue;
        }
        const glyph = glyphs.find((candidate) => line.startsWith(candidate, cx));
        if (glyph) {
          row[cx] = glyph;
          cx += glyph.length;
        } else {
          row[cx] = raw;
          cx++;
        }
      }
      return row;
    });
  } else {
    const width = source.reduce((max, row) => Math.max(max, row.length), 0);
    cells = source.map((sourceRow) =>
      Array.from({ length: width }, (_, cx) => sourceRow[cx] || EMPTY),
    );
  }
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;

  let maxSpanCols = 1;
  let maxSpanRows = 1;
  for (const [symbol, spec] of Object.entries(legend)) {
    const span = spec.span ?? ([ascii ? symbol.length : 1, 1] as const);
    spans[symbol] = span;
    const [spanCols, spanRows] = span;
    if (
      !Number.isInteger(spanCols) ||
      !Number.isInteger(spanRows) ||
      spanCols < 1 ||
      spanRows < 1
    ) {
      throw new Error(`Tiles.grid: "${symbol}" span must contain positive integers`);
    }
    if (ascii && spanCols < symbol.length) {
      throw new Error(`Tiles.grid: "${symbol}" span cannot be narrower than its glyph`);
    }
    maxSpanCols = Math.max(maxSpanCols, spanCols);
    maxSpanRows = Math.max(maxSpanRows, spanRows);
  }
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ch = cells[cy][cx];
      const [spanCols, spanRows] = spans[ch] ?? ONE_CELL;
      if (spanCols === 1 && spanRows === 1) continue;
      if (cx + spanCols > cols || cy + spanRows > rows) {
        throw new Error(`Tiles.grid: "${ch}" span at (${cx}, ${cy}) leaves the grid`);
      }
      for (let oy = 0; oy < spanRows; oy++) {
        for (let ox = 0; ox < spanCols; ox++) {
          if ((ox !== 0 || oy !== 0) && !isEmptyChar(cells[cy + oy][cx + ox])) {
            throw new Error(`Tiles.grid: "${ch}" span at (${cx}, ${cy}) overlaps another cell`);
          }
        }
      }
    }
  }

  const rect: Rect = { x: 0, y: 0, w: cols * size, h: rows * size };

  // Pooled rects handed out by solidsNear — valid until the next call.
  const pool: Solid[] = [];
  const ladderPool: Rect[] = [];
  let poolUsed = 0;
  let ladderPoolUsed = 0;
  function pooledSolid(
    x: number,
    y: number,
    w: number,
    h: number,
    oneWay: boolean,
    slope: SlopeDirection | undefined,
  ): Solid {
    let r = pool[poolUsed];
    if (!r) {
      // Full shape up front keeps one hidden class across the whole pool.
      r = { x: 0, y: 0, w: 0, h: 0, oneWay: false, slope: undefined };
      pool[poolUsed] = r;
    }
    poolUsed++;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    r.oneWay = oneWay;
    r.slope = slope;
    return r;
  }

  function pooledLadder(x: number, y: number, w: number, h: number): Rect {
    let r = ladderPool[ladderPoolUsed];
    if (!r) ladderPool[ladderPoolUsed] = r = { x: 0, y: 0, w: 0, h: 0 };
    ladderPoolUsed++;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    return r;
  }

  function specAt(cx: number, cy: number): TileSpec | undefined {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return undefined;
    return legend[cells[cy][cx]];
  }

  // One reused selector-view per level; render rebinds cx/cy/char per cell.
  const selectorCell: SelectorCell = {
    cx: 0,
    cy: 0,
    char: EMPTY,
    neighbor(dx, dy) {
      return level.at(this.cx + dx, this.cy + dy) === this.char;
    },
    solid(dx, dy) {
      return level.solidAt((this.cx + dx + 0.5) * size, (this.cy + dy + 0.5) * size);
    },
  };
  const stampPool: Array<{ cell: Cell; x: number; y: number }> = [];

  /** Paint cells [x0..x1]×[y0..y1] with `s` into `ctx` — shared by the live
   *  per-tile path and the offscreen bake. */
  function paintCells(
    ctx: CanvasRenderingContext2D,
    s: Record<string, SkinValue>,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    // Flat-color skins repaint the same few colors across thousands of cells;
    // setting fillStyle is a real state change, so only write it when it
    // actually differs. Starts null because the caller's ctx state is unknown.
    let lastFill: string | null = null;
    let stampCount = 0;
    try {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const ch = cells[cy][cx];
          if (isEmptyChar(ch)) continue;
          let value = s[ch];
          if (value === null || value === undefined) continue;
          if (typeof value === "function") {
            selectorCell.cx = cx;
            selectorCell.cy = cy;
            selectorCell.char = ch;
            value = value(selectorCell);
            if (value === null) continue;
          }
          const x = cx * size;
          const y = cy * size;
          if (typeof value === "string") {
            if (value !== lastFill) {
              ctx.fillStyle = value;
              lastFill = value;
            }
            fillPixelAligned(ctx, x, y, size, size);
          } else {
            if ((value.cols ?? 1) > 1 || (value.rows ?? 1) > 1) {
              let stamp = stampPool[stampCount];
              if (!stamp) stampPool[stampCount] = stamp = { cell: value, x, y };
              stamp.cell = value;
              stamp.x = x;
              stamp.y = y;
              stampCount++;
            } else {
              blitPixelAligned(
                ctx,
                value.image,
                value.sx,
                value.sy,
                value.sw,
                value.sh,
                x,
                y,
                size,
                size,
              );
            }
          }
        }
      }
      // Multi-cell atlas stamps sit above ordinary terrain regardless of row
      // order, so a slope can overlap the solid dirt cells beneath it.
      for (let i = 0; i < stampCount; i++) {
        const { cell, x, y } = stampPool[i];
        blitPixelAligned(
          ctx,
          cell.image,
          cell.sx,
          cell.sy,
          cell.sw,
          cell.sh,
          x,
          y,
          size * (cell.cols ?? 1),
          size * (cell.rows ?? 1),
        );
      }
    } finally {
      ctx.imageSmoothingEnabled = prevSmoothing;
    }
  }

  // ---------- Static-layer bake (opt-in via Draw.tiles' `bake`) ----------
  // One offscreen canvas covering the whole level, valid while the SAME skin
  // object is handed in and the camera scale stays within ±25% of the baked
  // one. `set()` and `invalidate()` drop it.
  const BAKE_MAX_PX = 4096; // device-px cap per axis for the offscreen canvas
  const BAKE_MAX_SCALE = 2; // bake resolution cap (device px per world px)
  let baked: { canvas: HTMLCanvasElement; scale: number; skinRef: unknown } | null = null;
  let bakeDisabled = false; // level too large — warned once, live path forever

  /** Bake ALL cells (no culling) into an offscreen canvas at device scale
   *  min(camera scale, 2). Null when the level is too large (warned once) or
   *  no real canvas exists here (headless/jsdom — live path, silently). */
  function bakeLayer(skin: Skin<Level<C>>, scale: number): typeof baked {
    const deviceScale = Math.min(scale, BAKE_MAX_SCALE);
    const w = Math.max(1, Math.ceil(cols * size * deviceScale));
    const h = Math.max(1, Math.ceil(rows * size * deviceScale));
    if (w > BAKE_MAX_PX || h > BAKE_MAX_PX) {
      bakeDisabled = true;
      console.warn(`Tiles: level too large to bake (${w}x${h} device px); drawing per-tile`);
      return null;
    }
    let canvas: HTMLCanvasElement;
    let bctx: CanvasRenderingContext2D | null;
    try {
      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      bctx = canvas.getContext("2d");
    } catch {
      return null;
    }
    if (!bctx) return null;
    bctx.scale(deviceScale, deviceScale);
    paintCells(bctx, skin as Record<string, SkinValue>, 0, 0, cols - 1, rows - 1);
    // Record the scale the pixels were actually baked at, not the camera's:
    // past BAKE_MAX_SCALE they diverge, and comparing against the camera's
    // would re-bake on zoom changes that produce identical pixels.
    return { canvas, scale: deviceScale, skinRef: skin };
  }

  const level: Level<C> = {
    size,
    cols,
    rows,
    rect,
    legend,
    at(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return EMPTY;
      return cells[cy][cx];
    },
    span(char) {
      return spans[char] ?? ONE_CELL;
    },
    set(cx, cy, char) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      cells[cy][cx] = char === null || char === "" ? EMPTY : char;
      baked = null; // a mutated cell invalidates any baked layer
    },
    invalidate() {
      baked = null;
    },
    spawns(char) {
      const out: Vec2[] = [];
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (cells[cy][cx] === char) {
            out.push({ x: (cx + 0.5) * size, y: (cy + 0.5) * size });
          }
        }
      }
      return out;
    },
    spawnOne(char) {
      const all = level.spawns(char);
      if (all.length === 0) throw new Error(`Tiles: no "${char}" marker in the level`);
      return all[0];
    },
    solidAt(x, y) {
      const tx = Math.floor(x / size);
      const ty = Math.floor(y / size);
      for (let cy = Math.max(0, ty - maxSpanRows + 1); cy <= ty; cy++) {
        for (let cx = Math.max(0, tx - maxSpanCols + 1); cx <= tx; cx++) {
          const spec = specAt(cx, cy);
          if (!spec?.solid && !spec?.slope) continue;
          const [spanCols, spanRows] = spans[cells[cy][cx]] ?? ONE_CELL;
          if (tx < cx + spanCols && ty < cy + spanRows) return true;
        }
      }
      return false;
    },
    ladderAt(x, y) {
      const tx = Math.floor(x / size);
      const ty = Math.floor(y / size);
      for (let cy = Math.max(0, ty - maxSpanRows + 1); cy <= ty; cy++) {
        for (let cx = Math.max(0, tx - maxSpanCols + 1); cx <= tx; cx++) {
          const spec = specAt(cx, cy);
          if (!spec?.ladder) continue;
          const [spanCols, spanRows] = spans[cells[cy][cx]] ?? ONE_CELL;
          if (tx < cx + spanCols && ty < cy + spanRows) return true;
        }
      }
      return false;
    },
    solidsNear(area, out) {
      poolUsed = 0;
      const x0 = Math.max(0, Math.floor(area.x / size) - maxSpanCols + 1);
      const y0 = Math.max(0, Math.floor(area.y / size) - maxSpanRows + 1);
      const x1 = Math.min(cols - 1, Math.floor((area.x + area.w) / size));
      const y1 = Math.min(rows - 1, Math.floor((area.y + area.h) / size));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const spec = legend[cells[cy][cx]];
          const automaticLadderTop =
            spec?.ladder === true &&
            spec.ladderTop !== false &&
            specAt(cx, cy - 1)?.ladder !== true;
          if (spec?.solid || spec?.slope || automaticLadderTop) {
            const [spanCols, spanRows] = spans[cells[cy][cx]] ?? ONE_CELL;
            const x = cx * size;
            const y = cy * size;
            const w = spanCols * size;
            const h = spanRows * size;
            if (x < area.x + area.w && x + w > area.x && y < area.y + area.h && y + h > area.y) {
              out.push(
                pooledSolid(x, y, w, h, automaticLadderTop || spec.oneWay === true, spec.slope),
              );
            }
          }
        }
      }
      return out;
    },
    laddersNear(area, out) {
      ladderPoolUsed = 0;
      const x0 = Math.max(0, Math.floor(area.x / size) - maxSpanCols + 1);
      const y0 = Math.max(0, Math.floor(area.y / size) - maxSpanRows + 1);
      const x1 = Math.min(cols - 1, Math.floor((area.x + area.w) / size));
      const y1 = Math.min(rows - 1, Math.floor((area.y + area.h) / size));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const spec = legend[cells[cy][cx]];
          if (spec?.ladder) {
            const [spanCols, spanRows] = spans[cells[cy][cx]] ?? ONE_CELL;
            const x = cx * size;
            const y = cy * size;
            const w = spanCols * size;
            const h = spanRows * size;
            if (x < area.x + area.w && x + w > area.x && y < area.y + area.h && y + h > area.y) {
              out.push(pooledLadder(x, y, w, h));
            }
          }
        }
      }
      return out;
    },
    render(ctx, skin, opts) {
      // Cull to the visible world rect, derived from the ctx's CURRENT
      // transform (whatever camera block we're inside) — zero API. The same
      // getTransform() yields the camera scale the bake path keys on.
      let x0 = 0;
      let y0 = 0;
      let x1 = cols - 1;
      let y1 = rows - 1;
      let scale = 1;
      if (typeof ctx.getTransform === "function") {
        try {
          // Invert the affine transform by hand — one getTransform(), no
          // DOMMatrix.inverse()/DOMPoint allocations per frame.
          const m = ctx.getTransform();
          scale = Math.hypot(m.a, m.b) || 1;
          const c = ctx.canvas as { width: number; height: number };
          const det = m.a * m.d - m.b * m.c;
          if (Number.isFinite(det) && det !== 0) {
            // Inverse-map all FOUR screen corners and take their world AABB.
            // Two corners suffice for a translate+scale transform, but not for
            // a rotated one — its world-space bounding box is set by the other
            // diagonal, so a two-corner box would under-cull and drop tiles.
            //   x = (d*(sx-e) - c*(sy-f))/det,  y = (a*(sy-f) - b*(sx-e))/det
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < 4; i++) {
              const sx = i & 1 ? c.width : 0;
              const sy = i & 2 ? c.height : 0;
              const dx = sx - m.e;
              const dy = sy - m.f;
              const wx = (m.d * dx - m.c * dy) / det;
              const wy = (m.a * dy - m.b * dx) / det;
              if (wx < minX) minX = wx;
              if (wx > maxX) maxX = wx;
              if (wy < minY) minY = wy;
              if (wy > maxY) maxY = wy;
            }
            x0 = Math.max(0, Math.floor(minX / size));
            y0 = Math.max(0, Math.floor(minY / size));
            x1 = Math.min(cols - 1, Math.floor(maxX / size));
            y1 = Math.min(rows - 1, Math.floor(maxY / size));
          }
        } catch {
          // DOMMatrix unavailable (tests/jsdom): draw everything.
        }
      }
      if (opts?.bake === true && !bakeDisabled) {
        // Compare like with like: `baked.scale` is the device scale the pixels
        // were rendered at, which is the camera scale CLAMPED to BAKE_MAX_SCALE.
        const wantScale = Math.min(scale, BAKE_MAX_SCALE);
        const stale =
          !baked ||
          baked.skinRef !== skin ||
          wantScale < baked.scale / 1.25 ||
          wantScale > baked.scale * 1.25;
        if (stale) baked = bakeLayer(skin, scale);
        if (baked) {
          // One whole-level blit; the ambient transform positions it.
          // Nearest-neighbour so pixel art stays crisp when the blit rescales.
          const prev = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false;
          blitPixelAligned(ctx, baked.canvas, 0, 0, cols * size, rows * size);
          ctx.imageSmoothingEnabled = prev;
          return;
        }
      }
      // A fixed region can begin outside the viewport and extend into it.
      // Include those anchors without making games manage tile culling.
      let overhangCols = 0;
      let overhangRows = 0;
      for (const value of Object.values(skin as Record<string, SkinValue>)) {
        if (value !== null && typeof value === "object") {
          overhangCols = Math.max(overhangCols, (value.cols ?? 1) - 1);
          overhangRows = Math.max(overhangRows, (value.rows ?? 1) - 1);
        }
      }
      x0 = Math.max(0, x0 - overhangCols);
      y0 = Math.max(0, y0 - overhangRows);
      paintCells(ctx, skin as Record<string, SkinValue>, x0, y0, x1, y1);
    },
  };
  return level;
}

/** Build a multi-level world directly from ordinary tile strings. Portal
 * endpoints are marker cells (`"level:P"`); `between` creates the common
 * bidirectional door pair while `from`/`to` creates a one-way link. */
export function world<const M extends Record<string, string>, L extends Record<string, TileSpec>>(
  maps: M,
  options: TileWorldOptions<keyof M & string, L>,
): TileWorld<keyof M & string, keyof L & string> {
  type A = keyof M & string;
  type C = keyof L & string;
  const areas = Object.keys(maps) as A[];
  if (areas.length === 0) throw new Error("Tiles.world: add at least one level");
  const levels = new Map<A, Level<C>>();
  const portals = new Map<A, TileWorldPortal<A>[]>();
  for (const area of areas) {
    levels.set(area, grid(maps[area], options));
    portals.set(area, []);
  }

  const level = (area: A): Level<C> => {
    const found = levels.get(area);
    if (!found) throw new Error(`Tiles.world: no level named "${area}"`);
    return found;
  };
  const endpoint = (source: TileWorldEndpoint<A>) => {
    const split = source.lastIndexOf(":");
    const area = source.slice(0, split) as A;
    const marker = source.slice(split + 1);
    if (split < 1 || !marker || !levels.has(area)) {
      throw new Error(`Tiles.world: invalid portal endpoint "${source}"`);
    }
    return { area, marker, at: level(area).spawnOne(marker) };
  };
  const connect = (
    fromSource: TileWorldEndpoint<A>,
    toSource: TileWorldEndpoint<A>,
    link: TileWorldLinkOptions,
  ) => {
    const from = endpoint(fromSource);
    const to = endpoint(toSource);
    const size = level(from.area).size;
    portals.get(from.area)!.push({
      x: from.at.x - size / 2,
      y: from.at.y - size / 2,
      w: size,
      h: size,
      to: { area: to.area, spawn: to.marker, anchor: "feet" },
      transition: link.transition,
      transitionMs: link.transitionMs,
    });
  };

  for (const link of options.portals ?? []) {
    if (link.between) {
      connect(link.between[0], link.between[1], link);
      connect(link.between[1], link.between[0], link);
    } else {
      connect(link.from, link.to, link);
    }
  }

  return {
    areas,
    first: areas[0],
    level,
    markers(marker) {
      return areas.flatMap((area) =>
        level(area)
          .spawns(marker)
          .map((at) => ({ ...at, area })),
      );
    },
    portals(area) {
      return portals.get(area) ?? [];
    },
    resolve(destination) {
      const target = level(destination.area);
      const at = target.spawnOne(destination.spawn);
      return { x: at.x, y: at.y + target.size / 2 };
    },
  };
}

function tiledProperties(tile: TiledTile | undefined): Record<string, unknown> {
  return Object.fromEntries(
    (tile?.properties ?? []).map((property) => [property.name, property.value]),
  );
}

/** Read a `.tsj` tileset without translating it into engine-specific atlas
 * coordinates. Tile class/type (or a string `name` property) becomes the
 * stable lookup name. Tiled custom properties `cols` and `rows` opt a tile
 * into a multi-cell atlas stamp. */
function tiledSet(image: CanvasImageSource, source: unknown): TiledSet {
  const json = source as TiledTilesetJson;
  if (!json || typeof json !== "object") {
    throw new Error("Tiles.Tiled.set: expected parsed Tiled tileset JSON");
  }
  if (!(json.tilewidth > 0) || !(json.tileheight > 0) || !(json.columns > 0)) {
    throw new Error("Tiles.Tiled.set: invalid tile size or column count");
  }
  const margin = json.margin ?? 0;
  const spacing = json.spacing ?? 0;
  const selectors = set(image, { size: json.tilewidth, names: {} });
  const definitions = new Map((json.tiles ?? []).map((tile) => [tile.id, tile]));
  const names = new Map<string, number>();
  for (const tile of json.tiles ?? []) {
    const properties = tiledProperties(tile);
    const name =
      tile.class ||
      tile.type ||
      (typeof properties.name === "string" ? properties.name : undefined);
    if (name) names.set(name, tile.id);
  }

  function tile(id: number): Cell {
    if (!Number.isInteger(id) || id < 0 || (json.tilecount !== undefined && id >= json.tilecount)) {
      throw new Error(`Tiles.Tiled.set: tile ${id} is outside the tileset`);
    }
    const definition = definitions.get(id);
    const properties = tiledProperties(definition);
    const cols = Number(properties.cols ?? 1);
    const rows = Number(properties.rows ?? 1);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new Error(`Tiles.Tiled.set: tile ${id} has invalid cols/rows properties`);
    }
    const col = id % json.columns;
    const row = Math.floor(id / json.columns);
    return {
      image,
      sx: margin + col * (json.tilewidth + spacing),
      sy: margin + row * (json.tileheight + spacing),
      sw: json.tilewidth * cols + spacing * (cols - 1),
      sh: json.tileheight * rows + spacing * (rows - 1),
      ...(cols > 1 ? { cols } : {}),
      ...(rows > 1 ? { rows } : {}),
    };
  }

  function idOf(nameOrId: string | number): number {
    if (typeof nameOrId === "number") return nameOrId;
    const id = names.get(nameOrId);
    if (id === undefined) throw new Error(`Tiles.Tiled.set: no tile named "${nameOrId}"`);
    return id;
  }

  return {
    json,
    tile,
    named(name) {
      return tile(idOf(name));
    },
    anim(nameOrId, clock) {
      const id = idOf(nameOrId);
      const frames = definitions.get(id)?.animation;
      if (!frames?.length) throw new Error(`Tiles.Tiled.set: tile ${id} has no animation`);
      const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
      return () => {
        let time = ((clock.now % total) + total) % total;
        for (const frame of frames) {
          if (time < frame.duration) return tile(frame.tileid);
          time -= frame.duration;
        }
        return tile(frames[frames.length - 1].tileid);
      };
    },
    wang(name, color = 1) {
      const wang = json.wangsets?.find((set) => set.name === name);
      if (!wang) throw new Error(`Tiles.Tiled.set: no Wang set named "${name}"`);
      const colorId =
        typeof color === "number"
          ? color
          : (wang.wangcolors?.findIndex((entry) => entry.name === color) ?? -1) + 1;
      if (colorId < 1) throw new Error(`Tiles.Tiled.set: no Wang color named "${color}"`);
      const candidates = wang.wangtiles ?? [];
      return (at) => {
        const up = at.neighbor(0, -1);
        const right = at.neighbor(1, 0);
        const down = at.neighbor(0, 1);
        const left = at.neighbor(-1, 0);
        const connected = [
          up,
          up && right && at.neighbor(1, -1),
          right,
          right && down && at.neighbor(1, 1),
          down,
          down && left && at.neighbor(-1, 1),
          left,
          left && up && at.neighbor(-1, -1),
        ];
        let best: { tileid: number; wangid: number[] } | undefined;
        let bestMismatch = Infinity;
        for (const candidate of candidates) {
          let mismatch = 0;
          for (let i = 0; i < 8; i++) {
            const wanted = connected[i] ? colorId : 0;
            if ((candidate.wangid[i] ?? 0) !== wanted) mismatch++;
          }
          if (mismatch < bestMismatch) {
            best = candidate;
            bestMismatch = mismatch;
          }
        }
        return best ? tile(best.tileid) : null;
      };
    },
    pick: selectors.pick,
    auto9: selectors.auto9,
    auto16: selectors.auto16,
  };
}

function assertImportGlyphs(values: Record<number, string>, source: string): void {
  for (const glyph of Object.values(values)) {
    if (glyph.length !== 1 || isEmptyChar(glyph)) {
      throw new Error(`${source}: imported grid glyphs must be one non-empty character`);
    }
  }
}

/** Turn a finite or chunked Tiled tile layer into the same semantic `Level`
 * returned by `Tiles.grid`. Rendering still comes from a separate skin. */
function tiledGrid<L extends Record<number, string>>(
  source: unknown,
  options: TiledGridOptions<L>,
): Level<L[keyof L] & string> {
  const map = source as TiledMapJson;
  if (!map || !Array.isArray(map.layers)) {
    throw new Error("Tiles.Tiled.grid: expected parsed Tiled map JSON");
  }
  assertImportGlyphs(options.tiles, "Tiles.Tiled.grid");
  const layer = map.layers.find(
    (entry) => entry.name === options.layer && entry.type === "tilelayer",
  );
  if (!layer) throw new Error(`Tiles.Tiled.grid: no tile layer named "${options.layer}"`);
  const chunks =
    layer.chunks ??
    (layer.data
      ? [
          {
            x: 0,
            y: 0,
            width: layer.width ?? map.width,
            height: layer.height ?? map.height,
            data: layer.data,
          },
        ]
      : []);
  if (chunks.length === 0)
    throw new Error(`Tiles.Tiled.grid: layer "${options.layer}" has no data`);
  const minX = Math.min(...chunks.map((chunk) => chunk.x));
  const minY = Math.min(...chunks.map((chunk) => chunk.y));
  const maxX = Math.max(...chunks.map((chunk) => chunk.x + chunk.width));
  const maxY = Math.max(...chunks.map((chunk) => chunk.y + chunk.height));
  const cols = maxX - minX;
  const rows = maxY - minY;
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => EMPTY));
  const firstGid = options.firstGid ?? 1;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.data.length; i++) {
      // Tiled stores horizontal/vertical/diagonal transform bits in the high
      // nibble. Semantics only care which tile the GID references.
      const gid = (chunk.data[i] >>> 0) & 0x0fffffff;
      if (gid === 0) continue;
      const glyph = options.tiles[gid - firstGid];
      if (glyph !== undefined) {
        const cx = chunk.x - minX + (i % chunk.width);
        const cy = chunk.y - minY + Math.floor(i / chunk.width);
        cells[cy][cx] = glyph;
      }
    }
  }
  return grid(cells.map((row) => row.join("")).join("\n"), {
    size: map.tilewidth,
    legend: options.legend,
  });
}

/** Standard Tiled JSON adapters. */
export const Tiled = Object.freeze({ set: tiledSet, grid: tiledGrid });

/** Slice a tileset image into named cells + selector factories — the
 *  space-indexed cousin of `Anim.fromGrid`. Named cells are fixed `Cell`s; the
 *  `region` crops a multi-cell atlas stamp; `pick`/`anim`/`auto9`/`auto16`
 *  build `Selector`s that choose a cell per grid cell. All drop into a skin:
 *
 *      const ts = Tiles.set(img, { size: 16, names: { ground: [0, 0], plank: [4, 0] } });
 *      const skin = { "#": ts.auto16(ts.ground), "-": ts.plank };
 *      Draw.tiles(level, skin);
 */
export function set<N extends string>(
  image: CanvasImageSource,
  options: TileSetOptions<N>,
): TileSet<N> {
  const s = options.size;

  function cell(col: number, row: number): Cell {
    return { image, sx: col * s, sy: row * s, sw: s, sh: s };
  }

  const factories = {
    cell,
    region(col: number, row: number, cols: number, rows: number): Cell {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
        throw new Error(`Tiles.set.region: cols and rows must be positive integers`);
      }
      return {
        image,
        sx: col * s,
        sy: row * s,
        sw: cols * s,
        sh: rows * s,
        cols,
        rows,
      };
    },
    pick(cells: Cell[], weights?: number[]): Selector {
      const total = weights ? weights.reduce((a, b) => a + b, 0) : cells.length;
      return (at) => {
        let roll = cellHash(at.cx, at.cy) * total;
        if (!weights) return cells[Math.min(cells.length - 1, Math.floor(roll))];
        for (let i = 0; i < cells.length; i++) {
          roll -= weights[i] ?? 0;
          if (roll < 0) return cells[i];
        }
        return cells[cells.length - 1];
      };
    },
    anim(cells: Cell[], opts: { fps?: number; clock: ClockHandle }): Selector {
      const fps = opts.fps ?? 4;
      return (at) => {
        const clock = opts.clock;
        const phase = Math.floor(cellHash(at.cx, at.cy) * cells.length);
        const idx = (Math.floor((clock.now * fps) / 1000) + phase) % cells.length;
        return cells[idx];
      };
    },
    auto9(base: Cell, opts: Auto9Options = {}): Selector {
      const stride = opts.stride ?? 1;
      if (!Number.isInteger(stride) || stride < 1) {
        throw new Error(`Tiles.set.auto9: stride must be a positive integer`);
      }
      const baseCol = base.sx / s;
      const baseRow = base.sy / s;
      const cells = Array.from({ length: 9 }, (_, index) =>
        cell(baseCol + (index % 3) * stride, baseRow + Math.floor(index / 3) * stride),
      );
      const solidConnect = opts.connect === "solid";
      return (at) => {
        const left = solidConnect ? at.solid(-1, 0) : at.neighbor(-1, 0);
        const right = solidConnect ? at.solid(1, 0) : at.neighbor(1, 0);
        const up = solidConnect ? at.solid(0, -1) : at.neighbor(0, -1);
        const down = solidConnect ? at.solid(0, 1) : at.neighbor(0, 1);
        if (left && right && up && down && opts.innerCorners) {
          const topLeft = solidConnect ? at.solid(-1, -1) : at.neighbor(-1, -1);
          const topRight = solidConnect ? at.solid(1, -1) : at.neighbor(1, -1);
          const bottomRight = solidConnect ? at.solid(1, 1) : at.neighbor(1, 1);
          const bottomLeft = solidConnect ? at.solid(-1, 1) : at.neighbor(-1, 1);
          if (!topLeft && opts.innerCorners.topLeft) {
            return opts.innerCorners.topLeft;
          }
          if (!topRight && opts.innerCorners.topRight) {
            return opts.innerCorners.topRight;
          }
          if (!bottomRight && opts.innerCorners.bottomRight) {
            return opts.innerCorners.bottomRight;
          }
          if (!bottomLeft && opts.innerCorners.bottomLeft) {
            return opts.innerCorners.bottomLeft;
          }
        }
        const col = left ? (right ? 1 : 2) : 0;
        const row = up ? (down ? 1 : 2) : 0;
        return cells[row * 3 + col];
      };
    },
    auto16(base: Cell): Selector {
      const baseCol = base.sx / s;
      const baseRow = base.sy / s;
      // Only 16 masks exist — bake all 16 cells once, index per grid cell.
      const byMask: Cell[] = [];
      for (let mask = 0; mask < 16; mask++) {
        byMask.push(cell(baseCol + (mask % 4), baseRow + Math.floor(mask / 4)));
      }
      return (at) => {
        const mask =
          (at.neighbor(0, -1) ? 1 : 0) |
          (at.neighbor(1, 0) ? 2 : 0) |
          (at.neighbor(0, 1) ? 4 : 0) |
          (at.neighbor(-1, 0) ? 8 : 0);
        return byMask[mask];
      };
    },
  };

  const named = {} as Record<N, Cell>;
  for (const name of Object.keys(options.names) as N[]) {
    const entry = options.names[name];
    named[name] =
      entry.length === 2
        ? cell(entry[0], entry[1])
        : factories.region(entry[0], entry[1], entry[2], entry[3]);
  }
  return Object.assign(named, factories) as TileSet<N>;
}
