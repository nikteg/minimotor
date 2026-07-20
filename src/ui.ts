// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, sliders, scrollbars, panels, popovers, modals, confirm
// dialogs and meter bars. Everything draws in YOUR draw phase — no retained
// widget tree, no layout engine. Floating texts and spinners age on the
// fixed step (via Loop.onStep), so they pause with the loop like Clock/Tween.
//
// The canvas context is implicit: widgets draw to the default game's ctx —
// no plumbing. Pass one explicitly only for isolated games/offscreen work
// (`UI.begin(ctx)` per frame, or the `(ctx, opts)` call form):
//
//   Minimotor.UI.float("+100", x, y, { color: "#ffd43b" }); // spawn (update)
//   if (Minimotor.UI.button({ x, y, label: "PLAY" })) start();
//   Minimotor.UI.bar(10, 10, 120, 10, hp / maxHp);
//   Minimotor.UI.drawFloats(); // late in draw: floats, then tooltips
//   Minimotor.UI.drawTips();
//
// Colors and fonts come from the active theme — `UI.setTheme({...})` restyles
// every widget at once; per-widget style options still override.

import { pointInRect } from "./collision.js";
import { Draw, Loop, Pointer, Stage } from "./engine.js";

// ---------- Implicit context ----------

let begunCtx: CanvasRenderingContext2D | null = null;

/** Point the widgets at a specific context for this frame (isolated games,
 *  offscreen canvases). Without it, everything draws to the default game's
 *  `Draw.ctx`. Cleared at frame end. */
export function begin(ctx: CanvasRenderingContext2D): void {
  begunCtx = ctx;
}

function uiCtx(): CanvasRenderingContext2D {
  return begunCtx ?? Draw.ctx;
}

/** Untangle the two call forms: `widget(opts)` (implicit ctx) and
 *  `widget(ctx, opts)`. */
function withCtx<T>(a: CanvasRenderingContext2D | T, b?: T): [CanvasRenderingContext2D, T] {
  return b === undefined ? [uiCtx(), a as T] : [a as CanvasRenderingContext2D, b];
}

/** Width of `text` in the given font (default: the theme's base font) —
 *  for sizing custom layouts around labels. */
export function textWidth(text: string, font?: string): number {
  const ctx = uiCtx();
  ctx.save();
  ctx.font = font ?? uiFont();
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

// ---------- Theme ----------

/** Every color, font and metric the widgets use. Override any subset with
 *  `setTheme`; per-widget style options still win over the theme. */
export interface Theme {
  /** Font family for all widget text. */
  font: string;
  /** Base label size in px; widget fonts scale from it. */
  fontSize: number;
  /** Highlight color: active tab underline, hover borders, fills, knobs. */
  accent: string;
  /** Dimmer accent for resting knobs/thumbs. */
  accentSoft: string;
  /** Primary text. */
  text: string;
  /** Secondary text: captions, inactive tabs, disabled hints. */
  textDim: string;
  /** Disabled label text. */
  textDisabled: string;
  /** Widget fill, idle / hovered / held. */
  bg: string;
  bgHover: string;
  bgActive: string;
  /** Widget border when not hovered. */
  border: string;
  /** Panel/modal/tooltip background. */
  panelBg: string;
  /** Track behind sliders/scrollbars/bars. */
  track: string;
  /** The modal backdrop. */
  dim: string;
  /** Fill of a `variant: "primary"` button (its label is `bgActive`). */
  primary: string;
  /** Fill of a `variant: "danger"` button (its label is `text`). */
  danger: string;
  /** Border thickness in px for buttons/panels/toggles/tabs. Default 2. */
  borderWidth: number;
  /** Corner radius in px (0 = square). Default 0. */
  radius: number;
  /** Horizontal padding added around auto-sized button labels. Default 28. */
  buttonPadX: number;
}

export const defaultTheme: Theme = {
  font: "monospace",
  fontSize: 13,
  accent: "#4ecdc4",
  accentSoft: "#3a8f89",
  text: "#e8f0f4",
  textDim: "#7d8894",
  textDisabled: "#5a6a75",
  bg: "#24384a",
  bgHover: "#2c4356",
  bgActive: "#1d2b36",
  border: "#3a5568",
  panelBg: "rgba(13,18,26,0.92)",
  track: "rgba(255,255,255,0.12)",
  dim: "rgba(0,0,0,0.55)",
  primary: "#4ecdc4",
  danger: "#ff6b6b",
  borderWidth: 2,
  radius: 0,
  buttonPadX: 28,
};

let theme: Theme = { ...defaultTheme };

/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides: Partial<Theme>): void {
  theme = { ...defaultTheme, ...overrides };
}

/** The active theme (live object — read, don't mutate). */
export function getTheme(): Theme {
  return theme;
}

