// ---------- Tooltip ----------
// A single hover-stable tooltip: widgets request one for the frame while their
// hit-area is hovered; `drawTips` paints it near the pointer once the hover has
// held ~350 ms. Hover stability + reset run off the kernel's frame-end hooks.
import {
  anchorViewport,
  centeredText,
  currentUiScale,
  drawBox,
  ensureWired,
  measureWidth,
  onFrameEnd,
  onReset,
  rawPointer,
  uiSlot,
  theme,
  uiCtx,
  uiFont,
} from "@src/ui/core/index.js";

interface TipState {
  request: string | null; // asked for this frame
  scale: number; // the UI scale the requesting widget drew under
  shown: { text: string; since: number; scale: number } | null; // hover-stable
}
const st = uiSlot<TipState>(() => ({ request: null, scale: 1, shown: null }));

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms — at the UI scale of the widget that asked,
 *  so a tip on a zoomed board matches the board. */
export function tooltip(msg: string): void {
  ensureWired();
  ensureTooltipHooks();
  const s = st();
  s.request = msg;
  s.scale = currentUiScale();
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export function drawTips(): void {
  const ctx = uiCtx();
  const shown = st().shown;
  if (!shown || performance.now() - shown.since < 350) return;
  const msg = shown.text;
  const vp = anchorViewport();
  const p = rawPointer();
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  // `drawTips` runs in native screen space, but the requesting widget may have
  // been inside a `UI.scaled` block — draw the box at ITS scale (the pointer and
  // the viewport clamp stay in screen px, so the tip still tracks the cursor and
  // never leaves the screen).
  const scale = shown.scale;
  const boxW = measureWidth(ctx, msg) + 16; // box in the requester's own units…
  const boxH = 24;
  const w = boxW * scale; // …and on screen, for the placement clamp
  const h = boxH * scale;
  let x = p.x + 14;
  let y = p.y + 20 * scale;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = p.y - 8 - h;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawBox(ctx, 0, 0, boxW, boxH, {
    fill: theme.panelBg,
    stroke: theme.border,
    border: 1,
    radius: Math.min(theme.radius, 6),
  });
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, msg, 8, boxH / 2);
  ctx.restore();
}

// Hover-stability: the same text keeps its timer; a change restarts it. Runs at
// frame-end so it reflects every tooltip() call in the just-drawn frame.
function tooltipEndFrame(): void {
  const s = st();
  if (s.request) {
    if (s.shown?.text !== s.request) {
      s.shown = { text: s.request, since: performance.now(), scale: s.scale };
    } else {
      s.shown.scale = s.scale; // same text, new zoom → follow the zoom
    }
  } else {
    s.shown = null;
  }
  s.request = null;
  s.scale = 1;
}

let hooksRegistered = false;
function ensureTooltipHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onFrameEnd(tooltipEndFrame);
  onReset(() => {
    const s = st();
    s.request = null;
    s.scale = 1;
    s.shown = null;
  });
}
