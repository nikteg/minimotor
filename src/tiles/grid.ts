// ---------- Level grids ----------
// `grid()` turns an ASCII map into a `Level`: pure data plus the collision,
// marker and tag queries a game asks of it. `world()` stitches several of those
// into a portal-linked set.

import type { Rect } from "@src/engine/index.js";
import type { Solid } from "@src/collision/index.js";
import type { Vec2 } from "@src/math/vec2.js";
import type {
  GridOptions,
  Level,
  TileSpec,
  TileWorld,
  TileWorldEndpoint,
  TileWorldLinkOptions,
  TileWorldOptions,
  TileWorldPortal,
} from "./types.js";
import { ONE_CELL } from "./cells.js";
import { EMPTY, isEmptyChar } from "./glyphs.js";
import { type MergedIndex, indexRects, mesh, queryIndex } from "./mesh.js";
import { type Painter, createPainter } from "./paint.js";

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

  function specAt(cx: number, cy: number): TileSpec | undefined {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return undefined;
    return legend[cells[cy][cx]];
  }

  // ---------- Merged collision rects ----------
  // The meshing itself lives in `./mesh`, which knows nothing about legends or
  // tags: it takes a membership grid and returns merged, indexed rects. What
  // follows is only the part that decides MEMBERSHIP — which is where the
  // semantics actually live.
  const dims = { cols, rows, size };
  let solidIndex: MergedIndex<Solid> | null = null;
  /** One lazily-built merged index per queried tag. */
  const tagIndexes = new Map<string, MergedIndex<Rect>>();

  function buildSolidIndex(): MergedIndex<Solid> {
    const rects: Solid[] = [];
    const plain = new Uint8Array(cols * rows); // solid, two-way, 1×1
    const platform = new Uint8Array(cols * rows); // one-way (incl. exposed top surfaces)
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const ch = cells[cy][cx];
        const spec = legend[ch];
        if (!spec) continue;
        // An exposed top surface only exists where the run actually ends: if
        // the tile above declares the same thing, this cell is mid-run.
        const exposedTop = spec.standOnTop === true && specAt(cx, cy - 1)?.standOnTop !== true;
        if (!spec.solid && !spec.slope && !exposedTop) continue;
        const [spanCols, spanRows] = spans[ch] ?? ONE_CELL;
        const oneWay = exposedTop || spec.oneWay === true;
        if (spec.slope || spanCols !== 1 || spanRows !== 1) {
          rects.push({
            x: cx * size,
            y: cy * size,
            w: spanCols * size,
            h: spanRows * size,
            oneWay,
            slope: spec.slope,
          });
          continue;
        }
        (oneWay ? platform : plain)[cy * cols + cx] = 1;
      }
    }
    mesh(dims, plain, true, (cx, cy, w, h) => {
      rects.push({
        x: cx * size,
        y: cy * size,
        w: w * size,
        h: h * size,
        oneWay: false,
        slope: undefined,
      });
    });
    mesh(dims, platform, false, (cx, cy, w, h) => {
      rects.push({
        x: cx * size,
        y: cy * size,
        w: w * size,
        h: h * size,
        oneWay: true,
        slope: undefined,
      });
    });
    return indexRects(dims, rects);
  }

  function buildTagIndex(tag: string): MergedIndex<Rect> {
    const rects: Rect[] = [];
    const member = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const ch = cells[cy][cx];
        if (!legend[ch]?.tags?.includes(tag)) continue;
        const [spanCols, spanRows] = spans[ch] ?? ONE_CELL;
        if (spanCols !== 1 || spanRows !== 1) {
          rects.push({ x: cx * size, y: cy * size, w: spanCols * size, h: spanRows * size });
          continue;
        }
        member[cy * cols + cx] = 1;
      }
    }
    // A tag is a pure region query with no surfaces to preserve, so it merges
    // on both axes — a whole climbable column becomes one rect.
    mesh(dims, member, true, (cx, cy, w, h) => {
      rects.push({ x: cx * size, y: cy * size, w: w * size, h: h * size });
    });
    return indexRects(dims, rects);
  }

  let painter: Painter<C> | null = null;

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
      // A mutated cell invalidates the baked layer and the merged rects alike.
      painter?.invalidate();
      solidIndex = null;
      tagIndexes.clear();
    },
    invalidate() {
      painter?.invalidate();
      solidIndex = null;
      tagIndexes.clear();
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
    tagAt(x, y, tag) {
      const tx = Math.floor(x / size);
      const ty = Math.floor(y / size);
      for (let cy = Math.max(0, ty - maxSpanRows + 1); cy <= ty; cy++) {
        for (let cx = Math.max(0, tx - maxSpanCols + 1); cx <= tx; cx++) {
          const spec = specAt(cx, cy);
          if (!spec?.tags?.includes(tag)) continue;
          const [spanCols, spanRows] = spans[cells[cy][cx]] ?? ONE_CELL;
          if (tx < cx + spanCols && ty < cy + spanRows) return true;
        }
      }
      return false;
    },
    solidsNear(area, out) {
      solidIndex ??= buildSolidIndex();
      return queryIndex(dims, solidIndex, area, out);
    },
    rectsNear(tag, area, out) {
      let index = tagIndexes.get(tag);
      if (!index) tagIndexes.set(tag, (index = buildTagIndex(tag)));
      return queryIndex(dims, index, area, out);
    },
    render(ctx, skin, opts) {
      // Built on first paint, not up front: a level used only for collision
      // (a server, a test, a generator) never constructs the paint path.
      painter ??= createPainter(dims, cells, level);
      painter.render(ctx, skin, opts);
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
