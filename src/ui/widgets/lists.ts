import { pointInRect } from "../../collision.js";
import { clamp } from "../../mathf.js";
import {
  Fillable,
  buttonState,
  clearPointerEdges,
  consumeKeyboardActivation,
  drawFocusRing,
  fillRect,
  focusFromPointer,
  focusedId,
  hoverCursor,
  onFrameEnd,
  registerFocusable,
  suppressPointerEdges,
  theme,
  uiCtx,
  uiPointer,
  widgetId,
  withCtx,
} from "../core/index.js";
import { tooltip } from "./tooltip.js";
import { clip } from "./layout.js";

/** A vertically-scrolling windowed list. Owns the clip, the visible-range
 *  windowing (only on-screen rows are drawn), the scrollbar and mouse-wheel —
 *  the boilerplate every leaderboard / inventory / chat log re-derives (and the
 *  off-by-one in `first`/`last` is a classic bug). The callback draws one row
 *  into its rect; pass your scroll `offset` in and store the returned value. */
export interface ListOptions extends Fillable {
  /** Left edge in px. Omit (with `y`) to AUTO-FLOW: the list fills the current
   *  `row`/`col`/`panel` (or `at` flow), leaving `reserve` px for later
   *  siblings. Given explicitly, `w` includes the scrollbar gutter. */
  x?: number;
  /** Top edge in px (see `x`). */
  y?: number;
  /** Width in px (includes the scrollbar gutter when one is shown). Ignored
   *  when auto-flowing (the container's cross axis sets it). */
  w?: number;
  /** Visible height in px; rows outside it are windowed out. Ignored when
   *  auto-flowing. */
  h?: number;
  /** Row height in px. */
  rowH: number;
  /** Total number of rows. */
  count: number;
  /** Current scroll offset (px) — pass state in, assign the return back. */
  offset: number;
  /** Vertical gap between rows. Default 0. */
  gap?: number;
  /** Scrollbar width when one is needed. Default 10. */
  scrollW?: number;
  /** Stable prefix for the scrollbar's widget id. */
  id?: string;
  /** Make the rows keyboard-navigable: given a row index, return the focusable
   *  id its widget uses. The list then registers EVERY row (not only the visible
   *  window) so Tab can reach them all, and auto-scrolls to keep the focused row
   *  on screen instead of the tab order jumping straight to the next widget.
   *  The row widget should set `tabIndex: -1` so the list owns the tab entry. */
  rowId?: (index: number) => string;
}

// Swipe / body-drag scrolling — one active gesture at a time, keyed by list id.
// A press starts a candidate; once it travels past DRAG_THRESHOLD it becomes a
// scroll that owns the pointer (and swallows the ending click so it doesn't
// select a row). Below the threshold it stays a tap and the row clicks normally.
let bodyScroll: { id: string; startY: number; startOffset: number; active: boolean } | null = null;
const DRAG_THRESHOLD = 6;

// Clear the click-suppression flag once per frame (set while a body-drag runs).
let listHooksWired = false;
function ensureListHooks(): void {
  if (listHooksWired) return;
  listHooksWired = true;
  onFrameEnd(clearPointerEdges);
}

/** Draw a windowed vertical list per `ListOptions`, calling `row(index, rect)`
 *  only for the currently visible rows. Handles clipping, the scrollbar, the
 *  mouse wheel and swipe/body-drag scrolling; returns the new (clamped) scroll
 *  `offset` to store back. */
