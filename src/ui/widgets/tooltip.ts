// ---------- Tooltip ----------
// A single hover-stable tooltip: widgets request one for the frame while their
// hit-area is hovered; `drawTips` paints it near the pointer once the hover has
// held ~350 ms. Hover stability + reset run off the kernel's frame-end hooks.
import {
  anchorViewport,
  centeredText,
  currentUiScale,
  ensureWired,
  measureWidth,
  onFrameEnd,
  onReset,
  rawPointer,
  isInOverlayPass,
  isOverlayActive,
  uiSlot,
  theme,
  uiCtx,
  uiFont,
  withTheme,
} from "@src/ui/core/index.js";
import { paintFrame } from "./panel.js";
import type { Theme } from "@src/ui/theme.js";

interface TipState {
  request: string | null; // asked for this frame
  scale: number; // the UI scale the requesting widget drew under
  theme: Theme;
  shown: { text: string; since: number; scale: number; theme: Theme } | null; // hover-stable
}
const st = uiSlot<TipState>(() => ({ request: null, scale: 1, theme, shown: null }));

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
  s.theme = theme;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export function drawTips(): void {
  const ctx = uiCtx();
  // Deferred tooltips must never paint through a modal, popover, or select
  // menu. The requesting widget may have been drawn before that overlay, but
  // the overlay owns the screen until it closes.
  if (isOverlayActive() || isInOverlayPass()) return;
  const shown = st().shown;
  if (!shown || performance.now() - shown.since < 350) return;
  withTheme(shown.theme, () => {
    const msg = shown.text;
    const vp = anchorViewport();
    const p = rawPointer();
    ctx.save();
    ctx.font = uiFont(theme.fontSize - 1);
    const panelFrame = theme.skin?.frames.panel;
    const frameMinW = panelFrame ? panelFrame.insets.left + panelFrame.insets.right : 0;
    const frameMinH = panelFrame ? panelFrame.insets.top + panelFrame.insets.bottom : 0;
    // `drawTips` runs in native screen space, but the requesting widget may have
    // been inside a `UI.scaled` block — draw the box at ITS scale (the pointer and
    // the viewport clamp stay in screen px, so the tip still tracks the cursor and
    // never leaves the screen).
    const scale = shown.scale;
    // A pixel frame has fixed corners. Keep the tooltip large enough for those
    // slices so drawNineSlice can repeat the center instead of scaling the whole
    // art down into a distorted badge.
    const framePadX = panelFrame ? Math.max(panelFrame.insets.left, panelFrame.insets.right) : 0;
    const tipPadX = Math.max(theme.spacing.lg, framePadX + theme.spacing.sm);
    const boxW = Math.max(measureWidth(ctx, msg) + tipPadX * 2, frameMinW);
    const boxH = Math.max(28, frameMinH + (panelFrame ? theme.spacing.md * 2 : 0));
    const w = boxW * scale; // …and on screen, for the placement clamp
    const h = boxH * scale;
    let x = p.x + theme.spacing.lg + theme.spacing.xs;
    let y = p.y + (theme.spacing.xl + theme.spacing.xs) * scale;
    if (x + w > vp.w - theme.spacing.xs * 2) x = vp.w - theme.spacing.xs * 2 - w;
    if (y + h > vp.h - theme.spacing.xs * 2) y = p.y - theme.spacing.md - h;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    paintFrame(ctx, {
      x: 0,
      y: 0,
      w: boxW,
      h: boxH,
      bg: theme.panelBg,
      border: theme.border,
    });
    ctx.fillStyle = theme.text;
    ctx.textAlign = "left";
    centeredText(ctx, msg, tipPadX, boxH / 2);
    ctx.restore();
  });
}

// Hover-stability: the same text keeps its timer; a change restarts it. Runs at
// frame-end so it reflects every tooltip() call in the just-drawn frame.
function tooltipEndFrame(): void {
  const s = st();
  if (s.request) {
    if (s.shown?.text !== s.request) {
      s.shown = { text: s.request, since: performance.now(), scale: s.scale, theme: s.theme };
    } else {
      s.shown.scale = s.scale; // same text, new zoom → follow the zoom
      s.shown.theme = s.theme;
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
    s.theme = theme;
    s.shown = null;
  });
}
