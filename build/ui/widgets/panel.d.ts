/** Geometry + look of a panel frame. */
export interface PanelFrame {
    /** Left edge in px. */
    x: number;
    /** Top edge in px. */
    y: number;
    /** Width in px. */
    w: number;
    /** Height in px. */
    h: number;
    /** Optional title; when set, a title strip is drawn along the top. */
    title?: string;
    /** Fill color. Default `theme.panel.background`. */
    bg?: string;
    /** Border color. Default `theme.border`. */
    border?: string;
    /** Title text color. Default `theme.accent`. */
    titleColor?: string;
    /** Title font. Default a bold `theme.fontSize + 1` UI font. */
    font?: string;
    /** Ring stroked OVER the finished frame — a live drop target, a validation
     *  error, a selected card. Unlike `border` this survives a pixel skin, whose
     *  nine-slice art replaces the frame's own stroke, so a container can still
     *  answer the pointer under every theme. Omit for none. */
    highlight?: string;
}
/** Vertical space reserved before panel children begin. The panel's top frame
 *  inset is part of the title area so title art sits inside the panel rather
 *  than painting over its decorative corners. */
export declare function panelTitleBodyOffset(): number;
/** Paint a framed box with an optional title strip — the shared box the public
 *  `panel`, the overlays and the `select` menu draw. Captures no input. */
export declare function paintFrame(ctx: CanvasRenderingContext2D, opts: PanelFrame): void;