export function list(
  opts: ListOptions,
  row: (index: number, rect: { x: number; y: number; w: number; h: number }) => void,
): number {
  // Explicit x/y place it by hand; otherwise auto-flow — fill the ambient (or
  // `at`) layout, leaving `reserve` px for siblings drawn after the list.
  const { x, y, w, h } = fillRect(opts);
  const gap = opts.gap ?? 0;
  const step = opts.rowH + gap;
  const content = opts.count * step - (opts.count > 0 ? gap : 0);
  const needsBar = content > h;
  const scrollW = needsBar ? (opts.scrollW ?? 10) : 0;
  const listW = w - (scrollW ? scrollW + 4 : 0);
  const max = Math.max(0, content - h);
  let offset = clamp(opts.offset, 0, max);

  // Swipe to scroll: drag anywhere in the content area (the scrollbar gutter is
  // excluded — that's the thumb's job) to pan the list. Read the pointer BEFORE
  // suppressing edges, so this gesture still sees them while the rows below
  // don't. Only when the content overflows.
  if (needsBar) {
    ensureListHooks();
    const p = uiPointer();
    const key = opts.id ?? `list:${x}:${y}`;
    const body = { x, y, w: listW, h };
    if (p.pressed && !bodyScroll && pointInRect(p.x, p.y, body)) {
      bodyScroll = { id: key, startY: p.y, startOffset: offset, active: false };
    }
    if (bodyScroll?.id === key) {
      if (p.down) {
        const dy = p.y - bodyScroll.startY;
        if (!bodyScroll.active && Math.abs(dy) > DRAG_THRESHOLD) bodyScroll.active = true;
        if (bodyScroll.active) {
          offset = clamp(bodyScroll.startOffset - dy, 0, max);
          suppressPointerEdges(); // rows below mustn't hover-click mid-drag
        }
      } else {
        if (bodyScroll.active) suppressPointerEdges(); // swallow the release that ends the drag
        bodyScroll = null;
      }
    }
  }

  // Keyboard navigation: register ALL rows as focusables (so Tab reaches every
  // row, not just the visible window), then scroll so the focused one is in
  // view. Runs before the draw so a just-focused off-screen row scrolls in this
  // same frame.
  if (opts.rowId) {
    const ctx = uiCtx();
    const focused = focusedId();
    let focusedIndex = -1;
    for (let i = 0; i < opts.count; i++) {
      const rid = opts.rowId(i);
      registerFocusable(ctx, { id: rid });
      if (rid === focused) focusedIndex = i;
    }
    if (focusedIndex >= 0) {
      const top = focusedIndex * step;
      if (top < offset) offset = top;
      else if (top + opts.rowH > offset + h) offset = top + opts.rowH - h;
      offset = clamp(offset, 0, max);
    }
  }

  clip({ x, y, w: listW, h }, () => {
    const first = Math.max(0, Math.floor(offset / step));
    const last = Math.min(opts.count, Math.ceil((offset + h) / step));
    for (let i = first; i < last; i++) {
      row(i, { x, y: y + i * step - offset, w: listW, h: opts.rowH });
    }
  });

  if (scrollW) {
    offset = scrollbar({
      x: x + w - scrollW,
      y,
      w: scrollW,
      h,
      view: h,
      content,
      offset,
      wheelArea: { x, y, w, h },
      id: opts.id ? `${opts.id}:sb` : undefined,
    });
  }
  return offset;
}

/** Even 2-D cell layout — inventories, hotbars, level-select, board games.
 *  Splits `w`×`h` into `cols`×`rows` cells (minus `gap`) and hands each cell's
 *  rect to the callback. Removes the column-width arithmetic that `row`/`col`
 *  still force for grids. */
export interface GridOptions {
  /** Left edge of the grid area, px. */
  x: number;
  /** Top edge of the grid area, px. */
  y: number;
  /** Total width of the grid area, px (split across `cols`). */
  w: number;
  /** Total height of the grid area, px (split across `rows`). */
  h: number;
  /** Number of columns. */
  cols: number;
  /** Number of rows. */
  rows: number;
  /** Gap between cells in px. Default 0. */
  gap?: number;
}

/** Split `w`×`h` into an even `cols`×`rows` cell grid (minus `gap`) and call
 *  `cell(rect, index, col, row)` for each cell in row-major order. */
export function grid(
  opts: GridOptions,
  cell: (
    rect: { x: number; y: number; w: number; h: number },
    index: number,
    col: number,
    rowIndex: number,
  ) => void,
): void {
  const gap = opts.gap ?? 0;
  const cw = (opts.w - gap * (opts.cols - 1)) / opts.cols;
  const ch = (opts.h - gap * (opts.rows - 1)) / opts.rows;
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      cell(
        { x: opts.x + c * (cw + gap), y: opts.y + r * (ch + gap), w: cw, h: ch },
        r * opts.cols + c,
        c,
        r,
      );
    }
  }
}

// ---------- Scrollbar ----------

/** A scrollbar bound to a content/view extent, vertical or horizontal. */
export interface ScrollbarOptions {
  /** Track left x in logical px. */
  x: number;
  /** Track top y in logical px. */
  y: number;
  /** Track height in logical px — the bar's LENGTH when vertical (`axis: "y"`),
   *  its THICKNESS when horizontal. */
  h: number;
  /** Track width — the bar's THICKNESS when vertical (default 10), its LENGTH
   *  when horizontal (`axis: "x"`, required then). */
  w?: number;
  /** Orientation. `"y"` (default) scrolls vertically; `"x"` horizontally. */
  axis?: "x" | "y";
  /** Visible extent, in content px. */
  view: number;
  /** Total content extent, in content px. */
  content: number;
  /** Current scroll offset — pass your state in, assign the return back. */
  offset: number;
  /** Rect that reacts to the mouse wheel (usually the list area). */
  wheelArea?: { x: number; y: number; w: number; h: number };
  /** Identity for drag tracking across frames. Defaults to the track
   *  position — pass an explicit id if the bar moves while dragged. */
  id?: string;
  /** Track (groove) color. Default `rgba(255,255,255,0.07)`. */
  track?: string;
  /** Thumb color when idle. Default `theme.border` (accent while hovered/dragged). */
  thumb?: string;
  /** Overall opacity 0..1 for a fade in/out (e.g. only show while the pointer is
   *  in the scrolled area). Default 1. The offset math still runs at any
   *  opacity, so a faded bar can still be dragged. */
  opacity?: number;
}

