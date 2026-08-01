// ---------- bar ----------
import { Flowable, drawBox, place, roundRectPath, theme, uiCtx } from "@src/ui/core/index.js";
import { clamp } from "@src/math/mathf.js";

/** A horizontal meter (health, progress, charge): a track with `value` (0..1,
 *  clamped) of it filled from the left. Give an explicit rect, or omit `x`/`y`
 *  to AUTO-FLOW into the current `row`/`col`/`panel` — it fills the cross axis
 *  (a col's width) at the theme's default bar thickness. */
export interface BarOptions extends Flowable {
  /** Fill fraction, 0..1 (clamped). */
  value: number;
  /** Track color behind the fill. Default a faint white tint. */
  bg?: string;
  /** Fill color. Default `theme.accent`. */
  fill?: string;
}

/** Draw a horizontal meter per `BarOptions`:
 *
 *    UI.bar({ x, y, w: 120, h: 8, value: hp / maxHp, fill: "#ff6b6b" });
 *    UI.bar({ value: loadFrac });   // auto-flows into the current col */
export function bar(opts: BarOptions): void {
  const ctx = uiCtx();
  const { x, y, w, h } = place({ ...opts, h: opts.h ?? theme.barH }, 120, theme.barH, "bar");
  const f = clamp(opts.value, 0, 1);
  const r = Math.min(theme.radius, h / 2);
  ctx.save();
  drawBox(ctx, x, y, w, h, {
    fill: opts.bg ?? "rgba(255,255,255,0.15)",
    radius: r,
    role: "barTrack",
  });
  if (f > 0) {
    const fillW = w * f;
    const fillFrame = theme.skin?.frames.barFill;
    if (fillFrame) {
      drawBox(ctx, x, y, fillW, h, {
        fill: opts.fill ?? theme.accent,
        role: "barFill",
      });
    } else {
      // Clip the fill to the rounded track so the corners stay round even at
      // a partial fill when the theme has no sprite frame.
      roundRectPath(ctx, x, y, w, h, r);
      ctx.clip();
      ctx.fillStyle = opts.fill ?? theme.accent;
      ctx.fillRect(x, y, fillW, h);
    }
  }
  ctx.restore();
}
