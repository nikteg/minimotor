import { uiCtx } from "./context.js";
import { Flow, currentLayout, place } from "./flow.js";
import { centeredText, resolveThemeTextPadding, theme, uiFont } from "./theme.js";
import { currentUiTransform, uiHeight, uiWidth } from "./input.js";
import { measureWidth } from "./measure.js";
import { uiApp } from "./state.js";

// ---------- Text ----------

/** Named screen anchors: position HUD text without reading the viewport.
 *  Anchors respect safe-area insets (notches) on the left/top edges. */
export type TextAnchor =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

export const ANCHOR_H: Record<TextAnchor, 0 | 0.5 | 1> = {
  topLeft: 0,
  left: 0,
  bottomLeft: 0,
  top: 0.5,
  center: 0.5,
  bottom: 0.5,
  topRight: 1,
  right: 1,
  bottomRight: 1,
};
export const ANCHOR_V: Record<TextAnchor, 0 | 0.5 | 1> = {
  topLeft: 0,
  top: 0,
  topRight: 0,
  left: 0.5,
  center: 0.5,
  right: 0.5,
  bottomLeft: 1,
  bottom: 1,
  bottomRight: 1,
};

/** The box viewport-anchored chrome positions against, in the CURRENT space:
 *  the host app's viewport at the root, and the REFERENCE box inside a
 *  `UI.scaled` block (what `UI.width`/`UI.height` report). Anchoring against the
 *  device viewport inside a scaled block would put "centered" and "bottom" off
 *  by the scale — a modal, a dialogue box or a flipped drop-menu laid out in
 *  reference coords must measure the space in those same coords. Safe-area
 *  insets are mapped in too (and clamped at 0 — a scaled box that starts past
 *  the notch owes it nothing). */
export function anchorViewport(): {
  w: number;
  h: number;
  safeLeft: number;
  safeTop: number;
} {
  const vp = uiApp().viewport;
  const t = currentUiTransform();
  if (t) {
    return {
      w: uiWidth(),
      h: uiHeight(),
      safeLeft: Math.max(0, (vp.safeLeft - t.ox) / t.scale),
      safeTop: Math.max(0, (vp.safeTop - t.oy) / t.scale),
    };
  }
  return vp;
}

/** A themed text label. */
export interface TextOptions {
  /** Position. In a layout, omit and it flows like any widget (reserving a
   *  slot the width of the text, the row's height / a `size`-tall line). */
  x?: number;
  /** Top y in logical px (see `x`). */
  y?: number;
  /** Named screen anchor: `x`/`y` become OFFSETS from this point instead of
   *  absolute coordinates, and the text aligns toward it ("center" centers,
   *  "topRight" right-aligns, …). The HUD way to say "middle of the screen"
   *  without reading the viewport. */
  anchor?: TextAnchor;
  /** Slot sizing overrides when placed in a layout. */
  w?: number;
  /** Slot height override in px (see `w`). */
  h?: number;
  /** Place in this layout stack — flows the label like any widget. */
  at?: Flow;
  /** Font size in px. Default `theme.fontSize`. */
  size?: number;
  /** Bold. Default false. */
  bold?: boolean;
  /** Full font string — overrides `size`/`bold`/theme font entirely. */
  font?: string;
  /** Color. `"dim"` / `"accent"` map to theme roles; any CSS color works.
   *  Default `theme.text`. */
  color?: string;
  /** Horizontal alignment within the slot. Default `"left"`. */
  align?: "left" | "center" | "right";
  /** Inset the text inside its slot, in px. `pad` sets both axes; `padX`/
   *  `padY` override one. Handy for insetting a label from a panel edge.
   *  Defaults to `theme.textPad` (0) when omitted. */
  pad?: number;
  /** Horizontal-only inset override in px (see `pad`). */
  padX?: number;
  /** Vertical-only inset override in px (see `pad`). */
  padY?: number;
  /** Word-wrap to multiple lines within the available width instead of
   *  squeezing one line to fit. In a layout, or when `w`/`maxWidth` is known,
   *  an omitted `h` grows automatically to fit every line. */
  wrap?: boolean;
  /** Clamp width (px) for a single line — the glyphs squeeze rather than
   *  spill. In a layout the slot width is used automatically (unless `wrap`). */
  maxWidth?: number;
}

export function resolveColor(c: string | undefined): string {
  if (c === "dim") return theme.textDim;
  if (c === "accent") return theme.accent;
  return c ?? theme.text;
}

/** Width of `text` in the given font (default: the theme's base font) —
 *  for sizing custom layouts around labels. Memoized per (font, string). */
export function textWidth(text: string, font?: string): number {
  const ctx = uiCtx();
  const prevFont = ctx.font;
  ctx.font = font ?? uiFont();
  const w = measureWidth(ctx, text);
  ctx.font = prevFont;
  return w;
}

/** Greedy word-wrap `str` into lines no wider than `maxW` (font must be set
 *  on `ctx`). A single word wider than `maxW` gets its own line (drawn clamped
 *  by the caller). */
