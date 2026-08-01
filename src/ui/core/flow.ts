// ---------- Flow — one-axis layout cursor + the container primitives ----------
// `flow` is the low-level manual cursor: it hands out rects along a row/col that
// widgets drop into via the `at` option. `row`/`col`/`group` (in ../widgets) are
// the ergonomic closures built on it (via runContainer/autoContainer below).

import { sweptCache } from "./frame-cache.js";
import { widgetId } from "./identity.js";
import type { IdPart } from "./identity.js";
import {
  layoutCaptureActive,
  noteContainerSize,
  popLayoutParent,
  pushLayoutParent,
  recordLayout,
  refreshLayoutRect,
} from "./layout-capture.js";
import { ANCHOR_H, ANCHOR_V, anchorViewport, type TextAnchor } from "./text.js";
import { uiSlot } from "./state.js";
import { theme, themeKey } from "@src/ui/theme.js";

export interface UiPadding {
  x: number;
  y: number;
}

type Padding = number | UiPadding;

function paddingXY(pad: Padding): UiPadding {
  return typeof pad === "number" ? { x: pad, y: pad } : pad;
}

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
  /** Flex-wrap: when a slot would overflow `length` on the main axis, start a
   *  new line (rows wrap downward, cols wrap sideways) offset by the tallest/
   *  widest slot of the line just finished. Needs `length`. Default false. */
  wrap?: boolean;
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
  readonly rect: { x: number; y: number; w: number; h: number };
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
  /** True when the container flex-wraps its children onto new lines. Nested
   *  containers read it (via `containerRect`) to reserve a NATURAL cross size
   *  so line breaks measure correctly. */
  readonly wrap: boolean;
  /** Reserve the next slot and advance. For rows pass the width (height
   *  defaults from the flow); for columns pass the height as the second
   *  argument (width defaults from the flow). */
  next(w?: number, h?: number): { x: number; y: number; w: number; h: number };
  /** Reserve the next slot WITHOUT advancing, for a child whose main-axis size
   *  is only known once its own children have run — see `DeferredSlot`. Returns
   *  null when this flow can't hold its cursor (it wraps, or it lays out
   *  backwards from a far edge), in which case the caller must size the slot up
   *  front from its cache. */
  reserve(w?: number, h?: number): DeferredSlot | null;
  /** Reserve a slot that fills the remaining main-axis space, minus `reserve`
   *  (leave room for later fixed slots — e.g. a footer's height + gap). Needs
   *  `length` set on the flow; the closure containers set it for you. */
  fill(reserve?: number): { x: number; y: number; w: number; h: number };
  /** Extra spacing before the next slot. */
  gap(px: number): void;
  /** Main-axis space left before the container's end (needs `length`). */
  readonly remaining: number;
  /** The most recently handed-out slot — anchor popovers/spinners to it. */
  readonly last: { x: number; y: number; w: number; h: number } | null;
  /** Bounding box of everything placed so far. */
  readonly extent: { x: number; y: number; w: number; h: number };
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
export function flow(opts: FlowOptions): Flow {
  const dir = opts.dir ?? "row";
  const gapPx = opts.gap ?? theme.spacing.md;
  const back = opts.align === "end";
  let cx = opts.x;
  let cy = opts.y;
  let last: { x: number; y: number; w: number; h: number } | null = null;
  let ext: { x: number; y: number; w: number; h: number } | null = null;
  // Flex-wrap only makes sense start-aligned with a known main-axis length.
  const wrapping = (opts.wrap ?? false) && !back && opts.length !== undefined;
  let lineCross = 0; // tallest (row) / widest (col) slot in the current line

  // Placing a slot is two steps, kept apart so a container whose size is only
  // known after its children have run can take step 1 now and step 2 later
  // (`reserve`). `slotRect` picks the position; `settle` moves the cursor past
  // the slot and folds it into `last`/`extent`. `next` is both, back to back.
  const slotRect = (w?: number, h?: number) => {
    const W = w ?? (dir === "col" ? (opts.w ?? 120) : 100);
    const H = h ?? opts.h ?? theme.buttonH;
    if (wrapping) {
      const mainStart = dir === "row" ? opts.x : opts.y;
      const mainCur = dir === "row" ? cx : cy;
      const mainSize = dir === "row" ? W : H;
      // A slot that would spill past the length starts a new line (unless it's
      // the first on this line — an oversize lone slot just overflows).
      if (mainCur - mainStart > 0.5 && mainCur - mainStart + mainSize > (opts.length ?? 0) + 0.5) {
        if (dir === "row") {
          cx = opts.x;
          cy += lineCross + gapPx;
        } else {
          cy = opts.y;
          cx += lineCross + gapPx;
        }
        lineCross = 0;
      }
      lineCross = Math.max(lineCross, dir === "row" ? H : W);
    }
    return dir === "row"
      ? { x: back ? cx - W : cx, y: cy, w: W, h: H }
      : { x: cx, y: back ? cy - H : cy, w: W, h: H };
  };

  // Reads the rect's CURRENT size, so a deferred slot settles against its
  // committed size rather than the provisional one it was handed out with.
  const settle = (rect: { x: number; y: number; w: number; h: number }) => {
    if (dir === "row") cx += (back ? -1 : 1) * (rect.w + gapPx);
    else cy += (back ? -1 : 1) * (rect.h + gapPx);
    last = rect;
    if (!ext) ext = { ...rect };
    else {
      const x2 = Math.max(ext.x + ext.w, rect.x + rect.w);
      const y2 = Math.max(ext.y + ext.h, rect.y + rect.h);
      ext.x = Math.min(ext.x, rect.x);
      ext.y = Math.min(ext.y, rect.y);
      ext.w = x2 - ext.x;
      ext.h = y2 - ext.y;
    }
  };

  const advance = (w?: number, h?: number) => {
    const rect = slotRect(w, h);
    settle(rect);
    return rect;
  };

  // Main-axis space between the cursor and the container's far edge
  // (start-aligned; fill/remaining aren't used with align:"end").
  const remaining = () => {
    if (opts.length === undefined) return 0;
    const start = dir === "row" ? opts.x : opts.y;
    const cur = dir === "row" ? cx : cy;
    return Math.max(0, start + opts.length - cur);
  };

  return {
    dir,
    crossSize: dir === "col" ? opts.w : opts.h,
    fitCross: opts.fitCross ?? false,
    wrap: wrapping,
    next: advance,
    reserve(w, h) {
      // Wrapping needs the main size to decide the line break, and an
      // end-aligned flow grows backwards from a far edge, so the slot's own
      // POSITION depends on its size. Neither can hold a cursor open.
      if (wrapping || back) return null;
      const rect = slotRect(w, h);
      let committed = false;
      return {
        rect,
        commit(cw, ch) {
          if (committed) return;
          committed = true;
          if (cw !== undefined) rect.w = cw;
          if (ch !== undefined) rect.h = ch;
          settle(rect);
        },
      };
    },
    fill(reserve = 0) {
      const avail = Math.max(0, remaining() - reserve);
      return dir === "row" ? advance(avail) : advance(undefined, avail);
    },
    gap(px) {
      if (dir === "row") cx += (back ? -1 : 1) * px;
      else cy += (back ? -1 : 1) * px;
    },
    get remaining() {
      return remaining();
    },
    get last() {
      return last;
    },
    get extent() {
      return ext ?? { x: opts.x, y: opts.y, w: 0, h: 0 };
    },
  };
}

