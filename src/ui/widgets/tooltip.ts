// ---------- Tooltip ----------
// A single hover-stable tooltip: widgets request one for the frame while their
// hit-area is hovered; `drawTips` paints it near the pointer once the hover has
// held ~350 ms. Hover stability + reset run off the kernel's frame-end hooks.
import {
  anchorViewport,
  centeredText,
  drawBox,
  ensureWired,
  onFrameEnd,
  onReset,
  rawPointer,
  runtimeSlot,
  theme,
  uiCtx,
  uiFont,
} from "../core/index.js";

interface TipState {
  request: string | null; // asked for this frame
  shown: { text: string; since: number } | null; // hover-stable
}
const st = runtimeSlot<TipState>(() => ({ request: null, shown: null }));

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(msg: string): void {
  ensureWired();
  ensureTooltipHooks();
  st().request = msg;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export function drawTips(): void {
  const ctx = uiCtx();
  const shown = st().shown;
  if (!shown || performance.now() - shown.since < 350) return;
  const msg = shown.text;
  const vp = anchorViewport(ctx);
  const p = rawPointer();
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(msg).width + 16;
  const h = 24;
  let x = p.x + 14;
  let y = p.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = p.y - 8 - h;
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
  const s = st();
  if (s.request) {
    if (s.shown?.text !== s.request) {
      s.shown = { text: s.request, since: performance.now() };
    }
  } else {
    s.shown = null;
  }
  s.request = null;
}

let hooksRegistered = false;
function ensureTooltipHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onFrameEnd(tooltipEndFrame);
  onReset(() => {
    const s = st();
    s.request = null;
    s.shown = null;
  });
}
