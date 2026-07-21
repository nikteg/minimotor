import { pointInRect } from "../collision.js";
import { hoverCursor, theme, uiPointer, withCtx } from "./core.js";
import { clip } from "./layout.js";

/** A vertically-scrolling windowed list. Owns the clip, the visible-range
 *  windowing (only on-screen rows are drawn), the scrollbar and mouse-wheel —
 *  the boilerplate every leaderboard / inventory / chat log re-derives (and the
 *  off-by-one in `first`/`last` is a classic bug). The callback draws one row
 *  into its rect; pass your scroll `offset` in and store the returned value. */
export interface ListOptions {
  x: number;
  y: number;
  w: number;
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
  id?: string;
}

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
  let offset = Math.max(0, Math.min(max, opts.offset));

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
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** Gap between cells in px. Default 0. */
  gap?: number;
}

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

/** A vertical scrollbar bound to a content/view extent. */
export interface ScrollbarOptions {
  /** Track position + height (the bar is vertical). */
  x: number;
  y: number;
  h: number;
  /** Track width. Default 10. */
  w?: number;
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
  track?: string;
  thumb?: string;
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
  let offset = Math.max(0, Math.min(max, opts.offset));
  if (max <= 0) return 0; // everything fits — draw nothing

  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const w = opts.w ?? 10;
  const thumbH = Math.max(24, (opts.view / opts.content) * opts.h);
  const range = opts.h - thumbH;
  let thumbY = opts.y + (offset / max) * range;
  const p = uiPointer();

  const overThumb = pointInRect(p.x, p.y, { x: opts.x, y: thumbY, w, h: thumbH });
  const overTrack = pointInRect(p.x, p.y, { x: opts.x, y: opts.y, w, h: opts.h });
  hoverCursor(overTrack || scrollDrag?.id === id);

  if (!p.down) scrollDrag = null;
  if (p.pressed && overThumb && !scrollDrag) {
    scrollDrag = { id, grab: p.y - thumbY };
  } else if (p.released && overTrack && !overThumb && scrollDrag?.id !== id) {
    // Track click: page toward the click.
    offset += p.y < thumbY ? -opts.view : opts.view;
  }
  if (scrollDrag?.id === id && range > 0) {
    offset = ((p.y - scrollDrag.grab - opts.y) / range) * max;
  }
  if (opts.wheelArea && pointInRect(p.x, p.y, opts.wheelArea)) {
    offset += p.wheel;
  }

  offset = Math.max(0, Math.min(max, offset));
  thumbY = opts.y + (offset / max) * range;

  ctx.save();
  ctx.fillStyle = opts.track ?? "rgba(255,255,255,0.07)";
  ctx.fillRect(opts.x, opts.y, w, opts.h);
  ctx.fillStyle = scrollDrag?.id === id || overThumb ? theme.accent : (opts.thumb ?? theme.border);
  ctx.fillRect(opts.x + 1, thumbY, w - 2, thumbH);
  ctx.restore();
  return offset;
}
