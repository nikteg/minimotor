// ---------- Tiles ----------
// Three clean layers (API_PLAN #39/#40/#41):
//
//   LEVEL = DATA.  `Tiles.grid(ascii, { size, legend })` — the ASCII grid IS
//   the source file. Legend chars are tiles with SEMANTICS ONLY (solid,
//   oneWay — plain JSON facts); "." and " " are empty; any other char is a
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

import type { Rect } from "./engine/index.js";
import type { Solid } from "./collision.js";
import type { Vec2 } from "./vec2.js";
import { Clock, type ClockHandle } from "./clock.js";

/** Semantics of one legend char — plain JSON facts, no presentation. */
export interface TileSpec {
  /** Blocks movement (a `Solid` for slide/moveAndSlide). */
  solid?: boolean;
  /** Land on top, pass through from below/sides (#13's flag). */
  oneWay?: boolean;
}

export interface GridOptions<L extends Record<string, TileSpec>> {
  /** World size of one tile, in px. */
  size: number;
  /** char → semantics. Chars NOT in the legend (except "." and space, which
   *  are empty) are spawn markers. */
  legend: L;
}

/** A level: pure data + queries. Rendering lives in `Draw.tiles`. */
export interface Level<C extends string = string> {
  /** Tile size in px. */
  readonly size: number;
  readonly cols: number;
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
  /** SolidSource: appends the solid tiles near `area` into `out`. The rects
   *  are pooled — valid until the next call. */
  solidsNear(area: Rect, out: Solid[]): Solid[];
  /** Renderer channel — call `Draw.tiles(level, skin)` instead. */
  render(ctx: CanvasRenderingContext2D, skin: Skin<Level<C>>): void;
  /** The legend (read-only semantics lookup). */
  readonly legend: Record<string, TileSpec>;
}

/** A resolved source cell of a tileset image. */
export interface Cell {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Everything a selector may consider: the cell coords and whether a
 *  neighbor holds the SAME legend char (autotiling connectivity). */
export interface SelectorCell {
  cx: number;
  cy: number;
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

/** Deterministic hash of cell coords → [0, 1). */
function cellHash(cx: number, cy: number): number {
  const s = Math.sin(cx * 127.1 + cy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Parse an ASCII grid into a level. */
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
  let poolUsed = 0;
  function pooledSolid(x: number, y: number, oneWay: boolean): Solid {
    let r = pool[poolUsed];
    if (!r) {
      r = { x: 0, y: 0, w: 0, h: 0 };
      pool[poolUsed] = r;
    }
    poolUsed++;
    r.x = x;
    r.y = y;
    r.w = size;
    r.h = size;
    if (oneWay) r.oneWay = true;
    else delete r.oneWay;
    return r;
  }

  function specAt(cx: number, cy: number): TileSpec | undefined {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return undefined;
    return legend[cells[cy][cx]];
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
      return specAt(Math.floor(x / size), Math.floor(y / size))?.solid === true;
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
          if (spec?.solid) {
            out.push(pooledSolid(cx * size, cy * size, spec.oneWay === true));
          }
        }
      }
      return out;
    },
    render(ctx, skin) {
      // Cull to the visible world rect, derived from the ctx's CURRENT
      // transform (whatever camera block we're inside) — zero API.
      let x0 = 0;
      let y0 = 0;
      let x1 = cols - 1;
      let y1 = rows - 1;
      if (typeof ctx.getTransform === "function") {
        try {
          const m = ctx.getTransform().inverse();
          const c = ctx.canvas as { width: number; height: number };
          const tl = m.transformPoint(new DOMPoint(0, 0));
          const br = m.transformPoint(new DOMPoint(c.width, c.height));
          x0 = Math.max(0, Math.floor(Math.min(tl.x, br.x) / size));
          y0 = Math.max(0, Math.floor(Math.min(tl.y, br.y) / size));
          x1 = Math.min(cols - 1, Math.floor(Math.max(tl.x, br.x) / size));
          y1 = Math.min(rows - 1, Math.floor(Math.max(tl.y, br.y) / size));
        } catch {
          // DOMMatrix unavailable (tests/jsdom): draw everything.
        }
      }
      const selectorCell: SelectorCell = {
        cx: 0,
        cy: 0,
        char: EMPTY,
        neighbor(dx, dy) {
          return level.at(this.cx + dx, this.cy + dy) === this.char;
        },
      };
      const s = skin as Record<string, SkinValue>;
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
            ctx.fillStyle = value;
            // A hair of overlap so fractional transforms can't antialias
            // hairline gaps between neighbouring fills.
            ctx.fillRect(x, y, size + 0.5, size + 0.5);
          } else {
            ctx.drawImage(value.image, value.sx, value.sy, value.sw, value.sh, x, y, size, size);
          }
        }
      }
    },
  };
  return level;
}

/** Slice a tileset image into named cells + selector factories. */
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
        const clock = opts.clock ?? Clock.game;
        const phase = Math.floor(cellHash(at.cx, at.cy) * cells.length);
        const idx = (Math.floor((clock.now * fps) / 1000) + phase) % cells.length;
        return cells[idx];
      };
    },
    auto16(base: Cell): Selector {
      const baseCol = base.sx / s;
      const baseRow = base.sy / s;
      return (at) => {
        const mask =
          (at.neighbor(0, -1) ? 1 : 0) |
          (at.neighbor(1, 0) ? 2 : 0) |
          (at.neighbor(0, 1) ? 4 : 0) |
          (at.neighbor(-1, 0) ? 8 : 0);
        return cell(baseCol + (mask % 4), baseRow + Math.floor(mask / 4));
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
