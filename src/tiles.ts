// ---------- Tiles ----------
// Grid tilemap: draw (culled to a view rect) + solidity queries. Levels are
// plain `number[][]` (rows of tile indices, 0 = empty) — trivially authored
// inline or loaded as JSON via `Assets`. Tiles render from an atlas image
// (index n blits cell n-1, row-major — Tiled's firstgid=1 convention) or from
// a color table for atlas-less prototyping.
//
//   const map = Minimotor.Tiles.grid(levelData, { tw: 16, atlas });
//   // in draw(), after translating by the camera:
//   map.draw(ctx, { x: cam.x, y: cam.y, w: viewW, h: viewH });
//   // in update():
//   if (map.solidAt(player.x, player.y + player.h)) land();

import type { Rect } from "./engine.js";

type AtlasImage = CanvasImageSource & { width: number; height: number };

/** The contact face on the MOVER, for a `moveAABB` collision filter. */
export type MoveDir = "left" | "right" | "top" | "bottom";

/** Options for `moveAABB`. */
export interface MoveOptions {
  /** Override which tiles block, per cell and per contact direction. Receives
   *  the tile index, its cell, and the mover's contact face; return true to
   *  block. Defaults to the map's `solid` predicate. Use it for one-off
   *  filtering (hazards that don't stop you, doors, etc.). */
  solid?: (tile: number, cx: number, cy: number, dir: MoveDir) => boolean;
  /** One-way platforms: tiles that block ONLY a downward landing (the mover's
   *  bottom meeting the tile's top), using the pre-move bottom edge so you
   *  rise and pass through from below and step off the sides freely. Explicit
   *  and opt-in — never inferred from level shape. */
  oneway?: (tile: number, cx: number, cy: number) => boolean;
}

/** Result of `moveAABB`: the resolved rect, the delta actually applied, and
 *  which faces ended in contact this move. */
