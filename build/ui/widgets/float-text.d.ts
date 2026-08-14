/** Options for a floating text. */
export interface FloatTextOptions {
    /** Rise speed in px/s (negative = up). Default -50. */
    vy?: number;
    /** Sideways drift in px/s (negative = left). Default 0. This is how a pop
     *  stays with the thing that spawned it in a side-scroller: pass the world's
     *  scroll speed and the "+10" rides along instead of hanging in screen space. */
    vx?: number;
    /** Lifetime in ms. Default 900. */
    life?: number;
    /** Fill color. Default "#fff". */
    color?: string;
    /** Outline color drawn behind the glyphs — the cheap way to stay legible over
     *  busy art. Off by default. */
    stroke?: string;
    /** Outline thickness in px. Default 3 (ignored without `stroke`). */
    strokeWidth?: number;
    /** Font size in px. Default 14. */
    size?: number;
    /** Bold. Default true — a pop has to read in the half-second it exists. */
    bold?: boolean;
    /** Full font string — overrides `size`/`bold`/the theme font entirely. */
    font?: string;
    /** Uniform draw scale for the glyphs and the rise speed. Default 1.
     *  `UI.floatText` fills this in from the active `UI.scaled` factor so a text
     *  spawned inside a zoomed board pops at the board's size. */
    scale?: number;
}
/** One live floating text in a pool — the record `spawn` creates and
 *  `advance`/`draw` consume. */
export interface FloatText {
    /** The string drawn. */
    text: string;
    /** Center x in px (the text is drawn centered on its position). */
    x: number;
    /** Center y in px — drifts by `vy` as the text ages. */
    y: number;
    /** Vertical drift in px/s (negative = up). */
    vy: number;
    /** Horizontal drift in px/s (negative = left). */
    vx: number;
    /** Total lifetime in ms; the text fades out over its last half. */
    life: number;
    /** Time left in ms; the text is removed when it reaches 0. */
    remaining: number;
    /** Fill color. */
    color: string;
    /** Outline color, or "" for no outline. */
    stroke: string;
    /** Outline thickness in px. */
    strokeWidth: number;
    /** Canvas font string. */
    font: string;
    /** Uniform draw scale for the glyphs (1 = unscaled). */
    scale: number;
}
/** A pool of rising, fading texts. Pure — drive `advance(dt)` yourself
 * (app-bound UI wires its shared manager to the fixed step). */
export interface FloatTextManager {
    /** Spawn a rising text at `(x, y)`; `opts` tunes drift/lifetime/color/font. */
    spawn(text: string, x: number, y: number, opts?: FloatTextOptions): void;
    /** Age every text by `dt` ms; expired ones are removed. */
    advance(dt: number): void;
    /** Draw all live texts, centered on their (drifting) position. */
    draw(ctx: CanvasRenderingContext2D): void;
    /** Remove every text at once. */
    clear(): void;
    /** Number of live texts currently in the pool. */
    readonly size: number;
}
/** Create a fresh, empty `FloatTextManager` pool. App-bound `UI` keeps a
 *  shared one (`UI.floatText`); make your own for an isolated set of texts. */
export declare function createFloatText(): FloatTextManager;
/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloatText`. Coords are
 *  taken in the CURRENT space: spawn inside a `UI.scaled` block and the point is
 *  mapped to screen for you — and the block's scale rides along — so it still
 *  lands (and sizes) right when `drawFloatText` paints it later, after the
 *  transform is gone.
 *
 *  Omit `x`/`y` to ANCHOR: the text rises from the top-center of the last
 *  placed widget, so a flowing button needs no coordinates:
 *
 *    if (UI.button("Collect")) UI.floatText("+10");   // pops above the button */
export declare function floatText(str: string, opts?: FloatTextOptions): void;
export declare function floatText(str: string, x: number, y: number, opts?: FloatTextOptions): void;
/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export declare function drawFloatText(): void;
/** Remove all floating texts (e.g. on scene change). */
export declare function clearFloatText(): void;
