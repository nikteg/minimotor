import { pointInRect } from "../../collision.js";
import { STEP_MS } from "../../clock.js";
import { clamp } from "../../mathf.js";
import {
  Fillable,
  buttonState,
  claimWheel,
  clearPointerEdges,
  clearWheelClaim,
  consumeKeyboardActivation,
  dragPointer,
  drawFocusRing,
  fillRect,
  focusFromPointer,
  focusedId,
  hoverCursor,
  ensureWired,
  onFrameEnd,
  claimPointerGesture,
  pointerGestureOwned,
  rawPointer,
  registerFocusable,
  runtimeSlot,
  suppressPointerEdges,
  sweptCache,
  uiApp,
  theme,
  uiCtx,
  uiPointer,
  widgetId,
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
   *  id its widget uses. The list registers the visible window (plus a one-row
   *  buffer, so Tab can step past the window's edge) and auto-scrolls to keep
   *  the focused row on screen — Tab walks the whole list one row at a time as
   *  the window follows, without paying O(count) registration per frame.
   *  The row widget should set `tabIndex: -1` so the list owns the tab entry. */
  rowId?: (index: number) => string;
}

// Swipe / body-drag scrolling — one active gesture at a time, keyed by region
// id. A press starts a candidate; once it travels past DRAG_THRESHOLD it becomes
// a scroll that owns the pointer (and swallows the ending click so it doesn't
// select whatever is underneath). Below the threshold it stays a tap and the
// widget under it clicks normally. When regions nest, the INNERMOST under the
// press wins (children draw after parents and overwrite the claim), so a swipe
// inside a nested region scrolls that region, not the page.
interface BodyScroll {
  id: string;
  start: number;
  startOffset: number;
  active: boolean;
  /** Smoothed finger speed along the axis, px per 60 Hz frame — becomes the
   *  fling velocity when the drag releases. */
  vel: number;
  lastPos: number;
  /** Countdown (in frames) of a live handoff offer: set when this drag is
   *  pinned at a scroll extreme and still pulling past it. Regions run
   *  parents-first each frame, so the offer must survive one frame boundary
   *  for ancestors to see it — enclosing regions under the pointer adopt the
   *  gesture (scroll chaining), the nearest ancestor (last adopter in draw
   *  order) winning. `from` keeps the region that handed off from re-adopting
   *  its own gesture. */
  handoff: number;
  from: string | null;
}
interface BodyScrollState {
  drag: BodyScroll | null;
  /** An ACTIVE drag released this frame — overlay close-on-click-outside logic
   *  checks it so the release that ends a scroll never reads as a click. */
  endedThisFrame: boolean;
  /** Post-release fling velocity per region (px per 60 Hz frame), decayed each
   *  frame until it dies out, hits an extreme, or a press catches it. */
  momentum: Map<string, number>;
}
const bodyScrollSlot = runtimeSlot<BodyScrollState>(() => ({
  drag: null,
  endedThisFrame: false,
  momentum: new Map(),
}));
const DRAG_THRESHOLD = 6;
// Overpull (px past a pinned extreme, in one frame) before the gesture is
// offered to an enclosing region.
const HANDOFF_SLOP = 8;
// Fling tuning: minimum release speed to coast at all, per-frame decay, and
// the speed below which the coast stops (all in px per 60 Hz frame).
const FLING_MIN = 3;
const FLING_DECAY = 0.94;
const FLING_STOP = 0.4;

// Frame-end: clear the click-suppression flag, the wheel claim, the one-frame
// scroll-ended flag and any pending handoff offer.
let listHooksWired = false;
function ensureListHooks(): void {
  if (listHooksWired) return;
  listHooksWired = true;
  onFrameEnd(clearPointerEdges);
  onFrameEnd(clearWheelClaim);
  onFrameEnd(() => {
    const bs = bodyScrollSlot();
    bs.endedThisFrame = false;
    if (bs.drag && bs.drag.handoff > 0) {
      bs.drag.handoff--;
      if (bs.drag.handoff === 0) bs.drag.from = null;
    }
  });
}

/** True while a body drag-scroll is live (or just released this frame) —
 *  overlays (popover, the select menu) check it so a scroll gesture that ends
 *  outside them is never mistaken for a click-outside close. */
export function scrollGestureActive(): boolean {
  const bs = bodyScrollSlot();
  return (bs.drag?.active ?? false) || bs.endedThisFrame;
}

/** Cancel any in-progress body-drag — a scrollbar calls this when it grabs its
 *  thumb, so click-dragging a scrollbar that sits inside a larger scroll region
 *  doesn't ALSO swipe that region. */
function cancelBodyDrag(): void {
  bodyScrollSlot().drag = null;
}

// Focused-row lookup cache. Resolving which row index the focused id maps to
// is O(count) — `rowId` is an opaque function — so remember the answer per
// list and re-scan only when the focused id, the row count, or the id→index
// mapping (rows reordered under the focus) changes.
const focusedRows = sweptCache<{ id: string; index: number; count: number }>();

function focusedRowIndex(
  key: string,
  focused: string,
  rowId: (index: number) => string,
  count: number,
): number {
  const c = focusedRows.get(key);
  if (
    c &&
    c.id === focused &&
    c.count === count &&
    (c.index < 0 || (c.index < count && rowId(c.index) === focused))
  ) {
    return c.index;
  }
  let index = -1;
  for (let i = 0; i < count; i++) {
    if (rowId(i) === focused) {
      index = i;
      break;
    }
  }
  focusedRows.set(key, { id: focused, index, count });
  return index;
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
  ensureWired(); // frame-end hooks (edge/claim/handoff clearing) must run
  ensureListHooks();
  const bs = bodyScrollSlot();
  const p = uiPointer();
  const pos = axis === "y" ? p.y : p.x;
  // Real frames elapsed (in 60 Hz steps) — scales the fling advance/decay so
  // momentum feels the same at any refresh rate.
  const step = uiApp()?.Loop.step ?? STEP_MS;
  const frames = (uiApp()?.Loop.frameDelta ?? step) / step;

  // A widget drag (slider knob, scrollbar thumb, drag-and-drop, text
  // selection) owns the pointer: body scroll neither starts nor continues.
  if (pointerGestureOwned()) {
    if (bs.drag?.id === key) bs.drag = null;
    bs.momentum.delete(key);
    return offset;
  }

  // Post-release fling: coast with decay until it dies, hits an extreme, or a
  // press inside the region catches it (the catch is not a click).
  const fling = bs.momentum.get(key);
  if (fling !== undefined && !bs.drag) {
    if (p.pressed && pointInRect(p.x, p.y, rect)) {
      bs.momentum.delete(key);
      suppressPointerEdges();
    } else {
      const next = clamp(offset - fling * frames, 0, max);
      offset = next;
      const decayed = fling * Math.pow(FLING_DECAY, frames);
      if (next <= 0 || next >= max || Math.abs(decayed) < FLING_STOP) bs.momentum.delete(key);
      else bs.momentum.set(key, decayed);
    }
  }

  // On the press frame the INNERMOST region under the pointer wins: parents run
  // first (drawn before their children) and set the claim, then the child
  // overwrites it — so a swipe inside a nested region scrolls THAT region, not
  // the page. `p.pressed` is one-shot, so this can't re-claim mid-drag.
  if (p.pressed && pointInRect(p.x, p.y, rect)) {
    bs.drag = {
      id: key,
      start: pos,
      startOffset: offset,
      active: false,
      vel: 0,
      lastPos: pos,
      handoff: 0,
      from: null,
    };
    bs.momentum.delete(key);
  }
  let drag = bs.drag;
  // Mid-gesture chaining: an inner region pinned at its extreme offered the
  // gesture up (`handoff`). Every enclosing region under the pointer adopts it
  // in draw order — parents first, so the LAST adopter (nearest ancestor of
  // the handing-off region) wins the frame.
  if (
    drag &&
    drag.handoff > 0 &&
    drag.id !== key &&
    drag.from !== key &&
    p.down &&
    pointInRect(p.x, p.y, rect)
  ) {
    drag = {
      id: key,
      start: pos,
      startOffset: offset,
      active: true,
      vel: drag.vel,
      lastPos: pos,
      handoff: drag.handoff,
      from: drag.from,
    };
    bs.drag = drag;
  }
  if (drag?.id === key) {
    if (p.down) {
      const d = pos - drag.start;
      if (!drag.active && Math.abs(d) > DRAG_THRESHOLD) drag.active = true;
      if (drag.active) {
        const target = drag.startOffset - d;
        offset = clamp(target, 0, max);
        // Track finger speed for the release fling (smoothed, px/60Hz-frame).
        const delta = pos - drag.lastPos;
        drag.vel = drag.vel * 0.7 + (delta / Math.max(frames, 0.001)) * 0.3;
        drag.lastPos = pos;
        suppressPointerEdges(); // whatever's under the finger mustn't click mid-drag
        // Pinned at an extreme and still pulling past it: re-anchor (so pulling
        // back responds immediately, no overpull backlash to eat) and offer the
        // rest of the gesture to an enclosing scroll region.
        const overpull = target - offset;
        if (overpull !== 0) {
          drag.start = pos;
          drag.startOffset = offset;
          if (Math.abs(overpull) > HANDOFF_SLOP) {
            drag.handoff = 2; // survives this frame's end; ancestors run next frame
            drag.from = key;
          }
        }
      }
    } else {
      if (drag.active) {
        suppressPointerEdges(); // swallow the release that ends the drag
        bs.endedThisFrame = true;
        // Launch a fling when the finger left with speed.
        if (Math.abs(drag.vel) > FLING_MIN) bs.momentum.set(key, drag.vel);
      }
      bs.drag = null;
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
  const { x, y, w, h } = fillRect(opts, "list");
  const gap = opts.gap ?? 0;
  const step = opts.rowH + gap;
  const content = opts.count * step - (opts.count > 0 ? gap : 0);
  const needsBar = content > h;
  const scrollW = needsBar ? (opts.scrollW ?? 10) : 0;
  const listW = w - (scrollW ? scrollW + 4 : 0);
  const max = Math.max(0, content - h);
  let offset = clamp(opts.offset, 0, max);
  const key = opts.id ?? `list:${x}:${y}`;

  // Swipe to scroll: drag anywhere in the content area (the scrollbar gutter is
  // excluded — that's the thumb's job) to pan the list. (Wheel is handled after
  // the rows below, so a nested region inside a row claims it first.)
  offset = dragScroll(key, { x, y, w: listW, h }, "y", offset, max);

  // The pointer at the LIST'S ENTRY: a list that is background to an open
  // overlay sees a dead pointer here, and the wheel claim below (after the
  // rows) must use THIS state — a row child calling `enterOverlay` enlivens
  // later reads for the rest of the frame, which would let a dead background
  // list steal the wheel from the overlay's own scroll region.
  const wp = uiPointer();

  // Keyboard navigation: scroll so the focused row is in view, then register
  // the visible window (plus a one-row buffer on each side) as focusables.
  // Runs before the draw so a just-focused off-screen row scrolls in this same
  // frame; the buffer row lets Tab step past the window's edge, and next
  // frame's auto-scroll (and registration) follows it.
  if (opts.rowId) {
    const ctx = uiCtx();
    const focused = focusedId();
    const focusedIndex = focused ? focusedRowIndex(key, focused, opts.rowId, opts.count) : -1;
    if (focusedIndex >= 0) {
      const top = focusedIndex * step;
      if (top < offset) offset = top;
      else if (top + opts.rowH > offset + h) offset = top + opts.rowH - h;
      offset = clamp(offset, 0, max);
    }
    const regFirst = Math.max(0, Math.floor(offset / step) - 1);
    const regLast = Math.min(opts.count, Math.ceil((offset + h) / step) + 1);
    for (let i = regFirst; i < regLast; i++) {
      registerFocusable(ctx, { id: opts.rowId(i) });
    }
  }

  clip({ x, y, w: listW, h }, () => {
    const first = Math.max(0, Math.floor(offset / step));
    const last = Math.min(opts.count, Math.ceil((offset + h) / step));
    for (let i = first; i < last; i++) {
      row(i, { x, y: y + i * step - offset, w: listW, h: opts.rowH });
    }
  });

  // Wheel AFTER the rows: a nested scroll region inside a row runs first and
  // claims the wheel, so it scrolls the INNER region until its edge, then chains
  // outward (inner-first). One-frame render lag on the wheel is invisible.
  // Uses the ENTRY pointer `wp` (see above), not a fresh read.
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
  const rect = fillRect(opts, "grid");
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
const scrollDragSlot = runtimeSlot<{ drag: { id: string; grab: number } | null }>(() => ({
  drag: null,
}));

/** Compute the next offset for a scrollbar — thumb drag, track paging and
 *  wheel — and draw it. Returns the new offset (clamped to the content):
 *
 *    scroll = UI.scrollbar({ x, y, h, view, content, offset: scroll, wheelArea }); */
export function scrollbar(opts: ScrollbarOptions): number {
  const ctx = uiCtx();
  ensureWired();
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
  const sd = scrollDragSlot();
  hoverCursor(overTrack || sd.drag?.id === id);

  // Release the drag on the REAL pointer-up, not the clip-gated one: a scrollbar
  // that sits inside another scroll region's clip sees a DEAD pointer when the
  // pointer is over the OUTER region's gutter (its own thumb), and must not
  // cancel that outer drag. `rawPointer` ignores clip/overlay gating.
  if (!rawPointer().down) sd.drag = null;
  if (p.pressed && overThumb && !sd.drag) {
    sd.drag = { id, grab: pAlong - along };
    cancelBodyDrag(); // grabbing the thumb must not also swipe a surrounding region
  }
  // While the thumb is held, the scrollbar owns the pointer — no body drag may
  // engage anywhere (the thumb often travels outside its own track rect).
  if (sd.drag?.id === id) claimPointerGesture();
  if (p.released && overTrack && !overThumb && sd.drag?.id !== id) {
    // Track click: page toward the click.
    offset += pAlong < along ? -opts.view : opts.view;
  }
  if (sd.drag?.id === id && range > 0) {
    // Track the live drag through `dragPointer` (mapped, never clip-gated) —
    // the thumb keeps following a finger that leaves the clip region mid-drag
    // instead of slamming to an end when `uiPointer` goes dead.
    const dp = dragPointer();
    offset = (((horiz ? dp.x : dp.y) - sd.drag.grab - alongStart) / range) * max;
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
    ctx.fillStyle = sd.drag?.id === id || overThumb ? theme.accent : (opts.thumb ?? theme.border);
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
export function listItem(opts: ListItemOptions): boolean {
  const ctx = uiCtx();
  const id = widgetId(opts.id, "list-item");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    rect: opts,
  });
  const state = opts.disabled ? { hover: false, clicked: false } : buttonState(opts, uiPointer());
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
  const { hover } = state;
  hoverCursor(hover);
  if (hover && opts.tooltip) tooltip(opts.tooltip);
  ctx.save();
  // Decide the fill as a VALUE. Reading it back off the context can't work:
  // canvas normalizes fillStyle, so an assigned "transparent" reads as
  // "rgba(0, 0, 0, 0)" and a `!== "transparent"` guard never matches — every
  // row then paid a no-op fillRect.
  const bg = opts.selected
    ? (opts.bgSelected ?? "rgba(78,205,196,0.18)")
    : hover
      ? (opts.bgHover ?? "rgba(255,255,255,0.05)")
      : opts.bg;
  if (bg && bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  }
  if (opts.selected) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(opts.x, opts.y, 3, opts.h);
  }
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, opts);
  return clicked;
}
