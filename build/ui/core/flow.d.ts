import type { IdPart } from "./identity.js";
import { type TextAnchor } from "./text.js";
export interface UiPadding {
    x?: number;
    y?: number;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
type Padding = number | UiPadding;
/** Options for `flow()` — a one-axis layout cursor. */
export interface FlowOptions {
    /** Starting corner. With `align: "end"` this is the FAR edge (right edge
     *  for rows, bottom for columns) and slots grow backwards from it. */
    x: number;
    /** Starting corner (see `x`). */
    y: number;
    /** Main axis. Default `"row"`. */
    dir?: "row" | "col";
    /** Gap between slots in px. Default 8. */
    gap?: number;
    /** Default cross-axis size for `next()`: slot height for rows. Default 30. */
    h?: number;
    /** Default cross-axis size for columns: slot width. Default 120. */
    w?: number;
    /** `"end"` lays slots out backwards — right-aligned toolbars, bottom-up
     *  columns. Default `"start"`. */
    align?: "start" | "end";
    /** Total main-axis length of the container (width for a row, height for a
     *  column). Enables `fill`/`remaining`. The closure containers set it. */
    length?: number;
    /** Shrink-wrap the CROSS axis: children take their natural size across the
     *  flow (a col's width, a row's height) instead of filling it. Set by an
     *  auto-sized container so it can measure its content. Default false. */
    fitCross?: boolean;
    /** After the first natural measurement, stretch children across the
     *  container's measured cross size. Useful for an auto-width column whose
     *  panels should all match its widest panel. */
    stretchCross?: boolean;
    /** Where a slot SMALLER than the cross axis sits across it — flexbox's
     *  `align-items`. Only bites on a slot with its own cross size (an 8px
     *  swatch in a row of text); a slot that fills the cross axis has no slack
     *  to be moved in. Ignored while wrapping, where the line's own cross size
     *  isn't known until the line is finished. Default `"start"`. */
    alignCross?: "start" | "center" | "end";
    /** Flex-wrap: when a slot would overflow `length` on the main axis, start a
     *  new line (rows wrap downward, cols wrap sideways) offset by the tallest/
     *  widest slot of the line just finished. Needs `length`. Default false. */
    wrap?: boolean;
    /** Internal layout-space scale. Closure containers set this to the active
     *  UI transform so a scaled boundary is not applied twice. */
    layoutScale?: number;
}
/** A slot handed out before its size is known — the mechanism that lets an
 *  auto-sized container measure itself IN the frame it is drawn rather than
 *  reading last frame's measurement.
 *
 *  `rect` starts at the cursor with a provisional main-axis size and is MUTATED
 *  IN PLACE by `commit`, so anything already holding it (the layout capture,
 *  the child's own body flow) sees the corrected size. The parent's cursor does
 *  not move until `commit`, so the next sibling lands in the right place first
 *  time. Committing twice is a no-op. */
export interface DeferredSlot {
    /** The slot, at its final position and provisional size. Mutated by `commit`. */
    readonly rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** Write the measured main-axis size in and advance the parent's cursor past
     *  it. Pass the width for a row, the height for a column. */
    commit(w?: number, h?: number): void;
}
/** A layout cursor from `flow()`: hands out rects along one axis. */
export interface Flow {
    /** Main axis. */
    readonly dir: "row" | "col";
    /** Space offered across the flow: width for a column, height for a row.
     *  Wrapped widgets use this to measure their natural cross-axis size. */
    readonly crossSize: number | undefined;
    /** True when the container shrink-wraps its cross axis — widgets should
     *  place at their natural cross size rather than filling. `place` reads it. */
    readonly fitCross: boolean;
    /** True after an auto container has measured its cross axis and now stretches
     *  children across that measured size. */
    readonly stretchCross: boolean;
    /** True when the container flex-wraps its children onto new lines. Nested
     *  containers read it (via `containerRect`) to reserve a NATURAL cross size
     *  so line breaks measure correctly. */
    readonly wrap: boolean;
    /** Scale already accounted for by this cursor's dimensions. */
    readonly layoutScale: number;
    /** Reserve the next slot and advance. For rows pass the width (height
     *  defaults from the flow); for columns pass the height as the second
     *  argument (width defaults from the flow). */
    next(w?: number, h?: number): {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** Reserve the next slot WITHOUT advancing, for a child whose main-axis size
     *  is only known once its own children have run — see `DeferredSlot`. Returns
     *  null when this flow can't hold its cursor (it wraps, or it lays out
     *  backwards from a far edge), in which case the caller must size the slot up
     *  front from its cache. */
    reserve(w?: number, h?: number): DeferredSlot | null;
    /** Reserve a slot that fills the remaining main-axis space, minus `reserve`
     *  (leave room for later fixed slots — e.g. a footer's height + gap). Needs
     *  `length` set on the flow; the closure containers set it for you. `cross`
     *  optionally supplies the other axis.
     *
     *  Several fills in one auto container share the leftover space equally.
     *  The split uses last frame's fill-call count for that container (1 when
     *  missing, so a lone fill still takes everything). When the number of fill
     *  children changes, the new split is one frame behind — the same class of
     *  lag as the other first-frame caches. */
    fill(reserve?: number, cross?: number): {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** Extra spacing before the next slot. */
    gap(px: number): void;
    /** Include an independently positioned drawing in this container's measured
     *  extent without moving the flow cursor. Useful for low-level `UI.flow`
     *  toolbars drawn inside an auto-sized panel. */
    include(rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    }): void;
    /** Main-axis space left before the container's end (needs `length`). */
    readonly remaining: number;
    /** The most recently handed-out slot — anchor popovers/spinners to it. */
    readonly last: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
    /** Bounding box of everything placed so far. */
    readonly extent: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    /** The container's NATURAL cross size: the largest cross size any child
     *  asked for, measured before `alignCross` moved it.
     *
     *  This is deliberately not read off `extent`. Centring a short child pushes
     *  it away from the cross origin, so an extent-derived cross size grows by
     *  the very offset it is used to compute — the container creeps a fraction
     *  taller every frame and never settles. Sizing from what the children
     *  ASKED for breaks that loop: alignment moves things inside the box without
     *  changing how big the box is.
     *
     *  A WRAPPING flow is the exception, and has to be: the tallest child in a
     *  three-line run says nothing about how tall the run is. `alignCross` is
     *  disabled while wrapping, so there is no offset to feed back and the
     *  extent can be read directly. */
    readonly crossExtent: number;
    /** Where the cross axis starts — the flow's `y` for a row, `x` for a col. */
    readonly crossStart: number;
}
/** Not flexbox — a cursor. Lay widgets along a row or column with a gap,
 *  letting them auto-size to their labels (`at` option on button/toggle/
 *  tabs), and read back `extent` to size backdrops:
 *
 *    const bar = UI.flow({ x: 12, y: 12, gap: 10 });          // a row
 *    if (UI.button({ at: bar, label: "SAVE" })) save();        // auto width
 *    on = UI.toggle({ at: bar, label: "Autosave", on });
 *
 *    const right = UI.flow({ x: vp.w - 12, y: 12, align: "end" }); // ← grows left */
export declare function flow(opts: FlowOptions): Flow;
export declare const layoutStack: Flow[];
/** The innermost active layout cursor, or null outside any container. */
export declare function currentLayout(): Flow | null;
/** Geometry for a widget that AUTO-FLOWS. It either takes an explicit rect
 *  (`x`/`y`, `w`/`h`) OR — with `x`/`y` omitted — places itself into the current
 *  `row`/`col`/`panel` (or an explicit `at` flow). Widgets with an intrinsic
 *  size (button, bar, spinner) reserve a fixed main-axis slot and fill the cross
 *  axis via `place`; region widgets that consume the REMAINING space (table,
 *  list) extend `Fillable` instead. */
export interface Flowable {
    /** Left edge in px. Omit (with `y`) to flow into the current layout. */
    x?: number;
    /** Top edge in px (see `x`). */
    y?: number;
    /** Width in px. While flowing it pins the size the slot would otherwise give
     *  (a row's slot width, a col's fill width). */
    w?: number;
    /** Height in px (see `w`). */
    h?: number;
    /** Fill the available parent space: remaining width in a row, or the
     *  parent's width when flowing in a column. Explicit `w`/`h` still win. */
    flex?: "fill";
    /** Flow into THIS cursor instead of the ambient layout. */
    at?: Flow;
}
/** A `Flowable` region that fills the REMAINING main-axis space of its layout
 *  — a scrollable table/list — rather than reserving a fixed slot. `w`/`h` are
 *  ignored while flowing (the container sets them). */
export interface Fillable extends Flowable {
    /** While flowing, px to leave for siblings drawn AFTER this widget (e.g. a
     *  footer row): the widget fills the remaining main axis minus this. Default
     *  0 (fill all remaining). */
    reserve?: number;
    /** Minimum natural width reported to an auto-sized parent. The widget still
     *  fills the parent's current slot; this only prevents the parent from
     *  shrink-wrapping narrower than the widget's content needs. */
    minW?: number;
}
/** The rect of the most recently placed widget — what `popover`/`floatText`
 *  anchor to when called without `x`/`y`. Null before any widget has drawn. */
export declare function lastWidgetRect(): {
    x: number;
    y: number;
    w: number;
    h: number;
} | null;
/** The committed rect of the container that most recently CLOSED. Read it
 *  immediately after an `autoContainer` call (`panel`, `col`, `row`, …) to get
 *  the box it actually occupied, auto-sizing included — which is not knowable
 *  before its children have run. Null before any container has drawn.
 *
 *  Nesting resolves the way you want: an inner container closes first, so the
 *  outer one overwrites it and the value after the outermost call is the
 *  outermost box. */
export declare function lastContainerRect(): {
    x: number;
    y: number;
    w: number;
    h: number;
} | null;
/** @internal Called by `autoContainer` as it closes. */
export declare function noteContainerRect(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}): void;
/** Resolve a `Fillable`'s rect: an explicit `x`/`y` wins; otherwise fill the
 *  ambient (or `at`) layout, leaving `reserve` px for later siblings. `kind`
 *  labels the rect in a layout capture (see `layoutCapture`). */
