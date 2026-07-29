// ---------- Tiles ----------
// Three clean layers:
//
//   LEVEL = DATA.  `Tiles.grid(ascii, { size, legend })` — the ASCII grid IS
//   the source file. Legend chars are tiles with SEMANTICS ONLY (solid,
//   oneWay, slope, ladder — plain JSON facts); "." and " " are empty; any other char is a
//   spawn MARKER the game queries (`spawns`, `spawnOne`). The whole level
//   definition is serializable and collides server-side (no canvas anywhere).
//
//   TILESET = NAMED CELLS.  `Tiles.set(image, { size, names })` — the
//   space-indexed cousin of `Anim.sheet`, plus cell SELECTORS: `pick`
//   (coord-seeded variants), `anim` (clock-derived water), `auto16`
//   (neighbor-aware autotiling).
//
//   SKIN = THE JOIN, AT THE DRAW SITE.  A plain `{ char: color | cell |
//   selector | null }` map handed to `Draw.tiles(level, skin)` — same level,
//   many skins (themes, the minimap in flat colors). Type it with
//   `satisfies Tiles.Skin<typeof level>`: add a tile kind and every skin
//   errors until it answers for it.
//
// The level is a `SolidSource`: `Collision.moveAndSlide(player, level)` gets
// grid broadphase for free.

import type { DrawTilesOptions, Rect } from "./engine/index.js";
import { blitPixelAligned, fillPixelAligned } from "./engine/pixel-raster.js";
import type { LadderSource, SlopeDirection, Solid, SolidSource } from "./collision.js";
import type { Vec2 } from "./vec2.js";
import { Clock, type ClockHandle } from "./clock.js";

/** Semantics of one legend char — plain JSON facts, no presentation. */
export interface TileSpec {
  /** Blocks movement (a `Solid` for slide/moveAndSlide). */
  solid?: boolean;
  /** Land on top, pass through from below/sides. */
  oneWay?: boolean;
  /** Walkable diagonal surface across this tile. */
  slope?: SlopeDirection;
  /** Climbable region; queried by `Collision.climbLadder`. */
  ladder?: boolean;
}

/** Options for `grid()` (exported as `Tiles.GridOptions`): tile `size` and char `legend`. */
export interface GridOptions<L extends Record<string, TileSpec>> {
  /** World size of one tile, in px. */
  size: number;
  /** char → semantics. Chars NOT in the legend (except "." and space, which
   *  are empty) are spawn markers. */
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
  /** The char at a cell ("." when empty or outside). */
  at(cx: number, cy: number): string;
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
}

/** Everything a selector may consider: the cell coords and whether a
 *  neighbor holds the SAME legend char (autotiling connectivity). */
