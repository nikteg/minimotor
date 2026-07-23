// ---------- tabs ----------
import {
  Stack,
  buttonState,
  centeredText,
  consumeKeyboardCommand,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  place,
  registerFocusable,
  roundRectPath,
  theme,
  uiFont,
  uiPointer,
  widgetId,
  withCtx,
} from "../core/index.js";

/** A horizontal tab strip. */
export interface TabsOptions {
  /** Stable identity enables Tab focus and arrow-key selection. */
  id?: string;
  /** Position in the keyboard tab order. */
  tabIndex?: number;
  /** Left edge in px. */
  x?: number;
  /** Top edge in px. */
  y?: number;
  /** Total width, split equally between the tabs. Omit to auto-size every
   *  cell to the widest label. */
  w?: number;
  /** Strip height in px. Default `30`. */
  h?: number;
  /** Tab labels, left to right. */
  items: string[];
  /** Current tab index — pass your state in, assign the return value back. */
  active: number;
  /** Place in this layout stack — supplies x/y (and h); auto width. */
  at?: Stack;
  /** Label font. Default a bold `theme.fontSize` UI font. */
  font?: string;
}

/** Draw a tab strip; returns the (possibly changed) active index:
 *
 *    tab = UI.tabs(ctx, { x, y, items: ["All", "Coop", "PvP"], active: tab }); */
export function tabs(opts: TabsOptions): number;
export function tabs(ctx: CanvasRenderingContext2D, opts: TabsOptions): number;
export function tabs(a: CanvasRenderingContext2D | TabsOptions, b?: TabsOptions): number {
  const [ctx, opts] = withCtx(a, b);
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize, true);
  // Auto width: equal cells sized to the widest label.
  const w =
    opts.w ??
    (Math.ceil(Math.max(...opts.items.map((t) => ctx.measureText(t).width))) + 26) *
      opts.items.length;
  const rect = place(opts, w, opts.h ?? 30);
  const id = widgetId(opts.id, "tabs");
  const keyboardFocused = registerFocusable(ctx, { id, tabIndex: opts.tabIndex });
  const cellW = rect.w / opts.items.length;
  const p = uiPointer();
  let active = opts.active;
  const command = consumeKeyboardCommand(id);
  if (command === "ArrowRight" || command === "ArrowDown")
    active = (active + 1) % opts.items.length;
  if (command === "ArrowLeft" || command === "ArrowUp")
    active = (active - 1 + opts.items.length) % opts.items.length;
  ctx.textAlign = "center";
  // Uniform baseline across the row: `centeredText` centers each label's own
  // ink box, so labels with descenders (g/q) would sit higher than others.
  // "middle" is font-relative (string-independent), so every tab lines up.
  ctx.textBaseline = "middle";
  // Round only the strip's outer corners: clip the whole strip, fill cells
  // square inside it.
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius);
  ctx.clip();
  opts.items.forEach((label, i) => {
    const x = rect.x + i * cellW;
    const { hover, clicked } = buttonState({ x, y: rect.y, w: cellW, h: rect.h }, p);
    hoverCursor(hover);
    if (clicked) {
      active = i;
      focusFromPointer(ctx, id);
    }
    const isActive = i === active;
    ctx.fillStyle = isActive ? theme.bg : hover ? theme.bgHover : theme.bgActive;
    ctx.fillRect(x, rect.y, cellW - 2, rect.h);
    if (isActive) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x, rect.y + rect.h - 3, cellW - 2, 3);
    }
    ctx.fillStyle = isActive ? theme.text : theme.textDim;
    ctx.textAlign = "center";
    centeredText(ctx, label, x + cellW / 2, rect.y + rect.h / 2, cellW - 10);
  });
  ctx.restore();
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);
  return active;
}