export declare function fillRect(opts: Fillable, kind?: string): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Resolve a widget's rect: an explicit `at` flow, else the ambient layout
 *  (unless the caller pinned x/y), else absolute coordinates. `autoW` is the
 *  widget's natural main-axis size (e.g. a button's label width); `kind`
 *  labels the rect in a layout capture (see `layoutCapture`). Set `intrinsicH`
 *  for a widget whose height is dictated by its art rather than by the row
 *  rhythm (`select`, `tabs`) — see the column branch below. */
export declare function place(opts: Flowable, autoW: number, defaultH: number, kind?: string, intrinsicH?: boolean): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Place a field-like widget. In a column, omitted field widths fill the
 *  column by default; rows and pinned widgets retain their natural size.
 *  Explicit `w` and `flex` always win. */
export declare function placeField(opts: Flowable, autoW: number, defaultH: number, kind?: string, intrinsicH?: boolean): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Options shared by the closure containers. */
export interface LayoutOptions {
    /** Theme overrides for this container and every widget drawn by its
     *  children. Nested containers may override the scope again. */
    theme?: import("../../ui/theme.js").ThemeOverrides;
    /** Explicit rect — a ROOT container (no parent layout) needs `x`/`y`/`w`;
     *  `h` is optional and auto-measured from the children when omitted. */
    x?: number;
    /** Explicit top (see `x`). */
    y?: number;
    /** Explicit width. When nested, the slot reserved from the parent. */
    w?: number;
    /** Explicit height. OMIT to auto-size to the children's measured height
     *  (see the module note on auto-height). Give it to pin a fixed height. */
    h?: number;
    /** Minimum height in px; auto-sized containers grow to at least this value. */
    minH?: number;
    /** Minimum width in px; auto-sized containers grow to at least this value. */
    minW?: number;
    /** Maximum height in px; an auto-sized container stops growing here.
     *
     *  On an `overflow: "auto"` container this is the "shrink-wrap, then scroll"
     *  bound, and it is the reason `maxH` exists: `h` pins a scroll region to one
     *  height whether the content needs it or not, so a dialog that fits gets a
     *  box of empty space and a scrollbar it never uses. With `maxH` the region
     *  is as tall as its content until the content passes the cap, and only then
     *  does it clip and scroll. */
    maxH?: number;
    /** Maximum width in px (see `maxH`). */
    maxW?: number;
    /** Stable id for the auto-height cache. Optional: falls back to the
     *  `idScope` call-order, then to a position-derived key for pinned
     *  containers. Set it when several unpinned containers would otherwise
     *  collide (dynamic/conditional lists). */
    id?: IdPart;
    /** Gap between children in px. Default 8. */
    gap?: number;
    /** Inner padding in px. `row`/`col` default to 0 (flush structural flow);
     *  `group` defaults to `theme.panel.padding`. Pass `{ x, y }` for axis shorthands, or
     *  `{ top, right, bottom, left }` for independent edges. */
    pad?: number | UiPadding;
    /** Where the content block sits on the main axis when the container is wider
     *  (a row) / taller (a col) than its children — POSITION, not order (this is
     *  flexbox's `justify-content`). `"center"` shares the slack on both sides;
     *  `"end"` pins it to the far edge. Default `"start"`. Orthogonal to
     *  `reverse`. (Not to be confused with `anchor` on `panel`/`text`, which is
     *  VIEWPORT placement.) */
    justify?: "start" | "center" | "end";
    /** Where children sit ACROSS the flow — a row's vertical placement, a
     *  column's horizontal one. This is flexbox's `align-items`, and `justify`
     *  above is its `justify-content`.
     *
     *  It only moves a child that has a cross size of its own, because only that
     *  child has slack: an 8px colour swatch beside a line of text centres,
     *  while the text — which fills the cross axis — has nowhere to go. Auto
     *  containers already shrink-wrap omitted cross axes; use `fitCross: false`
     *  when you explicitly want stretch behavior:
     *
     *    UI.row({ gap: 8, fitCross: true, alignCross: "center" }, () => {
     *      UI.bar({ value: 1, w: 8, h: 8, fill: color, bg: color });
     *      UI.text(label, { size: 11 });
     *    });
     *
     *  Default `"start"`. Ignored while `wrap`ping. */
    alignCross?: "start" | "center" | "end";
    /** Shrink-wrap the CROSS axis: children take their NATURAL cross size (a
     *  text's line height, a button's own height) instead of stretching to fill
     *  the container, and the container then hugs the tallest of them. CSS's
     *  `align-items: flex-start` on a `height: fit-content` box.
     *
     *  Defaults to true when the cross axis is omitted, so a row/column hugs its
     *  children. Set it to false to get flexbox-style stretching. `flex: "fill"`
     *  is an explicit fill request and therefore remains stretching. */
    fitCross?: boolean;
    /** After measuring an omitted cross axis, stretch every child across that
     *  measured size. This is useful for an auto-width column whose panels should
     *  all match its widest panel. */
    stretchCross?: boolean;
    /** Lay children in reverse ORDER (last-drawn first) — position is unchanged
     *  (see `justify`). Default false. `justify:"end"` + `reverse:true` together
     *  give the old right-to-left `align:"end"` behavior. NOTE: only the VISUAL
     *  order reverses; keyboard focus/Tab still follows draw (call) order, so with
     *  `reverse` the two diverge (like CSS `flex-direction: row-reverse`). Prefer
     *  `justify:"end"` when Tab order should match what's on screen. */
    reverse?: boolean;
    /** Overflow behavior along the main axis, like CSS. `"visible"` (default)
     *  auto-grows the box to its content. `"auto"`/`"scroll"` cap the box (at `h`,
     *  or at the room down to the viewport bottom) and scroll the content inside
     *  with a scrollbar + wheel; a titled `group` keeps its title fixed and scrolls
     *  only the body. `"hidden"` clips to the box without scrolling. */
    overflow?: "visible" | "hidden" | "auto" | "scroll";
    /** Keep a scrolling region pinned to the END of its content — the bottom of a
     *  column, the right of a row — as that content grows. For a feed that is
     *  appended to (a chat, an event log, a console) this is the difference
     *  between the newest line arriving on screen and it arriving just below the
     *  fold.
     *
     *  Pinned is a state, not a mode: the region follows the tail only while it is
     *  ALREADY at the tail, so scrolling back to read something older stops the
     *  region jumping away under you, and scrolling to the end again resumes the
     *  follow. A region that starts life with more content than it can show starts
     *  pinned. Only meaningful with `overflow: "auto"` or `"scroll"`. */
    stickToEnd?: boolean;
    /** Fill the remaining main-axis space in the parent flow. This is the
     *  container equivalent of Flow.fill(); only meaningful when nested.
     *  Several fill children in one container share the leftover space equally
     *  (the split is taken from last frame's fill-call count). */
    flex?: "fill";
    /** Flex-wrap: children that would overflow the main axis wrap onto a new line
     *  (a row wraps downward, a col sideways), each line offset by the previous
     *  line's tallest/widest child. Needs a bounded main axis (`w` for a row, `h`
     *  for a col) to know where to break. Default false. */
    wrap?: boolean;
    /** Place this (root) container in the VIEWPORT — `"center"` for a dialog,
     *  `"bottomRight"` for a HUD cluster, etc. — instead of pinning `x`/`y`. `w`/`h`
     *  become the PREFERRED size, clamped to the viewport minus `margin`; `x`/`y`
     *  become offsets from the anchor point. (Distinct from `justify`, which is
     *  main-axis child placement.) */
    anchor?: TextAnchor;
    /** Gap kept from the viewport edges when `anchor` is set (px). Default 0. */
    margin?: number;
}
export declare function runContainer<R>(dir: "row" | "col", rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, gap: number, pad: Padding, justify: "start" | "center" | "end", reverse: boolean, children: (layout: Flow) => R, fitCross?: boolean, stretchCross?: boolean, wrap?: boolean, contentMain?: number, alignCross?: "start" | "center" | "end", expectedFills?: number): R;
/** Measured content box of a container. `w`/`h` are the OUTER box needed to hold
 *  the content from the container's top-left (span, incl. a title band + pads —
 *  used for auto-sizing an omitted axis). `ew`/`eh` are the content's own
 *  bounding-box run (position-independent — used by `justify` to align a block
 *  inside a wider box without oscillating as the block moves). */
