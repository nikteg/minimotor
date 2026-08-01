// ---------- Bitmap fonts ----------
// Text drawn from an ATLAS instead of a typeface: the glyphs are pixels you
// shipped, so they look identical on every machine, at every scale, forever.
//
// WHY NOT JUST A WEB FONT
//
// A pixel .ttf is hinted, antialiased and rounded by the browser's text
// rasteriser, which is tuned to make small text READABLE — precisely the
// opposite of what a 6px font wants. At 3x it is blurry, at fractional scales
// it wobbles, and it renders differently on macOS than on Windows. A bitmap
// font is `drawImage`: exact pixels, pixel-snapped, no rasteriser involved.
// It is also the only way to use the font a pixel-art asset pack shipped,
// because those come as a PNG strip, not a font file.
//
// DEFINING ONE
//
//     const font = Font.atlas(sheet, { cell: 8, chars: Font.ASCII, cols: 16 });
//
// That is the whole common case: a grid of 8x8 cells holding printable ASCII.
// For a sheet that is not a grid, name the rects yourself:
//
//     const font = Font.glyphs(sheet, { glyphs: { A: [0, 0, 5, 7], ... } });
//
// PROPORTIONAL BY DEFAULT
//
// Grid sheets are drawn on a grid, but the glyphs inside are not the same
// width — "i" inks two pixels of its eight-pixel cell. Blitting whole cells is
// why hand-rolled bitmap text so often comes out looking gappy and wrong, so
// `atlas` measures each cell's ink and advances by THAT. Pass `trim: false`
// for a genuinely monospaced font, which is what a column of HUD digits wants
// so the numbers stop jittering as they count.
//
// The measuring reads the atlas's pixels. When it cannot — a cross-origin
// image taints the canvas, and a test environment has no rasteriser — the font
// falls back to monospaced rather than failing to load.
//
// DRAWING
//
// Hand it to `Draw.text` wherever a CSS font string would go:
//
//     Draw.text("READY", { x: 20, y: 20, font, color: "#ffd43b", scale: 3 });
//
// `color` tints (the atlas is usually white art), `scale` should stay a whole
// number, and "\n" starts a new line. Or drive it directly — `font.measure`,
// `font.wrap` and `font.render` are the same calls `Draw.text` makes.
//
// NOT COVERED
//
//   - `UI.text` and the widget theme still take a CSS font string. Bitmap
//     fonts are for `Draw.text` and for drawing yourself.
//   - No kerning pairs. `tracking` is uniform, and `advances` overrides one
//     character at a time.

export { atlas, glyphs } from "./bitmap.js";
export { ASCII } from "./slice.js";
export type {
  BitmapFont,
  FontAtlasOptions,
  FontGlyphsOptions,
  FontImage,
  FontOptions,
  Glyph,
  TextStyle as BitmapTextStyle,
} from "./types.js";
