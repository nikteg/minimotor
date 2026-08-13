// ---------- Panel frame (internal box painter) ----------
// The rounded frame + optional title strip that the PUBLIC `panel` (a layout
// container, in ./layout.ts), the overlays (popover / modal / dialog) and the
// `select` drop menu all paint. Not part of the public `UI.*` surface — it's the
// shared drawing primitive, not a widget.
import {
  centeredText,
  drawBox,
  resolveThemePadding,
  roundRectPath,
  theme,
  uiFont,
} from "@src/ui/core/index.js";

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
  /** Fill color. Default `theme.panel.background`. */
  bg?: string;
  /** Border color. Default `theme.border`. */
  border?: string;
  /** Title text color. Default `theme.accent`. */
  titleColor?: string;
  /** Title font. Default a bold `theme.fontSize + 1` UI font. */
  font?: string;
  /** Ring stroked OVER the finished frame — a live drop target, a validation
   *  error, a selected card. Unlike `border` this survives a pixel skin, whose
   *  nine-slice art replaces the frame's own stroke, so a container can still
   *  answer the pointer under every theme. Omit for none. */
  highlight?: string;
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
  return panelFrameInsets().top + theme.panel.title.height;
}

/** Paint a framed box with an optional title strip — the shared box the public
 *  `panel`, the overlays and the `select` menu draw. Captures no input. */
export function paintFrame(ctx: CanvasRenderingContext2D, opts: PanelFrame): void {
  ctx.save();
  drawBox(ctx, opts.x, opts.y, opts.w, opts.h, {
    fill: opts.bg ?? theme.panel.background,
    stroke: opts.border ?? theme.border,
    role: "panel",
  });
  if (opts.title) {
    const titleH = theme.panel.title.height;
    const panelInsets = panelFrameInsets();
    const titleFrame = theme.skin?.frames.panelTitle;
    const overhang = resolveThemePadding(theme.panel.title.overhang);
    const overhangLeft = Math.max(0, overhang.left);
    const overhangRight = Math.max(0, overhang.right);
    const overhangTop = Math.max(0, overhang.top);
    // The resulting insets may be negative: that is what lets decorative
    // title caps extend beyond the panel's outer edge.
    const titleRect = {
      x: opts.x + panelInsets.left - overhangLeft,
      y: opts.y + panelInsets.top - overhangTop,
      w: Math.max(0, opts.w - panelInsets.left + overhangLeft - panelInsets.right + overhangRight),
      h: titleH,
    };
    if (titleFrame) {
      drawBox(ctx, titleRect.x, titleRect.y, titleRect.w, titleRect.h, {
        fill: opts.bg ?? theme.panel.background,
        stroke: opts.border ?? theme.border,
        role: "panelTitle",
      });
    }
    // A procedural title strip follows the same overhang behavior as a
    // tileset title frame.
    if (!titleFrame) {
      // Clipped to the panel's INNER outline — inside the border, at the
      // radius the border leaves — rather than filled as a bare rectangle. A
      // 6%-white wash could square off a rounded top corner without anyone
      // noticing; `theme.panel.title.background` is opaque by the time anyone
      // sets it, and then the squared corners and the painted-over top border
      // are the first two things you see.
      const bw = theme.borderWidth;
      ctx.save();
      roundRectPath(
        ctx,
        opts.x + bw,
        opts.y + bw,
        Math.max(0, opts.w - bw * 2),
        Math.max(0, opts.h - bw * 2),
        Math.max(0, theme.radius - bw),
      );
      ctx.clip();
      ctx.fillStyle = theme.panel.title.background ?? "rgba(255,255,255,0.06)";
      ctx.fillRect(titleRect.x, titleRect.y, titleRect.w, titleRect.h);
      ctx.restore();
    }
    ctx.fillStyle = opts.titleColor ?? theme.panel.title.color ?? theme.accent;
    ctx.font = opts.font ?? uiFont(theme.fontSize + 1, true);
    ctx.textAlign = "left";
    // Inset the title by panel padding so a panel's header text lines up with
    // the left edge of its padded body content. Title padding is independent from
    // textPad, so tuning a title does not move other labels or controls.
    const titleTextPad = resolveThemePadding(theme.panel.title.padding);
    const bodyPad = resolveThemePadding(theme.panel.padding);
    const titleInsetX =
      Math.max(bodyPad.left - panelInsets.left, titleFrame?.insets.left ?? 0) + titleTextPad.left;
    centeredText(
      ctx,
      opts.title,
      titleRect.x + titleInsetX,
      titleRect.y + titleH / 2 + titleTextPad.top,
      Math.max(1, titleRect.w - titleInsetX * 2),
    );
  }
  if (opts.highlight) {
    // Last, so it rides over the title strip's overhanging caps too, and inset
    // by half its width so the ring lands inside the rect rather than straddling
    // its edge.
    const width = Math.max(2, theme.borderWidth);
    const half = width / 2;
    ctx.strokeStyle = opts.highlight;
    ctx.lineWidth = width;
    roundRectPath(
      ctx,
      opts.x + half,
      opts.y + half,
      Math.max(0, opts.w - width),
      Math.max(0, opts.h - width),
      Math.max(0, theme.radius - half),
    );
    ctx.stroke();
  }
  ctx.restore();
}
