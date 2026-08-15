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
import { currentUiScale, uiHeight, uiWidth } from "./input.js";
import { ANCHOR_H, ANCHOR_V, anchorViewport, type TextAnchor } from "./text.js";
import { uiSlot } from "./state.js";
import { theme, themeKey } from "@src/ui/theme.js";

export interface UiPadding {
  x?: number;
  y?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

type Padding = number | UiPadding;
type ResolvedPadding = {
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function resolvePadding(pad: Padding): ResolvedPadding {
  if (typeof pad === "number") {
    return { x: pad, y: pad, top: pad, right: pad, bottom: pad, left: pad };
  }
  const x = pad.x ?? 0;
  const y = pad.y ?? 0;
  const left = pad.left ?? x;
  const right = pad.right ?? x;
  const top = pad.top ?? y;
  const bottom = pad.bottom ?? y;
  return { x: left, y: top, top, right, bottom, left };
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
  next(w?: number, h?: number): { x: number; y: number; w: number; h: number };
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
  fill(reserve?: number, cross?: number): { x: number; y: number; w: number; h: number };
  /** Extra spacing before the next slot. */
  gap(px: number): void;
  /** Include an independently positioned drawing in this container's measured
   *  extent without moving the flow cursor. Useful for low-level `UI.flow`
   *  toolbars drawn inside an auto-sized panel. */
  include(rect: { x: number; y: number; w: number; h: number }): void;
  /** Main-axis space left before the container's end (needs `length`). */
  readonly remaining: number;
  /** The most recently handed-out slot — anchor popovers/spinners to it. */
  readonly last: { x: number; y: number; w: number; h: number } | null;
  /** Bounding box of everything placed so far. */
  readonly extent: { x: number; y: number; w: number; h: number };
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
export function flow(opts: FlowOptions): Flow {
  return createFlow(opts, 1);
}

/** Per-flow hook: equal-fill redistribution + this frame's fill() count. */
const flowFinishFills = new WeakMap<Flow, () => number>();

function finishFlowFills(st: Flow): number {
  return flowFinishFills.get(st)?.() ?? 0;
}

function createFlow(opts: FlowOptions, expectedFills: number): Flow {
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
  let crossMax = 0; // largest cross size any slot ASKED for — see `crossExtent`
  // Equal-fill: divide leftover main-axis space by last frame's fill() count
  // (1 when missing — a lone fill still takes everything). Count this frame's
  // calls and, when they differ, mutate the fill rects in place so nested
  // auto containers holding those objects see the corrected size this frame.
  let fillsLeft = Math.max(1, Math.floor(expectedFills));
  let fillCount = 0;
  const fillRects: { x: number; y: number; w: number; h: number }[] = [];
  let fillRemaining0 = 0;
  let fillReserve = 0;
  const crossFactor =
    opts.alignCross === "center" ? 0.5 : opts.alignCross === "end" ? 1 : /* start */ 0;

  // Placing a slot is two steps, kept apart so a container whose size is only
  // known after its children have run can take step 1 now and step 2 later
  // (`reserve`). `slotRect` picks the position; `settle` moves the cursor past
  // the slot and folds it into `last`/`extent`. `next` is both, back to back.
  const slotRect = (w?: number, h?: number) => {
    const W = w ?? (dir === "col" ? (opts.w ?? 120) : 100);
    const H = h ?? opts.h ?? theme.button.height;
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
    // Cross-axis alignment: a slot narrower/shorter than the cross axis has
    // slack, and this is where it goes. Wrapping is excluded — a wrapped
    // line's cross size is only known once the line has been closed, so there
    // is nothing to align against yet.
    const crossSlack = (size: number) => {
      if (crossFactor === 0 || wrapping) return 0;
      const cross = dir === "row" ? opts.h : opts.w;
      return cross === undefined ? 0 : Math.max(0, cross - size) * crossFactor;
    };
    return dir === "row"
      ? { x: back ? cx - W : cx, y: cy + crossSlack(H), w: W, h: H }
      : { x: cx + crossSlack(W), y: back ? cy - H : cy, w: W, h: H };
  };

  // Reads the rect's CURRENT size, so a deferred slot settles against its
  // committed size rather than the provisional one it was handed out with.
  const settle = (rect: { x: number; y: number; w: number; h: number }) => {
    crossMax = Math.max(crossMax, dir === "row" ? rect.h : rect.w);
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

  const st: Flow = {
    dir,
    crossSize: dir === "col" ? opts.w : opts.h,
    fitCross: opts.fitCross ?? false,
    stretchCross: opts.stretchCross ?? false,
    wrap: wrapping,
    layoutScale: opts.layoutScale ?? 1,
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
    fill(reserve = 0, cross) {
      if (fillCount === 0) {
        fillRemaining0 = remaining();
        fillReserve = reserve;
      }
      fillCount++;
      const distributing = fillsLeft > 0;
      const slots = Math.max(1, fillsLeft);
      const distributedGap = distributing ? gapPx * (slots - 1) : 0;
      const avail = Math.max(0, remaining() - reserve - distributedGap);
      const main = distributing ? avail / slots : avail;
      if (fillsLeft > 0) fillsLeft--;
      const rect = dir === "row" ? advance(main, cross) : advance(cross, main);
      fillRects.push(rect);
      return rect;
    },
    gap(px) {
      if (dir === "row") cx += (back ? -1 : 1) * px;
      else cy += (back ? -1 : 1) * px;
    },
    include(rect) {
      crossMax = Math.max(
        crossMax,
        dir === "row" ? rect.y + rect.h - (opts.y ?? rect.y) : rect.x + rect.w - (opts.x ?? rect.x),
      );
      if (!ext) ext = { ...rect };
      else {
        const x2 = Math.max(ext.x + ext.w, rect.x + rect.w);
        const y2 = Math.max(ext.y + ext.h, rect.y + rect.h);
        ext.x = Math.min(ext.x, rect.x);
        ext.y = Math.min(ext.y, rect.y);
        ext.w = x2 - ext.x;
        ext.h = y2 - ext.y;
      }
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
    get crossExtent() {
      if (!wrapping || !ext) return crossMax;
      return dir === "row" ? ext.y + ext.h - opts.y : ext.x + ext.w - opts.x;
    },
    crossStart: dir === "row" ? opts.y : opts.x,
  };
  flowFinishFills.set(st, () => {
    // Redistribute only when the live count disagrees with last frame's, the
    // fills were consecutive last slots, and the cursor can still be moved
    // (no wrap / end-align). Nested auto containers hold these same rect
    // objects, so mutating them is DeferredSlot.commit for equal-fill.
    if (
      fillCount > 0 &&
      fillCount !== Math.max(1, Math.floor(expectedFills)) &&
      !wrapping &&
      !back
    ) {
      const lastFill = fillRects[fillRects.length - 1];
      const afterLast = (dir === "row" ? lastFill.x + lastFill.w : lastFill.y + lastFill.h) + gapPx;
      const cur = dir === "row" ? cx : cy;
      let consecutive = Math.abs(cur - afterLast) <= 0.5;
      for (let i = 1; i < fillRects.length && consecutive; i++) {
        const prev = fillRects[i - 1];
        const next = fillRects[i];
        const expected = (dir === "row" ? prev.x + prev.w : prev.y + prev.h) + gapPx;
        const got = dir === "row" ? next.x : next.y;
        if (Math.abs(got - expected) > 0.5) consecutive = false;
      }
      if (consecutive) {
        const n = fillCount;
        const avail = Math.max(0, fillRemaining0 - fillReserve - gapPx * (n - 1));
        const main = avail / n;
        let pos = dir === "row" ? fillRects[0].x : fillRects[0].y;
        for (const rect of fillRects) {
          if (dir === "row") {
            rect.x = pos;
            rect.w = main;
          } else {
            rect.y = pos;
            rect.h = main;
          }
          pos += main + gapPx;
        }
        if (dir === "row") cx = pos;
        else cy = pos;
      }
    }
    return fillCount;
  });
  return st;
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

// A container's own rect, as COMMITTED — after its children have run and any
// auto-sizing has resized it. Separate from `lastRectSlot` because that one is
// written at PLACEMENT, so by the time a container closes its children have
// overwritten it. Deliberately not folded into `lastWidgetRect`: anchoring a
// popover to the last leaf widget is the behaviour that call site wants.
const lastContainerSlot = uiSlot<{ rect: { x: number; y: number; w: number; h: number } | null }>(
  () => ({ rect: null }),
);

/** The committed rect of the container that most recently CLOSED. Read it
 *  immediately after an `autoContainer` call (`panel`, `col`, `row`, …) to get
 *  the box it actually occupied, auto-sizing included — which is not knowable
 *  before its children have run. Null before any container has drawn.
 *
 *  Nesting resolves the way you want: an inner container closes first, so the
 *  outer one overwrites it and the value after the outermost call is the
 *  outermost box. */
export function lastContainerRect(): { x: number; y: number; w: number; h: number } | null {
  return lastContainerSlot().rect;
}

/** @internal Called by `autoContainer` as it closes. */
export function noteContainerRect(rect: { x: number; y: number; w: number; h: number }): void {
  lastContainerSlot().rect = rect;
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
  if (opts.minW !== undefined) {
    const measureLayout = opts.at ?? currentLayout();
    measureLayout?.include({
      x: rect.x,
      y: rect.y,
      w: Math.max(rect.w, opts.minW),
      h: rect.h,
    });
  }
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
      if (opts.flex === "fill" && opts.w === undefined) {
        rect = st.fill(0, opts.h ?? (st.fitCross && !st.stretchCross ? defaultH : undefined));
      } else {
        rect = st.next(
          opts.w ?? autoW,
          opts.h ?? (st.fitCross && !st.stretchCross ? defaultH : undefined),
        );
      }
    } else {
      // In a COLUMN, height is the main axis and an undated slot falls back to
      // the flow's generic row height (`theme.button.height`). `intrinsicH` widgets
      // opt out of that: their art has a height of its own, and squeezing it
      // into a button-sized slot squashes the frame. Rows are unaffected —
      // there height is the CROSS axis and filling the row is still right.
      rect = st.next(
        opts.w ??
          (opts.flex === "fill" ? undefined : st.fitCross && !st.stretchCross ? autoW : undefined),
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

/** Place a field-like widget. In a column, omitted field widths fill the
 *  column by default; rows and pinned widgets retain their natural size.
 *  Explicit `w` and `flex` always win. */
export function placeField(
  opts: Flowable,
  autoW: number,
  defaultH: number,
  kind = "field",
  intrinsicH = false,
): { x: number; y: number; w: number; h: number } {
  const layout = opts.at ?? (opts.x === undefined ? currentLayout() : null);
  const fieldOpts =
    opts.flex === undefined && opts.w === undefined && layout?.dir === "col"
      ? { ...opts, flex: "fill" as const }
      : opts;
  return place(fieldOpts, autoW, defaultH, kind, intrinsicH);
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

// Run `children` with a fresh layout cursor over `rect`'s interior. The
// cursor is also handed to the callback (egui style) so children can anchor
// popovers/spinners to `.last` or read `.extent`.
export function runContainer<R>(
  dir: "row" | "col",
  rect: { x: number; y: number; w: number; h: number },
  gap: number,
  pad: Padding,
  justify: "start" | "center" | "end",
  reverse: boolean,
  children: (layout: Flow) => R,
  fitCross = false,
  stretchCross = false,
  wrap = false,
  contentMain?: number,
  alignCross: "start" | "center" | "end" = "start",
  expectedFills = 1,
): R {
  const padding = resolvePadding(pad);
  const inner = {
    x: rect.x + padding.left,
    y: rect.y + padding.top,
    w: rect.w - padding.left - padding.right,
    h: rect.h - padding.top - padding.bottom,
  };
  const innerNear = dir === "row" ? inner.x : inner.y;
  const innerMain = dir === "row" ? inner.w : inner.h;
  // JUSTIFY positions the content block on the main axis: "end" pushes it to the
  // far edge by the slack (extra room beyond the children's measured length,
  // from last frame's cache — 0 on the first frame, corrected next). REVERSE
  // decides growth direction: forward from the block's near edge, or backward
  // from its far edge (so the first child lands at the far end).
  const slack =
    contentMain === undefined
      ? 0
      : Math.max(0, innerMain - contentMain) *
        (justify === "center" ? 0.5 : justify === "end" ? 1 : 0);
  const blockNear = innerNear + slack;
  const blockFar = contentMain !== undefined ? blockNear + contentMain : innerNear + innerMain;
  const mainStart = reverse ? blockFar : blockNear;
  const flowAlign = reverse ? "end" : "start";
  const st = createFlow(
    {
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
      layoutScale: currentUiScale(),
      fitCross,
      stretchCross,
      alignCross,
      wrap,
    },
    expectedFills,
  );
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
// Last frame's `fill()` / `flex: "fill"` count per auto-container key. The
// equal split uses this the way `contentSizes` uses last frame's measurement:
// missing means 1 (this fill takes all remaining), and a count change is one
// frame behind.
const fillCounts = sweptCache<number>();

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
  const padding = resolvePadding(pad);
  const e = st.extent;
  // MAIN axis from the extent (where the run actually reached), CROSS axis from
  // what the children asked for. The two differ only under `alignCross`, and
  // that difference is the whole point — see `Flow.crossExtent`.
  const crossSize = st.crossExtent;
  const crossSpan = st.crossStart - (st.dir === "row" ? outerTop : outerLeft) + crossSize;
  return st.dir === "row"
    ? {
        w: e.x + e.w - outerLeft + padding.right,
        h: crossSpan + padding.bottom,
        ew: e.w,
        eh: crossSize,
      }
    : {
        w: crossSpan + padding.right,
        h: e.y + e.h - outerTop + padding.bottom,
        ew: crossSize,
        eh: e.h,
      };
}

// Resolve a container's own rect: explicit if given, else reserve a slot from
// the parent layout. `auto` is last frame's measured size, used for whichever
// of width/height the caller omitted (auto-sizing). A ROOT container (pinned
// x/y) may omit both and shrink-wrap; a NESTED container fills its parent's
// cross axis and only auto-sizes along the main axis.
/** A requested size held between the caller's floor and ceiling. `min` wins a
 *  contradiction, so `minH` above `maxH` behaves like `minH` alone rather than
 *  collapsing the box. */
export function bound(value: number, min?: number, max?: number): number {
  return Math.max(min ?? 0, max === undefined ? value : Math.min(value, max));
}

export function containerRect(
  dir: "row" | "col",
  opts: LayoutOptions,
  auto?: ContentSize,
): { x: number; y: number; w: number; h: number } {
  const requestedW = opts.w ?? auto?.w;
  const w = requestedW === undefined ? undefined : bound(requestedW, opts.minW, opts.maxW);
  const requestedH = opts.h ?? auto?.h;
  const h = requestedH === undefined ? undefined : bound(requestedH, opts.minH, opts.maxH);
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
      w: w ?? Math.max(120, opts.minW ?? 0),
      h: Math.max(h ?? (dir === "row" ? 34 : 40), opts.minH ?? 0),
    };
  }
  const parent = currentLayout();
  if (!parent) {
    if (opts.flex === "fill") {
      return {
        x: opts.x ?? 0,
        y: opts.y ?? 0,
        w: opts.w ?? uiWidth(),
        h: Math.max(opts.h ?? uiHeight(), opts.minH ?? 0),
      };
    }
    throw new Error("createUI: a root row/col/group needs explicit x/y");
  }
  if (opts.flex === "fill") {
    const slot = parent.fill();
    // A scaled block can begin inside an unscaled flow. The parent slot is in
    // outer coordinates, while the child container lays out in scaled
    // reference space. Closure containers mark their own cursors with the
    // active scale, so only the first fill crossing the boundary is reduced.
    const scale = parent.layoutScale === currentUiScale() ? 1 : currentUiScale();
    const logical = (value: number): number => value / scale;
    if (scale !== 1) {
      return {
        x: slot.x,
        y: slot.y,
        w: parent.dir === "row" ? logical(slot.w) : (opts.w ?? logical(slot.w)),
        h: parent.dir === "col" ? logical(slot.h) : (opts.h ?? auto?.h ?? logical(slot.h)),
      };
    }
    // Same object as the fill slot so a later equal-fill redistribution
    // mutates this container's box in place (DeferredSlot.commit style).
    if (parent.dir === "row") slot.h = opts.h ?? auto?.h ?? slot.h;
    else if (opts.w !== undefined) slot.w = opts.w;
    return slot;
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
  justify: "start" | "center" | "end",
  reverse: boolean,
  fitCross: boolean,
  children: LayoutChildren<R>,
  wrap = false,
  contentMain?: number,
  reservation?: Reservation | null,
  alignCross: "start" | "center" | "end" = "start",
  stretchCross = false,
  minW = 0,
): R {
  const expectedFills = (key && fillCounts.get(key)) || 1;
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
        // Record this frame's fill() count for next frame's equal split, and
        // mutate fill rects in place when the live count disagrees so nested
        // auto containers holding those objects see the corrected size now.
        if (key) fillCounts.set(key, finishFlowFills(st));
        else finishFlowFills(st);
        const measured = measuredContainerSize(st, outer.x, outer.y, pad);
        measured.w = Math.max(measured.w, minW);
        storeContentSize(key, measured);
        // The children are placed and drawn; their extent is this container's
        // true size. A deferred slot writes it back into the rect the parent is
        // still holding open, so the next sibling starts from the right place
        // THIS frame instead of the next one. A fitCross parent also receives
        // the child's natural cross-axis size, so nested auto containers can
        // grow the row/column around their content immediately.
        if (reservation) {
          const { axis, slot } = reservation;
          slot.commit(
            axis === "w" || reservation.crossAxis === "w" ? measured.w : undefined,
            axis === "h" || reservation.crossAxis === "h" ? measured.h : undefined,
          );
        }
        return r;
      } finally {
        // A children callback that threw must not leave the parent's cursor
        // held open — the rest of the frame would pile up on this slot. Commit
        // at the provisional size instead; `commit` is idempotent, so the
        // measured commit above wins whenever it ran.
        reservation?.slot.commit();
        popLayoutParent();
        popContainerKey();
      }
    },
    fitCross,
    stretchCross,
    wrap,
    contentMain,
    alignCross,
    expectedFills,
  );
}

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
// What is deferred is always the PARENT'S main axis — the one measurement the
// parent's cursor is waiting on. Which of the container's own axes that is
// depends on whether the two agree:
//
//   SAME AXIS (a col in a col). The deferred size is the container's own main
//     axis. Children stack along it from a fixed origin, so their rects don't
//     move and the measurement is exact. This is the case that used to cost one
//     frame per nesting level.
//   CROSSING AXIS (a row in a col). The deferred size is the container's CROSS
//     axis, which its children fill — so children still take the provisional
//     size, exactly as they do today. What changes is the PARENT'S cursor: it
//     advances by what the row turned out to be, not by last frame's guess, so
//     the band underneath stops sliding. Children that pin their own size make
//     this exact; children that fill make it a no-op. Never worse.
//
// The conditions below are the ones that can't work either way:
//
//   BACKDROP PAINTING. `cfg.box` still paints under the children, so the frame
//     itself uses the provisional/cached rect. The layout slot can nevertheless
//     be deferred: children use the panel's fitCross flow, the measured size is
//     committed to the parent, and the next frame's frame art is exact. Roots
//     and pinned containers have no slot to hold open, so they keep the cache.
//   START-JUSTIFIED, FORWARD. `justify: "end"` and `reverse` position the
//     content block FROM the size, so they need it up front.
//   NO WRAP, NO EXPLICIT SIZE ON THE DEFERRED AXIS. Wrapping needs the size to
//     break lines; an explicit size was never a guess in the first place.
interface Reservation {
  slot: DeferredSlot;
  /** Which of the container's axes the parent is waiting on. */
  axis: "w" | "h";
  /** When the parent shrink-wraps its cross axis, commit that measured axis too. */
  crossAxis?: "w" | "h";
}

function tryReserve(
  dir: "row" | "col",
  opts: LayoutOptions,
  cfg: AutoContainerConfig,
  cached: ContentSize | undefined,
): Reservation | null {
  if (cfg.wrap || cfg.reverse || cfg.justify !== "start" || opts.flex === "fill") return null;
  // Roots (anchored, or pinned x/y) don't take a slot from anyone.
  if (opts.anchor !== undefined || (opts.x !== undefined && opts.y !== undefined)) return null;
  const parent = currentLayout();
  if (!parent) return null;
  const axis = parent.dir === "row" ? "w" : "h";
  if (opts[axis] !== undefined) return null;
  // Provisional size: last frame's measurement when we have one, so a container
  // that never settles is no worse off than before, and the flow's own default
  // otherwise. On the same axis only `fill()`/`remaining()` inside the container
  // read it; on a crossing axis the children fill it, as they already did.
  const provisionalW = axis === "w" ? cached?.w : opts.w;
  const provisionalH =
    axis === "h" ? Math.max(cached?.h ?? 0, opts.minH ?? 0) || undefined : (opts.h ?? opts.minH);
  const slot = parent.reserve(provisionalW, provisionalH);
  const cross = axis === "w" ? "h" : "w";
  return slot
    ? {
        slot,
        axis,
        crossAxis: parent.fitCross && opts[cross] === undefined ? cross : undefined,
      }
    : null;
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
  const reservation = tryReserve(dir, opts, cfg, cached);
  const parent = currentLayout();
  const rect = reservation ? reservation.slot.rect : containerRect(dir, opts, cached);
  const recorded = layoutCaptureActive ? recordLayout(kind, opts.id, rect) : -1;
  // `rect` is mutated in place further down — by `slot.commit`, by the flex
  // fill feedback, by an equal-fill redistribution in the parent's flow — and
  // the backdrop below goes down BEFORE any of that. Snapshot the geometry the
  // frame art is about to use, so `refreshLayoutRect` can keep it as
  // `paintedRect` rather than have the committed size stand in for pixels that
  // were never there. Harness-only: nothing is copied while capture is off.
  const paintedAt = recorded >= 0 ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : undefined;
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
  // The first pass must hug children so an auto-width column can discover its
  // widest child. Once that size is cached, the same column can stretch every
  // child across the measured cross axis without changing its own width.
  const stretchingCross = cfg.stretchCross === true && cached !== undefined;
  const result = runAutoSized(
    key,
    rect,
    body,
    dir,
    cfg.gap,
    cfg.pad,
    cfg.justify,
    cfg.reverse,
    stretchingCross ? false : cfg.fitCross,
    children,
    cfg.wrap ?? false,
    contentMain,
    reservation,
    cfg.alignCross ?? "start",
    stretchingCross,
    opts.minW ?? 0,
  );
  // A filled container in a row knows its width up front, but its height is
  // still auto-sized by its children. Feed that measured cross-axis size back
  // into the parent flow before the parent places its next sibling. Without
  // this, a row of filled panels reports only the provisional row height and
  // the following widget can overlap the panels.
  if (opts.flex === "fill" && opts.h === undefined && parent?.dir === "row") {
    const measured = cachedContentSize(key);
    if (measured) {
      rect.h = Math.max(rect.h, measured.h);
      parent.include(rect);
    }
  }
  if (recorded >= 0) {
    // `slot.commit` resized `rect` after the entry above was recorded from it —
    // as did the flex-fill feedback above, and an equal-fill redistribution in
    // the PARENT's flow, which reaches the very same object (see
    // `containerRect`'s fill branch). All three are post-paint, so this hands
    // over what the backdrop was drawn at as well as where the slot ended up.
    if (reservation || opts.flex === "fill") refreshLayoutRect(recorded, rect, paintedAt);
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
  noteContainerRect(rect);
  return result;
}
