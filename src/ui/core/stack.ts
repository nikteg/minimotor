// ---------- Stack (layout) ----------

/** Options for `stack()` — a one-axis layout cursor. */
export interface StackOptions {
  /** Starting corner. With `align: "end"` this is the FAR edge (right edge
   *  for rows, bottom for columns) and slots grow backwards from it. */
  x: number;
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
}

/** A layout cursor from `stack()`: hands out rects along one axis. */
export interface Stack {
  /** Main axis. */
  readonly dir: "row" | "col";
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

  const advance = (w?: number, h?: number) => {
    const W = w ?? (dir === "col" ? (opts.w ?? 120) : 100);
    const H = h ?? (dir === "row" ? (opts.h ?? 30) : 30);
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
    // In a row the main axis is width (pass autoW); in a column it's height
    // and the width fills the column (pass undefined so the stack's cross
    // width applies unless the caller overrides).
    return st.dir === "row" ? st.next(opts.w ?? autoW, opts.h) : st.next(opts.w, opts.h);
  }
  return { x: opts.x ?? 0, y: opts.y ?? 0, w: opts.w ?? autoW, h: opts.h ?? defaultH };
}

/** Options shared by the closure containers. */
export interface LayoutOptions {
  /** Explicit rect — required for a ROOT container (no parent layout). */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Gap between children in px. Default 8. */
  gap?: number;
  /** Inner padding in px. `row`/`col` default to 0 (flush structural flow);
   *  `group` defaults to `theme.pad`. */
  pad?: number;
  /** Main-axis alignment within the container's own slot when nested. */
  align?: "start" | "end";
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
  });
  layoutStack.push(st);
  try {
    return children(st);
  } finally {
    layoutStack.pop();
  }
}

// Resolve a container's own rect: explicit if given, else reserve a slot from
// the parent layout (declared main-axis size, cross inherited).
export function containerRect(
  dir: "row" | "col",
  opts: LayoutOptions,
): { x: number; y: number; w: number; h: number } {
  if (
    opts.x !== undefined &&
    opts.y !== undefined &&
    opts.w !== undefined &&
    opts.h !== undefined
  ) {
    return { x: opts.x, y: opts.y, w: opts.w, h: opts.h };
  }
  const parent = currentLayout();
  if (!parent) {
    throw new Error("Minimotor.UI: a root row/col/group needs explicit x/y/w/h");
  }
  // A row's natural extent along a column parent is its height (default 34);
  // a col's along a row parent is its width. Cross fills the parent.
  return parent.next(opts.w, opts.h ?? (dir === "row" ? 34 : undefined));
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
