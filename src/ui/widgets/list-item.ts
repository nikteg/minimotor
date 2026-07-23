// ---------- listItem ----------
import {
  buttonState,
  consumeKeyboardActivation,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  registerFocusable,
  theme,
  tooltip,
  uiPointer,
  widgetId,
  withCtx,
} from "../core/index.js";

/** A selectable list row (a table/menu entry — not to be confused with the
 *  `row` layout container). */
export interface ListItemOptions {
  /** Stable identity enables Tab focus and Enter/Space activation. */
  id?: string;
  /** Position in the keyboard tab order. */
  tabIndex?: number;
  /** Skip input and focus; the row is drawn without hover/click. */
  disabled?: boolean;
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px. */
  w: number;
  /** Height in px. */
  h: number;
  /** Draw the selected background plus an accent bar down the left edge. */
  selected?: boolean;
  /** Idle background. Default transparent (no fill). */
  bg?: string;
  /** Hover background. Default a faint white tint. */
  bgHover?: string;
  /** Selected background. Default a faint accent tint. */
  bgSelected?: string;
  /** Shown near the pointer after hovering a moment (see `drawTips`). */
  tooltip?: string;
}

/** Draw a selectable list-item background with hover/selected states and
 *  report a click. Draw your own content (columns, icons) on top afterwards:
 *
 *    if (UI.listItem({ x, y, w, h, selected: i === sel })) sel = i; */
export function listItem(opts: ListItemOptions): boolean;
export function listItem(ctx: CanvasRenderingContext2D, opts: ListItemOptions): boolean;
export function listItem(
  a: CanvasRenderingContext2D | ListItemOptions,
  b?: ListItemOptions,
): boolean {
  const [ctx, opts] = withCtx(a, b);
  const id = widgetId(opts.id, "list-item");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
  });
  const state = opts.disabled ? { hover: false, clicked: false } : buttonState(opts, uiPointer());
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
  const { hover } = state;
  hoverCursor(hover);
  if (hover && opts.tooltip) tooltip(opts.tooltip);
  ctx.save();
  ctx.fillStyle = opts.selected
    ? (opts.bgSelected ?? "rgba(78,205,196,0.18)")
    : hover
      ? (opts.bgHover ?? "rgba(255,255,255,0.05)")
      : (opts.bg ?? "transparent");
  if (ctx.fillStyle !== "transparent") ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  if (opts.selected) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(opts.x, opts.y, 3, opts.h);
  }
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, opts);
  return clicked;
}
