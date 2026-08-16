import { ButtonVariant } from "./button.js";
import { PanelFrame } from "./panel.js";
import { LayoutChildren } from "../../ui/core/index.js";
/** An anchored floating panel (dropdown, filter flyout). */
export interface PopoverOptions extends Omit<PanelFrame, "x" | "y" | "w" | "h"> {
    /** Open state — pass yours in, assign the return value back. */
    open: boolean;
    /** Escape and gamepad B, exactly as `modal`'s does.
     *
     *  A popover already closes on a click outside itself; this is the KEYBOARD
     *  half of the same intention, and without it a popover was the one
     *  dismissable overlay in the kit that a keyboard could not close — `modal`
     *  has answered Escape all along. Reported against a JOIN BY CODE box that
     *  took a click on CANCEL, on JOIN, or outside, and nothing else.
     *
     *  Separate from any click handler for the reason `modal` keeps them
     *  separate: only a real click may do the things a browser allows only from
     *  one, and a key press is not one. */
    onDismiss?: () => void;
    /** Identity across frames. Defaults to the position. */
    id?: string;
    /** Left edge in px. OMIT (with `y`) to ANCHOR to the last placed widget —
     *  the popover opens under it (flipping above when out of room, clamped to
     *  the viewport), so a trigger button in a flowing layout needs no
     *  coordinates at all. */
    x?: number;
    /** Top edge in px (see `x`). */
    y?: number;
    /** Explicit width. Omit in the `children` form to auto-size to its content. */
    w?: number;
    /** Explicit height. OMIT when using the `children` form — the box then
     *  AUTO-SIZES to its content (measured last frame, à la `group`). */
    h?: number;
    /** Gap between children (children form). Default 8. */
    gap?: number;
    /** Inner padding (children form). Default 12. */
    pad?: number;
}
/** A floating panel that closes on a click anywhere outside (the click is
 *  swallowed — it can't also activate whatever sits underneath). While open,
 *  the popover is an overlay: every widget drawn BEFORE it in the frame goes
 *  input-dead; widgets drawn after (its contents) work normally. The VALUE
 *  form draws a fixed box (`h` required) you fill yourself; the CHILDREN form
 *  (`popover(opts, () => {...})`) lays widgets out inside and AUTO-SIZES its
 *  height to them (omit `h`). Returns the new open state — assign it back. A
 *  close button inside the closure can't override that return, so set your own
 *  flag: `if (closed) open = false;`.
 *
 *    if (UI.button(trigger)) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ x, y, w: 240, h: 120, open: filtersOpen });
 *    if (filtersOpen) { ...toggles/sliders at x/y... }
 *
 *  Or ANCHORED — omit `x`/`y` right after the trigger and it opens under it:
 *
 *    if (UI.button("Filters…")) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ w: 240, open: filtersOpen }, () => { ... }); */
export declare function popover(opts: PopoverOptions): boolean;
export declare function popover(opts: PopoverOptions, children: () => void): boolean;
/** A centered dialog over a dimmed backdrop. */
export interface ModalOptions {
    /** Preferred dialog width in px. Clamped inside the viewport. Default 360. */
    w?: number;
    /** Dialog height in px. REQUIRED in the value form; omit it in the children
     *  form and the dialog auto-sizes to its content (measured last frame). */
    h?: number;
    /** Optional title, drawn in the panel's title strip. */
    title?: string;
    /** Stable identity for the auto-size cache (children form). Defaults to the
     *  title; give one when several modals share a title. */
    id?: string;
    /** Body layout axis (children form). Default `"col"`. */
    dir?: "row" | "col";
    /** Gap between children (children form). Default 8. */
    gap?: number;
    /** Inner padding (children form). Default `theme.panel.padding`. */
    pad?: number;
    /** Space kept from every viewport edge while clamping. Default 12. */
    margin?: number;
    /** Close action for the conventional gamepad B / keyboard Escape gesture.
     * Omit for a non-dismissible modal. */
    onDismiss?: () => void;
    /** Fired when a click is RELEASED on the dimmed backdrop rather than on the
     *  dialog — the "click away to close" gesture. Omit and the backdrop simply
     *  swallows clicks, which is right for a dialog that demands an answer.
     *
     *  Separate from `onDismiss` on purpose: this one is caused by a real click,
     *  so it still carries the browser's transient activation. That is the
     *  difference between a handler that may call `requestPointerLock`,
     *  `play()` on an audio element or open a window, and one that may not —
     *  Escape grants no activation, so `onDismiss` cannot do any of it.
     *
     *  A release that began INSIDE the dialog (a slider dragged past its edge,
     *  a scroll gesture) is not a click away and does not fire this, and neither
     *  does the very click that opened the modal. */
    onClickOutside?: () => void;
    /** Show focus on the first enabled control when the modal opens. By default
     * the control is focused logically, but its ring is shown only when a
     * gamepad is active. Set explicitly to override that behavior. */
    showFocus?: boolean;
}
/** Dim the whole screen and open a centered panel. Two forms:
 *
 *  VALUE — returns the panel rect and you draw into it (`h` required):
 *
 *    const r = UI.modal({ w: 340, h: 150, title: "CONFIRM" });
 *    if (UI.button({ x: r.x + 12, y: r.y + 100, label: "OK" })) { ... }
 *
 *  CHILDREN — the dialog is a `panel`, so its contents LAY THEMSELVES OUT and
 *  its height shrink-wraps them (omit `h`). Returns the callback's value:
 *
 *    const hit = UI.modal({ w: 340, title: "CONFIRM" }, () => {
 *      UI.text("Delete this save?");
 *      return UI.row({ justify: "end", gap: 8 }, () => UI.button({ label: "OK" }));
 *    });
 *
 *  While a modal is up, every widget drawn BEFORE it in the frame ignores the
 *  pointer, so clicks can't land through the backdrop; widgets drawn after (the
 *  dialog's own) work normally. Call it LAST in your draw. For the common
 *  title/lines/buttons dialog, `confirm()` does all of this for you.
 *
 *  `onClickOutside` turns the backdrop into a close button; `onDismiss` handles
 *  Escape and gamepad B. They are separate because only the first is caused by
 *  a real click, and so only the first may do the things a browser allows only
 *  from one — see its own note. */
