// ---------- Labelled field ----------
// A label bound to the control it names: the column, the small gap, and the
// binding that makes pressing the label focus the input.
//
// The column and the gap could live in any game. The BINDING could not — focus
// is per-app kernel state (`core/focus.ts`), and the text field's real keyboard
// target is a hidden DOM element the widget owns. A caller writing
// `UI.col(() => { UI.text("Name"); UI.textInput(...) })` gets a label that
// looks associated and is not, and it cannot fix that from outside: the field
// blurs its editor on any press outside its own box, so a label that grants
// focus has it taken away again on the same frame.
import { lastWidgetRect, lineHeight, focusFromPointer, hoverCursor, registerFocusProxy, requiredWidgetId, text, theme, uiCtx, uiPointer, } from "../../ui/core/index.js";
import { col } from "./layout.js";
import { pointInRect } from "../../collision/index.js";
/** A control with a label bound to it: a column with a label-sized gap, where
 *  pressing the LABEL focuses the control (and puts the caret in a text field,
 *  and raises the mobile keyboard) — the canvas equivalent of `<label for>`.
 *
 *  The field owns the id and passes it in, since the label is emitted before
 *  the control and has nothing to bind to otherwise:
 *
 *    name = UI.field({ label: "Player name" }, (id) =>
 *      UI.textInput({ id, value: name, placeholder: "Your name" }),
 *    ).value;
 *
 *  Returns whatever the callback returns, so the control's result reads
 *  straight out. Any focusable control can be labelled; `textInput` is the one
 *  that also opens its editor from the label press. */
export function field(opts, children) {
    const ctx = uiCtx();
    const id = requiredWidgetId(opts.id, "field");
    return col({ ...opts, id, gap: opts.gap ?? theme.spacing.sm }, (layout) => {
        // An explicit height: a column slot with none falls back to
        // `theme.button.height`, which would put 32px of dead space under a
        // one-line label and swallow the gap the field exists to set.
        text(opts.label, {
            color: opts.labelColor ?? (opts.disabled ? "dim" : undefined),
            size: opts.labelSize,
            bold: opts.labelBold,
            h: lineHeight(opts.labelSize),
        });
        const labelRect = lastWidgetRect();
        if (labelRect && !opts.disabled) {
            // Hand the rect to the kernel BEFORE the control draws. The control reads
            // it back in the same frame and treats it as part of its own hit area —
            // for the press, for the "was that press outside me?" test, and for the
            // native pointerdown listener that opens the mobile keyboard in-gesture.
            registerFocusProxy(id, labelRect);
            const p = uiPointer();
            if (pointInRect(p.x, p.y, labelRect)) {
                // The label is a thing you click, so it wears the hand — the same
                // cursor as the button it behaves like. It is NOT the I-beam of the
                // field it is bound to: there is no text here to select and no caret to
                // place. `textInput` scopes its own I-beam to the box for that reason.
                hoverCursor(true);
                // Keyboard focus moves here, the same way a direct press moves it, so a
                // control with no proxy support of its own is still focused by its label.
                if (p.pressed)
                    focusFromPointer(ctx, id);
            }
        }
        return children(id, layout);
    });
}
