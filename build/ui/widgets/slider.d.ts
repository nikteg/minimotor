import { Flowable } from "../../ui/core/index.js";
/** A horizontal value slider. */
export interface SliderOptions extends Flowable {
    /** Widget width in px (label + track). Default `140`. */
    w?: number;
    /** Slot height in px. Default `30`. */
    h?: number;
    /** Range minimum. Default `0`. */
    min?: number;
    /** Range maximum. Default `1`. */
    max?: number;
    /** Current value — pass your state in, assign the return value back. */
    value: number;
    /** Snap increment (e.g. 5) — also the arrow-key step when the slider has
     *  keyboard focus. Default continuous, with arrow keys stepping by
     *  (max − min) / 100. */
    step?: number;
    /** Caption drawn left of the track. */
    label?: string;
    /** Value text drawn right of the track. By default unit ranges show two
     *  decimals, stepped ranges match their step precision, and others round. */
    format?: (v: number) => string;
    /** Identity for drag tracking and keyboard focus. Defaults to the position. */
    id?: string;
    /** Keyboard traversal order. Negative values exclude the slider. */
    tabIndex?: number;
    /** Grayed out; ignores pointer and arrow keys. */
    disabled?: boolean;
    /** Label/value font. Default `uiFont()`. */
    font?: string;
    /** Label and value-text color. Default `theme.text`. */
    color?: string;
    /** The grab: the pointer went down on this slider's track or knob. Paired
     *  with `onRelease`, and NOTHING is called for the value changes in
     *  between — which is the whole point of the pair.
     *
     *  A slider's value moves once per frame while it is being dragged, so a
     *  caller that hangs a click, a haptic or a save on "the value changed" fires
     *  it sixty times a second. Trash Golf's volume sliders played the
     *  interface's click on every step and machine-gunned across a drag
     *  (31 clips for one sweep of the track). Grab and let-go are the two edges a
     *  gesture actually has, and they are the two the kit had no way to report. */
    onPress?: () => void;
    /** The let-go: the drag this slider owned has ended, wherever the pointer
     *  came up — including outside the widget, and including a press that never
     *  moved the value at all.
     *
     *  Exactly one per `onPress`, EXCEPT when the slider stops being drawn while
     *  the drag is live (its modal closed under the finger): a widget that is not
     *  drawn cannot be told anything, and the pending let-go is dropped rather
     *  than saved up for whenever it is next drawn. */
    onRelease?: () => void;
}
/** Draw a slider and return the (possibly changed) new value — drag the knob
 *  or click anywhere on the track:
 *
 *    volume = UI.slider({ x, y, w: 140, value: volume, label: "VOL" }); */
export declare function slider(label: string, value: number, opts?: Omit<SliderOptions, "label" | "value">): number;
export declare function slider(opts: SliderOptions): number;