export declare function modal(opts: ModalOptions): {
    x: number;
    y: number;
    w: number;
    h: number;
};
export declare function modal<R>(opts: ModalOptions, children: LayoutChildren<R>): R;
/** A whole dialog in one call. */
export interface ConfirmOptions {
    /** Stable prefix for keyboard-focusable action buttons. */
    id?: string;
    /** Dialog title, drawn in the panel's title strip. */
    title?: string;
    /** Body lines. The first is drawn in the primary text color, the rest
     *  dimmed — lead + detail. */
    lines?: string[];
    /** Button labels, left to right (the last one sits at the right edge —
     *  put the primary action last). Default `["OK"]`. */
    buttons?: string[];
    /** Per-button variants, aligned with `buttons`. Omit an entry for the
     *  default look. E.g. `["default", "danger"]` for a Cancel/Delete pair.
     *  When omitted entirely, the LAST button defaults to `"primary"`. */
    variants?: ButtonVariant[];
    /** Minimum dialog width; it grows to fit the content. Default 300. */
    minW?: number;
}
/** The declarative modal: title, body lines and buttons in one call, sized
 *  to its content. Returns the clicked button's label, or `null`:
 *
 *    if (confirming) {
 *      const hit = UI.confirm({
 *        title: "JOIN SERVER",
 *        lines: [server.name, details],
 *        buttons: ["CANCEL", "JOIN"],
 *      });
 *      if (hit === "JOIN") join(server);
 *      if (hit) confirming = null;
 *    } */
export declare function confirm(text: string): "yes" | "no" | null;
export declare function confirm(opts: ConfirmOptions): string | null;
/** Bottom-screen dialogue used by RPGs, adventures, visual novels and tutorial
 * conversations. Rendering is immediate-mode; the game owns conversation state. */
export interface DialogOptions {
    /** Stable prefix for keyboard-focusable choices. */
    id?: string;
    /** Speaker name, drawn in the box's title strip. */
    speaker?: string;
    /** Body text, one entry per line. */
    lines: string[];
    /** Optional response/action labels. Returns the clicked label. */
    choices?: string[];
    /** Box left. Default centers the box horizontally. */
    x?: number;
    /** Box top. Default pins the box near the bottom of the viewport. */
    y?: number;
    /** Box width. Default `min(680, viewport width - 24)`. */
    w?: number;
    /** Box height. Default sizes to the lines (plus choices row). */
    h?: number;
    /** Optional portrait drawn on the left. */
    portrait?: CanvasImageSource;
    /** Portrait square size in px. Default `72`. Ignored without `portrait`. */
    portraitSize?: number;
    /** Small footer hint when there are no explicit choices. */
    hint?: string;
}
/** Draw a themed dialogue box and return the clicked choice, or `null`.
 *
 * ```ts
 * const answer = UI.dialog({
 *   speaker: "BLACKSMITH",
 *   lines: ["The old bridge is unsafe."],
 *   choices: ["REPAIR IT", "LEAVE"],
 * });
 * ``` */
export declare function dialog(opts: DialogOptions): string | null;
