import { pointInRect } from "../collision.js";
import { clamp } from "../mathf.js";
import {
  focusedId,
  hoverCursor,
  registerFocusable,
  theme,
  uiCtx,
  uiPointer,
  withCtx,
} from "./core/index.js";
import { clip } from "./layout.js";

/** A vertically-scrolling windowed list. Owns the clip, the visible-range
 *  windowing (only on-screen rows are drawn), the scrollbar and mouse-wheel —
 *  the boilerplate every leaderboard / inventory / chat log re-derives (and the
 *  off-by-one in `first`/`last` is a classic bug). The callback draws one row
 *  into its rect; pass your scroll `offset` in and store the returned value. */
export interface ListOptions {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px (includes the scrollbar gutter when one is shown). */
  w: number;
  /** Visible height in px; rows outside it are windowed out. */
  h: number;
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

/** Draw a windowed vertical list per `ListOptions`, calling `row(index, rect)`
 *  only for the currently visible rows. Handles clipping, the scrollbar and the
 *  mouse wheel; returns the new (clamped) scroll `offset` to store back. */
export function list(
  opts: ListOptions,
  row: (index: number, rect: { x: number; y: number; w: number; h: number }) => void,
): number {
  const gap = opts.gap ?? 0;
  const step = opts.rowH + gap;
  const content = opts.count * step - (opts.count > 0 ? gap : 0);
  const needsBar = content > opts.h;
  const scrollW = needsBar ? (opts.scrollW ?? 10) : 0;
  const listW = opts.w - (scrollW ? scrollW + 4 : 0);
  const max = Math.max(0, content - opts.h);
  let offset = clamp(opts.offset, 0, max);

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
      else if (top + opts.rowH > offset + opts.h) offset = top + opts.rowH - opts.h;
      offset = clamp(offset, 0, max);
    }
  }

  clip({ x: opts.x, y: opts.y, w: listW, h: opts.h }, () => {
    const first = Math.max(0, Math.floor(offset / step));
    const last = Math.min(opts.count, Math.ceil((offset + opts.h) / step));
    for (let i = first; i < last; i++) {
      row(i, { x: opts.x, y: opts.y + i * step - offset, w: listW, h: opts.rowH });
    }
  });

  if (scrollW) {
    offset = scrollbar({
      x: opts.x + opts.w - scrollW,
      y: opts.y,
      w: scrollW,
      h: opts.h,
      view: opts.h,
      content,
      offset,
      wheelArea: { x: opts.x, y: opts.y, w: opts.w, h: opts.h },
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
  a: CanvasRenderingContext2D | ScrollbarOptions,
  b?: ScrollbarOptions,
): number {
  const [ctx, opts] = withCtx(a, b);
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
