import { Flowable } from "../../ui/core/index.js";
import type { ThemeTextPadding } from "../../ui/theme.js";
export interface TextEditor {
    id: string;
    /** A `<textarea>` when the field is multiline, else an `<input>`. Both expose
     *  the same value/selection API the canvas mirrors. */
    input: HTMLInputElement | HTMLTextAreaElement;
    value: string;
    changed: boolean;
    submitted: boolean;
    /** `true` when backed by a `<textarea>` (Enter inserts a newline). */
    multiline: boolean;
    /** Horizontal scroll offset (single-line only), so the caret stays inside the
     *  clip rect when the text is wider than the box. Recomputed each frame from
     *  the caret x and persisted so a resting caret doesn't snap the view about. */
    scrollX: number;
    /** Char index where a pointer drag-selection started, or `null` when not
     *  dragging. While set, pointer moves extend the native selection so the
     *  canvas text is mouse-selectable (and Cmd/Ctrl+C copies it). */
    dragAnchor: number | null;
    /** The value returned to the caller last frame. Lets a controlled value the
     *  app sets EXTERNALLY (one that isn't just echoing our last output — e.g.
     *  clearing a chat box after send) apply even while focused, without a
     *  keystroke-lagged echo clobbering what the user is typing. */
    lastReturned: string;
}
/** Inputs to `textInput`: the controlled `value`, geometry, and native
 *  `<input>` hints. */
export interface TextInputOptions extends Flowable {
    /** Stable identity. May be omitted inside `UI.idScope()`. */
    id?: string;
    /** Current text — controlled; pass your state in, assign the result's
     *  `value` back. */
    value: string;
    /** Field width in px. Default `180`. */
    w?: number;
    /** Field height in px. Default `32`. */
    h?: number;
    /** Additional inset for the mirrored text inside the frame. A scalar applies
     *  to both axes; an object can separate x/y. Defaults to theme.textPad. */
    textPad?: ThemeTextPadding;
    /** Muted text shown while empty and unfocused. */
    placeholder?: string;
    /** Grayed out; ignores input. */
    disabled?: boolean;
    /** Max character count (native `maxLength`). */
    maxLength?: number;
    /** Native input `type` — `"password"` masks with bullets; the rest steer
     *  mobile keyboards/validation. Default `"text"`. */
    type?: "text" | "password" | "email" | "number" | "search";
    /** Native `inputmode` hint for the on-screen keyboard (e.g. `"numeric"`,
     *  `"decimal"`). */
    inputMode?: "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
    /** Accessible name for the hidden `<input>`. Falls back to `placeholder`,
     *  then `id`. */
    ariaLabel?: string;
    /** Keyboard traversal order. Negative values exclude the field. */
    tabIndex?: number;
    /** Blur after Enter. Default true. */
    blurOnSubmit?: boolean;
    /** Multi-line field: backs the control with a `<textarea>` and wraps the text
     *  top-aligned inside the box. Enter inserts a newline (only Cmd/Ctrl+Enter
     *  submits); `maxLength` still applies. Implied when `rows > 1`. */
    multiline?: boolean;
    /** Visible line count. `1` (default) is a single-line input; anything larger
     *  makes it multi-line (implies `multiline`) and sizes the box to that many
     *  rows unless an explicit `h` overrides. Pair this with — or instead of —
     *  `multiline`; `rows: 4` and `multiline: true` are equivalent. */
    rows?: number;
}
/** What `textInput` returns this frame: current `value` plus changed/submitted/
 *  focused flags. */
export interface TextInputResult {
    /** The field's current text — assign it back to your state. */
    value: string;
    /** `true` for the one frame the text changed. */
    changed: boolean;
    /** `true` for the one frame Enter was pressed. */
    submitted: boolean;
    /** `true` while the field holds keyboard focus. */
    focused: boolean;
}
export declare function removeTextEditor(): void;
export declare function openTextEditor(opts: TextInputOptions & {
    id: string;
}): void;
/** Canvas-rendered text input backed by a hidden native `<input>` (or a
 * `<textarea>` when `multiline`) for keyboard, clipboard, IME and mobile-keyboard
 * behavior. The canvas mirrors the element's live caret and selection. Returns
 * the controlled value plus one-frame `changed`/`submitted` flags:
 *
 *     const r = UI.textInput({ id: "chat", value: draft, placeholder: "Say something" });
 *     draft = r.value;
 *     if (r.submitted) { send(draft); draft = ""; } // Enter pressed this frame
 */
export declare function textInput(opts: TextInputOptions): TextInputResult;
