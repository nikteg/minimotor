import { Flowable } from "../../ui/core/index.js";
/** A labeled checkbox. */
export interface ToggleOptions extends Flowable {
    /** Stable identity enables Tab focus and keyboard activation. */
    id?: string;
    /** Keyboard traversal order. Negative values exclude the toggle. */
    tabIndex?: number;
    /** Grayed out and unclickable. */
    disabled?: boolean;
    /** Slot height when placed in a layout (the box centers within it). */
    h?: number;
    /** Text drawn right of the box (also part of the click target). */
    label: string;
    /** Current value — pass your state in, assign the return value back. */
    on: boolean;
    /** Box side length in px. Default `16`. */
    size?: number;
    /** Use a round radio-control appearance instead of a square checkbox. */
    appearance?: "checkbox" | "radio";
    /** Label font. Default `uiFont()`. */
    font?: string;
    /** Label color. Default `theme.text`. */
    color?: string;
    /** Shown near the pointer after hovering a moment (see `drawTips`). */
    tooltip?: string;
}
/** Draw a checkbox + label; returns the (possibly flipped) new value:
 *
 *    hideFull = UI.toggle({ x, y, label: "Hide full", on: hideFull }); */
export declare function toggle(label: string, on: boolean, opts?: Omit<ToggleOptions, "label" | "on">): boolean;
export declare function toggle(opts: ToggleOptions): boolean;
