import type { TextHAlign, TextVAlign } from "../engine/text.js";
/** An image with known dimensions — a loaded `<img>`, a canvas, an
 *  `ImageBitmap`. The same shape `Sprites.contentBounds` takes. */
export type FontImage = CanvasImageSource & {
    width: number;
    height: number;
};
/** One character's placement in the atlas, in source pixels. */
export interface Glyph {
    /** Source rect in the atlas image. */
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    /** How far the pen moves after drawing this glyph, BEFORE `tracking`. */
    advance: number;
    /** Offset from the pen to the glyph's top-left. Non-zero when a sheet packs
     *  glyphs tighter than they should render (accents, descenders). */
    ox: number;
    oy: number;
}
/** Per-draw overrides. Everything here is optional; a font drawn with no
 *  options renders top-left, unscaled, in its own colours. */
export interface TextStyle {
    /** Recolour every opaque pixel. Bitmap fonts are usually drawn white so
     *  this can tint them; omit to blit the atlas art untouched. */
    color?: string;
    /** Integer upscale factor. Pixel fonts want whole numbers — 2, 3, 4 — or
     *  the glyph grid lands between device pixels and shimmers. Default 1. */
    scale?: number;
    /** Horizontal anchor of `x`. Default "left". */
    align?: TextHAlign;
    /** Vertical anchor of `y`, over the whole block for multi-line text.
     *  Default "top". */
    baseline?: TextVAlign;
    /** Extra pixels between glyphs, added to each advance. Overrides the font's
     *  own `tracking` for this draw. */
    tracking?: number;
    /** Line spacing in pixels. Overrides the font's `lineHeight`. */
    lineHeight?: number;
    /** Draw a halo of this colour behind the glyphs. What makes small text stay
     *  legible over busy terrain, and it costs nothing to measure — the outline
     *  grows outward, so the text still occupies `measure(str)` pixels. */
    outline?: string;
    /** Outline thickness in FONT pixels, so it scales with `scale` and stays
     *  chunky rather than hairline. Default 1. */
    outlineWidth?: number;
    /** "round" surrounds each glyph on all eight neighbours; "cross" uses only
     *  the four orthogonal ones, which is thinner and cheaper and is what most
     *  pixel art actually wants. Default "round". */
    outlineStyle?: "round" | "cross";
    /** Offset of a drop shadow in font pixels. Needs `shadowColor`. */
    shadow?: {
        x: number;
        y: number;
    };
    /** Colour of the `shadow` offset. Default: the outline colour, else black. */
    shadowColor?: string;
}
/** A font whose glyphs are pixels in an atlas rather than curves in a typeface.
 *
 *  Hand it to `Draw.text` as `font`, or drive it directly with `measure`,
 *  `wrap` and `render`. */
export interface BitmapFont {
    /** The atlas the glyphs are blitted from. */
    readonly image: FontImage;
    /** Height of one line, including leading. */
    readonly lineHeight: number;
    /** Cell height — the em box every glyph was sliced from. */
    readonly size: number;
    /** Default extra pixels between glyphs. */
    readonly tracking: number;
    /** Every character this font can draw. */
    readonly chars: readonly string[];
    /** Look one character up, or `undefined` if the font has no glyph for it. */
    glyph(ch: string): Glyph | undefined;
    /** Width in pixels of a single line at `scale` 1. Newlines are NOT handled —
     *  see `measureBlock`. */
    measure(str: string): number;
    /** Width and height of `str` including its newlines, at `scale` 1. */
    measureBlock(str: string): {
        w: number;
        h: number;
    };
    /** Greedy word-wrap to lines no wider than `maxWidth` pixels. */
    wrap(str: string, maxWidth: number): string[];
    /** Draw `str` at (x, y). Honours "\n". This is what `Draw.text` calls. */
    render(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, style?: TextStyle): void;
}
/** Shared options for every way of defining a font. */
export interface FontOptions {
    /** Extra pixels between glyphs. A trimmed font almost always wants 1 —
     *  without it, proportional glyphs touch. Default 0. */
    tracking?: number;
    /** Line height. Default: the cell height. */
    lineHeight?: number;
    /** Advance for characters the atlas has no glyph for, and for glyphs that
     *  turn out to be blank (which is how a trimmed space is detected).
     *  Default: a third of the cell width, rounded. */
    space?: number;
    /** Draw this character in place of any the font is missing. Default: draw
     *  nothing and advance by `space`. */
    fallback?: string;
    /** Force specific advances, keyed by character. The escape hatch for the one
     *  glyph auto-trimming gets wrong — a "." should not be 1px wide. */
    advances?: Readonly<Record<string, number>>;
}
/** Options for `Font.atlas` — a font laid out on a regular grid. */
export interface FontAtlasOptions extends FontOptions {
    /** Cell size in pixels. A number means a square cell. */
    cell: number | {
        w: number;
        h: number;
    };
    /** The characters, in atlas order, row-major. Default `Font.ASCII`. */
    chars?: string;
    /** Cells per row. Default: as many as fit the image width. */
    cols?: number;
    /** Top-left of the grid within the image, for sheets with a margin. */
    origin?: {
        x: number;
        y: number;
    };
    /** Gap between cells in the image, in pixels. Default 0. */
    gap?: number;
    /** Narrow each glyph to the pixels it actually inks, making the font
     *  PROPORTIONAL instead of monospaced. Default true — a grid sheet drawn
     *  monospaced is the single most common reason bitmap text looks wrong.
     *  Pass a number to set the alpha threshold (default 8), or `false` to keep
     *  every glyph the full cell width. */
    trim?: boolean | number;
}
/** Options for `Font.glyphs` — a font whose characters sit at arbitrary rects.
 *  What you reach for when the sheet is not a grid, or when a `.fnt`-style
 *  description already told you where everything is. */
export interface FontGlyphsOptions extends FontOptions {
    /** Source rect per character: `[x, y, w, h]`, or a full `Glyph` when you
     *  need to control `advance`/`ox`/`oy` yourself. */
    glyphs: Readonly<Record<string, readonly [number, number, number, number] | Glyph>>;
    /** Em height, used for `size` and the default `lineHeight`.
     *  Default: the tallest glyph. */
    size?: number;
}
