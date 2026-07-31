// ---------- Canvas text drawing helpers ----------
// Aligned text without manual ctx.textAlign/textBaseline juggling
// or text-width math. All helpers save/restore the context state.

export type TextHAlign = "left" | "center" | "right";
export type TextVAlign = "top" | "middle" | "bottom";

// Font strings are memoized per size so the hot text paths don't rebuild
// (and re-parse) `"${size}px monospace"` on every call.
const monoFonts = new Map<number, string>();

/** The `"${size}px monospace"` CSS font string for a pixel size, memoized. */
export function monoFont(size: number): string {
  let font = monoFonts.get(size);
  if (font === undefined) {
    font = `${size}px monospace`;
    monoFonts.set(size, font);
  }
  return font;
}

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
export function drawText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  style: TextStyle = {},
): void {
  // Save the four properties rather than the whole context: `save()/restore()`
  // pushes every bit of canvas state (transform, clip, compositing, shadows),
  // and this runs once per string drawn.
  const prevFont = ctx.font;
  const prevFill = ctx.fillStyle;
  const prevAlign = ctx.textAlign;
  const prevBaseline = ctx.textBaseline;
  ctx.font = style.font ?? monoFont(16);
  ctx.fillStyle = style.color ?? "#fff";
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = style.baseline ?? "top";
  ctx.fillText(str, x, y);
  ctx.font = prevFont;
  ctx.fillStyle = prevFill;
  ctx.textAlign = prevAlign;
  ctx.textBaseline = prevBaseline;
}

/** Text centered horizontally and vertically on (cx, cy).
 *  The standard choice for overlay headlines. */
export function drawCentered(
  ctx: CanvasRenderingContext2D,
  str: string,
  cx: number,
  cy: number,
  style: Omit<TextStyle, "align" | "baseline"> = {},
): void {
  drawText(ctx, str, cx, cy, { ...style, align: "center", baseline: "middle" });
}

/** Same-style multi-line text block, vertically centered on cy.
 *  `lineHeight` defaults to 24. */
export function drawCenteredBlock(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  cx: number,
  cy: number,
  style: Omit<TextStyle, "align" | "baseline"> & { lineHeight?: number } = {},
): void {
  const lh = style.lineHeight ?? 24;
  const top = cy - ((lines.length - 1) * lh) / 2;
  for (let i = 0; i < lines.length; i++) {
    drawCentered(ctx, lines[i], cx, top + i * lh, style);
  }
}
