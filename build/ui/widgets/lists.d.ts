import { Fillable } from "../../ui/core/index.js";
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
    /** Row height in px, or a function returning each row's height. */
    rowH: number | ((index: number) => number);
    /** Total number of rows. */
    count: number;
    /** Current scroll offset (px) — pass state in, assign the return back. */
    offset: number;
    /** Vertical gap between rows. Default 0. */
    gap?: number;
    /** Scrollbar width when one is needed. Defaults to the theme's
     *  `scrollbarW`. */
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
/** Apply this frame's wheel to a scroll region and re-clamp its offset.
 *
 *  Call it AFTER the region's body has drawn: a nested region inside the body
 *  runs first and claims the wheel, so the wheel scrolls the INNERMOST region
 *  under the pointer until its edge and then chains outward. (The offset lands
 *  one frame late as a result — invisible on a wheel.)
 *
 *  `p` must be the pointer read at the region's ENTRY, not a fresh read here.
 *  A region that is background to an open overlay sees a DEAD pointer on entry
 *  and must keep seeing it: a child `select`/popover calling `enterOverlay`
 *  enlivens the pointer for the rest of the frame, and re-reading it after the
 *  body would let the dead background region steal the wheel from the overlay's
 *  own scroll region.
 *
 *  Shared by `list`/`grid`/`table` and the `overflow` containers. */
export declare function wheelScroll(p: {
    x: number;
    y: number;
    wheel: number;
}, area: {
    x: number;
    y: number;
    w: number;
    h: number;
}, offset: number, max: number): number;
/** True while a body drag-scroll is live (or just released this frame) —
 *  overlays (popover, the select menu) check it so a scroll gesture that ends
 *  outside them is never mistaken for a click-outside close. */
export declare function scrollGestureActive(): boolean;
/** Should this frame's pointer release dismiss an open overlay?
 *
 *  Only a release, only outside every rect the overlay owns (its own box, and
 *  for a drop-menu the control that opened it), and never the release that
 *  merely ENDS a gesture: a swipe that started inside the overlay and lifted
 *  outside it, or a widget drag that owns the pointer, is not a click-outside.
 *  Lives here because that gesture state does — the popover and the select menu
 *  had both spelled the same four conditions out inline.
 *
 *  `p` and `rects` must be in the SAME space: the select menu uses the current
 *  space, the popover maps its rect to screen coords to match `rawPointer`. */
export declare function dismissedByOutsideRelease(p: {
    x: number;
    y: number;
    released: boolean;
}, ...rects: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
}[]): boolean;
/** Swipe / body-drag scrolling for any scroll region — the shared engine behind
 *  `list`'s rows and the `overflow` containers. Pass the region's clipped body
 *  `rect`, its scroll `axis` (`"y"` vertical, `"x"` horizontal), the current
 *  `offset` and the max scroll; returns the updated offset. A drag past the
 *  threshold suppresses the click that ends it, so dragging to scroll never
 *  activates the widget the finger lifts over. */
export declare function dragScroll(key: string, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, axis: "x" | "y", offset: number, max: number): number;
/** Draw a windowed vertical list per `ListOptions`, calling `row(index, rect)`
 *  only for the currently visible rows. Row heights may be fixed or supplied
 *  per index. Handles clipping, the scrollbar, mouse wheel and swipe/body-drag
 *  scrolling; returns the new (clamped) scroll `offset` to store back. */
export declare function list(opts: ListOptions, row: (index: number, rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}) => void): number;
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
    /** Scrollbar width when the rows overflow. Defaults to the theme's
     *  `scrollbarW`. */
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
export declare function grid(opts: GridOptions, cell: (rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, index: number, col: number, rowIndex: number) => void): number;
/** A scrollbar bound to a content/view extent, vertical or horizontal. */
export interface ScrollbarOptions {
    /** Track left x in logical px. */
    x: number;
    /** Track top y in logical px. */
    y: number;
    /** Track height in logical px — the bar's LENGTH when vertical (`axis: "y"`),
     *  its THICKNESS when horizontal. */
    h: number;
    /** Track width — the bar's THICKNESS when vertical (defaults to the
     *  theme's `scrollbarW`), its LENGTH when horizontal (`axis: "x"`, required
     *  then). */
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
    wheelArea?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
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
/** Ease a scroll region's bar toward full while the pointer is inside it and
 *  back to a faint resting level when it leaves, so there is always a hint that
 *  the area scrolls without a bright bar sitting over static content. Returns 0
 *  when nothing overflows. Shared by `list`/`grid`/`table` and the `overflow`
 *  containers so every scroll region in a screen fades alike. */
export declare function scrollbarFade(id: string, hovered: boolean, overflows: boolean): number;
/** Compute the next offset for a scrollbar — thumb drag, track paging and
 *  wheel — and draw it. Returns the new offset (clamped to the content):
 *
 *    scroll = UI.scrollbar({ x, y, h, view, content, offset: scroll, wheelArea }); */
export declare function scrollbar(opts: ScrollbarOptions): number;
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
export declare function listItem(opts: ListItemOptions): boolean;