const uiFont = (size = theme.fontSize, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${theme.font}`;

/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill (and optionally stroke) a themed box: rounded per `theme.radius`,
 *  stroked at `theme.borderWidth` inset so the outline stays inside the rect.
 *  `radius`/`border` override the theme for one call. */
function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; radius?: number; border?: number },
): void {
  const r = opts.radius ?? theme.radius;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();
  }
  if (opts.stroke) {
    const bw = opts.border ?? theme.borderWidth;
    if (bw > 0) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = bw;
      const half = bw / 2;
      roundRectPath(ctx, x + half, y + half, w - bw, h - bw, Math.max(0, r - half));
      ctx.stroke();
    }
  }
}

/** Vertically centered text using real glyph metrics — the canvas "middle"
 *  baseline sits visibly high for most fonts. Honors the current textAlign.
 *  `maxW` clamps rendering (canvas squeezes the glyphs) so a label can never
 *  spill out of its widget. */
function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxW?: number,
): void {
  // measureText's actualBoundingBox values are relative to the CURRENT
  // textBaseline — pin it before measuring, or state leaked from caller
  // drawing (e.g. "middle") skews the correction.
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent ?? 0;
  const desc = m.actualBoundingBoxDescent ?? 0;
  if (asc || desc) {
    ctx.fillText(text, x, cy + (asc - desc) / 2, maxW);
  } else {
    // Metrics unavailable (mocked ctx) — middle baseline is the best we have.
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, cy, maxW);
  }
}

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
}

/** A layout cursor from `stack()`: hands out rects along one axis. */
export interface Stack {
  /** Main axis. */
  readonly dir: "row" | "col";
  /** Reserve the next slot and advance. For rows pass the width (height
   *  defaults from the stack); for columns pass the height as the second
   *  argument (width defaults from the stack). */
  next(w?: number, h?: number): { x: number; y: number; w: number; h: number };
  /** Extra spacing before the next slot. */
  gap(px: number): void;
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

  return {
    dir,
    next(w, h) {
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
    },
    gap(px) {
      if (dir === "row") cx += (back ? -1 : 1) * px;
      else cy += (back ? -1 : 1) * px;
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
const layoutStack: Stack[] = [];

/** The innermost active layout cursor, or null outside any container. */
function currentLayout(): Stack | null {
  return layoutStack.length > 0 ? layoutStack[layoutStack.length - 1] : null;
}

/** Resolve a widget's rect: an explicit `at` stack, else the ambient layout
 *  (unless the caller pinned x/y), else absolute coordinates. `autoW` is the
 *  widget's natural main-axis size (e.g. a button's label width). */
function place(
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
  /** Inner padding in px. Default 0 (8 for `group`/`panel`). */
  pad?: number;
  /** Main-axis alignment within the container's own slot when nested. */
  align?: "start" | "end";
}

// Run `children` with a fresh layout cursor over `rect`'s interior. The
// cursor is also handed to the callback (egui style) so children can anchor
// popovers/spinners to `.last` or read `.extent`.
function runContainer<R>(
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
function containerRect(
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
function layoutArgs<R>(
  a: LayoutOptions | LayoutChildren<R>,
  b?: LayoutChildren<R>,
): [LayoutOptions, LayoutChildren<R>] {
  return typeof a === "function" ? [{}, a] : [a, b as LayoutChildren<R>];
}

/** Lay children out left-to-right. Root call needs an explicit rect; nested
 *  calls reserve a slot from the enclosing container (full parent height, a
 *  declared width, or `h` as the row's own height in a column parent). The
 *  callback receives the cursor and returns whatever you return — a nested
 *  button's `clicked` bubbles straight out:
 *
 *    UI.row(() => {
 *      if (UI.button({ label: "Play" })) start();   // auto-flows, auto-width
 *      UI.button({ label: "Options" });
 *    }); */
export function row<R>(children: LayoutChildren<R>): R;
export function row<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function row<R>(a: LayoutOptions | LayoutChildren<R>, b?: LayoutChildren<R>): R {
  const [opts, children] = layoutArgs(a, b);
  const rect = containerRect("row", opts);
  return runContainer("row", rect, opts.gap ?? 8, opts.pad ?? 0, opts.align ?? "start", children);
}

/** Lay children out top-to-bottom. See `row`. */
export function col<R>(children: LayoutChildren<R>): R;
export function col<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
export function col<R>(a: LayoutOptions | LayoutChildren<R>, b?: LayoutChildren<R>): R {
  const [opts, children] = layoutArgs(a, b);
  const rect = containerRect("col", opts);
  return runContainer("col", rect, opts.gap ?? 8, opts.pad ?? 0, opts.align ?? "start", children);
}

/** A `group` is a bordered/optionally-titled box that also lays its children
 *  out (a column by default). Combines `panel` + `col` in one call. */
export interface GroupOptions extends LayoutOptions {
  title?: string;
  dir?: "row" | "col";
  bg?: string;
  border?: string;
}

export function group<R>(opts: GroupOptions, children: LayoutChildren<R>): R {
  const dir = opts.dir ?? "col";
  const rect = containerRect(dir, opts);
  panel({
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    title: opts.title,
    bg: opts.bg,
    border: opts.border,
  });
  const top = opts.title ? 34 : 0;
  const body = { x: rect.x, y: rect.y + top, w: rect.w, h: rect.h - top };
  return runContainer(dir, body, opts.gap ?? 8, opts.pad ?? 8, opts.align ?? "start", children);
}

/** Insert extra spacing before the next child in the current layout. */
export function spacer(px: number): void {
  currentLayout()?.gap(px);
}

/** Clip drawing to `rect` for the duration of `children` — for scrollable
 *  lists and masked regions, so a screen never hand-rolls save/clip/restore.
 *  Returns the callback's value. */
export function clip<R>(
  rect: { x: number; y: number; w: number; h: number },
  children: () => R,
): R {
  const ctx = uiCtx();
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 0);
  ctx.clip();
  try {
    return children();
  } finally {
    ctx.restore();
  }
}

// ---------- Shared input (overlay capture + hover cursor) ----------

// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
let overlaySeen = false; // an overlay ran this frame
let overlayActive = false; // an overlay ran last frame → block the background
let inOverlayPass = false; // the rest of the frame belongs to the overlay

const DEAD_POINTER = { x: -1e9, y: -1e9, down: false, released: false, pressed: false, wheel: 0 };

/** The pointer, raw — overlays themselves read this (their close logic must
 *  see clicks even while they block everyone else). */
function rawPointer() {
  return {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
    pressed: Pointer.framePressed,
    wheel: Pointer.wheel,
  };
}

/** The pointer as widgets see it: frame-scoped edges, and dead while an
 *  overlay has the screen (unless we're in the overlay's own pass). Falls
 *  back to a dead pointer when there's no default game yet (headless/tests),
 *  so widgets still render, they just don't interact. */
function uiPointer() {
  ensureWired(); // per-frame housekeeping keeps overlay/tooltip state honest
  if (overlayActive && !inOverlayPass) return DEAD_POINTER;
  try {
    return rawPointer();
  } catch {
    return DEAD_POINTER;
  }
}

/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
function hoverCursor(hover: boolean): void {
  if (hover) Loop.setCursor("pointer");
}

// ---------- Flex (layout) ----------

/** A size in a `FlexSpec`: fixed px, or a function of a text measurer —
 *  content-fit sizing without a second pass:
 *
 *    filters: { w: (m) => m.text("FILTERS (0)") + 28 } */
export type FlexSize = number | ((m: { text(s: string, font?: string): number }) => number);

/** One node in a `flex()` layout tree. In a row, `w` is the main-axis size
 *  and `h` the cross-axis size (swapped in a column). Give a node a fixed
 *  main size, or a `flex` share of the leftover; omit both for `flex: 1`.
 *  A node with `children` is a nested container. */
export interface FlexSpec {
  /** Fixed width in px (or a measure fn). Cross-axis: omit to fill. */
  w?: FlexSize;
  /** Fixed height in px (or a measure fn). Cross-axis: omit to fill. */
  h?: FlexSize;
  /** Share of the leftover main-axis space (flex-grow). Default 1 when no
   *  fixed main size is given. */
  flex?: number;
  /** Container: main axis for the children. Default `"col"`. */
  dir?: "row" | "col";
  /** Container: gap between children in px. Default 0. */
  gap?: number;
  /** Container: inner padding in px. Default 0. */
  pad?: number;
  /** Container: named children, laid out in order. */
  children?: Record<string, FlexSpec>;
}

/** Flexbox, minus the parts a game HUD doesn't need (wrap, shrink,
 *  per-item alignment): split a box into named regions — fixed sizes keep
 *  theirs, `flex` shares divide the leftover — and get back one flat map of
 *  rects (nested names must be unique). Recompute per frame from the live
 *  viewport and resize comes free:
 *
 *    const L = UI.flex({ x: 0, y: 0, w: vp.w, h: vp.h }, {
 *      dir: "col", pad: 12, gap: 8,
 *      children: {
 *        toolbar: { h: 30 },
 *        body: { flex: 1, dir: "row", gap: 4, children: {
 *          list: { flex: 1 }, scroll: { w: 10 },
 *        }},
 *        footer: { h: 40 },
 *      },
 *    });
 *    UI.scrollbar(ctx, { ...L.scroll, view: L.scroll.h, ... });
 *
 *  Rects feed straight into widgets (they all take x/y/w/h). For toolbars of
 *  label-sized widgets, use a `stack` inside a flex rect instead. */
export function flex(
  box: { x: number; y: number; w: number; h: number },
  spec: FlexSpec,
  out: Record<string, { x: number; y: number; w: number; h: number }> = {},
): Record<string, { x: number; y: number; w: number; h: number }> {
  const dir = spec.dir ?? "col";
  const gap = spec.gap ?? 0;
  const pad = spec.pad ?? 0;
  const inner = {
    x: box.x + pad,
    y: box.y + pad,
    w: Math.max(0, box.w - pad * 2),
    h: Math.max(0, box.h - pad * 2),
  };
  const kids = Object.entries(spec.children ?? {});
  const main = dir === "row" ? inner.w : inner.h;

  // Measure-fn sizes resolve against the implicit ctx (content-fit).
  const measurer = { text: (s: string, font?: string) => textWidth(s, font) };
  const resolve = (s: FlexSize | undefined): number | undefined =>
    typeof s === "function" ? s(measurer) : s;

  let fixed = gap * Math.max(0, kids.length - 1);
  let shares = 0;
  for (const [, k] of kids) {
    const size = resolve(dir === "row" ? k.w : k.h);
    if (size !== undefined) fixed += size;
    else shares += k.flex ?? 1;
  }
  const leftover = Math.max(0, main - fixed);

  let cursor = dir === "row" ? inner.x : inner.y;
  for (const [name, k] of kids) {
    const fixedMain = resolve(dir === "row" ? k.w : k.h);
    const size = fixedMain ?? (shares > 0 ? (leftover * (k.flex ?? 1)) / shares : 0);
    const rect =
      dir === "row"
        ? { x: cursor, y: inner.y, w: size, h: resolve(k.h) ?? inner.h }
        : { x: inner.x, y: cursor, w: resolve(k.w) ?? inner.w, h: size };
    out[name] = rect;
    cursor += size + gap;
    if (k.children) flex(rect, k, out);
  }
  return out;
}

// ---------- Floating text ----------

/** Options for a floating text. */
export interface FloatOptions {
  /** Rise speed in px/s (negative = up). Default -50. */
  vy?: number;
  /** Lifetime in ms. Default 900. */
  life?: number;
  /** Fill color. Default "#fff". */
  color?: string;
  /** Font. Default "bold 14px monospace". */
  font?: string;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  remaining: number;
  color: string;
  font: string;
}

/** A pool of rising, fading texts. Pure — drive `advance(dt)` yourself (the
 *  `UI` facade wires it to the fixed step for you). */
export interface FloatManager {
  spawn(text: string, x: number, y: number, opts?: FloatOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  clear(): void;
  readonly size: number;
}

export function createFloats(): FloatManager {
  const texts: FloatText[] = [];
  return {
    spawn(text, x, y, opts = {}) {
      texts.push({
        text,
        x,
        y,
        vy: opts.vy ?? -50,
        life: opts.life ?? 900,
        remaining: opts.life ?? 900,
        color: opts.color ?? "#fff",
        font: opts.font ?? "bold 14px monospace",
      });
    },

    advance(dt) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.remaining -= dt;
        if (t.remaining <= 0) {
          texts.splice(i, 1);
          continue;
        }
        t.y += (t.vy * dt) / 1000;
      }
    },

    draw(ctx) {
      if (texts.length === 0) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of texts) {
        // Full strength, then fade out over the last half of the lifetime.
        ctx.globalAlpha = Math.min(1, (2 * t.remaining) / t.life);
        ctx.fillStyle = t.color;
        ctx.font = t.font;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    },

    clear() {
      texts.length = 0;
    },

    get size() {
      return texts.length;
    },
  };
}

// ---------- Text ----------

/** A themed text label. */
export interface TextOptions {
  /** Position. In a layout, omit and it flows like any widget (reserving a
   *  slot the width of the text, the row's height / a `size`-tall line). */
  x?: number;
  y?: number;
  /** Slot sizing overrides when placed in a layout. */
  w?: number;
  h?: number;
  at?: Stack;
  /** Font size in px. Default `theme.fontSize`. */
  size?: number;
  /** Bold. Default false. */
  bold?: boolean;
  /** Full font string — overrides `size`/`bold`/theme font entirely. */
  font?: string;
  /** Color. `"dim"` / `"accent"` map to theme roles; any CSS color works.
   *  Default `theme.text`. */
  color?: string;
  /** Horizontal alignment within the slot. Default `"left"`. */
  align?: "left" | "center" | "right";
  /** Clamp width (px) — the glyphs squeeze rather than spill. In a layout the
   *  slot width is used automatically. */
  maxWidth?: number;
}

function resolveColor(c: string | undefined): string {
  if (c === "dim") return theme.textDim;
  if (c === "accent") return theme.accent;
  return c ?? theme.text;
}

/** Draw a line of themed text. Uses the theme font/size/color so a screen
 *  never has to touch `ctx.font`/`fillText` itself; flows in a layout or
 *  positions absolutely:
 *
 *    UI.text("Score: 42", { x: 12, y: 12, bold: true });
 *    UI.text(name, { color: "dim", align: "right", w: col.w }); */
export function text(str: string, opts?: TextOptions): void;
export function text(ctx: CanvasRenderingContext2D, str: string, opts?: TextOptions): void;
export function text(
  a: CanvasRenderingContext2D | string,
  b?: string | TextOptions,
  c?: TextOptions,
): void {
  const [ctx, str, opts] =
    typeof a === "string" ? [uiCtx(), a, (b as TextOptions) ?? {}] : [a, b as string, c ?? {}];
  ctx.save();
  ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize, opts.bold ?? false);
  const natural = Math.ceil(ctx.measureText(str).width);
  const lineH = (opts.size ?? theme.fontSize) + 6;
  const rect = place(opts, natural, opts.h ?? lineH);
  const align = opts.align ?? "left";
  ctx.fillStyle = resolveColor(opts.color);
  ctx.textAlign = align;
  const tx =
    align === "center" ? rect.x + rect.w / 2 : align === "right" ? rect.x + rect.w : rect.x;
  const maxW =
    opts.maxWidth ?? (opts.w !== undefined || currentLayout() || opts.at ? rect.w : undefined);
  centeredText(ctx, str, tx, rect.y + rect.h / 2, maxW);
  ctx.restore();
}

// ---------- Button ----------

/** Button look. `"default"` is the neutral filled button; `"primary"` fills
 *  with the theme accent (calls to action); `"danger"` fills red (destructive
 *  actions); `"ghost"` is text-only with no fill/border until hovered. */
export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** Style knobs for `button()`. Every color defaults from the theme. */
export interface ButtonStyle {
  font?: string;
  /** Preset look — see `ButtonVariant`. Default `"default"`. */
  variant?: ButtonVariant;
  /** Label color. */
  color?: string;
  /** Fill when idle / hovered / held down. */
  bg?: string;
  bgHover?: string;
  bgActive?: string;
  /** Corner radius override (px). Defaults to `theme.radius`. */
  radius?: number;
}

/** A button's geometry + label. Position it yourself (`x`/`y` required,
 *  `w` optional — auto-sized to the label when omitted), or hand it a
 *  layout `Stack` via `at` and skip the geometry entirely. */
export interface ButtonOptions extends ButtonStyle {
  x?: number;
  y?: number;
  /** Omit to auto-size to the label (+ padding). */
  w?: number;
  h?: number;
  label: string;
  /** Place in this layout stack — supplies x/y (and h); auto width. */
  at?: Stack;
  /** Grayed out and unclickable. */
  disabled?: boolean;
  /** Shown near the pointer after hovering a moment (see `drawTips`). Works
   *  on disabled buttons too — the place to say WHY it's disabled. */
  tooltip?: string;
}

/** Resolve a variant into (idle, hover, active) fills, border and label
 *  colors — mixing in the theme and any per-button overrides. */
// Nudge a color toward black/white without parsing it — CSS color-mix is
// understood by canvas fillStyle in every browser we target.
const shade = (c: string, dark: boolean) =>
  `color-mix(in srgb, ${c} ${dark ? 82 : 88}%, ${dark ? "#000" : "#fff"})`;

function variantColors(opts: ButtonStyle): {
  bg: string;
  bgHover: string;
  bgActive: string;
  border: string;
  label: string;
} {
  const v = opts.variant ?? "default";
  let base;
  if (v === "primary") {
    base = { bg: theme.primary, label: theme.bgActive, border: theme.primary };
  } else if (v === "danger") {
    base = { bg: theme.danger, label: theme.text, border: theme.danger };
  } else if (v === "ghost") {
    base = { bg: "transparent", label: theme.text, border: "transparent" };
  } else {
    base = { bg: theme.bg, label: theme.text, border: theme.border };
  }
  const solid = v === "primary" || v === "danger";
  return {
    bg: opts.bg ?? base.bg,
    bgHover: opts.bgHover ?? (v === "ghost" ? theme.bgHover : shade(base.bg, false)),
    bgActive: opts.bgActive ?? (solid ? shade(base.bg, true) : theme.bgActive),
    border: base.border,
    label: opts.color ?? base.label,
  };
}

/** The interaction state `button()` derives from a pointer. Pure — exported
 *  for tests and for custom-drawn buttons that want the logic without the
 *  default look. */
export function buttonState(
  rect: { x: number; y: number; w: number; h: number },
  pointer: { x: number; y: number; down: boolean; released: boolean },
): { hover: boolean; active: boolean; clicked: boolean } {
  const hover = pointInRect(pointer.x, pointer.y, rect);
  return { hover, active: hover && pointer.down, clicked: hover && pointer.released };
}

/** Draw an immediate-mode button and report whether it was clicked this
 *  frame. Call it every frame from `draw` — there is no retained widget:
 *
 *    if (UI.button(ctx, { x, y, w: 160, h: 44, label: "PLAY" })) start();
 *
 *  Hit-testing uses the polled `Pointer` in canvas coordinates — draw the
 *  button untransformed (outside camera/letterbox transforms). */
export function button(opts: ButtonOptions): boolean;
export function button(ctx: CanvasRenderingContext2D, opts: ButtonOptions): boolean;
export function button(a: CanvasRenderingContext2D | ButtonOptions, b?: ButtonOptions): boolean {
  const [ctx, opts] = withCtx(a, b);
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize + 2, true);
  // Auto width: the label plus comfortable padding.
  const w = opts.w ?? Math.ceil(ctx.measureText(opts.label).width) + theme.buttonPadX;
  const rect = place(opts, w, opts.h ?? 30);

  const p = uiPointer();
  const over = pointInRect(p.x, p.y, rect);
  if (over && opts.tooltip) tooltip(opts.tooltip);
  const { hover, active, clicked } = opts.disabled
    ? { hover: false, active: false, clicked: false }
    : buttonState(rect, p);
  hoverCursor(hover);

  const c = variantColors(opts);
  const fill = opts.disabled ? theme.bgActive : active ? c.bgActive : hover ? c.bgHover : c.bg;
  // Hover lifts the border to the accent, except on filled variants (their
  // border already matches the fill — an accent ring would clash).
  const filled = c.bg !== "transparent" && c.border === c.bg;
  const stroke =
    c.border === "transparent" && !hover ? undefined : hover && !filled ? theme.accent : c.border;
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: fill === "transparent" ? undefined : fill,
    stroke,
    radius: opts.radius,
  });
  ctx.fillStyle = opts.disabled ? theme.textDisabled : c.label;
  ctx.textAlign = "center";
  centeredText(
    ctx,
    opts.label,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2 + (active ? 1 : 0),
    rect.w - 12, // labels squeeze rather than spill
  );
  ctx.restore();

  return clicked;
}

// ---------- Panel ----------

/** A framed box with an optional title strip — visual grouping for menus,
 *  dialogs and HUD clusters. Purely decorative; it captures no input. */
export interface PanelOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  bg?: string;
  border?: string;
  titleColor?: string;
  font?: string;
}

export function panel(opts: PanelOptions): void;
export function panel(ctx: CanvasRenderingContext2D, opts: PanelOptions): void;
export function panel(a: CanvasRenderingContext2D | PanelOptions, b?: PanelOptions): void {
  const [ctx, opts] = withCtx(a, b);
  ctx.save();
  drawBox(ctx, opts.x, opts.y, opts.w, opts.h, {
    fill: opts.bg ?? theme.panelBg,
    stroke: opts.border ?? theme.border,
  });
  if (opts.title) {
    // Title strip clipped to the panel's rounded top so it doesn't poke past
    // the corners.
    ctx.save();
    roundRectPath(ctx, opts.x, opts.y, opts.w, opts.h, theme.radius);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(opts.x + 2, opts.y + 2, opts.w - 4, 30);
    ctx.restore();
    ctx.fillStyle = opts.titleColor ?? theme.accent;
    ctx.font = opts.font ?? uiFont(theme.fontSize + 1, true);
    ctx.textAlign = "left";
    centeredText(ctx, opts.title, opts.x + 12, opts.y + 17, opts.w - 24);
  }
  ctx.restore();
}

// ---------- Toggle ----------

/** A labeled checkbox. */
export interface ToggleOptions {
  x?: number;
  y?: number;
  /** Slot height when placed in a layout (the box centers within it). */
  h?: number;
  label: string;
  /** Current value — pass your state in, assign the return value back. */
  on: boolean;
  /** Place in this layout stack — supplies x/y; width is the box + label. */
  at?: Stack;
  size?: number;
  font?: string;
  color?: string;
  /** Shown near the pointer after hovering a moment (see `drawTips`). */
  tooltip?: string;
}

/** Draw a checkbox + label; returns the (possibly flipped) new value:
 *
 *    hideFull = UI.toggle(ctx, { x, y, label: "Hide full", on: hideFull }); */
export function toggle(opts: ToggleOptions): boolean;
export function toggle(ctx: CanvasRenderingContext2D, opts: ToggleOptions): boolean;
export function toggle(a: CanvasRenderingContext2D | ToggleOptions, b?: ToggleOptions): boolean {
  const [ctx, opts] = withCtx(a, b);
  const size = opts.size ?? 16;
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelW = ctx.measureText(opts.label).width;
  const w = size + 8 + Math.ceil(labelW);
  // Hit region spans box + label, so the text is clickable too. Placed via a
  // layout, the box is vertically centered on the taller slot.
  const slot = place({ x: opts.x, y: opts.y, w, h: opts.h, at: opts.at }, w, size);
  const rect = { x: slot.x, y: slot.y + Math.max(0, (slot.h - size) / 2), w, h: size };
  const { hover, clicked } = buttonState(rect, uiPointer());
  hoverCursor(hover);
  if (hover && opts.tooltip) tooltip(opts.tooltip);
  const on = clicked ? !opts.on : opts.on;

  // Checkbox radius scales down with the theme so a big radius doesn't turn
  // the little box into a circle.
  const boxR = Math.min(theme.radius, 4);
  drawBox(ctx, rect.x, rect.y, size, size, {
    fill: theme.bgActive,
    stroke: hover ? theme.accent : theme.border,
    radius: boxR,
  });
  if (on) {
    drawBox(ctx, rect.x + 4, rect.y + 4, size - 8, size - 8, {
      fill: theme.accent,
      radius: Math.max(0, boxR - 2),
    });
  }
  ctx.fillStyle = opts.color ?? theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, opts.label, rect.x + size + 8, rect.y + size / 2);
  ctx.restore();
  return on;
}

// ---------- Tabs ----------

/** A horizontal tab strip. */
export interface TabsOptions {
  x?: number;
  y?: number;
  /** Total width, split equally between the tabs. Omit to auto-size every
   *  cell to the widest label. */
  w?: number;
  h?: number;
  items: string[];
  /** Current tab index — pass your state in, assign the return value back. */
  active: number;
  /** Place in this layout stack — supplies x/y (and h); auto width. */
  at?: Stack;
  font?: string;
}

/** Draw a tab strip; returns the (possibly changed) active index:
 *
 *    tab = UI.tabs(ctx, { x, y, items: ["All", "Coop", "PvP"], active: tab }); */
export function tabs(opts: TabsOptions): number;
export function tabs(ctx: CanvasRenderingContext2D, opts: TabsOptions): number;
export function tabs(a: CanvasRenderingContext2D | TabsOptions, b?: TabsOptions): number {
  const [ctx, opts] = withCtx(a, b);
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize, true);
  // Auto width: equal cells sized to the widest label.
  const w =
    opts.w ??
    (Math.ceil(Math.max(...opts.items.map((t) => ctx.measureText(t).width))) + 26) *
      opts.items.length;
  const rect = place(opts, w, opts.h ?? 30);
  const cellW = rect.w / opts.items.length;
  const p = uiPointer();
  let active = opts.active;
  ctx.textAlign = "center";
  // Round only the strip's outer corners: clip the whole strip, fill cells
  // square inside it.
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius);
  ctx.clip();
  opts.items.forEach((label, i) => {
    const x = rect.x + i * cellW;
    const { hover, clicked } = buttonState({ x, y: rect.y, w: cellW, h: rect.h }, p);
    hoverCursor(hover);
    if (clicked) active = i;
    const isActive = i === active;
    ctx.fillStyle = isActive ? theme.bg : hover ? theme.bgHover : theme.bgActive;
    ctx.fillRect(x, rect.y, cellW - 2, rect.h);
    if (isActive) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x, rect.y + rect.h - 3, cellW - 2, 3);
    }
    ctx.fillStyle = isActive ? theme.text : theme.textDim;
    centeredText(ctx, label, x + cellW / 2, rect.y + rect.h / 2, cellW - 10);
  });
  ctx.restore();
  ctx.restore();
  return active;
}

// ---------- List item ----------

/** A selectable list row (a table/menu entry — not to be confused with the
 *  `row` layout container). */
export interface ListItemOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  selected?: boolean;
  bg?: string;
  bgHover?: string;
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
  a: CanvasRenderingContext2D | ListItemOptions,
  b?: ListItemOptions,
): boolean {
  const [ctx, opts] = withCtx(a, b);
  const { hover, clicked } = buttonState(opts, uiPointer());
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
  return clicked;
}

// ---------- Slider ----------

/** A horizontal value slider. */
export interface SliderOptions {
  x: number;
  y: number;
  w: number;
  /** Value range. Default 0..1. */
  min?: number;
  max?: number;
  /** Current value — pass your state in, assign the return value back. */
  value: number;
  /** Snap increment (e.g. 5). Default continuous. */
  step?: number;
  /** Caption drawn left of the track. */
  label?: string;
  /** Value text drawn right of the track. Default the rounded value. */
  format?: (v: number) => string;
  /** Identity for drag tracking across frames. Defaults to the position. */
  id?: string;
  font?: string;
  color?: string;
}

// One slider drag at a time, tracked across frames by id.
let sliderDrag: string | null = null;

/** Draw a slider and return the (possibly changed) new value — drag the knob
 *  or click anywhere on the track:
 *
 *    volume = UI.slider(ctx, { x, y, w: 140, value: volume, label: "VOL" }); */
export function slider(opts: SliderOptions): number;
export function slider(ctx: CanvasRenderingContext2D, opts: SliderOptions): number;
export function slider(a: CanvasRenderingContext2D | SliderOptions, b?: SliderOptions): number {
  const [ctx, opts] = withCtx(a, b);
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const knobR = 7;
  const p = uiPointer();
  // Generous hit region: the whole track strip, knob included.
  const hit = { x: opts.x - knobR, y: opts.y - knobR, w: opts.w + knobR * 2, h: knobR * 2 };
  const hover = pointInRect(p.x, p.y, hit);
  hoverCursor(hover || sliderDrag === id);

  if (!p.down) sliderDrag = null;
  if (p.pressed && hover && !sliderDrag) sliderDrag = id;

  let value = Math.max(min, Math.min(max, opts.value));
  if (sliderDrag === id) {
    value = min + ((p.x - opts.x) / opts.w) * (max - min);
    if (opts.step) value = Math.round(value / opts.step) * opts.step;
    value = Math.max(min, Math.min(max, value));
  }
  const knobX = opts.x + ((value - min) / (max - min || 1)) * opts.w;

  ctx.save();
  ctx.font = opts.font ?? uiFont();
  if (opts.label) {
    ctx.fillStyle = opts.color ?? theme.text;
    ctx.textAlign = "right";
    centeredText(ctx, opts.label, opts.x - 10, opts.y);
  }
  ctx.fillStyle = theme.track;
  ctx.fillRect(opts.x, opts.y - 2, opts.w, 4);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(opts.x, opts.y - 2, knobX - opts.x, 4);
  ctx.beginPath();
  ctx.arc(knobX, opts.y, knobR, 0, Math.PI * 2);
  ctx.fillStyle = sliderDrag === id || hover ? theme.accent : theme.accentSoft;
  ctx.fill();
  ctx.fillStyle = opts.color ?? theme.text;
  ctx.textAlign = "left";
  const valueText = opts.format ? opts.format(value) : `${Math.round(value)}`;
  centeredText(ctx, valueText, opts.x + opts.w + 12, opts.y);
  ctx.restore();
  return value;
}

// ---------- Spinner ----------

/** Style knobs for `spinner()`. */
export interface SpinnerOptions {
  r?: number;
  color?: string;
  lineWidth?: number;
}

/** A rotating "busy" arc for in-flight work (loading, refreshing). Advances
 *  on the fixed step, so it pauses with the loop:
 *
 *    if (refreshing) UI.spinner(ctx, x, y); */
export function spinner(x: number, y: number, opts?: SpinnerOptions): void;
export function spinner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts?: SpinnerOptions,
): void;
export function spinner(
  a: CanvasRenderingContext2D | number,
  b: number,
  c?: number | SpinnerOptions,
  d?: SpinnerOptions,
): void {
  const [ctx, x, y, opts] =
    typeof a === "number"
      ? [uiCtx(), a, b, (c as SpinnerOptions) ?? {}]
      : [a, b, c as number, d ?? {}];
  ensureWired(); // the shared step hook advances the angle
  ctx.save();
  ctx.strokeStyle = opts.color ?? theme.accent;
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.beginPath();
  ctx.arc(x, y, opts.r ?? 8, spinAngle, spinAngle + Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
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

// ---------- Bar ----------

/** Style knobs for `bar()`. */
export interface BarStyle {
  /** Track color behind the fill. */
  bg?: string;
  /** Fill color. */
  fill?: string;
}

/** A horizontal meter (health, progress, charge): a track with `frac` (0..1,
 *  clamped) of it filled from the left. */
export function bar(
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style?: BarStyle,
): void;
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style?: BarStyle,
): void;
export function bar(
  a: CanvasRenderingContext2D | number,
  b: number,
  c: number,
  d: number,
  e: number,
  f2?: number | BarStyle,
  g?: BarStyle,
): void {
  const [ctx, x, y, w, h, frac, style] =
    typeof a === "number"
      ? [uiCtx(), a, b, c, d, e, (f2 as BarStyle) ?? {}]
      : [a, b, c, d, e, f2 as number, g ?? {}];
  const f = Math.max(0, Math.min(1, frac));
  const r = Math.min(theme.radius, h / 2);
  ctx.save();
  drawBox(ctx, x, y, w, h, { fill: style.bg ?? "rgba(255,255,255,0.15)", radius: r });
  if (f > 0) {
    // Clip the fill to the rounded track so the corners stay round even at a
    // partial fill.
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = style.fill ?? theme.accent;
    ctx.fillRect(x, y, w * f, h);
  }
  ctx.restore();
}

// ---------- Popover ----------

/** An anchored floating panel (dropdown, filter flyout). */
export interface PopoverOptions extends PanelOptions {
  /** Open state — pass yours in, assign the return value back. */
  open: boolean;
  /** Identity across frames. Defaults to the position. */
  id?: string;
}

// Whether each popover was open LAST frame — the click that opens one lands
// outside its rect and must not immediately close it again.
const popoverWasOpen = new Map<string, boolean>();

/** Draw a popover panel while open; a click anywhere outside closes it (and
 *  is swallowed — it can't also activate whatever sits underneath). While
 *  open, the popover is an overlay: every widget drawn BEFORE it in the
 *  frame goes input-dead; widgets drawn after (its contents) work normally.
 *  Returns the new open state:
 *
 *    if (UI.button(trigger)) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover({ x, y, w: 240, h: 120, open: filtersOpen });
 *    if (filtersOpen) { ...toggles/sliders at x/y... } */
export function popover(opts: PopoverOptions): boolean;
export function popover(ctx: CanvasRenderingContext2D, opts: PopoverOptions): boolean;
export function popover(a: CanvasRenderingContext2D | PopoverOptions, b?: PopoverOptions): boolean {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const was = popoverWasOpen.get(id) ?? false;
  let open = opts.open;
  // Raw pointer: while open we're the overlay — uiPointer would be dead.
  const p = rawPointer();
  if (open && was && p.released && !pointInRect(p.x, p.y, opts)) open = false;
  popoverWasOpen.set(id, open);
  if (open) {
    overlaySeen = true;
    inOverlayPass = true; // contents drawn after this call get live input
    panel(ctx, opts);
  }
  return open;
}

// ---------- Modal ----------

/** A centered dialog over a dimmed backdrop. */
export interface ModalOptions {
  w: number;
  h: number;
  title?: string;
}

/** Dim the whole screen and open a centered panel. Returns the panel rect —
 *  draw the dialog contents (text, buttons) inside it after the call. While
 *  a modal is up, every widget drawn BEFORE it in the frame ignores the
 *  pointer, so clicks can't land through the backdrop; widgets drawn after
 *  (the dialog's own) work normally. Call it LAST in your draw. For the
 *  common title/lines/buttons dialog, `confirm()` does all of this for you:
 *
 *    if (confirming) {
 *      const r = UI.modal({ w: 340, h: 150, title: "CONFIRM" });
 *      if (UI.button({ x: r.x + 12, ... label: "OK" })) { ... }
 *    } */
export function modal(opts: ModalOptions): { x: number; y: number; w: number; h: number };
export function modal(
  ctx: CanvasRenderingContext2D,
  opts: ModalOptions,
): { x: number; y: number; w: number; h: number };
export function modal(
  a: CanvasRenderingContext2D | ModalOptions,
  b?: ModalOptions,
): { x: number; y: number; w: number; h: number } {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  overlaySeen = true;
  inOverlayPass = true;
  const vp = Stage.viewport;
  ctx.save();
  ctx.fillStyle = theme.dim;
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.restore();
  const x = Math.round((vp.w - opts.w) / 2);
  const y = Math.round((vp.h - opts.h) / 2);
  panel(ctx, { x, y, w: opts.w, h: opts.h, title: opts.title });
  return { x, y, w: opts.w, h: opts.h };
}

// ---------- Confirm (declarative dialog) ----------

/** A whole dialog in one call. */
export interface ConfirmOptions {
  title?: string;
  /** Body lines. The first is drawn in the primary text color, the rest
   *  dimmed — lead + detail. */
  lines?: string[];
  /** Button labels, left to right (the last one sits at the right edge —
   *  put the primary action last). Default `["OK"]`. */
  buttons?: string[];
  /** Per-button variants, aligned with `buttons`. Omit an entry for the
   *  default look. E.g. `["default", "danger"]` for a Cancel/Delete pair.
   *  When omitted entirely, the LAST button defaults to `"primary"`. */
  variants?: ButtonVariant[];
  /** Minimum dialog width; it grows to fit the content. Default 300. */
  minW?: number;
}

/** The declarative modal: title, body lines and buttons in one call, sized
 *  to its content. Returns the clicked button's label, or `null`:
 *
 *    if (confirming) {
 *      const hit = UI.confirm({
 *        title: "JOIN SERVER",
 *        lines: [server.name, details],
 *        buttons: ["CANCEL", "JOIN"],
 *      });
 *      if (hit === "JOIN") join(server);
 *      if (hit) confirming = null;
 *    } */
export function confirm(opts: ConfirmOptions): string | null;
export function confirm(ctx: CanvasRenderingContext2D, opts: ConfirmOptions): string | null;
export function confirm(
  a: CanvasRenderingContext2D | ConfirmOptions,
  b?: ConfirmOptions,
): string | null {
  const [ctx, opts] = withCtx(a, b);
  const lines = opts.lines ?? [];
  const buttons = opts.buttons ?? ["OK"];
  const lineH = theme.fontSize + 8;

  // Size to content: widest of title, lines, and the button row.
  ctx.save();
  ctx.font = uiFont(theme.fontSize + 2, true);
  const buttonsW = buttons.reduce(
    (sum, l) => sum + Math.ceil(ctx.measureText(l).width) + 28 + 8,
    0,
  );
  ctx.font = uiFont(theme.fontSize + 1, true);
  const titleW = opts.title ? Math.ceil(ctx.measureText(opts.title).width) : 0;
  ctx.font = uiFont();
  const lineW = Math.ceil(Math.max(0, ...lines.map((l) => ctx.measureText(l).width)));
  ctx.restore();
  const w = Math.max(opts.minW ?? 300, lineW + 32, buttonsW + 24, titleW + 24);
  const h = (opts.title ? 30 : 0) + 16 + lines.length * lineH + 16 + 34 + 12;

  const r = modal(ctx, { w, h, title: opts.title });

  ctx.save();
  ctx.font = uiFont();
  ctx.textAlign = "left";
  let ty = r.y + (opts.title ? 30 : 0) + 16 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? theme.text : theme.textDim;
    centeredText(ctx, line, r.x + 16, ty);
    ty += lineH;
  });
  ctx.restore();

  // Buttons right-aligned; array order reads left → right. Without explicit
  // variants, the last (rightmost, primary-action) button goes accent.
  const variantFor = (i: number): ButtonVariant =>
    opts.variants?.[i] ?? (i === buttons.length - 1 ? "primary" : "default");
  const btnBar = stack({ x: r.x + r.w - 12, y: r.y + r.h - 46, gap: 8, h: 34, align: "end" });
  let hit: string | null = null;
  for (let i = buttons.length - 1; i >= 0; i--) {
    if (button(ctx, { at: btnBar, label: buttons[i], variant: variantFor(i), h: 34 })) {
      hit = buttons[i];
    }
  }
  return hit;
}

// ---------- Tooltip ----------

let tipRequest: string | null = null; // asked for this frame
let tipShown: { text: string; since: number } | null = null; // hover-stable

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(msg: string): void {
  ensureWired();
  tipRequest = msg;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloats`, after any modal) so it sits on top. */
