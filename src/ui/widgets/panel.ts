// ---------- Panel frame (internal box painter) ----------
// The rounded frame + optional title strip that the PUBLIC `panel` (a layout
// container, in ./layout.ts), the overlays (popover / modal / dialog) and the
// `select` drop menu all paint. Not part of the public `UI.*` surface — it's the
// shared drawing primitive, not a widget.
import { centeredText, drawBox, theme, uiFont } from "@src/ui/core/index.js";

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

interface FrameInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const ZERO_INSETS: FrameInsets = { left: 0, top: 0, right: 0, bottom: 0 };

function panelFrameInsets(): FrameInsets {
  return theme.skin?.frames.panel?.insets ?? ZERO_INSETS;
}

/** Vertical space reserved before panel children begin. The panel's top frame
 *  inset is part of the title area so title art sits inside the panel rather
 *  than painting over its decorative corners. */
export function panelTitleBodyOffset(): number {
  return panelFrameInsets().top + theme.panelTitleH;
}

/** Paint a framed box with an optional title strip — the shared box the public
 *  `panel`, the overlays and the `select` menu draw. Captures no input. */
export function paintFrame(ctx: CanvasRenderingContext2D, opts: PanelFrame): void {
  ctx.save();
  drawBox(ctx, opts.x, opts.y, opts.w, opts.h, {
    fill: opts.bg ?? theme.panelBg,
    stroke: opts.border ?? theme.border,
    role: "panel",
  });
  if (opts.title) {
    const titleH = theme.panelTitleH;
    const panelInsets = panelFrameInsets();
    const titleFrame = theme.skin?.frames.panelTitle;
    const overhangX = Math.max(0, theme.panelTitleOverhang.x);
    const overhangY = Math.max(0, theme.panelTitleOverhang.y);
    // The resulting insets may be negative: that is what lets decorative
    // title caps extend beyond the panel's outer edge.
    const sideInset = panelInsets.left - overhangX;
    const farSideInset = panelInsets.right - overhangX;
    const titleRect = {
      x: opts.x + sideInset,
      y: opts.y + panelInsets.top - overhangY,
      w: Math.max(0, opts.w - sideInset - farSideInset),
      h: titleH,
    };
    if (titleFrame) {
      drawBox(ctx, titleRect.x, titleRect.y, titleRect.w, titleRect.h, {
        fill: opts.bg ?? theme.panelBg,
        stroke: opts.border ?? theme.border,
        role: "panelTitle",
      });
    }
    // A procedural title strip follows the same overhang behavior as a
    // tileset title frame.
    if (!titleFrame) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(titleRect.x, titleRect.y, titleRect.w, titleRect.h);
    }
    ctx.fillStyle = opts.titleColor ?? theme.panelTitleText ?? theme.accent;
    ctx.font = opts.font ?? uiFont(theme.fontSize + 1, true);
    ctx.textAlign = "left";
    // Inset the title by theme.pad so a panel's header text lines up with the
    // left edge of its padded body content. panelTitlePad is independent from
    // textPad, so tuning a title does not move other labels or controls.
    const titleTextPad = theme.panelTitlePad;
    const titleInsetX =
      Math.max(theme.pad.x - panelInsets.left, titleFrame?.insets.left ?? 0) + titleTextPad.x;
    centeredText(
      ctx,
      opts.title,
      titleRect.x + titleInsetX,
      titleRect.y + titleH / 2 + titleTextPad.y,
      Math.max(1, titleRect.w - titleInsetX * 2),
    );
  }
  ctx.restore();
}
