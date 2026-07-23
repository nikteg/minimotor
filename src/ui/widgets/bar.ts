// ---------- bar ----------
import { drawBox, roundRectPath, theme, uiCtx } from "../core/index.js";
import { clamp } from "../../mathf.js";

/** Style knobs for `bar()`. */
export interface BarStyle {
  /** Track color behind the fill. */
  bg?: string;
  /** Fill color. */
  fill?: string;
}

/** A horizontal meter (health, progress, charge): a track with `frac` (0..1,
 *  clamped) of it filled from the left. */
export function bar(
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style?: BarStyle,
): void;
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style?: BarStyle,
): void;
export function bar(
  ctxOrX: CanvasRenderingContext2D | number,
  xOrY: number,
  yOrW: number,
  wOrH: number,
  hOrFrac: number,
  fracOrStyle?: number | BarStyle,
  maybeStyle?: BarStyle,
): void {
  const [ctx, x, y, w, h, frac, style] =
    typeof ctxOrX === "number"
      ? [uiCtx(), ctxOrX, xOrY, yOrW, wOrH, hOrFrac, (fracOrStyle as BarStyle) ?? {}]
      : [ctxOrX, xOrY, yOrW, wOrH, hOrFrac, fracOrStyle as number, maybeStyle ?? {}];
  const f = clamp(frac, 0, 1);
  const r = Math.min(theme.radius, h / 2);
  ctx.save();
  drawBox(ctx, x, y, w, h, { fill: style.bg ?? "rgba(255,255,255,0.15)", radius: r });
  if (f > 0) {
    // Clip the fill to the rounded track so the corners stay round even at a
    // partial fill.
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = style.fill ?? theme.accent;
    ctx.fillRect(x, y, w * f, h);
  }
  ctx.restore();
}
