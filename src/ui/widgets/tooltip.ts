// ---------- Tooltip ----------
// A single hover-stable tooltip: widgets request one for the frame while their
// hit-area is hovered; `drawTips` paints it near the pointer once the hover has
// held ~350 ms. Hover stability + reset run off the kernel's frame-end hooks.
import {
  centeredText,
  drawBox,
  ensureWired,
  onFrameEnd,
  onReset,
  theme,
  uiCtx,
  uiFont,
} from "../core/index.js";
import { Pointer, Stage } from "../../engine/index.js";

let tipRequest: string | null = null; // asked for this frame

let tipShown: { text: string; since: number } | null = null; // hover-stable

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(msg: string): void {
  ensureWired();
  ensureTooltipHooks();
  tipRequest = msg;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export function drawTips(maybeCtx?: CanvasRenderingContext2D): void {
  const ctx = maybeCtx ?? uiCtx();
  if (!tipShown || performance.now() - tipShown.since < 350) return;
  const msg = tipShown.text;
  const vp = Stage.viewport;
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(msg).width + 16;
  const h = 24;
  let x = Pointer.x + 14;
  let y = Pointer.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = Pointer.y - 8 - h;
  drawBox(ctx, x, y, w, h, {
    fill: theme.panelBg,
    stroke: theme.border,
    border: 1,
    radius: Math.min(theme.radius, 6),
  });
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, msg, x + 8, y + h / 2);
  ctx.restore();
}

// Hover-stability: the same text keeps its timer; a change restarts it. Runs at
// frame-end so it reflects every tooltip() call in the just-drawn frame.
function tooltipEndFrame(): void {
  if (tipRequest) {
    if (tipShown?.text !== tipRequest) {
      tipShown = { text: tipRequest, since: performance.now() };
    }
  } else {
    tipShown = null;
  }
  tipRequest = null;
}

let hooksRegistered = false;
function ensureTooltipHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onFrameEnd(tooltipEndFrame);
  onReset(() => {
    tipRequest = null;
    tipShown = null;
  });
}
