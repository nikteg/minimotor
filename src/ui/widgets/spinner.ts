// ---------- spinner ----------
import { ensureWired, onStep, theme, uiCtx } from "../core/index.js";

// Rotation phase, advanced on the fixed step (via onStep) so it pauses with the
// loop. ~7 rad/s at 60 steps.
let spinAngle = 0;
let hooksRegistered = false;
function ensureSpinnerHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onStep(() => {
    spinAngle += 0.12;
  });
}

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
  ctxOrX: CanvasRenderingContext2D | number,
  xOrY: number,
  yOrOpts?: number | SpinnerOptions,
  maybeOpts?: SpinnerOptions,
): void {
  const [ctx, x, y, opts] =
    typeof ctxOrX === "number"
      ? [uiCtx(), ctxOrX, xOrY, (yOrOpts as SpinnerOptions) ?? {}]
      : [ctxOrX, xOrY, yOrOpts as number, maybeOpts ?? {}];
  ensureWired();
  ensureSpinnerHooks(); // the step hook advances the angle
  ctx.save();
  ctx.strokeStyle = opts.color ?? theme.accent;
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.beginPath();
  ctx.arc(x, y, opts.r ?? 8, spinAngle, spinAngle + Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}