export interface ContentSize {
    w: number;
    h: number;
    ew: number;
    eh: number;
}
export declare function pushContainerKey(key: string | undefined): void;
export declare function popContainerKey(): void;
/** Cache key for a container's auto-size: explicit `id`, else the idScope
 *  call-order id, else a position key for pinned/anchored containers, else —
 *  for a NESTED container — the enclosing container's key plus this child's
 *  ordinal. Without a key a container has no auto-size cache at all: it can't
 *  measure its content, so it collapses to a fallback height and its children
 *  spill over whatever follows. The ordinal assumes children appear in a stable
 *  order (the same assumption `idScope`'s auto-ids make); if they don't, the
 *  size is one frame stale rather than wrong forever. */
export declare function containerKey(opts: LayoutOptions, kind: string): string | undefined;
/** Last-frame measured size for `key` (undefined on the first frame). */
export declare function cachedContentSize(key: string | undefined): ContentSize | undefined;
/** Store this frame's measured container size for next frame. */
export declare function storeContentSize(key: string | undefined, size: ContentSize): void;
/** Full container size implied by the children placed into `st`, measured from
 *  the container's outer top-left and closed with one `pad` on each far edge. */
export declare function measuredContainerSize(st: Flow, outerLeft: number, outerTop: number, pad: Padding): ContentSize;
/** A requested size held between the caller's floor and ceiling. `min` wins a
 *  contradiction, so `minH` above `maxH` behaves like `minH` alone rather than
 *  collapsing the box. */
