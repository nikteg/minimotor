// ---------- Tile types ----------
// Every interface the tiles capability exposes, and nothing that runs. Kept
// separate so the runtime modules can import each other's shapes without
// dragging in each other's code, and so the whole public vocabulary of the
// capability can be read in one sitting.

import type { DrawTilesOptions, Rect } from "@src/engine/index.js";
import type { SlopeDirection, Solid, SolidSource } from "@src/collision/index.js";
import type { PortalTransition } from "@src/portals/index.js";
import type { Vec2 } from "@src/math/vec2.js";
import type { ClockHandle } from "@src/clock/index.js";

/** Semantics of one legend glyph — plain JSON facts, no presentation.
 *
 *  Deliberately, this names no game concepts. `solid`/`oneWay`/`slope` exist
 *  because `Collision.Solid` has those exact fields, so the level must be able
 *  to produce them; everything else a game wants a REGION to mean — climbable,
 *  icy, damaging, a trigger volume — is a `tag`. See `./presets` for the
 *  ready-made vocabulary, which is ordinary data written in these terms. */
export interface TileSpec {
  /** Blocks movement (a `Solid` for slide/moveAndSlide). */
  solid?: boolean;
  /** Land on top, pass through from below/sides. */
  oneWay?: boolean;
  /** Walkable diagonal surface across this tile. */
  slope?: SlopeDirection;
  /** Names for this region, queried back as merged rects with
   *  `level.rectsNear(tag, area, out)` and point-tested with `level.tagAt`.
   *  Any string works; the engine never interprets one. */
  tags?: readonly string[];
  /** The exposed TOP edge of this tile is a one-way standing surface — "you can
   *  stand on the top of the run, and pass through the rest of it". Applies
   *  only where the tile above does not also declare it, so a stack produces
   *  one surface at the top rather than one per cell. */
  standOnTop?: boolean;
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
export interface Level<C extends string = string> extends SolidSource {
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
  /** Is the world point inside a tile carrying `tag`? */
  tagAt(x: number, y: number, tag: string): boolean;
  /** SolidSource: appends the solid rects near `area` into `out`. Runs of
   *  identically-behaving tiles are MERGED into one rect, so a plain floor is a
   *  single box with no internal edges to snag on. Slopes and multi-cell spans
   *  keep their own shape, and one-way platforms merge only sideways. The rects
   *  are cached and shared — read them, never mutate them; `set()` and
   *  `invalidate()` rebuild them. */
  solidsNear(area: Rect, out: Solid[]): Solid[];
  /** Appends the rects of every tile tagged `tag` near `area` to `out`, merged
   *  and cached on the same terms as `solidsNear`. One index is built per tag,
   *  lazily, so unused tags cost nothing.
   *
   *  This is the seam a game's own concepts go through — every adapter in
   *  `Tiles.presets` is nothing but this call bound to one tag. */
  rectsNear(tag: string, area: Rect, out: Rect[]): Rect[];
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
  /** Mirror horizontally when drawn. Set by `Tiles.orient`. */
  flipX?: boolean;
  /** Mirror vertically when drawn. Set by `Tiles.orient`. */
  flipY?: boolean;
  /** Clockwise quarter-turns (0-3) applied when drawn. Set by `Tiles.orient`. */
  turn?: 0 | 1 | 2 | 3;
}

/** How to re-orient a cell — the dihedral group of the square. One drawn tile
 *  can therefore stand in for up to 8 hand-drawn atlas cells. */
export interface CellOrientation {
  /** Mirror horizontally. */
  flipX?: boolean;
  /** Mirror vertically. */
  flipY?: boolean;
  /** Clockwise quarter-turns. `1` is 90°, `2` is 180°, `3` is 270°. */
  turn?: 0 | 1 | 2 | 3;
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

/** A dual-grid terrain layer, built by `TileSet.auto4`. Its tiles are drawn on
 *  a lattice offset by half a cell, so each drawn tile is decided by the FOUR
 *  world cells touching that corner — 16 atlas cells instead of the 47 an
 *  8-neighbor blob set needs, with corners correct by construction. */
export interface DualLayer {
  /** Atlas cell for a corner mask (bit 1 top-left, 2 top-right, 4 bottom-right,
   *  8 bottom-left), or null to draw nothing. */
  readonly dual: (mask: number) => Cell | null;
  /** How a neighboring cell counts as filled — same glyph, or any solid. */
  readonly connect: "same" | "solid";
}

/** What a skin may say about a tile char: a flat color, a fixed cell, a
 *  selector, a dual-grid layer, or null (deliberately invisible). */
export type SkinValue = string | Cell | Selector | DualLayer | null;

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

export interface Auto4Options {
  /** Atlas-cell gap between the 4×4 entries. Default 1. */
  stride?: number;
  /** Connect different glyphs when both are semantically solid. */
  connect?: "same" | "solid";
  /** Atlas cell drawn for the all-empty mask 0. Default: nothing. */
  empty?: Cell | null;
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
  /** DUAL-GRID autotiling. `base` is the top-left of a 4×4 block laid out
   *  row-major by CORNER mask (top-left=1, top-right=2, bottom-right=4,
   *  bottom-left=8). Tiles are drawn half a cell up and left of the grid, so
   *  each one resolves the four world cells around a corner: 16 atlas cells do
   *  the job of a 47-cell blob set, and inner corners come out right without
   *  the extra `auto9` cases. Terrain overhangs the level rect by half a cell
   *  and is clipped there. */
  auto4(base: Cell, opts?: Auto4Options): DualLayer;
  /** Mirror/rotate a cell at draw time — one atlas cell can stand in for up to
   *  8. Combines with `pick` to get mirrored variants for free. */
  orient(cell: Cell, opts: CellOrientation): Cell;
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
  auto4(base: Cell, options?: Auto4Options): DualLayer;
  orient(cell: Cell, options: CellOrientation): Cell;
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

export interface TileWorldLinkOptions {
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