// ---------- Layout containers (closure children) ----------

// The ambient layout flow. A container pushes a `flow` cursor over its
// interior for the duration of its children callback; widgets with no
// explicit x/y and no `at` place themselves into the innermost one. This is
// the egui-style "children as a closure" layer over the explicit `flex`/
// `flow` tools — the nesting is the layout tree, and widgets still return
// their click inline (the callback's return value bubbles out unchanged).
export const layoutStack: Flow[] = [];

/** The innermost active layout cursor, or null outside any container. */
export function currentLayout(): Flow | null {
  return layoutStack.length > 0 ? layoutStack[layoutStack.length - 1] : null;
}

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
}

// ---------- Last placed widget (anchor rect) ----------
// Every widget's resolved rect passes through `place`/`fillRect`, so the kernel
// can remember where the MOST RECENT widget landed — flowing or pinned alike.
// Anchored floaters (popover, floatText) attach to it when the caller gives no
// x/y, so `UI.button(...)` followed by `UI.popover({...})` just works inside an
// auto-flowing layout. Per app; the rect is in the CURRENT UI space (the
// same space the widget drew in).
const lastRectSlot = uiSlot<{ rect: { x: number; y: number; w: number; h: number } | null }>(
  () => ({ rect: null }),
);

/** The rect of the most recently placed widget — what `popover`/`floatText`
 *  anchor to when called without `x`/`y`. Null before any widget has drawn. */