export interface MoveResult {
  /** The resolved rectangle (a fresh object; the input is not mutated). */
  rect: Rect;
  /** Delta actually applied after resolution (≤ the requested magnitude). */
  dx: number;
  dy: number;
  /** True if the mover was stopped on that face this move. */
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface TilesConfig {
  /** Tile width in px. */
  tw: number;
  /** Tile height in px (default `tw` — square tiles). */
  th?: number;
  /** Atlas image; tile index n blits cell n-1 (row-major). Omit to render
   *  from `colors` instead. */
  atlas?: AtlasImage;
  /** Atlas grid columns; default `floor(atlas.width / tw)`. */
  cols?: number;
  /** Which tile indices block movement. Default: every non-zero tile. */
  solid?: (tile: number) => boolean;
  /** Fill color per tile index, for maps without an atlas. Unlisted non-zero
   *  tiles fall back to `#888`. */
  colors?: Record<number, string>;
}

/** A grid tilemap. Draws in world coordinates (translate your ctx by the
 *  camera first); the optional view rect only culls.
 *
 *  Seams: visible tiles are composited into an internal buffer at integer 1:1
 *  coordinates and blitted in one drawImage, so a fractional camera offset,
 *  browser zoom or a non-integer devicePixelRatio can't antialias the edges
 *  between tiles into hairline gaps. */
export interface TileMap {
  /** Grid width in cells (longest row). */
  readonly cols: number;
  /** Grid height in cells. */
  readonly rows: number;
  /** World size in px (`cols * tw` / `rows * th`). */
  readonly worldW: number;
  readonly worldH: number;
  /** Tile index at cell (cx, cy); 0 outside the grid. */
  at(cx: number, cy: number): number;
  /** Write a cell (ignored outside the grid). */
  set(cx: number, cy: number, tile: number): void;
  /** Tile index at a world point. */
  tileAt(x: number, y: number): number;
  /** Is the world point inside a solid tile? */
  solidAt(x: number, y: number): boolean;
  /** Does the rect overlap any solid tile? Edge-touching doesn't count
   *  (matches `Collision.rectsOverlap`). The go-to broadphase for tile
   *  platformer movement: move one axis, test, resolve. */
  solidInRect(rect: Rect): boolean;
  /** Move an axis-aligned rect by (dx, dy) against the solid tiles and resolve
   *  the collision, returning the stopped rect plus which faces made contact.
   *
   *    const hit = map.moveAABB(playerRect, vx, vy);
   *    playerRect = hit.rect;
   *    if (hit.bottom) vy = 0;         // landed / ceiling
   *    if (hit.top) vy = Math.max(0, vy);
   *
   *  X and Y resolve independently to exact tile boundaries; every solid tile
   *  blocks from every side; large deltas sweep the crossed cells (no
   *  tunneling); a rect already overlapping a solid is not shoved (spawn-
   *  overlap safe). It owns no velocity/gravity/state — the game keeps those.
   *  See `MoveOptions` for per-tile filtering and opt-in one-way platforms. */
  moveAABB(rect: Rect, dx: number, dy: number, opts?: MoveOptions): MoveResult;
  /** Draw every non-empty tile inside `view` (or the whole map). Returns how
   *  many tiles were drawn — handy for asserting the culling works. */
  draw(ctx: CanvasRenderingContext2D, view?: Rect): number;
}

/** Create a tilemap over `data` (rows of tile indices; rows may be ragged —
 *  missing cells read as empty). The array is used live, not copied, so
 *  editing it (or via `set`) is reflected immediately. */
export function grid(data: number[][], config: TilesConfig): TileMap {
  const tw = config.tw;
  const th = config.th ?? config.tw;
  const rows = data.length;
  let cols = 0;
  for (const row of data) cols = Math.max(cols, row.length);
  const atlas = config.atlas;
  const atlasCols = config.cols ?? (atlas ? Math.max(1, Math.floor(atlas.width / tw)) : 1);
  const isSolid = config.solid ?? ((t: number) => t > 0);
  const colors = config.colors ?? {};

  function at(cx: number, cy: number): number {
    return data[cy]?.[cx] ?? 0;
  }

  // Seam-proofing buffer: tiles land here at integer 1:1 coordinates, then the
  // whole visible block blits to the target in one drawImage. Tile edges only
  // ever meet inside the buffer (no antialiasing possible); the single outer
  // edge that can blend sits at/past the view border. Unavailable in
  // non-browser environments (jsdom tests) — those draw directly.
  let buffer: HTMLCanvasElement | null = null;
  let bufferCtx: CanvasRenderingContext2D | null = null;
  let bufferBroken = false;

  function getBufferCtx(w: number, h: number): CanvasRenderingContext2D | null {
    if (bufferBroken) return null;
    if (!buffer) {
      if (typeof document === "undefined") {
        bufferBroken = true;
        return null;
      }
      buffer = document.createElement("canvas");
    }
    if (buffer.width < w) buffer.width = w;
    if (buffer.height < h) buffer.height = h;
    bufferCtx ??= buffer.getContext("2d");
    if (!bufferCtx) {
      bufferBroken = true;
      return null;
    }
    bufferCtx.clearRect(0, 0, w, h);
    return bufferCtx;
  }

  function drawTile(ctx: CanvasRenderingContext2D, t: number, x: number, y: number): void {
    if (atlas) {
      const cell = t - 1;
      ctx.drawImage(
        atlas,
        (cell % atlasCols) * tw,
        Math.floor(cell / atlasCols) * th,
        tw,
        th,
        x,
        y,
        tw,
        th,
      );
    } else {
      ctx.fillStyle = colors[t] ?? "#888";
      ctx.fillRect(x, y, tw, th);
    }
  }

  return {
    cols,
    rows,
    worldW: cols * tw,
    worldH: rows * th,
    at,

    set(cx, cy, tile) {
      if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return;
      data[cy][cx] = tile;
    },

    tileAt(x, y) {
      return at(Math.floor(x / tw), Math.floor(y / th));
    },

    solidAt(x, y) {
      return isSolid(at(Math.floor(x / tw), Math.floor(y / th)));
    },

    solidInRect(rect) {
      const cx0 = Math.floor(rect.x / tw);
      const cy0 = Math.floor(rect.y / th);
      // ceil(edge/size) - 1: the last cell strictly before the far edge, so a
      // rect exactly touching a tile boundary doesn't collide with it.
      const cx1 = Math.ceil((rect.x + rect.w) / tw) - 1;
      const cy1 = Math.ceil((rect.y + rect.h) / th) - 1;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (isSolid(at(cx, cy))) return true;
        }
      }
      return false;
    },

