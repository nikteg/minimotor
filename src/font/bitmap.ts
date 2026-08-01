// ---------- The BitmapFont object ----------
// Construction resolves every advance up front, so drawing is a tight loop of
// `drawImage` calls with no measurement, no allocation and no string parsing.

import { blitPixelAligned } from "@src/engine/pixel-raster.js";
import { tint } from "@src/sprites/raster.js";
import type {
  BitmapFont,
  FontAtlasOptions,
  FontGlyphsOptions,
  FontImage,
  FontOptions,
  Glyph,
} from "./types.js";
import { ASCII, sliceGrid } from "./slice.js";

/** Outline offsets, in units of the outline width. */
const ROUND = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
const CROSS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

/** Build the shared font object from a resolved glyph table. Both `atlas` and
 *  `glyphs` funnel through here, so measuring and drawing behave identically
 *  however the font was described. */
function build(
  image: FontImage,
  table: Map<string, Glyph>,
  size: number,
  cellW: number,
  options: FontOptions,
): BitmapFont {
  const tracking = options.tracking ?? 0;
  const lineHeight = options.lineHeight ?? size;
  const space = options.space ?? Math.max(1, Math.round(cellW / 3));

  // A blank cell is how `sliceGrid` reports "nothing to measure here", which is
  // what a trimmed space looks like. Resolve those, and any caller overrides,
  // once — `measure` must not branch on them per character.
  for (const [ch, glyph] of table) {
    if (glyph.advance < 0) glyph.advance = space;
    const forced = options.advances?.[ch];
    if (forced !== undefined) glyph.advance = forced;
  }

  const fallback = options.fallback !== undefined ? table.get(options.fallback) : undefined;
  const glyph = (ch: string): Glyph | undefined => table.get(ch) ?? fallback;

  const advanceOf = (ch: string, extra: number): number => {
    const g = glyph(ch);
    return (g ? g.advance : space) + extra;
  };

  const measureLine = (str: string, extra: number): number => {
    let w = 0;
    for (const ch of str) w += advanceOf(ch, extra);
    // Tracking sits BETWEEN glyphs, so the last one does not pay for it —
    // otherwise every centred label drifts left by half a tracking unit.
    return str.length > 0 ? w - extra : 0;
  };

  const font: BitmapFont = {
    image,
    lineHeight,
    size,
    tracking,
    get chars() {
      return [...table.keys()];
    },
    glyph,
    measure: (str) => measureLine(str, tracking),
    measureBlock(str) {
      const lines = str.split("\n");
      let w = 0;
      for (const line of lines) w = Math.max(w, measureLine(line, tracking));
      return { w, h: lines.length * lineHeight };
    },
    wrap(str, maxWidth) {
      const out: string[] = [];
      for (const paragraph of str.split("\n")) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let line = "";
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && measureLine(candidate, tracking) > maxWidth) {
            out.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        // A word wider than `maxWidth` still gets its own line, matching
        // `UI.wrapLines`: breaking mid-word is worse than one long line.
        out.push(line);
      }
      return out;
    },
    render(ctx, str, x, y, style = {}) {
      const scale = style.scale ?? 1;
      const extra = style.tracking ?? tracking;
      const lh = style.lineHeight ?? lineHeight;
      // `tint` caches per (source, colour), so each pass costs one map lookup
      // rather than a fresh composite of the whole atlas.
      const source = style.color ? tint(image, style.color) : image;
      const lines = str.split("\n");

      const align = style.align ?? "left";
      const vAlign = style.baseline ?? "top";
      const blockH = lines.length * lh * scale;
      const top = vAlign === "top" ? y : vAlign === "middle" ? y - blockH / 2 : y - blockH;

      // Shadow first, then the outline halo, then the glyphs — back to front,
      // because each pass paints over the one before it. Offsets are in font
      // pixels scaled up, so a 1px outline on a 4x font is 4 device pixels
      // thick and matches the art rather than disappearing into a hairline.
      const passes: { dx: number; dy: number; src: typeof source }[] = [];
      if (style.shadow) {
        const colour = style.shadowColor ?? style.outline ?? "#000";
        passes.push({
          dx: style.shadow.x * scale,
          dy: style.shadow.y * scale,
          src: tint(image, colour),
        });
      }
      if (style.outline) {
        const ow = (style.outlineWidth ?? 1) * scale;
        const halo = tint(image, style.outline);
        for (const [ox, oy] of style.outlineStyle === "cross" ? CROSS : ROUND) {
          passes.push({ dx: ox * ow, dy: oy * ow, src: halo });
        }
      }
      passes.push({ dx: 0, dy: 0, src: source });

      // The whole promise of a bitmap font is exact pixels, and an upscaled
      // `drawImage` interpolates by default — which turns a 5x7 glyph at 4x
      // into the blurry mush a web font would have given. Off for the blits,
      // restored afterwards so nothing else on the frame changes behaviour.
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;

      for (const pass of passes) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineW = measureLine(line, extra) * scale;
          const left = align === "left" ? x : align === "center" ? x - lineW / 2 : x - lineW;
          let pen = left + pass.dx;
          const lineTop = top + i * lh * scale + pass.dy;
          for (const ch of line) {
            const g = glyph(ch);
            if (!g) {
              pen += (space + extra) * scale;
              continue;
            }
            if (g.sw > 0 && g.sh > 0) {
              blitPixelAligned(
                ctx,
                pass.src,
                g.sx,
                g.sy,
                g.sw,
                g.sh,
                pen + g.ox * scale,
                lineTop + g.oy * scale,
                g.sw * scale,
                g.sh * scale,
              );
            }
            pen += (g.advance + extra) * scale;
          }
        }
      }

      ctx.imageSmoothingEnabled = smoothing;
    },
  };
  return font;
}