export function lastWidgetRect(): { x: number; y: number; w: number; h: number } | null {
  return lastRectSlot().rect;
}

/** Resolve a `Fillable`'s rect: an explicit `x`/`y` wins; otherwise fill the
 *  ambient (or `at`) layout, leaving `reserve` px for later siblings. `kind`
 *  labels the rect in a layout capture (see `layoutCapture`). */
export function fillRect(
  opts: Fillable,
  kind = "fill",
): { x: number; y: number; w: number; h: number } {
  const layout = opts.at ?? (opts.x === undefined ? currentLayout() : null);
  const rect = layout
    ? layout.fill(opts.reserve ?? 0)
    : { x: opts.x ?? 0, y: opts.y ?? 0, w: opts.w ?? 0, h: opts.h ?? 0 };
  lastRectSlot().rect = rect;
  if (layoutCaptureActive) {
    recordLayout(kind, (opts as { id?: string }).id, rect, { pinned: !layout });
  }
  return rect;
}

/** Resolve a widget's rect: an explicit `at` flow, else the ambient layout
 *  (unless the caller pinned x/y), else absolute coordinates. `autoW` is the
 *  widget's natural main-axis size (e.g. a button's label width); `kind`
 *  labels the rect in a layout capture (see `layoutCapture`). Set `intrinsicH`
 *  for a widget whose height is dictated by its art rather than by the row
 *  rhythm (`select`, `tabs`) — see the column branch below. */
export function place(
  opts: Flowable,
  autoW: number,
  defaultH: number,
  kind = "widget",
  intrinsicH = false,
): { x: number; y: number; w: number; h: number } {
  const pinned = opts.x !== undefined || opts.y !== undefined;
  const st = pinned ? undefined : (opts.at ?? currentLayout());
  let rect: { x: number; y: number; w: number; h: number };
  if (st) {
    // Main axis: rows pass the widget's natural width, cols its natural height.
    // Cross axis: fill the container (pass undefined) UNLESS it shrink-wraps
    // (`fitCross`), where the widget's natural cross size is used instead.
    if (st.dir === "row") {
      rect = st.next(opts.w ?? autoW, opts.h ?? (st.fitCross ? defaultH : undefined));
    } else {
      // In a COLUMN, height is the main axis and an undated slot falls back to
      // the flow's generic row height (`theme.buttonH`). `intrinsicH` widgets
      // opt out of that: their art has a height of its own, and squeezing it
      // into a button-sized slot squashes the frame. Rows are unaffected —
      // there height is the CROSS axis and filling the row is still right.
      rect = st.next(
        opts.w ?? (st.fitCross ? autoW : undefined),
        opts.h ?? (intrinsicH ? defaultH : undefined),
      );
    }
  } else {
    rect = { x: opts.x ?? 0, y: opts.y ?? 0, w: opts.w ?? autoW, h: opts.h ?? defaultH };
  }
  lastRectSlot().rect = rect;
  if (layoutCaptureActive) recordLayout(kind, (opts as { id?: string }).id, rect, { pinned });
  return rect;
}

