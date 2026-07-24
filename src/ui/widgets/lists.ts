import { pointInRect } from "../../collision.js";
import { clamp } from "../../mathf.js";
import {
  Fillable,
  buttonState,
  claimWheel,
  clearPointerEdges,
  clearWheelClaim,
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

// Swipe / body-drag scrolling — one active gesture at a time, keyed by region
// id. A press starts a candidate; once it travels past DRAG_THRESHOLD it becomes
// a scroll that owns the pointer (and swallows the ending click so it doesn't
// select whatever is underneath). Below the threshold it stays a tap and the
// widget under it clicks normally. The FIRST region to claim a press wins, so
// when regions nest, the outer (drawn first) takes the gesture — a page swipe
// scrolls the page, not a widget inside it.
let bodyScroll: { id: string; start: number; startOffset: number; active: boolean } | null = null;
const DRAG_THRESHOLD = 6;

// Clear the click-suppression flag once per frame (set while a body-drag runs).
let listHooksWired = false;
function ensureListHooks(): void {
  if (listHooksWired) return;
  listHooksWired = true;
  onFrameEnd(clearPointerEdges);
  onFrameEnd(clearWheelClaim);
}

/** Cancel any in-progress body-drag — a scrollbar calls this when it grabs its
 *  thumb, so click-dragging a scrollbar that sits inside a larger scroll region
 *  doesn't ALSO swipe that region. */
function cancelBodyDrag(): void {
  bodyScroll = null;
}

/** Swipe / body-drag scrolling for any scroll region — the shared engine behind
 *  `list`'s rows and the `overflow` containers. Pass the region's clipped body
 *  `rect`, its scroll `axis` (`"y"` vertical, `"x"` horizontal), the current
 *  `offset` and the max scroll; returns the updated offset. A drag past the
 *  threshold suppresses the click that ends it, so dragging to scroll never
 *  activates the widget the finger lifts over. */
export function dragScroll(
  key: string,
  rect: { x: number; y: number; w: number; h: number },
  axis: "x" | "y",
  offset: number,
  max: number,
): number {
  if (max <= 0) return offset;
  ensureListHooks();
  const p = uiPointer();
  const pos = axis === "y" ? p.y : p.x;
  if (p.pressed && !bodyScroll && pointInRect(p.x, p.y, rect)) {
    bodyScroll = { id: key, start: pos, startOffset: offset, active: false };
  }
  if (bodyScroll?.id === key) {
    if (p.down) {
      const d = pos - bodyScroll.start;
      if (!bodyScroll.active && Math.abs(d) > DRAG_THRESHOLD) bodyScroll.active = true;
      if (bodyScroll.active) {
        offset = clamp(bodyScroll.startOffset - d, 0, max);
        suppressPointerEdges(); // whatever's under the finger mustn't click mid-drag
      }
    } else {
      if (bodyScroll.active) suppressPointerEdges(); // swallow the release that ends the drag
      bodyScroll = null;
    }
  }
  return offset;
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
  // excluded — that's the thumb's job) to pan the list. Wheel is claimed
  // outer-first so it chains through nested regions.
  offset = dragScroll(opts.id ?? `list:${x}:${y}`, { x, y, w: listW, h }, "y", offset, max);
  const wp = uiPointer();
  offset = clamp(
    offset +
      claimWheel(
        pointInRect(wp.x, wp.y, { x, y, w, h }),
        wp.wheel,
        offset <= 0.5,
        offset >= max - 0.5,
      ),
    0,
    max,
  );

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
      id: opts.id ? `${opts.id}:sb` : undefined,
    });
  }
  return offset;
}

/** Even 2-D cell layout — inventories, hotbars, level-select, board games.
 *  Lays `count` items out in a `cols`-wide grid and hands each cell's rect to
 *  the callback, dropping the column-width arithmetic that `row`/`col` force.
 *  Auto-flows (`Fillable`), and — with a fixed `rowH` — WINDOWS + scrolls when
 *  the rows overflow. */
