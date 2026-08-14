/** What every measuring caller in the UI actually wants. `asc`/`desc` are the
 *  real glyph bounds relative to the ALPHABETIC baseline (see `metrics`). */
export interface GlyphMetrics {
    /** Advance width in px. */
    width: number;
    /** Distance above the alphabetic baseline the glyphs actually reach; 0 when
     *  the context reports no bounding-box metrics (mocked ctx in tests). */
    asc: number;
    /** Distance below the alphabetic baseline the glyphs actually reach. */
    desc: number;
}
/** Font-level vertical metrics used for a stable line baseline. Unlike
 * `GlyphMetrics`, these must not depend on the characters in the current
 * string: otherwise `p`, `g`, and `y` make otherwise aligned labels move. */
export interface LineMetrics {
    asc: number;
    desc: number;
}
/** Measure `str` in the context's CURRENT font, memoized per (font, string).
 *
 *  `actualBoundingBox*` is reported relative to the active `textBaseline`, so
 *  this pins the baseline to "alphabetic" while measuring (and puts it back) —
 *  otherwise a caller mid-draw with `textBaseline: "middle"` would poison the
 *  cache with shifted metrics for every later reader.
 *
 *  The result is CACHED AND SHARED: read it, don't mutate it. */
export declare function metrics(ctx: CanvasRenderingContext2D, str: string): GlyphMetrics;
/** Measure the active font's stable line box. Modern Canvas implementations
 * expose font-level bounds directly; the representative sample is the
 * fallback for browsers and test contexts that only expose actual glyph
 * bounds. */
export declare function lineMetrics(ctx: CanvasRenderingContext2D): LineMetrics;
/** Advance width of `str` in the context's current font — the memoized
 *  replacement for `ctx.measureText(str).width`. */
export declare function measureWidth(ctx: CanvasRenderingContext2D, str: string): number;