export function wrapLines(ctx: CanvasRenderingContext2D, str: string, maxW: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureWidth(ctx, candidate) > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/** Draw a line of themed text. Uses the theme font/size/color so a screen
 *  never has to touch `ctx.font`/`fillText` itself; flows in a layout or
 *  positions absolutely:
 *
 *    UI.text("Score: 42", { x: 12, y: 12, bold: true });
 *    UI.text(name, { color: "dim", align: "right", w: col.w }); */
export function text(str: string, rawOpts?: TextOptions): void {
  const ctx = uiCtx();
  let opts = rawOpts ?? {};
  if (opts.anchor) {
    const view = anchorViewport();
    const hx = ANCHOR_H[opts.anchor];
    const vy = ANCHOR_V[opts.anchor];
    const baseX = hx === 0 ? view.safeLeft : hx === 0.5 ? view.w / 2 : view.w;
    const baseY = vy === 0 ? view.safeTop : vy === 0.5 ? view.h / 2 : view.h;
    const lineH = (opts.size ?? theme.fontSize) + 6;
    opts = {
      ...opts,
      x: baseX + (opts.x ?? 0),
      y: baseY + (opts.y ?? 0) - vy * lineH,
      align: opts.align ?? (hx === 0 ? "left" : hx === 0.5 ? "center" : "right"),
      anchor: undefined,
    };
  }
  ctx.save();
  // UI is ALWAYS screen (letterbox-logical) space, regardless of ambient
  // camera blocks — reset to the base transform, not raw device space. Only
  // when the host app actually owns THIS ctx (an offscreen ctx keeps its
  // transform). The reset also wipes the canvas-side scale a `UI.scaled` block
  // pushed — but the rect below is laid out in that block's REFERENCE coords —
  // so re-apply the active UI transform: the glyphs must land (and size) where
  // the sibling widget boxes drew.
  if (typeof ctx.setTransform === "function") {
    const g = uiApp();
    if (g.ctx === ctx) {
      g.resetTransform();
      const t = currentUiTransform();
      if (t) {
        ctx.translate(t.ox, t.oy);
        ctx.scale(t.scale, t.scale);
      }
    }
  }
  ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize, opts.bold ?? false);
  const natural = Math.ceil(measureWidth(ctx, str));
  const lineH = (opts.size ?? theme.fontSize) + 6;
  const themePad = resolveThemeTextPadding(theme.textPad);
  const padX = opts.padX ?? opts.pad ?? themePad.x;
  const padY = opts.padY ?? opts.pad ?? themePad.y;
  const layout =
    opts.x === undefined && opts.y === undefined ? (opts.at ?? currentLayout()) : undefined;
  const wrapWidth =
    opts.maxWidth ??
    (opts.w !== undefined
      ? opts.w - padX * 2
      : layout?.dir === "col" && layout.crossSize !== undefined
        ? layout.crossSize - padX * 2
        : layout?.dir === "row"
          ? layout.remaining - padX * 2
          : undefined);
  const autoH =
    opts.wrap && wrapWidth !== undefined
      ? wrapLines(ctx, str, Math.max(0, wrapWidth)).length * lineH + padY * 2
      : lineH;
  const autoW =
    opts.wrap && opts.w === undefined && layout?.dir === "row" ? layout.remaining : undefined;
  // A self-sized slot must include the padding it will then be inset by —
  // otherwise the label is ellipsized to fit inside its OWN `theme.textPad`,
  // and every label under a theme with a non-zero textPad loses its last
  // characters to "…".
  const rect = place(
    opts.wrap && wrapWidth !== undefined
      ? { ...opts, w: autoW ?? opts.w, h: opts.h ?? autoH }
      : opts,
    natural + padX * 2,
    autoH,
    "text",
  );

  // Inset within the slot (pad shorthand + per-axis overrides). Falls back to
  // the theme's textPad (default 0 → flush) so a global inset is one setTheme.
  const bx = rect.x + padX;
  const bw = rect.w - padX * 2;
  const by = rect.y + padY;
  const bh = rect.h - padY * 2;

  const align = opts.align ?? "left";
  ctx.fillStyle = resolveColor(opts.color);
  ctx.textAlign = align;
  // A known width constrains the text: it flows in a layout, or w/maxWidth was
  // given. Then align positions WITHIN the slot [bx, bx+bw] and the width
  // clamps/wraps. Without a width the position is an anchor point: `x` is where
  // the text aligns to (canvas-native), so `align:"center", x: W/2` centers on
  // W/2 rather than starting there.
  const constrained =
    opts.w !== undefined || opts.maxWidth !== undefined || !!currentLayout() || !!opts.at;
  const tx = constrained
    ? align === "center"
      ? bx + bw / 2
      : align === "right"
        ? bx + bw
        : bx
    : rect.x;
  const maxW = opts.maxWidth ?? (constrained ? bw : undefined);

  if (opts.wrap && maxW !== undefined) {
    const lines = wrapLines(ctx, str, maxW);
    const blockTop = by + (bh - lines.length * lineH) / 2;
    lines.forEach((line, i) => centeredText(ctx, line, tx, blockTop + i * lineH + lineH / 2, maxW));
  } else {
    centeredText(ctx, str, tx, by + bh / 2, maxW);
  }
  ctx.restore();
}
