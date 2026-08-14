import { Flowable } from "../../ui/core/index.js";
/** A horizontal meter (health, progress, charge): a track with `value` (0..1,
 *  clamped) of it filled from the left. Give an explicit rect, or omit `x`/`y`
 *  to AUTO-FLOW into the current `row`/`col`/`panel` — it fills the cross axis
 *  (a col's width) at the theme's default bar thickness. */
export interface BarOptions extends Flowable {
    /** Fill fraction, 0..1 (clamped). */
    value: number;
    /** Track color behind the fill. Default a faint white tint. */
    bg?: string;
    /** Fill color. Default `theme.accent`. */
    fill?: string;
}
/** Draw a horizontal meter per `BarOptions`:
 *
 *    UI.bar({ x, y, w: 120, h: 8, value: hp / maxHp, fill: "#ff6b6b" });
 *    UI.bar({ value: loadFrac });   // auto-flows into the current col */
export declare function bar(opts: BarOptions): void;
