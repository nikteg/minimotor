// ---------- spinner ----------
import { Flowable, ensureWired, onStep, place, theme, uiCtx } from "../core/index.js";

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

/** Options for `spinner()`. Give `x`/`y` (the arc's CENTER) to place it by
 *  hand, or omit them to AUTO-FLOW into the current `row`/`col`/`panel` (a
 *  2·`r` slot, spinning in its middle). */
export interface SpinnerOptions extends Flowable {
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
 *    if (refreshing) UI.spinner({ x, y });   // x/y = arc center
 *    if (busy) UI.spinner();                 // auto-flows into the current row */
export function spinner(opts: SpinnerOptions = {}): void {
  const ctx = uiCtx();
  ensureWired();
  ensureSpinnerHooks(); // the step hook advances the angle
  const r = opts.r ?? 8;
  // Pinned: x/y are the arc CENTER (a spinner is a point, not a box). Flowing:
  // reserve a 2r square and spin in its middle.
  let cx: number, cy: number;
  if (opts.x !== undefined || opts.y !== undefined) {
    cx = opts.x ?? 0;
    cy = opts.y ?? 0;
  } else {
    const box = place(opts, r * 2, r * 2);
    cx = box.x + box.w / 2;
    cy = box.y + box.h / 2;
  }
  ctx.save();
  ctx.strokeStyle = opts.color ?? theme.accent;
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, spinAngle, spinAngle + Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}