export interface GridOptions extends Fillable {
  /** Number of columns; each cell's width is derived from the area width. */
  cols: number;
  /** Total number of cells: rows = `ceil(count / cols)`, and the last row may
   *  be partial. */
  count: number;
  /** Fixed row height in px. OMIT to divide the area height evenly across the
   *  rows — a static matrix that always fits (no scroll). GIVE it for
   *  fixed-height rows that WINDOW + scroll (scrollbar / wheel / swipe) when they
   *  overflow the area — a scrollable inventory. */
  rowH?: number;
  /** Gap between cells in px (both axes). Default 0. */
  gap?: number;
  /** Scroll offset (px), for the overflow case — pass state in, assign the
   *  return back. Ignored by the fill-to-fit matrix (which never scrolls). */
  offset?: number;
  /** Scrollbar width when the rows overflow. Default 10. */
  scrollW?: number;
  /** Stable prefix for the scrollbar widget id. */
  id?: string;
}

/** Lay `count` items out in an even `cols`-wide grid and call
 *  `cell(rect, index, col, row)` for each in row-major order. Two modes: omit
 *  `rowH` and the area height splits evenly across the rows (a static matrix —
 *  inventories, boards, always fits); give `rowH` and the rows are fixed-height
 *  and WINDOW + scroll when they overflow (built on `list`, so the scrollbar,
 *  wheel and swipe come free). Give an explicit rect or omit `x`/`y` to
 *  AUTO-FLOW into the current layout. Returns the (clamped) scroll offset. */
export function grid(
  opts: GridOptions,
  cell: (
    rect: { x: number; y: number; w: number; h: number },
    index: number,
    col: number,
    rowIndex: number,
  ) => void,
): number {
  const rect = fillRect(opts);
  const { cols, count } = opts;
  const gap = opts.gap ?? 0;
  const rows = cols > 0 ? Math.ceil(count / cols) : 0;

  // Matrix mode: no `rowH` → divide the area, draw every cell, never scroll.
  if (opts.rowH === undefined) {
    const cw = cols > 0 ? (rect.w - gap * (cols - 1)) / cols : rect.w;
    const ch = rows > 0 ? (rect.h - gap * (rows - 1)) / rows : rect.h;
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      cell({ x: rect.x + c * (cw + gap), y: rect.y + r * (ch + gap), w: cw, h: ch }, i, c, r);
    }
    return 0;
  }

  // Overflow mode: fixed-height rows windowed through `list` — one list row
  // draws a strip of `cols` cells — so scrollbar + wheel + swipe come for free.
  const rowH = opts.rowH;
  return list(
    {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      rowH,
      gap,
      count: rows,
      offset: opts.offset ?? 0,
      scrollW: opts.scrollW,
      id: opts.id,
    },
    (rowIndex, rowRect) => {
      const cw = cols > 0 ? (rowRect.w - gap * (cols - 1)) / cols : rowRect.w;
      for (let c = 0; c < cols; c++) {
        const i = rowIndex * cols + c;
        if (i >= count) break;
        cell({ x: rowRect.x + c * (cw + gap), y: rowRect.y, w: cw, h: rowH }, i, c, rowIndex);
      }
    },
  );
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
  ensureListHooks(); // a standalone scrollbar still needs the per-frame wheel-claim reset
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
    cancelBodyDrag(); // grabbing the thumb must not also swipe a surrounding region
  } else if (p.released && overTrack && !overThumb && scrollDrag?.id !== id) {
    // Track click: page toward the click.
    offset += pAlong < along ? -opts.view : opts.view;
  }
  if (scrollDrag?.id === id && range > 0) {
    offset = ((pAlong - scrollDrag.grab - alongStart) / range) * max;
  }
  if (opts.wheelArea) {
    offset += claimWheel(
      pointInRect(p.x, p.y, opts.wheelArea),
      p.wheel,
      offset <= 0.5,
      offset >= max - 0.5,
    );
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
