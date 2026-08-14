import type { FontImage, Glyph } from "./types.js";
/** Printable ASCII, `space` through `~`, in code-point order. The layout
 *  virtually every pixel-font sheet on itch.io ships with — 95 cells, usually
 *  as 16 columns of 6 rows (the last row short) or a single strip. */
export declare const ASCII: string;
/** Alpha of every pixel in the atlas, or `null` when the pixels cannot be read
 *  — a cross-origin image taints the canvas, and jsdom has no rasteriser at
 *  all. Callers must treat `null` as "no trimming possible", never as an
 *  error: a font that silently became monospaced is far better than a game
 *  that fails to boot. */
export declare function alphaMap(image: FontImage): {
    data: Uint8ClampedArray;
    w: number;
} | null;
export interface GridSpec {
    cellW: number;
    cellH: number;
    cols: number;
    originX: number;
    originY: number;
    gap: number;
}
/** Slice `chars` out of a grid atlas into glyphs.
 *
 *  `trim` is where a grid sheet stops looking like a grid sheet: each glyph is
 *  narrowed to its own ink, so "i" advances 2px and "W" advances 8. Blank cells
 *  come back with `advance: -1`, which the caller replaces with the space
 *  width — a trimmed space has no ink to measure. */
export declare function sliceGrid(image: FontImage, chars: string, grid: GridSpec, trim: boolean | number): Map<string, Glyph>;
