// ---------- Theme ----------

/** Every color, font and metric the widgets use. Override any subset with
 *  `setTheme`; per-widget style options still win over the theme. */
export interface Theme {
  /** Font family for all widget text. */
  font: string;
  /** Base label size in px; widget fonts scale from it. */
  fontSize: number;
  /** Highlight color: active tab underline, hover borders, fills, knobs. */
  accent: string;
  /** Dimmer accent for resting knobs/thumbs. */
  accentSoft: string;
  /** Primary text. */
  text: string;
  /** Secondary text: captions, inactive tabs, disabled hints. */
  textDim: string;
  /** Disabled label text. */
  textDisabled: string;
  /** Widget fill when idle. */
  bg: string;
  /** Widget fill when hovered. */
  bgHover: string;
  /** Widget fill when held/pressed — also the recessed tone for insets
   *  (checkbox well) and disabled/inactive fills. */
  bgActive: string;
  /** Widget border when not hovered. */
  border: string;
  /** Panel/modal/tooltip background. */
  panelBg: string;
  /** Track behind sliders/scrollbars/bars. */
  track: string;
  /** The modal backdrop. */
  dim: string;
  /** Fill of a `variant: "primary"` button (its label is `bgActive`). */
  primary: string;
  /** Fill of a `variant: "danger"` button (its label is `text`). */
  danger: string;
  /** Border thickness in px for buttons/panels/toggles/tabs. Default 2. */
  borderWidth: number;
  /** Corner radius in px (0 = square). Default 0. */
  radius: number;
  /** Horizontal padding added around auto-sized button labels. Default 28. */
  buttonPadX: number;
  /** Default inner padding (px) for bordered content containers — the `group`
   *  body inset. Override per call with `pad`. Structural flow containers
   *  (`row`/`col`) intentionally stay flush (pad 0) so widgets align to their
   *  slot edges; use a `group` (or an explicit `pad`) when you want a box that
   *  insets its content. Default 8. */
  pad: number;
  /** Default inset (px) applied by `UI.text` when no `pad`/`padX`/`padY` is
   *  given. 0 keeps a label flush with its slot (so it lines up with sibling
   *  widgets and HUD columns); raise it for a global label inset. Default 0. */
  textPad: number;
}

/** The built-in `Theme` — the base every `setTheme` override is merged over
 *  (so overrides never compound) and the reset target for `getTheme`. */
export const defaultTheme: Theme = {
  font: "monospace",
  fontSize: 13,
  accent: "#4ecdc4",
  accentSoft: "#3a8f89",
  text: "#e8f0f4",
  textDim: "#7d8894",
  textDisabled: "#5a6a75",
  bg: "#24384a",
  bgHover: "#2c4356",
  bgActive: "#1d2b36",
  border: "#3a5568",
  panelBg: "rgba(13,18,26,0.92)",
  track: "rgba(255,255,255,0.12)",
  dim: "rgba(0,0,0,0.55)",
  primary: "#4ecdc4",
  danger: "#ff6b6b",
  borderWidth: 2,
  radius: 0,
  buttonPadX: 28,
  pad: 8,
  textPad: 0,
};

export let theme: Theme = { ...defaultTheme };

/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides: Partial<Theme>): void {
  theme = { ...defaultTheme, ...overrides };
}

/** The active theme (live object — read, don't mutate). */
export function getTheme(): Theme {
  return theme;
}

export const uiFont = (size = theme.fontSize, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${theme.font}`;

/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; radius?: number; border?: number },
): void {
  const r = opts.radius ?? theme.radius;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (opts.stroke) {
    const bw = opts.border ?? theme.borderWidth;
    if (bw > 0) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = bw;
      const half = bw / 2;
      roundRectPath(ctx, x + half, y + half, w - bw, h - bw, Math.max(0, r - half));
      ctx.stroke();
    }
  }
}

/** Vertically centered text using real glyph metrics — the canvas "middle"
 *  baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clamps rendering (canvas squeezes the glyphs) so a label can never
 *  spill out of its widget. */
/** Trim `text` with a trailing ellipsis until it fits `maxW` (binary search).
 *  Returns the string unchanged when it already fits. */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0 || ctx.measureText(text).width <= maxW) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

export function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxW?: number,
): void {
  // measureText's actualBoundingBox values are relative to the CURRENT
  // textBaseline — pin it before measuring, or state leaked from caller
  // drawing (e.g. "middle") skews the correction.
  ctx.textBaseline = "alphabetic";
  // Clip to width with an ellipsis rather than passing `maxW` to fillText,
  // which SQUISHES the glyphs horizontally. (Multi-line wrapping is handled by
  // the caller via `wrapLines`; this keeps a single line from stretching.)
  const str = maxW !== undefined ? ellipsize(ctx, text, maxW) : text;
  const m = ctx.measureText(str);
  const asc = m.actualBoundingBoxAscent ?? 0;
  const desc = m.actualBoundingBoxDescent ?? 0;
  if (asc || desc) {
    ctx.fillText(str, x, cy + (asc - desc) / 2);
  } else {
    // Metrics unavailable (mocked ctx) — middle baseline is the best we have.
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, cy);
  }
}
