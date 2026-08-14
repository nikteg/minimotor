import { Flowable } from "../../ui/core/index.js";
/** Button look. `"default"` is the neutral filled button; `"primary"` fills
 *  with the theme accent (calls to action); `"danger"` fills red (destructive
 *  actions); `"ghost"` is text-only with no fill/border until hovered. */
export type ButtonVariant = "default" | "primary" | "danger" | "ghost";
/** Style knobs for `button()`. Every color defaults from the theme. */
export interface ButtonStyle {
    /** Label size in px. Default `theme.fontSize + 2`. */
    size?: number;
    /** Bold label. Default true. */
    bold?: boolean;
    /** Full font string for the label — overrides `size`/`bold`/the theme font. */
    font?: string;
    /** Preset look — see `ButtonVariant`. Default `"default"`. */
    variant?: ButtonVariant;
    /** Label color. */
    color?: string;
    /** Fill when idle. */
    bg?: string;
    /** Fill when hovered. */
    bgHover?: string;
    /** Fill when held down (pressed). */
    bgActive?: string;
    /** Corner radius override (px). Defaults to `theme.radius`. */
    radius?: number;
    /** Use the theme's pixel button frame when available. Default true. */
    skin?: boolean;
}
/** A button's geometry + label. Position it yourself (`x`/`y` required,
 *  `w` optional — auto-sized to the label when omitted), or hand it a
 *  layout `Flow` via `at` and skip the geometry entirely. */
export interface ButtonOptions extends ButtonStyle, Flowable {
    /** Stable identity enables Tab focus and keyboard activation. */
    id?: string;
    /** Keyboard traversal order. Negative values exclude the button. */
    tabIndex?: number;
    /** Omit to use `theme.button.width`, or auto-size to the label when it is 0. */
    w?: number;
    /** Button height in logical px. Default `theme.button.height`. */
    h?: number;
    /** Text drawn centered on the button. */
    label: string;
    /** Grayed out and unclickable. */
    disabled?: boolean;
    /** Shown near the pointer after hovering a moment (see `drawTips`). Works
     *  on disabled buttons too — the place to say WHY it's disabled. */
    tooltip?: string;
}
/** The width `button` would choose for this label under the active theme.
 *
 *  For laying out AROUND a button before it is placed — a `spacer` that pushes
 *  one flush right has to know how much room to leave, and a hardcoded number
 *  is wrong the moment a skin changes button padding, min width or the font.
 *  Pass the same `font`/`size`/`bold` the button will get. */
export declare function buttonWidth(label: string, opts?: Pick<ButtonOptions, "font" | "size" | "bold">): number;
/** Draw an immediate-mode button and report whether it was clicked this
 *  frame. Call it every frame from `draw` — there is no retained widget:
 *
 *    if (UI.button({ x, y, w: 160, h: 44, label: "PLAY" })) start();
 *
 *  Hit-testing uses the polled `Pointer` in canvas coordinates — draw the
 *  button outside game-world/camera transforms. To draw UI scaled, wrap it in
 *  `UI.scaled`, which remaps the pointer to match. */
export declare function button(label: string, opts?: Omit<ButtonOptions, "label">): boolean;
export declare function button(opts: ButtonOptions): boolean;
