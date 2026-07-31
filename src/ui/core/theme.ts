// ---------- Theme painting ----------
// Drawing helpers that style from the shared `Theme` tokens. They need text
// measurement (a UI-state concern), so they stay here; the tokens themselves
// are core and re-exported below so `UI.setTheme` stays one import for callers.

import { measureWidth, metrics } from "./measure.js";
import { theme } from "@src/ui/theme.js";

export { defaultTheme, getTheme, setTheme, theme } from "@src/ui/theme.js";
export type { Theme } from "@src/ui/theme.js";

export const uiFont = (size = theme.fontSize, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${theme.font}`;

/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; radius?: number; border?: number },
): void {
  const r = opts.radius ?? theme.radius;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (opts.stroke) {
    const bw = opts.border ?? theme.borderWidth;
    if (bw > 0) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = bw;
      const half = bw / 2;
      roundRectPath(ctx, x + half, y + half, w - bw, h - bw, Math.max(0, r - half));
      ctx.stroke();
    }
  }
}

/** Trim `text` with a trailing ellipsis until it fits `maxW` (binary search).
 *  Returns the string unchanged when it already fits. Every probe goes through
 *  the memo, so a label that keeps its text and width costs map hits after the
 *  first frame instead of ~log₂(n) real measurements. */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0 || measureWidth(ctx, text) <= maxW) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureWidth(ctx, text.slice(0, mid) + ell) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

/** Vertically centered text using real glyph metrics — the canvas "middle"
 *  baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clips with an ellipsis (via `ellipsize`) so a label can never spill
 *  out of its widget. */
export function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxW?: number,
): void {
  // measureText's actualBoundingBox values are relative to the CURRENT
  // textBaseline — pin it before measuring, or state leaked from caller
  // drawing (e.g. "middle") skews the correction. (`metrics` pins it for its
  // own measurement too; this one is for the fillText below.)
  ctx.textBaseline = "alphabetic";
  // Clip to width with an ellipsis rather than passing `maxW` to fillText,
  // which SQUISHES the glyphs horizontally. (Multi-line wrapping is handled by
  // the caller via `wrapLines`; this keeps a single line from stretching.)
  const str = maxW !== undefined ? ellipsize(ctx, text, maxW) : text;
  const { asc, desc } = metrics(ctx, str);
  if (asc || desc) {
    ctx.fillText(str, x, cy + (asc - desc) / 2);
  } else {
    // Metrics unavailable (mocked ctx) — middle baseline is the best we have.
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, cy);
  }
}