export interface SelectorCell {
  /** Cell column. */
  cx: number;
  /** Cell row. */
  cy: number;
  /** The legend char at this cell. */
  char: string;
  /** True when the cell at (cx+dx, cy+dy) holds the same char. */
  neighbor(dx: number, dy: number): boolean;
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

/** Options for `Tiles.set()`: source cell `size` and a `names` → `[col, row]` map. */
export interface TileSetOptions<N extends string> {
  /** Source cell size in the image, px. */
  size: number;
  /** name → [column, row] grid coordinates in the image. */
  names: Record<N, [number, number]>;
}

/** Named cells over a tileset image, plus the selector factories. */
export type TileSet<N extends string> = { readonly [K in N]: Cell } & {
  /** The cell at raw grid coords (escape hatch for unnamed cells). */
  cell(col: number, row: number): Cell;
  /** Per-cell random variant, seeded by cell coords — deterministic and
   *  stable every frame, zero stored state. `weights` matches `cells`. */
  pick(cells: Cell[], weights?: number[]): Selector;
  /** Clock-derived animated tile (water, lava). Phase-offset per cell so it
   *  shimmers instead of blinking in unison. */
  anim(cells: Cell[], opts?: { fps?: number; clock?: ClockHandle }): Selector;
  /** 16-cell bitmask autotiling: `base` is the top-left of a 4×4 block laid
   *  out row-major by neighbor mask (up=1, right=2, down=4, left=8). Cells
   *  connect to neighbors holding the same legend char. */
  auto16(base: Cell): Selector;
};

const EMPTY = ".";

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
 *  chars carry semantics only (`solid`, `oneWay`, `slope`, `ladder` — plain JSON facts); `"."`
 *  and space are empty; any OTHER char is a spawn marker you query with
 *  `spawns`/`spawnOne`. The result is pure data: paint it with
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
  ascii: string,
  options: GridOptions<L>,
): Level<keyof L & string> {
  type C = keyof L & string;
  const size = options.size;
  const legend = options.legend;
  if (EMPTY in legend || " " in legend) {
    throw new Error(`Tiles.grid: "." and " " are reserved empty chars, not legend entries`);
  }

  // Rows: drop blank leading/trailing lines, keep interior spacing verbatim.
  const lines = ascii.split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const rows = lines.length;
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const cells: string[][] = lines.map((l) => Array.from({ length: cols }, (_, x) => l[x] ?? EMPTY));

  const rect: Rect = { x: 0, y: 0, w: cols * size, h: rows * size };

  // Pooled rects handed out by solidsNear — valid until the next call.
  const pool: Solid[] = [];
  const ladderPool: Rect[] = [];
  let poolUsed = 0;
  let ladderPoolUsed = 0;
  function pooledSolid(
    x: number,
    y: number,
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
    r.w = size;
    r.h = size;
    r.oneWay = oneWay;
    r.slope = slope;
    return r;
  }

  function pooledLadder(x: number, y: number): Rect {
    let r = ladderPool[ladderPoolUsed];
    if (!r) ladderPool[ladderPoolUsed] = r = { x: 0, y: 0, w: 0, h: 0 };
    ladderPoolUsed++;
    r.x = x;
    r.y = y;
    r.w = size;
    r.h = size;
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
  };

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
      const spec = specAt(Math.floor(x / size), Math.floor(y / size));
      return spec?.solid === true || spec?.slope !== undefined;
    },
    ladderAt(x, y) {
      return specAt(Math.floor(x / size), Math.floor(y / size))?.ladder === true;
    },
    solidsNear(area, out) {
      poolUsed = 0;
      const x0 = Math.max(0, Math.floor(area.x / size));
      const y0 = Math.max(0, Math.floor(area.y / size));
      const x1 = Math.min(cols - 1, Math.floor((area.x + area.w) / size));
      const y1 = Math.min(rows - 1, Math.floor((area.y + area.h) / size));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const spec = legend[cells[cy][cx]];
          if (spec?.solid || spec?.slope) {
            out.push(pooledSolid(cx * size, cy * size, spec.oneWay === true, spec.slope));
          }
        }
      }
      return out;
    },
    laddersNear(area, out) {
      ladderPoolUsed = 0;
      const x0 = Math.max(0, Math.floor(area.x / size));
      const y0 = Math.max(0, Math.floor(area.y / size));
      const x1 = Math.min(cols - 1, Math.floor((area.x + area.w) / size));
      const y1 = Math.min(rows - 1, Math.floor((area.y + area.h) / size));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const spec = legend[cells[cy][cx]];
          if (spec?.ladder) {
            out.push(pooledLadder(cx * size, cy * size));
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
      paintCells(ctx, skin as Record<string, SkinValue>, x0, y0, x1, y1);
    },
  };
  return level;
}

/** Slice a tileset image into named cells + selector factories — the
 *  space-indexed cousin of `Anim.sheet`. Named cells are fixed `Cell`s; the
 *  `pick`/`anim`/`auto16` factories build `Selector`s that choose a cell per
 *  grid cell. Both drop straight into a skin for `Draw.tiles`:
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
    anim(cells: Cell[], opts: { fps?: number; clock?: ClockHandle } = {}): Selector {
      const fps = opts.fps ?? 4;
      return (at) => {
        const clock = opts.clock ?? Clock.world;
        const phase = Math.floor(cellHash(at.cx, at.cy) * cells.length);
        const idx = (Math.floor((clock.now * fps) / 1000) + phase) % cells.length;
        return cells[idx];
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
    const [col, row] = options.names[name];
    named[name] = cell(col, row);
  }
  return Object.assign(named, factories) as TileSet<N>;
}