/** Options shared by the closure containers. */
export interface LayoutOptions {
  /** Theme overrides for this container and every widget drawn by its
   *  children. Nested containers may override the scope again. */
  theme?: import("@src/ui/theme.js").ThemeOverrides;
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
  /** Stable id for the auto-height cache. Optional: falls back to the
   *  `idScope` call-order, then to a position-derived key for pinned
   *  containers. Set it when several unpinned containers would otherwise
   *  collide (dynamic/conditional lists). */
  id?: IdPart;
  /** Gap between children in px. Default 8. */
  gap?: number;
  /** Inner padding in px. `row`/`col` default to 0 (flush structural flow);
   *  `group` defaults to `theme.pad`. */
  pad?: number;
  /** Where the content block sits on the main axis when the container is wider
   *  (a row) / taller (a col) than its children — POSITION, not order (this is
   *  flexbox's `justify-content`). `"end"` pins it to the far edge (a
   *  right-aligned toolbar), children keeping their natural order. Default
   *  `"start"`. Orthogonal to `reverse`. (Not to be confused with `anchor` on
   *  `panel`/`text`, which is VIEWPORT placement.) */
  justify?: "start" | "end";
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

// Run `children` with a fresh layout cursor over `rect`'s interior. The
// cursor is also handed to the callback (egui style) so children can anchor
// popovers/spinners to `.last` or read `.extent`.
export function runContainer<R>(
  dir: "row" | "col",
  rect: { x: number; y: number; w: number; h: number },
  gap: number,
  pad: Padding,
  justify: "start" | "end",
  reverse: boolean,
  children: (layout: Flow) => R,
  fitCross = false,
  wrap = false,
  contentMain?: number,
): R {
  const { x: padX, y: padY } = paddingXY(pad);
  const inner = {
    x: rect.x + padX,
    y: rect.y + padY,
    w: rect.w - padX * 2,
    h: rect.h - padY * 2,
  };
  const innerNear = dir === "row" ? inner.x : inner.y;
  const innerMain = dir === "row" ? inner.w : inner.h;
  // JUSTIFY positions the content block on the main axis: "end" pushes it to the
  // far edge by the slack (extra room beyond the children's measured length,
  // from last frame's cache — 0 on the first frame, corrected next). REVERSE
  // decides growth direction: forward from the block's near edge, or backward
  // from its far edge (so the first child lands at the far end).
  const slack =
    justify === "end" && contentMain !== undefined ? Math.max(0, innerMain - contentMain) : 0;
  const blockNear = innerNear + slack;
  const blockFar = contentMain !== undefined ? blockNear + contentMain : innerNear + innerMain;
  const mainStart = reverse ? blockFar : blockNear;
  const flowAlign = reverse ? "end" : "start";
  const st = flow({
    x: dir === "row" ? mainStart : inner.x,
    y: dir === "col" ? mainStart : inner.y,
    dir,
    gap,
    align: flowAlign,
    // Cross-axis size the children fill: row → height, col → width.
    h: dir === "row" ? inner.h : undefined,
    w: dir === "col" ? inner.w : undefined,
    // Main-axis length enables fill()/remaining inside the callback.
    length: innerMain,
    fitCross,
    wrap,
  });
  layoutStack.push(st);
  try {
    return children(st);
  } finally {
    layoutStack.pop();
  }
}

// ---------- Auto-height (last-frame content-size cache) ----------
// Immediate mode can't know children's height before drawing the container's
// box, so — like Dear ImGui's auto-fit — we cache the height MEASURED from the
// children this frame and reuse it to size (and draw) the box next frame. A
// container with a stable key self-corrects after one frame; static UIs are
// steady from frame two. Callers pass no `h` to opt in.

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

// Swept: entries for containers that stop being drawn (or whose position-
// derived fallback key changes as they move) age out instead of accumulating.
const contentSizes = sweptCache<ContentSize>();

// The enclosing containers' cache keys, innermost last, with a running count of
// the child containers each has handed a fallback key to this frame. A NESTED
// container with no id of its own derives one from its parent's key plus its
// ordinal — see `containerKey`. Pushed/popped by `runAutoSized`, so the counts
// restart every frame.
const keyPath: { key: string | undefined; children: number }[] = [];

export function pushContainerKey(key: string | undefined): void {
  keyPath.push({ key, children: 0 });
}

export function popContainerKey(): void {
  keyPath.pop();
}

/** Cache key for a container's auto-size: explicit `id`, else the idScope
 *  call-order id, else a position key for pinned/anchored containers, else —
 *  for a NESTED container — the enclosing container's key plus this child's
 *  ordinal. Without a key a container has no auto-size cache at all: it can't
 *  measure its content, so it collapses to a fallback height and its children
 *  spill over whatever follows. The ordinal assumes children appear in a stable
 *  order (the same assumption `idScope`'s auto-ids make); if they don't, the
 *  size is one frame stale rather than wrong forever. */
export function containerKey(opts: LayoutOptions, kind: string): string | undefined {
  const prefix = `theme${themeKey}:`;
  if (opts.id !== undefined) return `${prefix}${kind}:${opts.id}`;
  const auto = widgetId(undefined, kind);
  if (auto) return `${prefix}${auto}`;
  if (opts.x !== undefined && opts.y !== undefined) {
    return `${prefix}${kind}@${opts.x}:${opts.y}:${opts.w ?? "auto"}`;
  }
  if (opts.anchor !== undefined) {
    return `${prefix}${kind}@${opts.anchor}:${opts.w ?? "auto"}:${opts.h ?? "auto"}`;
  }
  const parent = keyPath[keyPath.length - 1];
  if (!parent?.key) return undefined;
  return `${prefix}${parent.key}>${kind}#${parent.children++}`;
}

/** Last-frame measured size for `key` (undefined on the first frame). */
export function cachedContentSize(key: string | undefined): ContentSize | undefined {
  return key ? contentSizes.get(key) : undefined;
}

/** Store this frame's measured container size for next frame. */
export function storeContentSize(key: string | undefined, size: ContentSize): void {
  if (key) contentSizes.set(key, size);
}

/** Full container size implied by the children placed into `st`, measured from
 *  the container's outer top-left and closed with one `pad` on each far edge. */
export function measuredContainerSize(
  st: Flow,
  outerLeft: number,
  outerTop: number,
  pad: Padding,
): ContentSize {
  const { x: padX, y: padY } = paddingXY(pad);
  const e = st.extent;
  return {
    w: e.x + e.w - outerLeft + padX,
    h: e.y + e.h - outerTop + padY,
    ew: e.w,
    eh: e.h,
  };
}

// Resolve a container's own rect: explicit if given, else reserve a slot from
// the parent layout. `auto` is last frame's measured size, used for whichever
// of width/height the caller omitted (auto-sizing). A ROOT container (pinned
// x/y) may omit both and shrink-wrap; a NESTED container fills its parent's
// cross axis and only auto-sizes along the main axis.
export function containerRect(
  dir: "row" | "col",
  opts: LayoutOptions,
  auto?: ContentSize,
): { x: number; y: number; w: number; h: number } {
  const w = opts.w ?? auto?.w;
  const requestedH = opts.h ?? auto?.h;
  const h = requestedH === undefined ? undefined : Math.max(requestedH, opts.minH ?? 0);
  if (opts.anchor) {
    // Root placed in the VIEWPORT: `w`/`h` are the preferred size clamped to the
    // viewport minus `margin`; the anchor + any `x`/`y` offset position it.
    const vp = anchorViewport();
    const m = opts.margin ?? 0;
    const cw = Math.min(w ?? 120, vp.w - m * 2);
    const ch = Math.min(h ?? (dir === "row" ? 34 : 40), vp.h - m * 2);
    const hx = ANCHOR_H[opts.anchor];
    const vy = ANCHOR_V[opts.anchor];
    const bx = hx === 0 ? m : hx === 0.5 ? (vp.w - cw) / 2 : vp.w - cw - m;
    const by = vy === 0 ? m : vy === 0.5 ? (vp.h - ch) / 2 : vp.h - ch - m;
    return { x: Math.round(bx + (opts.x ?? 0)), y: Math.round(by + (opts.y ?? 0)), w: cw, h: ch };
  }
  if (opts.x !== undefined && opts.y !== undefined) {
    // Root: pinned position; each omitted axis auto-measured (small first-frame
    // fallback, corrected next frame).
    return {
      x: opts.x,
      y: opts.y,
      w: w ?? 120,
      h: Math.max(h ?? (dir === "row" ? 34 : 40), opts.minH ?? 0),
    };
  }
  const parent = currentLayout();
  if (!parent) {
    throw new Error("Minimotor.UI: a root row/col/group needs explicit x/y");
  }
  // Nested: reserve a slot from the parent. Size along the PARENT's main axis
  // (width for a row parent, height for a col parent) from auto/explicit; pass
  // undefined on the cross axis so the parent's slot fills it — UNLESS the parent
  // wraps, where the cross size must be this container's NATURAL size so line
  // breaks and line heights measure correctly.
  if (parent.dir === "row") {
    return parent.next(w, h ?? (parent.wrap ? auto?.h : opts.minH));
  }
  return parent.next(opts.w ?? (parent.wrap ? auto?.w : undefined), h ?? opts.minH);
}

/** A container's children callback — receives the layout cursor for
 *  anchoring (`.last`) or measuring (`.extent`). */
export type LayoutChildren<R> = (layout: Flow) => R;

/** Untangle `(opts?, children)` vs `(children)`. */
export function layoutArgs<R>(
  optsOrChildren: LayoutOptions | LayoutChildren<R>,
  children?: LayoutChildren<R>,
): [LayoutOptions, LayoutChildren<R>] {
  return typeof optsOrChildren === "function"
    ? [{}, optsOrChildren]
    : [optsOrChildren, children as LayoutChildren<R>];
}

// ---------- The one auto-sizing container primitive ----------
// Every self-sizing container (row / col / group / popover) is the same shape:
// resolve a rect (auto-measuring any omitted axis from last frame), optionally
// paint a backdrop, run children under a fresh cursor, then measure + cache
// their extent for next frame. These two helpers hold that logic ONCE so no
// widget hand-rolls its own size cache.

/** Run a container's children over `body`, then cache their measured extent
 *  (taken from the OUTER top-left `outer`, so a title band + both pads are
 *  included) under `key` for next-frame auto-sizing. The shared tail of every
 *  auto-sizing container. */
export function runAutoSized<R>(
  key: string | undefined,
  outer: { x: number; y: number },
  body: { x: number; y: number; w: number; h: number },
  dir: "row" | "col",
  gap: number,
  pad: Padding,
  justify: "start" | "end",
  reverse: boolean,
  fitCross: boolean,
  children: LayoutChildren<R>,
  wrap = false,
  contentMain?: number,
  slot?: DeferredSlot | null,
): R {
  return runContainer(
    dir,
    body,
    gap,
    pad,
    justify,
    reverse,
    (st) => {
      // Anonymous nested containers key off this one — see `containerKey` —
      // and everything placed inside is captured as this container's child.
      pushContainerKey(key);
      pushLayoutParent();
      try {
        const r = children(st);
        const measured = measuredContainerSize(st, outer.x, outer.y, pad);
        storeContentSize(key, measured);
        // The children are placed and drawn; their extent is this container's
        // true size. A deferred slot writes it back into the rect the parent is
        // still holding open, so the next sibling starts from the right place
        // THIS frame instead of the next one.
        slot?.commit(
          dir === "row" ? measured.w : undefined,
          dir === "col" ? measured.h : undefined,
        );
        return r;
      } finally {
        // A children callback that threw must not leave the parent's cursor
        // held open — the rest of the frame would pile up on this slot. Commit
        // at the provisional size instead; `commit` is idempotent, so the
        // measured commit above wins whenever it ran.
        slot?.commit();
        popLayoutParent();
        popContainerKey();
      }
    },
    fitCross,
    wrap,
    contentMain,
  );
}

/** Extra knobs an auto-sizing container passes to `autoContainer`. */
export interface AutoContainerConfig {
  /** Inner padding in px; a number applies equally on both axes. */
  pad: Padding;
  /** Gap between children in px. */
  gap: number;
  /** Where the content block sits on the main axis (see `LayoutOptions.justify`). */
  justify: "start" | "end";
  /** Lay children in reverse order (see `LayoutOptions.reverse`). */
  reverse: boolean;
  /** Shrink-wrap the cross axis (a root container along its free axis). */
  fitCross: boolean;
  /** Flex-wrap children onto new lines when they overflow the main axis. */
  wrap?: boolean;
  /** Body inset from the rect's top — a title strip. Default 0. */
  top?: number;
  /** Extra height removed from the body — a title's bottom border. Default 0. */
  bottom?: number;
  /** Paint the container's backdrop given its resolved rect, before children
   *  run (e.g. `group`/`popover` draw a `panel`). Layout containers omit it. */
  box?: (rect: { x: number; y: number; w: number; h: number }) => void;
}

// ---------- Deferred placement (measuring in-frame instead of next frame) ----
// An auto-sized container's main-axis size is only known once its children have
// run, and the cache exists because the container has to hand the parent a slot
// BEFORE that. It doesn't, always: if the parent can hold its cursor open
// (`Flow.reserve`), the container takes its slot at the right position, runs its
// children, and writes the measured size back. Nothing is a frame behind and
// nesting no longer costs a frame per level.
//
// The conditions below are what makes that legal — read them as "the children's
// own rects must not depend on the size we don't know yet":
//
//   NO BACKDROP. `cfg.box` paints under the children, so it has to run first,
//     at a size we would not have. `row`/`col` have no box; `panel`/`group`/
//     `popover` do, and keep the cache. (This is Dear ImGui's split exactly: a
//     window auto-resizes a frame late, a layout group never does.)
//   SAME AXIS AS THE PARENT. When `parent.dir === dir`, the size we're deferring
//     is the container's MAIN axis, and children stack along it from a fixed
//     origin — their rects don't move. Crossing axes (a row inside a column)
//     would defer the row's HEIGHT, which its children fill, and that is
//     genuinely circular.
//   START-JUSTIFIED, FORWARD. `justify: "end"` and `reverse` position the
//     content block FROM the size, so they need it up front.
//   NO WRAP, NO EXPLICIT SIZE. Wrapping needs the size to break lines; an
//     explicit size was never a guess in the first place.
function tryReserve(
  dir: "row" | "col",
  opts: LayoutOptions,
  cfg: AutoContainerConfig,
  cached: ContentSize | undefined,
): DeferredSlot | null {
  if (cfg.box || cfg.wrap || cfg.reverse || cfg.justify === "end") return null;
  // Roots (anchored, or pinned x/y) don't take a slot from anyone.
  if (opts.anchor !== undefined || (opts.x !== undefined && opts.y !== undefined)) return null;
  const main = dir === "row" ? opts.w : opts.h;
  if (main !== undefined) return null;
  const parent = currentLayout();
  if (!parent || parent.dir !== dir) return null;
  // Provisional size: last frame's measurement when we have one, so a container
  // that never settles is no worse off than before, and the flow's own default
  // otherwise. Only `fill()`/`remaining()` inside the container read it.
  return dir === "row"
    ? parent.reserve(cached?.w, opts.h ?? opts.minH)
    : parent.reserve(opts.w, Math.max(cached?.h ?? 0, opts.minH ?? 0) || undefined);
}

/** The single auto-sizing container: resolve the rect from `opts` (measuring
 *  the children in-frame where possible — see `tryReserve` — and otherwise
 *  auto-sizing any omitted axis from last frame's cached content), paint the
 *  optional backdrop, lay the children out and cache their size for next frame.
 *  `row`, `col`, `group` (and, via `runAutoSized`, `popover`) are thin wrappers
 *  over this — the auto-size machinery lives here, not in each widget. */
export function autoContainer<R>(
  kind: string,
  dir: "row" | "col",
  opts: LayoutOptions,
  cfg: AutoContainerConfig,
  children: LayoutChildren<R>,
): R {
  const key = containerKey(opts, kind);
  const cached = cachedContentSize(key);
  const slot = tryReserve(dir, opts, cfg, cached);
  const rect = slot ? slot.rect : containerRect(dir, opts, cached);
  const recorded = layoutCaptureActive ? recordLayout(kind, opts.id, rect) : -1;
  cfg.box?.(rect);
  const top = cfg.top ?? 0;
  const bottom = cfg.bottom ?? 0;
  const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top - bottom };
  // Content's main-axis run (last frame) — justify:"end" uses it to right/bottom-
  // align the block, and reverse uses it to find the block's far edge. This is
  // the content's own bounding-box length (`ew`/`eh`), NOT the span from the box
  // edge, so it stays stable as the block moves (a span would oscillate).
  // Undefined on the first frame (positions settle next frame).
  const contentMain = cached ? (dir === "row" ? cached.ew : cached.eh) : undefined;
  const result = runAutoSized(
    key,
    rect,
    body,
    dir,
    cfg.gap,
    cfg.pad,
    cfg.justify,
    cfg.reverse,
    cfg.fitCross,
    children,
    cfg.wrap ?? false,
    contentMain,
    slot,
  );
  if (recorded >= 0) {
    // `slot.commit` resized `rect` after the entry above was recorded from it.
    if (slot) refreshLayoutRect(recorded, rect);
    // What the box was worth against what it turned out to hold. A deferred
    // container is measured in-frame and is 0 by construction; the ones that
    // fell back to the cache are where a pop can still come from, and this is
    // what names them. Only the axes the caller left auto count — a container
    // given an explicit size was told to be that size.
    const measured = cachedContentSize(key);
    noteContainerSize(recorded, key, {
      w: measured && opts.w === undefined ? rect.w - measured.w : 0,
      h: measured && opts.h === undefined ? rect.h - measured.h : 0,
    });
  }
  return result;
}
