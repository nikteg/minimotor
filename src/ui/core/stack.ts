// ---------- Stack (layout) ----------

import { widgetId } from "./identity.js";
import type { IdPart } from "./identity.js";

/** Options for `stack()` — a one-axis layout cursor. */
export interface StackOptions {
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
   *  stack (a col's width, a row's height) instead of filling it. Set by an
   *  auto-sized container so it can measure its content. Default false. */
  fitCross?: boolean;
  /** Flex-wrap: when a slot would overflow `length` on the main axis, start a
   *  new line (rows wrap downward, cols wrap sideways) offset by the tallest/
   *  widest slot of the line just finished. Needs `length`. Default false. */
  wrap?: boolean;
}

/** A layout cursor from `stack()`: hands out rects along one axis. */
export interface Stack {
  /** Main axis. */
  readonly dir: "row" | "col";
  /** True when the container shrink-wraps its cross axis — widgets should
   *  place at their natural cross size rather than filling. `place` reads it. */
  readonly fitCross: boolean;
  /** True when the container flex-wraps its children onto new lines. Nested
   *  containers read it (via `containerRect`) to reserve a NATURAL cross size
   *  so line breaks measure correctly. */
  readonly wrap: boolean;
  /** Reserve the next slot and advance. For rows pass the width (height
   *  defaults from the stack); for columns pass the height as the second
   *  argument (width defaults from the stack). */
  next(w?: number, h?: number): { x: number; y: number; w: number; h: number };
  /** Reserve a slot that fills the remaining main-axis space, minus `reserve`
   *  (leave room for later fixed slots — e.g. a footer's height + gap). Needs
   *  `length` set on the stack; the closure containers set it for you. */
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
 *    const bar = UI.stack({ x: 12, y: 12, gap: 10 });          // a row
 *    if (UI.button(ctx, { at: bar, label: "SAVE" })) save();   // auto width
 *    on = UI.toggle(ctx, { at: bar, label: "Autosave", on });
 *
 *    const right = UI.stack({ x: vp.w - 12, y: 12, align: "end" }); // ← grows left */
export function stack(opts: StackOptions): Stack {
  const dir = opts.dir ?? "row";
  const gapPx = opts.gap ?? 8;
  const back = opts.align === "end";
  let cx = opts.x;
  let cy = opts.y;
  let last: { x: number; y: number; w: number; h: number } | null = null;
  let ext: { x: number; y: number; w: number; h: number } | null = null;
  // Flex-wrap only makes sense start-aligned with a known main-axis length.
  const wrapping = (opts.wrap ?? false) && !back && opts.length !== undefined;
  let lineCross = 0; // tallest (row) / widest (col) slot in the current line

  const advance = (w?: number, h?: number) => {
    const W = w ?? (dir === "col" ? (opts.w ?? 120) : 100);
    const H = h ?? (dir === "row" ? (opts.h ?? 30) : 30);
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
    const rect =
      dir === "row"
        ? { x: back ? cx - W : cx, y: cy, w: W, h: H }
        : { x: cx, y: back ? cy - H : cy, w: W, h: H };
    if (dir === "row") cx += (back ? -1 : 1) * (W + gapPx);
    else cy += (back ? -1 : 1) * (H + gapPx);
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
    fitCross: opts.fitCross ?? false,
    wrap: wrapping,
    next: advance,
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

// The ambient layout stack. A container pushes a `stack` cursor over its
// interior for the duration of its children callback; widgets with no
// explicit x/y and no `at` place themselves into the innermost one. This is
// the egui-style "children as a closure" layer over the explicit `flex`/
// `stack` tools — the nesting is the layout tree, and widgets still return
// their click inline (the callback's return value bubbles out unchanged).
export const layoutStack: Stack[] = [];

/** The innermost active layout cursor, or null outside any container. */
export function currentLayout(): Stack | null {
  return layoutStack.length > 0 ? layoutStack[layoutStack.length - 1] : null;
}

/** Resolve a widget's rect: an explicit `at` stack, else the ambient layout
 *  (unless the caller pinned x/y), else absolute coordinates. `autoW` is the
 *  widget's natural main-axis size (e.g. a button's label width). */
export function place(
  opts: { x?: number; y?: number; w?: number; h?: number; at?: Stack },
  autoW: number,
  defaultH: number,
): { x: number; y: number; w: number; h: number } {
  const pinned = opts.x !== undefined || opts.y !== undefined;
  const st = pinned ? undefined : (opts.at ?? currentLayout());
  if (st) {
    // Main axis: rows pass the widget's natural width, cols its natural height.
    // Cross axis: fill the container (pass undefined) UNLESS it shrink-wraps
    // (`fitCross`), where the widget's natural cross size is used instead.
    if (st.dir === "row") {
      return st.next(opts.w ?? autoW, opts.h ?? (st.fitCross ? defaultH : undefined));
    }
    return st.next(opts.w ?? (st.fitCross ? autoW : undefined), opts.h);
  }
  return { x: opts.x ?? 0, y: opts.y ?? 0, w: opts.w ?? autoW, h: opts.h ?? defaultH };
}

/** Options shared by the closure containers. */
export interface LayoutOptions {
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
  /** Main-axis alignment within the container's own slot when nested. */
  align?: "start" | "end";
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
}

// Run `children` with a fresh layout cursor over `rect`'s interior. The
// cursor is also handed to the callback (egui style) so children can anchor
// popovers/spinners to `.last` or read `.extent`.
export function runContainer<R>(
  dir: "row" | "col",
  rect: { x: number; y: number; w: number; h: number },
  gap: number,
  pad: number,
  align: "start" | "end",
  children: (layout: Stack) => R,
  fitCross = false,
  wrap = false,
): R {
  const inner = { x: rect.x + pad, y: rect.y + pad, w: rect.w - pad * 2, h: rect.h - pad * 2 };
  // For align:"end" the cursor starts at the far edge and grows backward.
  const start =
    align === "end"
      ? {
          x: dir === "row" ? inner.x + inner.w : inner.x,
          y: dir === "col" ? inner.y + inner.h : inner.y,
        }
      : { x: inner.x, y: inner.y };
  const st = stack({
    x: start.x,
    y: start.y,
    dir,
    gap,
    align,
    // Cross-axis size the children fill: row → height, col → width.
    h: dir === "row" ? inner.h : undefined,
    w: dir === "col" ? inner.w : undefined,
    // Main-axis length enables fill()/remaining inside the callback.
    length: dir === "row" ? inner.w : inner.h,
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

/** Measured content box of a container (width and height). */
export interface ContentSize {
  w: number;
  h: number;
}

const contentSizes = new Map<string, ContentSize>();

/** Cache key for a container's auto-size: explicit `id`, else the idScope
 *  call-order id, else a position key for pinned containers, else none. */
export function containerKey(opts: LayoutOptions, kind: string): string | undefined {
  if (opts.id !== undefined) return `${kind}:${opts.id}`;
  const auto = widgetId(undefined, kind);
  if (auto) return auto;
  if (opts.x !== undefined && opts.y !== undefined) {
    return `${kind}@${opts.x}:${opts.y}:${opts.w ?? "auto"}`;
  }
  return undefined;
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
  st: Stack,
  outerLeft: number,
  outerTop: number,
  pad: number,
): ContentSize {
  const e = st.extent;
  return { w: e.x + e.w - outerLeft + pad, h: e.y + e.h - outerTop + pad };
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
  const h = opts.h ?? auto?.h;
  if (opts.x !== undefined && opts.y !== undefined) {
    // Root: pinned position; each omitted axis auto-measured (small first-frame
    // fallback, corrected next frame).
    return { x: opts.x, y: opts.y, w: w ?? 120, h: h ?? (dir === "row" ? 34 : 40) };
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
    return parent.next(w, opts.h ?? (parent.wrap ? auto?.h : undefined));
  }
  return parent.next(opts.w ?? (parent.wrap ? auto?.w : undefined), h);
}

/** A container's children callback — receives the layout cursor for
 *  anchoring (`.last`) or measuring (`.extent`). */
export type LayoutChildren<R> = (layout: Stack) => R;

/** Untangle `(opts?, children)` vs `(children)`. */
export function layoutArgs<R>(
  a: LayoutOptions | LayoutChildren<R>,
  b?: LayoutChildren<R>,
): [LayoutOptions, LayoutChildren<R>] {
  return typeof a === "function" ? [{}, a] : [a, b as LayoutChildren<R>];
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
  pad: number,
  align: "start" | "end",
  fitCross: boolean,
  children: LayoutChildren<R>,
  wrap = false,
): R {
  return runContainer(
    dir,
    body,
    gap,
    pad,
    align,
    (st) => {
      const r = children(st);
      storeContentSize(key, measuredContainerSize(st, outer.x, outer.y, pad));
      return r;
    },
    fitCross,
    wrap,
  );
}

/** Extra knobs an auto-sizing container passes to `autoContainer`. */
export interface AutoContainerConfig {
  /** Inner padding in px. */
  pad: number;
  /** Gap between children in px. */
  gap: number;
  /** Main-axis alignment within the container's own slot. */
  align: "start" | "end";
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

/** The single auto-sizing container: resolve the rect from `opts` (auto-sizing
 *  any omitted axis from last frame's cached content), paint the optional
 *  backdrop, lay the children out and cache their size for next frame. `row`,
 *  `col`, `group` (and, via `runAutoSized`, `popover`) are thin wrappers over
 *  this — the auto-size machinery lives here, not in each widget. */
export function autoContainer<R>(
  kind: string,
  dir: "row" | "col",
  opts: LayoutOptions,
  cfg: AutoContainerConfig,
  children: LayoutChildren<R>,
): R {
  const key = containerKey(opts, kind);
  const rect = containerRect(dir, opts, cachedContentSize(key));
  cfg.box?.(rect);
  const top = cfg.top ?? 0;
  const bottom = cfg.bottom ?? 0;
  const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top - bottom };
  return runAutoSized(
    key,
    rect,
    body,
    dir,
    cfg.gap,
    cfg.pad,
    cfg.align,
    cfg.fitCross,
    children,
    cfg.wrap ?? false,
  );
}
