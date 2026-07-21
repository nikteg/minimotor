import { uiCtx } from "./context.js";
import { Stack, currentLayout, place } from "./stack.js";
import { centeredText, theme, uiFont } from "./theme.js";

// ---------- Text ----------

/** A themed text label. */
export interface TextOptions {
  /** Position. In a layout, omit and it flows like any widget (reserving a
   *  slot the width of the text, the row's height / a `size`-tall line). */
  x?: number;
  y?: number;
  /** Slot sizing overrides when placed in a layout. */
  w?: number;
  h?: number;
  at?: Stack;
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
  padX?: number;
  padY?: number;
  /** Word-wrap to multiple lines within the available width instead of
   *  squeezing one line to fit. The lines are stacked and vertically centered
   *  in the slot — give the slot enough `h` for them (≈ `size + 6` per line). */
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

/** Greedy word-wrap `str` into lines no wider than `maxW` (font must be set
 *  on `ctx`). A single word wider than `maxW` gets its own line (drawn clamped
 *  by the caller). */
export function wrapLines(ctx: CanvasRenderingContext2D, str: string, maxW: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxW) {
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
export function text(str: string, opts?: TextOptions): void;
export function text(ctx: CanvasRenderingContext2D, str: string, opts?: TextOptions): void;
export function text(
  a: CanvasRenderingContext2D | string,
  b?: string | TextOptions,
  c?: TextOptions,
): void {
  const [ctx, str, opts] =
    typeof a === "string" ? [uiCtx(), a, (b as TextOptions) ?? {}] : [a, b as string, c ?? {}];
  ctx.save();
  ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize, opts.bold ?? false);
  const natural = Math.ceil(ctx.measureText(str).width);
  const lineH = (opts.size ?? theme.fontSize) + 6;
  const rect = place(opts, natural, opts.h ?? lineH);

  // Inset within the slot (pad shorthand + per-axis overrides). Falls back to
  // the theme's textPad (default 0 → flush) so a global inset is one setTheme.
  const padX = opts.padX ?? opts.pad ?? theme.textPad;
  const padY = opts.padY ?? opts.pad ?? theme.textPad;
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