export function drawTips(maybeCtx?: CanvasRenderingContext2D): void {
  const ctx = maybeCtx ?? uiCtx();
  if (!tipShown || performance.now() - tipShown.since < 350) return;
  const msg = tipShown.text;
  const vp = Stage.viewport;
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(msg).width + 16;
  const h = 24;
  let x = Pointer.x + 14;
  let y = Pointer.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = Pointer.y - 8 - h;
  drawBox(ctx, x, y, w, h, {
    fill: theme.panelBg,
    stroke: theme.border,
    border: 1,
    radius: Math.min(theme.radius, 6),
  });
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, msg, x + 8, y + h / 2);
  ctx.restore();
}

// ---------- Default facade (aged by the default Loop's fixed step) ----------

let floats = createFloats();
let spinAngle = 0;
let wired = false;

function ensureWired(): void {
  if (wired) return;
  // Registering the loop hooks needs the default game; without one
  // (headless/tests) the calls throw — stay unwired and retry next call.
  try {
    Loop.onStep(() => {
      floats.advance(Loop.step);
      spinAngle += 0.12; // ~7 rad/s at 60 steps
    });
    // Frame-end housekeeping for the immediate-mode state machines.
    Loop.onFrame(() => {
      begunCtx = null; // re-begin() each frame when overriding the ctx
      // Overlay capture: what was drawn this frame gates input next frame.
      overlayActive = overlaySeen;
      overlaySeen = false;
      inOverlayPass = false;
      // Tooltip hover-stability: same text keeps its timer; a change restarts.
      if (tipRequest) {
        if (tipShown?.text !== tipRequest) {
          tipShown = { text: tipRequest, since: performance.now() };
        }
      } else {
        tipShown = null;
      }
      tipRequest = null;
    });
    wired = true;
  } catch {
    // no default game yet
  }
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloats`. */
export function float(str: string, x: number, y: number, opts?: FloatOptions): void {
  ensureWired();
  floats.spawn(str, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloats(ctx?: CanvasRenderingContext2D): void {
  floats.draw(ctx ?? uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloats(): void {
  floats.clear();
}

/** Reset floats, theme and Loop wiring — for tests. */
export function _reset(): void {
  floats = createFloats();
  theme = { ...defaultTheme };
  tipRequest = null;
  tipShown = null;
  overlaySeen = false;
  overlayActive = false;
  inOverlayPass = false;
  begunCtx = null;
  wired = false;
}
