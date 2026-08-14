export type TextHAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "middle" | "bottom";
/** The `"${size}px monospace"` CSS font string for a pixel size, memoized. */
export declare function monoFont(size: number): string;
export interface TextStyle {
    /** CSS font string. Default "16px monospace" */
    font?: string;
    /** Fill: a CSS color or a CanvasGradient (Draw.linear/radial). Default "#fff" */
    color?: string | CanvasGradient;
    /** Horizontal anchor of the x coordinate. Default "left" */
    align?: TextHAlign;
    /** Vertical anchor of the y coordinate. Default "top" */
    baseline?: TextVAlign;
}
/** Draw text anchored at (x, y) according to align/baseline.
 *
 *    // top-left HUD (same as plain fillText):
 *    drawText(ctx, "Score: 10", 10, 10);
 *    // right-aligned against the right edge — no width guessing:
 *    drawText(ctx, "controls", w - 10, 10, { align: "right" });
 *    // sits ON the bottom edge, never dips below it:
 *    drawText(ctx, "hint", 10, h - 8, { baseline: "bottom" }); */
export declare function drawText(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, style?: TextStyle): void;
/** Text centered horizontally and vertically on (cx, cy).
 *  The standard choice for overlay headlines. */
export declare function drawCentered(ctx: CanvasRenderingContext2D, str: string, cx: number, cy: number, style?: Omit<TextStyle, "align" | "baseline">): void;
/** Same-style multi-line text block, vertically centered on cy.
 *  `lineHeight` defaults to 24. */
export declare function drawCenteredBlock(ctx: CanvasRenderingContext2D, lines: string[], cx: number, cy: number, style?: Omit<TextStyle, "align" | "baseline"> & {
    lineHeight?: number;
}): void;
