// ---------- Tileset ----------
// Slicing a tileset image into named cells plus the selector factories that
// choose a cell per grid cell, and the offscreen palette swap that turns one
// tileset into a season of them.

import type {
  Auto4Options,
  Auto9Options,
  Cell,
  DualLayer,
  Selector,
  TileSet,
  TileSetOptions,
} from "./types.js";
import type { ClockHandle } from "@src/clock/index.js";
import { cellHash, orient } from "./cells.js";

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
    auto4(base: Cell, opts: Auto4Options = {}): DualLayer {
      const stride = opts.stride ?? 1;
      if (!Number.isInteger(stride) || stride < 1) {
        throw new Error(`Tiles.set.auto4: stride must be a positive integer`);
      }
      const baseCol = base.sx / s;
      const baseRow = base.sy / s;
      const byMask: Array<Cell | null> = [];
      for (let mask = 0; mask < 16; mask++) {
        byMask.push(cell(baseCol + (mask % 4) * stride, baseRow + Math.floor(mask / 4) * stride));
      }
      // Mask 0 touches no terrain at all. Its atlas slot stays in the 4×4 block
      // so the layout is regular, but nothing is drawn unless asked.
      byMask[0] = opts.empty ?? null;
      return { dual: (mask) => byMask[mask] ?? null, connect: opts.connect ?? "same" };
    },
    orient,
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

/** `#rgb`, `#rrggbb` or `#rrggbbaa` → packed RGBA. Throws on anything else so
 *  a typo in a palette surfaces at load time rather than as a silent no-op. */
function parseHex(color: string, where: string): [number, number, number, number] {
  const hex = color.trim().replace(/^#/, "");
  const short = hex.length === 3 || hex.length === 4;
  if (!/^[0-9a-fA-F]+$/.test(hex) || !(short || hex.length === 6 || hex.length === 8)) {
    throw new Error(`Tiles.recolor: ${where} "${color}" is not a #rgb/#rrggbb/#rrggbbaa color`);
  }
  const part = (index: number): number => {
    const at = short ? index : index * 2;
    const text = short ? hex[at] + hex[at] : hex.slice(at, at + 2);
    return parseInt(text, 16);
  };
  const hasAlpha = hex.length === 4 || hex.length === 8;
  return [part(0), part(1), part(2), hasAlpha ? part(3) : 255];
}

/** Palette-swap a tileset image, returning a NEW image usable anywhere the
 *  original was — one drawn tileset becomes snow/night/lava variants:
 *
 *      const night = Tiles.recolor(terrain, { "#7ec850": "#2c4a3b", "#8bb": "#334" });
 *
 *  Keys and values are `#rgb`/`#rrggbb`/`#rrggbbaa`; matching is exact on RGB,
 *  and a value's alpha (when given) replaces the pixel's. Fully transparent
 *  pixels are left alone. Returns the original image unchanged when no 2D
 *  canvas exists (headless/jsdom) or the image has no intrinsic size. */
export function recolor(
  image: CanvasImageSource,
  palette: Record<string, string>,
): CanvasImageSource {
  const sized = image as Partial<
    Record<"naturalWidth" | "naturalHeight" | "width" | "height", number>
  >;
  const w = Math.floor(sized.naturalWidth || Number(sized.width) || 0);
  const h = Math.floor(sized.naturalHeight || Number(sized.height) || 0);
  if (w <= 0 || h <= 0) return image;

  // Pack the palette into an int→int map once; the pixel loop is per-pixel hot.
  const map = new Map<number, number>();
  for (const [from, to] of Object.entries(palette)) {
    const [fr, fg, fb] = parseHex(from, "key");
    const [tr, tg, tb, ta] = parseHex(to, "value");
    map.set((fr << 16) | (fg << 8) | fb, (ta << 24) | (tr << 16) | (tg << 8) | tb);
  }

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext("2d");
    if (!ctx) return image;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
  } catch {
    return image;
  }

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, w, h);
  } catch {
    return image; // tainted canvas (cross-origin tileset) — leave it be
  }
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const to = map.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    if (to === undefined) continue;
    data[i] = (to >>> 16) & 0xff;
    data[i + 1] = (to >>> 8) & 0xff;
    data[i + 2] = to & 0xff;
    const alpha = (to >>> 24) & 0xff;
    if (alpha !== 255) data[i + 3] = alpha;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
