import { LayoutOptions } from "../../ui/core/index.js";
import type { Flow } from "../../ui/core/index.js";
/** Inputs to `field`: the label, the id it binds to, and the column options the
 *  pair is laid out with. */
export interface FieldOptions extends LayoutOptions {
    /** The label text, drawn above the control. */
    label: string;
    /** The CONTROL's id — the field owns it and hands it to the callback, because
     *  the label draws first and could not otherwise learn it. May be omitted
     *  inside `UI.idScope()`. */
    id?: string;
    /** Gap between label and control. Default `theme.spacing.sm` — the label
     *  belongs to the control, so it sits closer than the `spacing.md` a column
     *  puts between unrelated widgets. */
    gap?: number;
    /** Label color. `"dim"`/`"accent"` map to theme roles. Default `theme.text`,
     *  or `theme.textDim` while `disabled`. */
    labelColor?: string;
    /** Label font size in px. Default `theme.fontSize`. */
    labelSize?: number;
    /** Bold label. Default false. */
    labelBold?: boolean;
    /** Dim the label and stop it focusing anything. Set this alongside the
     *  control's own `disabled` — the field can't read the control's options. */
    disabled?: boolean;
}
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
export declare function field<R>(opts: FieldOptions, children: (id: string, layout: Flow) => R): R;
