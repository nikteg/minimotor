import { Flow } from "./flow.js";
import { type TextRun } from "./theme.js";
/** Named screen anchors: position HUD text without reading the viewport.
 *  Anchors respect safe-area insets (notches) on the left/top edges. */
export type TextAnchor = "topLeft" | "top" | "topRight" | "left" | "center" | "right" | "bottomLeft" | "bottom" | "bottomRight";
export declare const ANCHOR_H: Record<TextAnchor, 0 | 0.5 | 1>;
export declare const ANCHOR_V: Record<TextAnchor, 0 | 0.5 | 1>;
/** The box viewport-anchored chrome positions against, in the CURRENT space:
 *  the host app's viewport at the root, and the REFERENCE box inside a
 *  `UI.scaled` block (what `UI.width`/`UI.height` report). Anchoring against the
 *  device viewport inside a scaled block would put "centered" and "bottom" off
 *  by the scale — a modal, a dialogue box or a flipped drop-menu laid out in
 *  reference coords must measure the space in those same coords. Safe-area
 *  insets are mapped in too (and clamped at 0 — a scaled box that starts past
 *  the notch owes it nothing). */
export declare function anchorViewport(): {
    w: number;
    h: number;
    safeLeft: number;
    safeTop: number;
};
/** Keep a box that hangs off something else on screen.
 *
 *  `box` is where it WANTS to go (already offset from its anchor by whatever
 *  gap that caller likes), `flipY` is the top edge to use instead when it would
 *  run off the bottom — normally above the anchor. The result is clamped into
 *  `anchorViewport()` with `margin` px to spare on every side, so a flip that
 *  itself doesn't fit still lands on screen.
 *
 *  Shared by the popover, the select drop-menu and the tooltip. They had each
 *  written the clamp inline and drifted to different margins; the gaps stay
 *  theirs (a menu hugs its control, a tooltip trails the cursor), only the
 *  staying-on-screen part is common. */
export declare function fitAnchored(box: {
    x: number;
    y: number;
    w: number;
    h: number;
}, flipY: number, margin: number): {
    x: number;
    y: number;
};
/** One coloured run inside a single `UI.text` call.
 *
 *  Passing an array of these instead of a string keeps the label ONE widget —
 *  one slot, one wrap, one alignment, one measurement — while letting parts of
 *  it carry their own colour. The immediate reason it exists is a chat/event
 *  log where a player's name must stay in that player's colour without the
 *  surrounding sentence being cut into separately laid-out labels, which is
 *  what makes wrapping and right-alignment go wrong.
 *
 *  Runs are drawn in array order and their text is CONCATENATED verbatim —
 *  no separator is inserted, so any spacing belongs inside the runs. */
export interface TextSpan {
    /** The characters of this run. */
    text: string;
    /** Colour for this run. `"dim"` / `"accent"` map to theme roles exactly as
     *  `TextOptions.color` does; omitted inherits the call's own `color`. */
    color?: string;
}
/** What `UI.text` draws: a plain string, or runs that share one layout. */
export type TextContent = string | readonly TextSpan[];
/** A themed text label. */
export interface TextOptions {
    /** Position. In a layout, omit and it flows like any widget (reserving a
     *  slot the width of the text, the row's height / a `size`-tall line). */
    x?: number;
    /** Top y in logical px (see `x`). */
    y?: number;
    /** Named screen anchor: `x`/`y` become OFFSETS from this point instead of
     *  absolute coordinates, and the text aligns toward it ("center" centers,
     *  "topRight" right-aligns, …). The HUD way to say "middle of the screen"
     *  without reading the viewport. */
    anchor?: TextAnchor;
    /** Slot sizing overrides when placed in a layout. */
    w?: number;
    /** Slot height override in px (see `w`). */
    h?: number;
    /** Place in this layout stack — flows the label like any widget. */
    at?: Flow;
    /** Font size in px. Default `theme.fontSize`. */
    size?: number;
    /** Bold. Default false. */
    bold?: boolean;
    /** Full font string — overrides `size`/`bold`/theme font entirely. */
    font?: string;
    /** Color. `"dim"` / `"accent"` map to theme roles; any CSS color works.
     *  Default `theme.text`. */
    color?: string;
    /** Horizontal alignment within the slot. Default `"left"`. */
    align?: "left" | "center" | "right";
    /** Inset the text inside its slot, in px. `pad` sets both axes; `padX`/
     *  `padY` override one. Handy for insetting a label from a panel edge.
     *  Defaults to `theme.textPad` (0) when omitted. */
    pad?: number;
    /** Horizontal-only inset override in px (see `pad`). */
    padX?: number;
    /** Vertical-only inset override in px (see `pad`). */
    padY?: number;
    /** Word-wrap to multiple lines within the available width instead of
     *  squeezing one line to fit. In a layout, or when `w`/`maxWidth` is known,
     *  an omitted `h` grows automatically to fit every line. */
    wrap?: boolean;
    /** Clamp width (px) for a single line — the glyphs squeeze rather than
     *  spill. In a layout the slot width is used automatically (unless `wrap`). */
    maxWidth?: number;
}
/** The line box a single line of themed text occupies: the font size plus the
 *  kit's leading. What `text` reserves per line, and what a caller placing a
 *  label in a COLUMN must pass as `h` — a column slot with no height falls back
 *  to `theme.button.height`, which turns a one-line label into a 32px block. */
export declare function lineHeight(size?: number): number;
export declare function resolveColor(c: string | undefined): string;
/** Width of `content` in the given font (default: the theme's base font) —
 *  for sizing custom layouts around labels. Memoized per (font, string).
 *  Runs measure as the one string they concatenate to, which is the same width
 *  `UI.text` will reserve for them. */
export declare function textWidth(content: TextContent, font?: string): number;
/** The one string a run list means — what is measured, wrapped, ellipsized and
 *  reported. Runs concatenate verbatim. */
export declare function spanText(content: TextContent): string;
/** Greedy word-wrap `runs` into lines no wider than `maxW` (font must be set on
 *  `ctx`), each line a run list whose concatenation is that line's text.
 *
 *  This is the kit's ONLY wrapping calculation: `wrapLines` is this function
 *  with one run. Words are measured as the combined string they will be drawn
 *  as, so a word that straddles a colour boundary (`"Ana"` + `"'s ball"`)
 *  breaks where the same characters in one colour would. */
export declare function wrapRuns(ctx: CanvasRenderingContext2D, runs: readonly TextRun[], maxW: number): TextRun[][];
/** Greedy word-wrap `str` into lines no wider than `maxW` (font must be set
 *  on `ctx`). A single word wider than `maxW` gets its own line (drawn clamped
 *  by the caller). */
export declare function wrapLines(ctx: CanvasRenderingContext2D, str: string, maxW: number): string[];
/** Draw a line of themed text. Uses the theme font/size/color so a screen
 *  never has to touch `ctx.font`/`fillText` itself; flows in a layout or
 *  positions absolutely:
 *
 *    UI.text("Score: 42", { x: 12, y: 12, bold: true });
 *    UI.text(name, { color: "dim", align: "right", w: col.w });
 *
 *  Pass RUNS instead of a string to colour parts of one label without splitting
 *  it into separate widgets — the runs share this call's slot, wrap, alignment
 *  and measurement, and only the paint is per-run:
 *
 *    UI.text([{ text: name, color: player.color }, { text: " holed out" }]); */
export declare function text(content: TextContent, rawOpts?: TextOptions): void;
