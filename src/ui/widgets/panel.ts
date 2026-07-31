// ---------- Panel frame (internal box painter) ----------
// The rounded frame + optional title strip that the PUBLIC `panel` (a layout
// container, in ./layout.ts), the overlays (popover / modal / dialog) and the
// `select` drop menu all paint. Not part of the public `UI.*` surface — it's the
// shared drawing primitive, not a widget.
import { centeredText, drawBox, roundRectPath, theme, uiFont } from "@src/ui/core/index.js";

/** Geometry + look of a panel frame. */
export interface PanelFrame {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px. */
  w: number;
  /** Height in px. */
  h: number;
  /** Optional title; when set, a title strip is drawn along the top. */
  title?: string;
  /** Fill color. Default `theme.panelBg`. */
  bg?: string;
  /** Border color. Default `theme.border`. */
  border?: string;
  /** Title text color. Default `theme.accent`. */
  titleColor?: string;
  /** Title font. Default a bold `theme.fontSize + 1` UI font. */
  font?: string;
}

/** Paint a framed box with an optional title strip — the shared box the public
 *  `panel`, the overlays and the `select` menu draw. Captures no input. */
export function paintFrame(ctx: CanvasRenderingContext2D, opts: PanelFrame): void {
  ctx.save();
  drawBox(ctx, opts.x, opts.y, opts.w, opts.h, {
    fill: opts.bg ?? theme.panelBg,
    stroke: opts.border ?? theme.border,
  });
  if (opts.title) {
    // Title strip clipped to the frame's rounded top so it doesn't poke past
    // the corners.
    ctx.save();
    roundRectPath(ctx, opts.x, opts.y, opts.w, opts.h, theme.radius);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(opts.x + 2, opts.y + 2, opts.w - 4, 30);
    ctx.restore();
    ctx.fillStyle = opts.titleColor ?? theme.accent;
    ctx.font = opts.font ?? uiFont(theme.fontSize + 1, true);
    ctx.textAlign = "left";
    // Inset the title by theme.pad so a panel's header text lines up with the
    // left edge of its padded body content.
    centeredText(ctx, opts.title, opts.x + theme.pad, opts.y + 17, opts.w - theme.pad * 2);
  }
  ctx.restore();
}