    moveAABB(rect, dx, dy, opts = {}) {
      // Live edges — X resolves first, then Y uses the resolved x-span.
      let x = rect.x;
      let y = rect.y;
      const { w, h } = rect;
      const prevBottom = y + h; // for one-way "landing from above" tests

      // Is cell (cx, cy) blocking, given the mover's contact face? Empty and
      // off-map cells never block. One-way platforms block only a downward
      // landing whose pre-move bottom was at/above the tile top.
      const blocks = (cx: number, cy: number, dir: MoveDir): boolean => {
        const t = at(cx, cy);
        if (opts.oneway?.(t, cx, cy)) {
          return dir === "bottom" && prevBottom <= cy * th + 0.001;
        }
        return opts.solid ? opts.solid(t, cx, cy, dir) : isSolid(t);
      };

      // Perpendicular cell span a segment [a, a+len) covers (edge-exclusive,
      // matching solidInRect so a flush edge doesn't count as overlap).
      const span = (a: number, len: number, size: number): [number, number] => [
        Math.floor(a / size),
        Math.ceil((a + len) / size) - 1,
      ];

      // ---- X axis ----
      let left = false;
      let right = false;
      if (dx !== 0) {
        const [cyA, cyB] = span(y, h, th);
        if (dx > 0) {
          const edge = x + w; // leading (right) edge
          const target = edge + dx;
          // Column boundaries the right edge crosses: c*tw in [edge, target).
          // Starting at ceil(edge/tw) skips a cell we already overlap.
          for (let c = Math.ceil(edge / tw); c * tw < target; c++) {
            let hit = false;
            for (let cy = cyA; cy <= cyB; cy++) if (blocks(c, cy, "right")) hit = true;
            if (hit) {
              x = c * tw - w;
              right = true;
              break;
            }
          }
          if (!right) x = x + dx;
        } else {
          const edge = x; // leading (left) edge
          const target = edge + dx;
          // Boundaries V = k*tw with target < V <= edge; the cell entered is k-1.
          for (let k = Math.floor(edge / tw); k * tw > target; k--) {
            const v = k * tw;
            if (v > edge) continue;
            let hit = false;
            for (let cy = cyA; cy <= cyB; cy++) if (blocks(k - 1, cy, "left")) hit = true;
            if (hit) {
              x = v;
              left = true;
              break;
            }
          }
          if (!left) x = x + dx;
        }
      }

      // ---- Y axis (uses the resolved x-span) ----
      let top = false;
      let bottom = false;
      if (dy !== 0) {
        const [cxA, cxB] = span(x, w, tw);
        if (dy > 0) {
          const edge = y + h;
          const target = edge + dy;
          for (let c = Math.ceil(edge / th); c * th < target; c++) {
            let hit = false;
            for (let cx = cxA; cx <= cxB; cx++) if (blocks(cx, c, "bottom")) hit = true;
            if (hit) {
              y = c * th - h;
              bottom = true;
              break;
            }
          }
          if (!bottom) y = y + dy;
        } else {
          const edge = y;
          const target = edge + dy;
          for (let k = Math.floor(edge / th); k * th > target; k--) {
            const v = k * th;
            if (v > edge) continue;
            let hit = false;
            for (let cx = cxA; cx <= cxB; cx++) if (blocks(cx, k - 1, "top")) hit = true;
            if (hit) {
              y = v;
              top = true;
              break;
            }
          }
          if (!top) y = y + dy;
        }
      }

      return { rect: { x, y, w, h }, dx: x - rect.x, dy: y - rect.y, left, right, top, bottom };
    },

    draw(ctx, view) {
      let cx0 = 0;
      let cy0 = 0;
      let cx1 = cols - 1;
      let cy1 = rows - 1;
      if (view) {
        cx0 = Math.max(cx0, Math.floor(view.x / tw));
        cy0 = Math.max(cy0, Math.floor(view.y / th));
        cx1 = Math.min(cx1, Math.floor((view.x + view.w) / tw));
        cy1 = Math.min(cy1, Math.floor((view.y + view.h) / th));
      }
      const bw = (cx1 - cx0 + 1) * tw;
      const bh = (cy1 - cy0 + 1) * th;
      const bctx = bw > 0 && bh > 0 ? getBufferCtx(bw, bh) : null;
      let drawn = 0;
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const t = at(cx, cy);
          if (t === 0) continue;
          if (bctx) drawTile(bctx, t, (cx - cx0) * tw, (cy - cy0) * th);
          else drawTile(ctx, t, cx * tw, cy * th);
          drawn++;
        }
      }
      if (bctx) ctx.drawImage(buffer!, 0, 0, bw, bh, cx0 * tw, cy0 * th, bw, bh);
      return drawn;
    },
  };
}
