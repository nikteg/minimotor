import { Flowable } from "../../ui/core/index.js";
/** Options for `spinner()`. Give `x`/`y` (the arc's CENTER) to place it by
 *  hand, or omit them to AUTO-FLOW into the current `row`/`col`/`panel` (a
 *  2·`r` slot, spinning in its middle). */
export interface SpinnerOptions extends Flowable {
    /** Arc radius in px. Default `8`. */
    r?: number;
    /** Stroke color. Default `theme.accent`. */
    color?: string;
    /** Stroke width in px. Default `3`. */
    lineWidth?: number;
}
/** A rotating "busy" arc for in-flight work (loading, refreshing). Advances
 *  on the fixed step, so it pauses with the loop:
 *
 *    if (refreshing) UI.spinner({ x, y });   // x/y = arc center
 *    if (busy) UI.spinner();                 // auto-flows into the current row */
export declare function spinner(opts?: SpinnerOptions): void;
