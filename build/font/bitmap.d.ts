import type { BitmapFont, FontAtlasOptions, FontGlyphsOptions, FontImage } from "./types.js";
/** Define a font from a grid atlas — the usual pixel-font sheet.
 *
 *      const font = Font.atlas(sheet, { cell: 8, chars: Font.ASCII, cols: 16 });
 *      Draw.text("READY", { x: 20, y: 20, font, color: "#ffd43b", scale: 3 });
 *
 *  Glyphs are trimmed to their ink by default, so the sheet renders
 *  proportionally rather than as a fixed-pitch grid. Pass `trim: false` for a
 *  genuinely monospaced font (a HUD of digits that must not jitter). */
export declare function atlas(image: FontImage, options: FontAtlasOptions): BitmapFont;
/** Define a font from arbitrary rects, for a sheet that is not a grid.
 *
 *      const font = Font.glyphs(sheet, {
 *        glyphs: { A: [0, 0, 5, 7], B: [6, 0, 5, 7], "!": [12, 0, 1, 7] },
 *      });
 *
 *  Values are `[x, y, w, h]`, or a full `Glyph` when a character needs its own
 *  `advance` or offset. */
export declare function glyphs(image: FontImage, options: FontGlyphsOptions): BitmapFont;