// One drag at a time, tracked across frames by the scrollbar's id.
let scrollDrag: { id: string; grab: number } | null = null;

/** Compute the next offset for a scrollbar — thumb drag, track paging and
 *  wheel — and draw it. Returns the new offset (clamped to the content):
 *
 *    scroll = UI.scrollbar(ctx, { x, y, h, view, content, offset: scroll, wheelArea }); */
export function scrollbar(opts: ScrollbarOptions): number;
export function scrollbar(ctx: CanvasRenderingContext2D, opts: ScrollbarOptions): number;
export function scrollbar(
  ctxOrOpts: CanvasRenderingContext2D | ScrollbarOptions,
  maybeOpts?: ScrollbarOptions,
): number {
  const [ctx, opts] = withCtx(ctxOrOpts, maybeOpts);
  const max = Math.max(0, opts.content - opts.view);
  let offset = clamp(opts.offset, 0, max);
  if (max <= 0) return 0; // everything fits — draw nothing

  // Map onto a main (scroll) axis + a cross (thickness) axis so one body serves
  // both orientations. Vertical: length=h, thickness=w. Horizontal: length=w,
  // thickness=h; the pointer coordinate and thumb travel switch to x.
  const horiz = opts.axis === "x";
  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const thickness = horiz ? opts.h : (opts.w ?? 10);
  const length = horiz ? (opts.w ?? 0) : opts.h;
  const alongStart = horiz ? opts.x : opts.y;
  const thumbLen = Math.max(24, (opts.view / opts.content) * length);
  const range = length - thumbLen;
  let along = alongStart + (offset / max) * range;
  const p = uiPointer();
  const pAlong = horiz ? p.x : p.y;
  const trackRect = {
    x: opts.x,
    y: opts.y,
    w: horiz ? length : thickness,
    h: horiz ? thickness : length,
  };
  const thumbRect = () =>
    horiz
      ? { x: along, y: opts.y, w: thumbLen, h: thickness }
      : { x: opts.x, y: along, w: thickness, h: thumbLen };

  const overThumb = pointInRect(p.x, p.y, thumbRect());
  const overTrack = pointInRect(p.x, p.y, trackRect);
  hoverCursor(overTrack || scrollDrag?.id === id);

  if (!p.down) scrollDrag = null;
  if (p.pressed && overThumb && !scrollDrag) {
    scrollDrag = { id, grab: pAlong - along };
  } else if (p.released && overTrack && !overThumb && scrollDrag?.id !== id) {
    // Track click: page toward the click.
    offset += pAlong < along ? -opts.view : opts.view;
  }
  if (scrollDrag?.id === id && range > 0) {
    offset = ((pAlong - scrollDrag.grab - alongStart) / range) * max;
  }
  if (opts.wheelArea && pointInRect(p.x, p.y, opts.wheelArea)) {
    offset += p.wheel;
  }

  offset = clamp(offset, 0, max);
  along = alongStart + (offset / max) * range;

  const opacity = opts.opacity ?? 1;
  if (opacity > 0.01) {
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.fillStyle = opts.track ?? "rgba(255,255,255,0.07)";
    ctx.fillRect(trackRect.x, trackRect.y, trackRect.w, trackRect.h);
    ctx.fillStyle =
      scrollDrag?.id === id || overThumb ? theme.accent : (opts.thumb ?? theme.border);
    const t = thumbRect();
    if (horiz) ctx.fillRect(t.x, t.y + 1, t.w, t.h - 2);
    else ctx.fillRect(t.x + 1, t.y, t.w - 2, t.h);
    ctx.restore();
  }
  return offset;
}

// ---------- listItem ----------
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
  ctxOrOpts: CanvasRenderingContext2D | ListItemOptions,
  maybeOpts?: ListItemOptions,
): boolean {
  const [ctx, opts] = withCtx(ctxOrOpts, maybeOpts);
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