export declare function bound(value: number, min?: number, max?: number): number;
export declare function containerRect(dir: "row" | "col", opts: LayoutOptions, auto?: ContentSize): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** A container's children callback — receives the layout cursor for
 *  anchoring (`.last`) or measuring (`.extent`). */
export type LayoutChildren<R> = (layout: Flow) => R;
/** Untangle `(opts?, children)` vs `(children)`. */
export declare function layoutArgs<R>(optsOrChildren: LayoutOptions | LayoutChildren<R>, children?: LayoutChildren<R>): [LayoutOptions, LayoutChildren<R>];
/** Run a container's children over `body`, then cache their measured extent
 *  (taken from the OUTER top-left `outer`, so a title band + both pads are
 *  included) under `key` for next-frame auto-sizing. The shared tail of every
 *  auto-sizing container. */
export declare function runAutoSized<R>(key: string | undefined, outer: {
    x: number;
    y: number;
}, body: {
    x: number;
    y: number;
    w: number;
    h: number;
}, dir: "row" | "col", gap: number, pad: Padding, justify: "start" | "center" | "end", reverse: boolean, fitCross: boolean, children: LayoutChildren<R>, wrap?: boolean, contentMain?: number, reservation?: Reservation | null, alignCross?: "start" | "center" | "end", stretchCross?: boolean, minW?: number): R;
/** Extra knobs an auto-sizing container passes to `autoContainer`. */
export interface AutoContainerConfig {
    /** Inner padding in px; a number applies equally on both axes. */
    pad: Padding;
    /** Gap between children in px. */
    gap: number;
    /** Where the content block sits on the main axis (see `LayoutOptions.justify`). */
    justify: "start" | "center" | "end";
    /** Lay children in reverse order (see `LayoutOptions.reverse`). */
    reverse: boolean;
    /** Shrink-wrap the cross axis (a root container along its free axis, or an
     *  explicit `fitCross` on the caller's options). */
    fitCross: boolean;
    /** Stretch children across the measured cross axis after the first pass. */
    stretchCross?: boolean;
    /** Cross-axis alignment for children with slack (see `LayoutOptions`). */
    alignCross?: "start" | "center" | "end";
    /** Flex-wrap children onto new lines when they overflow the main axis. */
    wrap?: boolean;
    /** Body inset from the rect's top — a title strip. Default 0. */
    top?: number;
    /** Extra height removed from the body — a title's bottom border. Default 0. */
    bottom?: number;
    /** Paint the container's backdrop given its resolved rect, before children
     *  run (e.g. `group`/`popover` draw a `panel`). Layout containers omit it. */
    box?: (rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    }) => void;
}
interface Reservation {
    slot: DeferredSlot;
    /** Which of the container's axes the parent is waiting on. */
    axis: "w" | "h";
    /** When the parent shrink-wraps its cross axis, commit that measured axis too. */
    crossAxis?: "w" | "h";
}
/** The single auto-sizing container: resolve the rect from `opts` (measuring
 *  the children in-frame where possible — see `tryReserve` — and otherwise
 *  auto-sizing any omitted axis from last frame's cached content), paint the
 *  optional backdrop, lay the children out and cache their size for next frame.
 *  `row`, `col`, `group` (and, via `runAutoSized`, `popover`) are thin wrappers
 *  over this — the auto-size machinery lives here, not in each widget. */
export declare function autoContainer<R>(kind: string, dir: "row" | "col", opts: LayoutOptions, cfg: AutoContainerConfig, children: LayoutChildren<R>): R;
export {};