/** Define a font from a grid atlas — the usual pixel-font sheet.
 *
 *      const font = Font.atlas(sheet, { cell: 8, chars: Font.ASCII, cols: 16 });
 *      Draw.text("READY", { x: 20, y: 20, font, color: "#ffd43b", scale: 3 });
 *
 *  Glyphs are trimmed to their ink by default, so the sheet renders
 *  proportionally rather than as a fixed-pitch grid. Pass `trim: false` for a
 *  genuinely monospaced font (a HUD of digits that must not jitter). */
export function atlas(image: FontImage, options: FontAtlasOptions): BitmapFont {
  const cellW = typeof options.cell === "number" ? options.cell : options.cell.w;
  const cellH = typeof options.cell === "number" ? options.cell : options.cell.h;
  if (!(cellW > 0) || !(cellH > 0)) throw new Error("Font.atlas: cell must be a positive size");
  const gap = options.gap ?? 0;
  const originX = options.origin?.x ?? 0;
  const originY = options.origin?.y ?? 0;
  const cols =
    options.cols ?? Math.max(1, Math.floor((image.width - originX + gap) / (cellW + gap)));
  const chars = options.chars ?? ASCII;
  const table = sliceGrid(
    image,
    chars,
    { cellW, cellH, cols, originX, originY, gap },
    options.trim ?? true,
  );
  if (table.size === 0) {
    throw new Error(
      `Font.atlas: no glyph fits — a ${cellW}x${cellH} cell at (${originX}, ${originY}) ` +
        `does not land inside the ${image.width}x${image.height} atlas`,
    );
  }
  return build(image, table, cellH, cellW, options);
}

/** Define a font from arbitrary rects, for a sheet that is not a grid.
 *
 *      const font = Font.glyphs(sheet, {
 *        glyphs: { A: [0, 0, 5, 7], B: [6, 0, 5, 7], "!": [12, 0, 1, 7] },
 *      });
 *
 *  Values are `[x, y, w, h]`, or a full `Glyph` when a character needs its own
 *  `advance` or offset. */
export function glyphs(image: FontImage, options: FontGlyphsOptions): BitmapFont {
  const table = new Map<string, Glyph>();
  let tallest = 0;
  let widest = 0;
  for (const [ch, spec] of Object.entries(options.glyphs)) {
    const g: Glyph = Array.isArray(spec)
      ? { sx: spec[0], sy: spec[1], sw: spec[2], sh: spec[3], advance: spec[2], ox: 0, oy: 0 }
      : { ...(spec as Glyph) };
    table.set(ch, g);
    tallest = Math.max(tallest, g.sh);
    widest = Math.max(widest, g.advance);
  }
  if (table.size === 0) throw new Error("Font.glyphs: at least one glyph is required");
  return build(image, table, options.size ?? tallest, widest, options);
}
