/** A tiny fixed-capacity history graph: `push` a sample per frame, `draw`
 *  renders right-aligned bars scaled to the window's max. Ring buffer —
 *  no allocations after creation. */
export interface Sparkline {
    /** Record one sample, evicting the oldest once at capacity. */
    push(v: number): void;
    /** Draw the history as bars in the box `x`,`y`,`w`,`h`, filled with `color`.
     *  Heights scale to the window's max; newest bar sits flush with the right
     *  edge. No-op until the first `push`. */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void;
}
/** Create a fixed-capacity sparkline backed by a ring buffer — `capacity`
 *  samples of history (default `WINDOW`), no allocations after creation. */
export declare function createSparkline(capacity?: number): Sparkline;
