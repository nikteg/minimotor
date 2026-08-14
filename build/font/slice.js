// ---------- Turning an atlas into glyphs ----------
// Everything here is measurement, done ONCE when the font is defined. Nothing
// in this file runs while drawing.
import { scratchCanvas, scratchContext } from "../engine/offscreen.js";
/** Printable ASCII, `space` through `~`, in code-point order. The layout
 *  virtually every pixel-font sheet on itch.io ships with — 95 cells, usually
 *  as 16 columns of 6 rows (the last row short) or a single strip. */
export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
/** Alpha of every pixel in the atlas, or `null` when the pixels cannot be read
 *  — a cross-origin image taints the canvas, and jsdom has no rasteriser at
 *  all. Callers must treat `null` as "no trimming possible", never as an
 *  error: a font that silently became monospaced is far better than a game
 *  that fails to boot. */
export function alphaMap(image) {
    const w = Math.max(1, Math.ceil(image.width));
    const h = Math.max(1, Math.ceil(image.height));
    try {
        const cv = scratchCanvas(w, h);
        const ctx = scratchContext(cv);
        if (!ctx)
            return null;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, w, h).data;
        // A context that exists but rasterises nothing (jsdom, a headless mock,
        // an image that has not decoded yet) reports every pixel transparent.
        // Trimming against that would collapse the whole font to zero width, so
        // treat a completely blank atlas as unreadable rather than as a font.
        for (let i = 3; i < pixels.length; i += 4)
            if (pixels[i] !== 0)
                return { data: pixels, w };
        return null;
    }
    catch {
        return null;
    }
}
/** The horizontal span of inked pixels inside a cell, or `null` when the cell
 *  is blank. Only the x axis is trimmed: narrowing a glyph vertically would
 *  move it off the shared baseline. */
function inkSpan(alpha, x0, y0, cw, ch, threshold) {
    let minX = cw;
    let maxX = -1;
    for (let y = 0; y < ch; y++) {
        const row = (y0 + y) * alpha.w;
        for (let x = 0; x < cw; x++) {
            if (alpha.data[(row + x0 + x) * 4 + 3] > threshold) {
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
            }
        }
    }
    return maxX < 0 ? null : { x: minX, w: maxX - minX + 1 };
}
/** Slice `chars` out of a grid atlas into glyphs.
 *
 *  `trim` is where a grid sheet stops looking like a grid sheet: each glyph is
 *  narrowed to its own ink, so "i" advances 2px and "W" advances 8. Blank cells
 *  come back with `advance: -1`, which the caller replaces with the space
 *  width — a trimmed space has no ink to measure. */
export function sliceGrid(image, chars, grid, trim) {
    const threshold = typeof trim === "number" ? trim : 8;
    const alpha = trim === false ? null : alphaMap(image);
    const out = new Map();
    const list = Array.from(chars);
    for (let i = 0; i < list.length; i++) {
        const col = i % grid.cols;
        const row = Math.floor(i / grid.cols);
        const sx = grid.originX + col * (grid.cellW + grid.gap);
        const sy = grid.originY + row * (grid.cellH + grid.gap);
        // A `chars` longer than the sheet is a typo in the caller's charset, not
        // something to paper over with glyphs read from outside the image.
        if (sx + grid.cellW > image.width || sy + grid.cellH > image.height)
            break;
        const span = alpha ? inkSpan(alpha, sx, sy, grid.cellW, grid.cellH, threshold) : null;
        if (alpha && !span) {
            out.set(list[i], { sx, sy, sw: 0, sh: grid.cellH, advance: -1, ox: 0, oy: 0 });
            continue;
        }
        const x = span ? span.x : 0;
        const w = span ? span.w : grid.cellW;
        out.set(list[i], { sx: sx + x, sy, sw: w, sh: grid.cellH, advance: w, ox: 0, oy: 0 });
    }
    return out;
}
