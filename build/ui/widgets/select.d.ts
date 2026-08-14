import { Flowable } from "../../ui/core/index.js";
import type { ThemePadding, ThemeTextPadding } from "../../ui/theme.js";
export interface SelectEditor {
    id: string;
    select: HTMLSelectElement;
    index: number;
    changed: boolean;
    open: boolean;
    justOpened: boolean;
    /** Drop-menu scroll offset (px) — the menu is a `list` scroll region. */
    scroll: number;
    /** `index` as of last frame, to detect keyboard moves and scroll to them. */
    lastIndex: number;
}
export interface SelectOverlayRequest<T = unknown> {
    ctx: CanvasRenderingContext2D;
    opts: ResolvedSelectOptions<T>;
    /** The control's rect in the coords it was DRAWN in (reference coords inside
     *  a `UI.scaled` block). The overlay pass re-applies `transform` before
     *  drawing, so the menu anchors under the control and zooms with it. */
    rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** The UI transform in force when the select drew, or `null` at the root —
     *  the overlay pass runs after every `UI.scaled` block has popped, so the
     *  menu has to restore it itself. `w`/`h` are the reference-space size. */
    transform: {
        scale: number;
        ox: number;
        oy: number;
        w: number;
        h: number;
    } | null;
    /** Theme scope captured where the control was drawn. Deferred overlays run
     *  after lexical layout scopes have unwound, so restore it explicitly. */
    theme: import("../../ui/theme.js").Theme;
}
/** One entry in a `select` dropdown: a `label` and the `value` it yields. */
export interface SelectOption<T> {
    /** Text shown for this option. */
    label: string;
    /** Value returned when this option is chosen. */
    value: T;
    /** Non-selectable (grayed in the list). */
    disabled?: boolean;
}
/** A labeled section in a grouped select menu. Group headers are visual and
 *  non-selectable; their options keep the same value/keyboard semantics as a
 *  flat `options` list. */
export interface SelectGroup<T> {
    label: string;
    options: readonly SelectOption<T>[];
}
/** Inputs to `select`: the controlled `value`, the `options` list, geometry,
 *  and native `<select>` hints. */
export interface SelectOptions<T> extends Flowable {
    /** Stable identity. May be omitted inside `UI.idScope()`. */
    id?: string;
    /** Current value — controlled; matched against `options` by `Object.is`.
     *  Assign the result's `value` back. */
    value: T;
    /** The selectable options (label + value). Omit when using `groups`. */
    options?: readonly SelectOption<T>[];
    /** Optional labeled sections. When present, these are flattened for the
     *  controlled value but rendered with non-selectable group headers. */
    groups?: readonly SelectGroup<T>[];
    /** Control width in px. Default `180`; the drop menu matches it. */
    w?: number;
    /** Control height in px. Default `32`. */
    h?: number;
    /** Additional inset for the selected label inside the closed control. A
     *  scalar applies to both axes; an object can separate x/y. Defaults to the
     *  theme's `textPad`. */
    textPad?: ThemeTextPadding;
    /** Grayed out; won't open. */
    disabled?: boolean;
    /** Shown when no option matches `value`. Default `"Select…"`. */
    placeholder?: string;
    /** Max option rows shown at once; the list windows around the current
     *  selection. Default `8`. */
    maxVisible?: number;
    /** Inner padding between the dropdown frame and its option list. Defaults
     *  to `theme.panel.padding`, so tiled frames keep their fixed border slices clear. */
    menuPad?: ThemePadding;
    /** Wrap long option labels onto as many lines as they need. Default `false`. */
    wrapItems?: boolean;
    /** Accessible name for the hidden `<select>`. Falls back to `id`. */
    ariaLabel?: string;
    /** Keyboard traversal order. Negative values exclude the select. */
    tabIndex?: number;
}
/** What `select` returns this frame: the selected `value` plus changed/open
 *  flags. */
export interface SelectResult<T> {
    /** Currently selected value — assign it back to your state. */
    value: T;
    /** `true` for the one frame the selection changed. */
    changed: boolean;
    /** `true` while the drop menu is open. */
    open: boolean;
}
type ResolvedSelectOptions<T> = SelectOptions<T> & {
    id: string;
    options: readonly SelectOption<T>[];
};
export declare function removeSelectEditor(): void;
export declare function openSelectEditor<T>(opts: ResolvedSelectOptions<T>, index: number, menuOpen?: boolean): void;
/** Themed dropdown backed by a hidden native `<select>`. Clicking opens a
 * canvas option list; focused keyboard arrows (native) and gamepad d-pad/stick
 * (via the focus machine) update the same controlled value. Controlled: pass
 * `value` in, assign the result's `value` back:
 *
 *     mode = UI.select({
 *       id: "mode",
 *       value: mode,
 *       options: [{ label: "Easy", value: "easy" }, { label: "Hard", value: "hard" }],
 *     }).value;
 */
export declare function select<T>(opts: SelectOptions<T>): SelectResult<T>;
export declare function drawSelectOverlay(): void;
export declare function selectEndFrame(): void;
/** Reset all select state — for tests (see frame `_reset`). */
export declare function resetSelect(): void;
export {};
