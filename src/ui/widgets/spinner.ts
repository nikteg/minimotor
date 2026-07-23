// ---------- spinner ----------
import { ensureWired, spinAngle, theme, uiCtx } from "../core/index.js";

/** Style knobs for `spinner()`. */
export interface SpinnerOptions {
  /** Arc radius in px. Default `8`. */
  r?: number;
  /** Stroke color. Default `theme.accent`. */
  color?: string;
  /** Stroke width in px. Default `3`. */
  lineWidth?: number;
}

/** A rotating "busy" arc for in-flight work (loading, refreshing). Advances
 *  on the fixed step, so it pauses with the loop:
 *
 *    if (refreshing) UI.spinner(ctx, x, y); */
export function spinner(x: number, y: number, opts?: SpinnerOptions): void;
export function spinner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts?: SpinnerOptions,
): void;
export function spinner(
  a: CanvasRenderingContext2D | number,
  b: number,
  c?: number | SpinnerOptions,
  d?: SpinnerOptions,
): void {
  const [ctx, x, y, opts] =
    typeof a === "number"
      ? [uiCtx(), a, b, (c as SpinnerOptions) ?? {}]
      : [a, b, c as number, d ?? {}];
  ensureWired(); // the shared step hook advances the angle
  ctx.save();
  ctx.strokeStyle = opts.color ?? theme.accent;
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.beginPath();
  ctx.arc(x, y, opts.r ?? 8, spinAngle, spinAngle + Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}
