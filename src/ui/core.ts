// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, text/select inputs, sliders, scrollbars, panels, popovers,
// modals, dialogue, drag/drop, confirm dialogs and meter bars. Everything draws in YOUR draw phase — no retained
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

import { pointInRect } from "../collision.js";
import { Draw, Loop, Pointer, Stage } from "../engine.js";
// The select dropdown's overlay (drawSelectOverlay, below) renders through the
// panel/button widgets. Call-time only, so this cycle with controls is safe.
import { button, panel } from "./controls.js";

// ---------- Drag state (shared: widgets set it, the frame loop cancels it) ----
export interface ActiveDrag {
  sourceId: string;
  payload: unknown;
  offsetX: number;
  offsetY: number;
}
export let activeDrag: ActiveDrag | null = null;
/** Set/clear the active drag from the dragdrop widgets (they can't reassign an
 *  imported binding). */
export function setActiveDrag(d: ActiveDrag | null): void {
  activeDrag = d;
}
/** Mark that an overlay ran this frame and open its live-input pass — called by
 *  the overlay widgets (popover/modal), which can't reassign the imported flags. */
export function enterOverlay(): void {
  overlaySeen = true;
  focusTrapSeen = true;
  inOverlayPass = true;
}

// ---------- Implicit context ----------

export let begunCtx: CanvasRenderingContext2D | null = null;

/** Point the widgets at a specific context for this frame (isolated games,
 *  offscreen canvases). Without it, everything draws to the default game's
 *  `Draw.ctx`. Cleared at frame end. */
export function begin(ctx: CanvasRenderingContext2D): void {
  begunCtx = ctx;
}

export function uiCtx(): CanvasRenderingContext2D {
  return begunCtx ?? Draw.ctx;
}

/** Untangle the two call forms: `widget(opts)` (implicit ctx) and
 *  `widget(ctx, opts)`. */
export function withCtx<T>(a: CanvasRenderingContext2D | T, b?: T): [CanvasRenderingContext2D, T] {
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
  /** Default inner padding (px) for bordered content containers — the `group`
   *  body inset. Override per call with `pad`. Structural flow containers
   *  (`row`/`col`) intentionally stay flush (pad 0) so widgets align to their
   *  slot edges; use a `group` (or an explicit `pad`) when you want a box that
   *  insets its content. Default 8. */
  pad: number;
  /** Default inset (px) applied by `UI.text` when no `pad`/`padX`/`padY` is
   *  given. 0 keeps a label flush with its slot (so it lines up with sibling
   *  widgets and HUD columns); raise it for a global label inset. Default 0. */
  textPad: number;
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
  pad: 8,
  textPad: 0,
};

export let theme: Theme = { ...defaultTheme };

/** Restyle every widget at once. Overrides are merged over the DEFAULT theme
 *  (not the current one), so two `setTheme` calls don't compound. */
export function setTheme(overrides: Partial<Theme>): void {
  theme = { ...defaultTheme, ...overrides };
}

/** The active theme (live object — read, don't mutate). */
export function getTheme(): Theme {
  return theme;
}

export const uiFont = (size = theme.fontSize, bold = false) =>
  `${bold ? "bold " : ""}${size}px ${theme.font}`;

/** Trace a rounded-rect path (square when `r <= 0`). Radius is clamped to
 *  half the shorter side so small widgets stay sane. */
export function roundRectPath(
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
export function drawBox(
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
export function centeredText(
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

// ---------- Widget identity ----------

export type IdPart = string | number;

/** Build stable readable widget ids without repeating a prefix.
 *
 * ```ts
 * const id = UI.ids("server-browser");
 * UI.button({ id: id("refresh"), label: "REFRESH" });
 * UI.listItem({ id: id("server", server.id), ...rect });
 * ``` */
export function ids(...prefix: IdPart[]): (...parts: IdPart[]) => string {
  const base = prefix.map(String).join(":");
  return (...parts) => [base, ...parts.map(String)].filter(Boolean).join(":");
}

export interface IdScopeState {
  prefix: string;
  next: number;
}

export const idScopes: IdScopeState[] = [];

/** Give otherwise-unidentified interactive widgets automatic, frame-stable
 * ids in callback order. Best for static forms/toolbars. Dynamic or
 * conditional collections should use explicit ids from `UI.ids()` instead.
 * Nested scopes compose their prefixes. */
export function idScope<R>(prefix: IdPart, children: () => R): R {
  const parent = idScopes[idScopes.length - 1];
  const full = parent ? `${parent.prefix}:${prefix}` : String(prefix);
  idScopes.push({ prefix: full, next: 0 });
  try {
    return children();
  } finally {
    idScopes.pop();
  }
}

export function widgetId(explicit: string | undefined, kind: string): string | undefined {
  if (explicit) return explicit;
  const scope = idScopes[idScopes.length - 1];
  return scope ? `${scope.prefix}:${kind}:${scope.next++}` : undefined;
}

export function requiredWidgetId(explicit: string | undefined, kind: string): string {
  const id = widgetId(explicit, kind);
  if (!id) {
    throw new Error(`UI.${kind} requires an id, or must be drawn inside UI.idScope()`);
  }
  return id;
}

// ---------- Shared input (overlay capture + hover cursor) ----------

// While an overlay (modal OR open popover) is up, widgets drawn outside its
// pass must go dead — otherwise a click "through" it still lands on them.
export let overlaySeen = false; // an overlay ran this frame

export let overlayActive = false; // an overlay ran last frame → block the background

export let inOverlayPass = false; // the rest of the frame belongs to the overlay

export interface TextEditor {
  id: string;
  input: HTMLInputElement;
  value: string;
  changed: boolean;
  submitted: boolean;
}

export let textEditor: TextEditor | null = null;

export let textInputSeen: string | null = null;

export interface SelectEditor {
  id: string;
  select: HTMLSelectElement;
  index: number;
  changed: boolean;
  open: boolean;
  justOpened: boolean;
}

export let selectEditor: SelectEditor | null = null;

export let selectSeen: string | null = null;

export interface SelectOverlayRequest<T = unknown> {
  ctx: CanvasRenderingContext2D;
  opts: SelectOptions<T> & { id: string };
  rect: { x: number; y: number; w: number; h: number };
}

export let selectOverlayRequest: SelectOverlayRequest | null = null;

export let selectCommit: { id: string; index: number } | null = null;

// Focusables register in draw order each frame. Keyboard events happen between
// frames, so they operate on the last complete registry rather than a retained
// widget tree.
export interface FocusEntry {
  id: string;
  disabled: boolean;
  overlay: boolean;
  tabIndex: number;
  native: boolean;
  focus?: () => void;
  blur?: () => void;
}

export let focusFrame: FocusEntry[] = [];

export let focusRegistry: FocusEntry[] = [];

export let focusedWidget: string | null = null;

// Mirrors browser :focus-visible behavior: pointer focus remains usable but
// only keyboard traversal paints the dotted focus indicator.
export let focusVisible = false;

export let focusTrapSeen = false;

export let focusOverlayActive = false;

export let focusBeforeOverlay: string | null = null;

export let keyboardActivation: string | null = null;

export let keyboardCommand: { id: string; key: string } | null = null;

export let focusKeyboardWired = false;

export const focusCanvases = new WeakSet<HTMLCanvasElement>();

export function focusCandidates(): FocusEntry[] {
  const entries = focusOverlayActive
    ? focusRegistry.filter((entry) => entry.overlay)
    : focusRegistry;
  return entries
    .filter((entry) => !entry.disabled && entry.tabIndex >= 0)
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => a.entry.tabIndex - b.entry.tabIndex || a.order - b.order)
    .map(({ entry }) => entry);
}

export function setWidgetFocus(id: string | null): void {
  if (focusedWidget === id) return;
  focusRegistry.find((entry) => entry.id === focusedWidget)?.blur?.();
  focusedWidget = id;
  focusRegistry.find((entry) => entry.id === id)?.focus?.();
}

export function moveWidgetFocus(direction: 1 | -1): void {
  const entries = focusCandidates();
  if (!entries.length) return setWidgetFocus(null);
  const current = entries.findIndex((entry) => entry.id === focusedWidget);
  const next =
    current < 0
      ? direction > 0
        ? 0
        : entries.length - 1
      : (current + direction + entries.length) % entries.length;
  setWidgetFocus(entries[next].id);
}

export function wireFocusCanvas(ctx: CanvasRenderingContext2D): void {
  const canvas = ctx.canvas;
  if (focusCanvases.has(canvas)) return;
  focusCanvases.add(canvas);
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  // The canvas is only a browser focus surface; individual canvas widgets
  // paint their own focus-visible state.
  canvas.style.outline = "none";
  canvas.addEventListener("pointerdown", () => {
    focusVisible = false;
  });
  canvas.addEventListener("focus", () => {
    if (!focusedWidget) moveWidgetFocus(1);
  });
}

export function registerFocusable(
  ctx: CanvasRenderingContext2D,
  opts: {
    id?: string;
    disabled?: boolean;
    tabIndex?: number;
    native?: boolean;
    focus?: () => void;
    blur?: () => void;
  },
): boolean {
  if (!opts.id) return false;
  wireFocusCanvas(ctx);
  focusFrame.push({
    id: opts.id,
    disabled: opts.disabled ?? false,
    overlay: inOverlayPass,
    tabIndex: opts.tabIndex ?? 0,
    native: opts.native ?? false,
    focus: opts.focus,
    blur: opts.blur,
  });
  return focusVisible && focusedWidget === opts.id;
}

export function markFocusableOverlay(id: string): void {
  const entry = [...focusFrame].reverse().find((item) => item.id === id);
  if (entry) entry.overlay = true;
}

export function focusFromPointer(ctx: CanvasRenderingContext2D, id: string | undefined): void {
  if (!id) return;
  focusVisible = false;
  focusedWidget = id;
  ctx.canvas.focus({ preventScroll: true });
}

export function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): void {
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = Math.max(2, theme.borderWidth);
  ctx.setLineDash([4, 3]);
  roundRectPath(ctx, rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6, theme.radius + 2);
  ctx.stroke();
  ctx.restore();
}

export function consumeKeyboardActivation(id: string | undefined): boolean {
  if (!id || keyboardActivation !== id) return false;
  keyboardActivation = null;
  return true;
}

export function consumeKeyboardCommand(id: string | undefined): string | null {
  if (!id || keyboardCommand?.id !== id) return null;
  const key = keyboardCommand.key;
  keyboardCommand = null;
  return key;
}

/** Move keyboard focus to a registered widget. */
export function focus(id: string): void {
  if (focusRegistry.some((entry) => entry.id === id && !entry.disabled)) {
    focusVisible = true;
    setWidgetFocus(id);
  }
}

/** Clear canvas-widget keyboard focus. */
export function blur(): void {
  setWidgetFocus(null);
}

/** The currently focused widget id, or `null`. */
export function focusedId(): string | null {
  return focusedWidget;
}

/** Move to the next/previous widget in the most recently drawn tab order. */
export function focusNext(): void {
  moveWidgetFocus(1);
}

export function focusPrevious(): void {
  moveWidgetFocus(-1);
}

export const DEAD_POINTER = {
  x: -1e9,
  y: -1e9,
  down: false,
  released: false,
  pressed: false,
  wheel: 0,
};

/** The pointer, raw — overlays themselves read this (their close logic must
 *  see clicks even while they block everyone else). */
export function rawPointer() {
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
export function uiPointer() {
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
export function hoverCursor(hover: boolean): void {
  if (hover) Loop.setCursor("pointer");
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

export interface FloatText {
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
  /** Inset the text inside its slot, in px. `pad` sets both axes; `padX`/
   *  `padY` override one. Handy for insetting a label from a panel edge.
   *  Defaults to `theme.textPad` (0) when omitted. */
  pad?: number;
  padX?: number;
  padY?: number;
  /** Word-wrap to multiple lines within the available width instead of
   *  squeezing one line to fit. The lines are stacked and vertically centered
   *  in the slot — give the slot enough `h` for them (≈ `size + 6` per line). */
  wrap?: boolean;
  /** Clamp width (px) for a single line — the glyphs squeeze rather than
   *  spill. In a layout the slot width is used automatically (unless `wrap`). */
  maxWidth?: number;
}

export function resolveColor(c: string | undefined): string {
  if (c === "dim") return theme.textDim;
  if (c === "accent") return theme.accent;
  return c ?? theme.text;
}

/** Greedy word-wrap `str` into lines no wider than `maxW` (font must be set
 *  on `ctx`). A single word wider than `maxW` gets its own line (drawn clamped
 *  by the caller). */
export function wrapLines(ctx: CanvasRenderingContext2D, str: string, maxW: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
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

  // Inset within the slot (pad shorthand + per-axis overrides). Falls back to
  // the theme's textPad (default 0 → flush) so a global inset is one setTheme.
  const padX = opts.padX ?? opts.pad ?? theme.textPad;
  const padY = opts.padY ?? opts.pad ?? theme.textPad;
  const bx = rect.x + padX;
  const bw = rect.w - padX * 2;
  const by = rect.y + padY;
  const bh = rect.h - padY * 2;

  const align = opts.align ?? "left";
  ctx.fillStyle = resolveColor(opts.color);
  ctx.textAlign = align;
  // A known width constrains the text: it flows in a layout, or w/maxWidth was
  // given. Then align positions WITHIN the slot [bx, bx+bw] and the width
  // clamps/wraps. Without a width the position is an anchor point: `x` is where
  // the text aligns to (canvas-native), so `align:"center", x: W/2` centers on
  // W/2 rather than starting there.
  const constrained =
    opts.w !== undefined || opts.maxWidth !== undefined || !!currentLayout() || !!opts.at;
  const tx = constrained
    ? align === "center"
      ? bx + bw / 2
      : align === "right"
        ? bx + bw
        : bx
    : rect.x;
  const maxW = opts.maxWidth ?? (constrained ? bw : undefined);

  if (opts.wrap && maxW !== undefined) {
    const lines = wrapLines(ctx, str, maxW);
    const blockTop = by + (bh - lines.length * lineH) / 2;
    lines.forEach((line, i) => centeredText(ctx, line, tx, blockTop + i * lineH + lineH / 2, maxW));
  } else {
    centeredText(ctx, str, tx, by + bh / 2, maxW);
  }
  ctx.restore();
}

// ---------- Text input ----------

export interface TextInputOptions {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  value: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  at?: Stack;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: "text" | "password" | "email" | "number" | "search";
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the field. */
  tabIndex?: number;
  /** Blur after Enter. Default true. */
  blurOnSubmit?: boolean;
}

export interface TextInputResult {
  value: string;
  changed: boolean;
  submitted: boolean;
  focused: boolean;
}

export function removeTextEditor(): void {
  textEditor?.input.remove();
  textEditor = null;
}

export function openTextEditor(opts: TextInputOptions & { id: string }): void {
  removeTextEditor();
  const input = document.createElement("input");
  input.type = opts.type ?? "text";
  input.value = opts.value;
  if (opts.maxLength !== undefined) input.maxLength = opts.maxLength;
  if (opts.inputMode) input.inputMode = opts.inputMode;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", opts.ariaLabel ?? opts.placeholder ?? opts.id);
  input.tabIndex = -1;
  input.dataset.minimotorUi = "true";
  Object.assign(input.style, {
    position: "fixed",
    left: "-1000px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  const editor: TextEditor = {
    id: opts.id,
    input,
    value: opts.value,
    changed: false,
    submitted: false,
  };
  input.addEventListener("input", () => {
    editor.value = input.value;
    editor.changed = true;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      editor.submitted = true;
      if (opts.blurOnSubmit ?? true) input.blur();
    } else if (event.key === "Escape") {
      input.blur();
    }
  });
  document.body.appendChild(input);
  textEditor = editor;
  input.focus({ preventScroll: true });
  // Selection APIs throw for some valid input types (notably number/email).
  try {
    input.setSelectionRange?.(input.value.length, input.value.length);
  } catch {
    // Native control still works; it simply chooses its own caret position.
  }
}

/** Canvas-rendered single-line input backed by a hidden native `<input>` for
 * keyboard, clipboard, IME and mobile-keyboard behavior. Returns controlled
 * value plus one-frame `changed`/`submitted` flags. */
export function textInput(opts: TextInputOptions): TextInputResult;
export function textInput(ctx: CanvasRenderingContext2D, opts: TextInputOptions): TextInputResult;
export function textInput(
  a: CanvasRenderingContext2D | TextInputOptions,
  b?: TextInputOptions,
): TextInputResult {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = requiredWidgetId(opts.id, "textInput");
  const resolvedOpts = { ...opts, id };
  textInputSeen = id;
  const rect = place(opts, opts.w ?? 180, opts.h ?? 32);
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    focus: () => {
      if (textEditor?.id === id) textEditor.input.focus({ preventScroll: true });
      else openTextEditor(resolvedOpts);
    },
    blur: () => {
      if (textEditor?.id === id) textEditor.input.blur();
    },
  });
  const p = uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
  if (hovered) hoverCursor(true);
  if (hovered && p.released) {
    focusFromPointer(ctx, id);
    if (textEditor?.id === id) textEditor.input.focus({ preventScroll: true });
    else openTextEditor(resolvedOpts);
  } else if (p.released && textEditor?.id === id && !hovered) textEditor.input.blur();

  const active = textEditor?.id === id ? textEditor : null;
  if (active) {
    active.input.disabled = opts.disabled ?? false;
    if (opts.maxLength !== undefined) active.input.maxLength = opts.maxLength;
    if (document.activeElement !== active.input && opts.value !== active.value) {
      active.value = opts.value;
      active.input.value = opts.value;
    }
  }
  const value = active?.value ?? opts.value;
  const focused = !!active && document.activeElement === active.input;
  const shown = value
    ? opts.type === "password"
      ? "•".repeat(value.length)
      : value
    : focused
      ? ""
      : (opts.placeholder ?? "");

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : theme.bg,
    stroke: focused ? theme.accent : hovered ? theme.accentSoft : theme.border,
  });
  ctx.beginPath();
  ctx.rect(rect.x + 7, rect.y + 2, Math.max(0, rect.w - 14), Math.max(0, rect.h - 4));
  ctx.clip();
  ctx.font = uiFont();
  ctx.fillStyle = value ? theme.text : theme.textDim;
  ctx.textAlign = "left";
  centeredText(ctx, shown, rect.x + 9, rect.y + rect.h / 2, rect.w - 18);
  if (focused && Math.floor(performance.now() / 500) % 2 === 0) {
    const caretX = Math.min(rect.x + rect.w - 9, rect.x + 9 + ctx.measureText(shown).width + 1);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(caretX, rect.y + 7, 1, Math.max(4, rect.h - 14));
  }
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);

  const changed = active?.changed ?? false;
  const submitted = active?.submitted ?? false;
  if (active) {
    active.changed = false;
    active.submitted = false;
  }
  return { value, changed, submitted, focused };
}

// ---------- Select dropdown ----------

export interface SelectOption<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface SelectOptions<T> {
  /** Stable identity. May be omitted inside `UI.idScope()`. */
  id?: string;
  value: T;
  options: readonly SelectOption<T>[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  at?: Stack;
  disabled?: boolean;
  placeholder?: string;
  maxVisible?: number;
  ariaLabel?: string;
  /** Keyboard traversal order. Negative values exclude the select. */
  tabIndex?: number;
}

export interface SelectResult<T> {
  value: T;
  changed: boolean;
  open: boolean;
}

export function removeSelectEditor(): void {
  selectEditor?.select.remove();
  selectEditor = null;
}

export function openSelectEditor<T>(
  opts: SelectOptions<T> & { id: string },
  index: number,
  menuOpen = true,
): void {
  removeSelectEditor();
  const select = document.createElement("select");
  select.setAttribute("aria-label", opts.ariaLabel ?? opts.id);
  select.tabIndex = -1;
  select.dataset.minimotorUi = "true";
  Object.assign(select.style, {
    position: "fixed",
    left: "-1000px",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  for (let i = 0; i < opts.options.length; i++) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = opts.options[i].label;
    option.disabled = opts.options[i].disabled ?? false;
    select.appendChild(option);
  }
  select.value = index >= 0 ? String(index) : "";
  const editor: SelectEditor = {
    id: opts.id,
    select,
    index,
    changed: false,
    open: menuOpen,
    justOpened: menuOpen,
  };
  select.addEventListener("change", () => {
    editor.index = Number(select.value);
    editor.changed = true;
  });
  select.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      editor.open = !editor.open;
      editor.justOpened = editor.open;
    } else if (event.key === "Escape") {
      editor.open = false;
      select.blur();
    }
  });
  document.body.appendChild(select);
  selectEditor = editor;
  select.focus({ preventScroll: true });
}

/** Themed dropdown backed by a hidden native `<select>`. Clicking opens a
 * canvas option list; focused native arrow-key navigation updates the same
 * controlled value. */
export function select<T>(opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(ctx: CanvasRenderingContext2D, opts: SelectOptions<T>): SelectResult<T>;
export function select<T>(
  a: CanvasRenderingContext2D | SelectOptions<T>,
  b?: SelectOptions<T>,
): SelectResult<T> {
  const [ctx, opts] = withCtx(a, b);
  ensureWired();
  const id = requiredWidgetId(opts.id, "select");
  const resolvedOpts = { ...opts, id };
  selectSeen = id;
  const rect = place(opts, opts.w ?? 180, opts.h ?? 32);
  const currentIndex = opts.options.findIndex((option) => Object.is(option.value, opts.value));
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    native: true,
    focus: () => {
      if (selectEditor?.id === id) selectEditor.select.focus({ preventScroll: true });
      else openSelectEditor(resolvedOpts, currentIndex, false);
    },
    blur: () => {
      if (selectEditor?.id === id) {
        selectEditor.open = false;
        selectEditor.select.blur();
      }
    },
  });
  const p = selectEditor?.id === id ? rawPointer() : uiPointer();
  const hovered = !opts.disabled && pointInRect(p.x, p.y, rect);
  if (hovered) hoverCursor(true);

  if (hovered && p.released && !opts.disabled) {
    focusFromPointer(ctx, id);
    if (selectEditor?.id === id) {
      selectEditor.open = !selectEditor.open;
      selectEditor.justOpened = selectEditor.open;
      selectEditor.select.focus({ preventScroll: true });
    } else openSelectEditor(resolvedOpts, currentIndex);
  }
  let editor = selectEditor?.id === id ? selectEditor : null;
  const committed = selectCommit?.id === id ? selectCommit.index : -1;
  if (committed >= 0) selectCommit = null;
  let value =
    committed >= 0
      ? (opts.options[committed]?.value ?? opts.value)
      : editor && editor.index >= 0
        ? (opts.options[editor.index]?.value ?? opts.value)
        : opts.value;
  let changed = committed >= 0 || (editor?.changed ?? false);
  const selected = opts.options.find((option) => Object.is(option.value, value));

  ctx.save();
  drawBox(ctx, rect.x, rect.y, rect.w, rect.h, {
    fill: opts.disabled ? theme.bgActive : theme.bg,
    stroke: editor ? theme.accent : hovered ? theme.accentSoft : theme.border,
  });
  ctx.font = uiFont();
  ctx.fillStyle = selected ? theme.text : theme.textDim;
  ctx.textAlign = "left";
  centeredText(
    ctx,
    selected?.label ?? opts.placeholder ?? "Select…",
    rect.x + 10,
    rect.y + rect.h / 2,
    rect.w - 36,
  );
  ctx.fillStyle = theme.textDim;
  ctx.beginPath();
  ctx.moveTo(rect.x + rect.w - 20, rect.y + rect.h / 2 - 3);
  ctx.lineTo(rect.x + rect.w - 10, rect.y + rect.h / 2 - 3);
  ctx.lineTo(rect.x + rect.w - 15, rect.y + rect.h / 2 + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);

  if (editor?.open) {
    markFocusableOverlay(id);
    // Defer the menu until frame-end so siblings drawn later in the callback
    // layout cannot paint over it. Input is still captured immediately.
    overlaySeen = true;
    inOverlayPass = true;
    selectOverlayRequest = { ctx, opts: resolvedOpts, rect } as SelectOverlayRequest;
    editor.changed = false;
  }
  return { value, changed, open: !!editor?.open };
}

export function drawSelectOverlay(): void {
  const request = selectOverlayRequest;
  selectOverlayRequest = null;
  if (!request || !selectEditor?.open || selectEditor.id !== request.opts.id) return;
  const { ctx, opts, rect } = request;
  const editor = selectEditor;
  const p = rawPointer();
  const value = editor.index >= 0 ? opts.options[editor.index]?.value : opts.value;
  const visible = Math.max(1, Math.min(opts.options.length, opts.maxVisible ?? 8));
  const itemH = 30;
  const menuH = visible * itemH + 4;
  const vp = Stage.viewport;
  const menuY = rect.y + rect.h + menuH <= vp.h - 4 ? rect.y + rect.h + 2 : rect.y - menuH - 2;
  const menu = { x: rect.x, y: menuY, w: rect.w, h: menuH };

  ctx.save();
  ctx.fillStyle = theme.bgActive;
  ctx.fillRect(menu.x, menu.y, menu.w, menu.h);
  ctx.restore();
  panel(ctx, { ...menu, bg: theme.bgActive });
  const start = Math.max(
    0,
    Math.min(opts.options.length - visible, editor.index - Math.floor(visible / 2)),
  );
  for (let i = start; i < Math.min(opts.options.length, start + visible); i++) {
    const option = opts.options[i];
    if (
      button(ctx, {
        x: menu.x + 2,
        y: menu.y + 2 + (i - start) * itemH,
        w: menu.w - 4,
        h: itemH,
        label: option.label,
        disabled: option.disabled,
        variant: Object.is(option.value, value) ? "primary" : "ghost",
      })
    ) {
      editor.index = i;
      editor.select.value = String(i);
      editor.index = i;
      editor.select.value = String(i);
      editor.open = false;
      selectCommit = { id: opts.id, index: i }; // observed by select() next draw
      return;
    }
  }
  if (
    !editor.justOpened &&
    p.released &&
    !pointInRect(p.x, p.y, rect) &&
    !pointInRect(p.x, p.y, menu)
  ) {
    removeSelectEditor();
    return;
  }
  editor.justOpened = false;
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

// ---------- Tooltip ----------

export let tipRequest: string | null = null; // asked for this frame

export let tipShown: { text: string; since: number } | null = null; // hover-stable

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

export let floats = createFloats();

export let spinAngle = 0;

export let wired = false;

export function ensureWired(): void {
  if (!focusKeyboardWired && typeof window !== "undefined") {
    focusKeyboardWired = true;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Tab") focusVisible = true;
        const target = event.target as HTMLElement | null;
        const onFocusSurface =
          !!focusedWidget ||
          target?.dataset?.minimotorUi === "true" ||
          (target instanceof HTMLCanvasElement && focusCanvases.has(target));
        if (!onFocusSurface) return;
        const entry = focusRegistry.find((item) => item.id === focusedWidget);
        if (event.key === "Tab") {
          event.preventDefault();
          event.stopImmediatePropagation();
          moveWidgetFocus(event.shiftKey ? -1 : 1);
        } else if (!entry?.native && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (focusedWidget) keyboardActivation = focusedWidget;
        } else if (!entry?.native && event.key.startsWith("Arrow")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (focusedWidget) keyboardCommand = { id: focusedWidget, key: event.key };
        } else if (event.key === "Escape" && !entry?.native) {
          blur();
        }
      },
      true,
    );
    window.addEventListener("focusin", (event) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.dataset?.minimotorUi !== "true" &&
        !(target instanceof HTMLCanvasElement && focusCanvases.has(target))
      ) {
        setWidgetFocus(null);
      }
    });
  }
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
      // Deferred overlays render above every ordinary widget in the user's
      // draw callback (and still see frame-scoped pointer release edges).
      drawSelectOverlay();
      begunCtx = null; // re-begin() each frame when overriding the ctx
      // Complete this frame's keyboard registry after every widget (including
      // deferred overlays) has had a chance to register.
      focusRegistry = focusFrame;
      focusFrame = [];
      const wasFocusOverlay = focusOverlayActive;
      if (!wasFocusOverlay && focusTrapSeen) focusBeforeOverlay = focusedWidget;
      focusOverlayActive = focusTrapSeen;
      const candidates = focusCandidates();
      const focusMissing = !candidates.some((entry) => entry.id === focusedWidget);
      if (focusMissing && (focusedWidget || focusOverlayActive)) {
        const restore =
          !focusOverlayActive &&
          wasFocusOverlay &&
          candidates.some((entry) => entry.id === focusBeforeOverlay)
            ? focusBeforeOverlay
            : null;
        setWidgetFocus(focusOverlayActive && candidates.length ? candidates[0].id : restore);
      }
      if (wasFocusOverlay && !focusOverlayActive) focusBeforeOverlay = null;
      // Overlay capture: what was drawn this frame gates input next frame.
      overlayActive = overlaySeen;
      overlaySeen = false;
      focusTrapSeen = false;
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
      // Native editing bridges only live while their immediate-mode widget is
      // still submitted every frame.
      if (textEditor && textInputSeen !== textEditor.id) removeTextEditor();
      if (selectEditor && selectSeen !== selectEditor.id) removeSelectEditor();
      textInputSeen = null;
      selectSeen = null;
      // A release not consumed by any drop target cancels the drag.
      try {
        if (activeDrag && Pointer.frameReleased) activeDrag = null;
      } catch {
        activeDrag = null;
      }
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
  activeDrag = null;
  removeTextEditor();
  removeSelectEditor();
  textInputSeen = null;
  selectSeen = null;
  selectOverlayRequest = null;
  selectCommit = null;
  focusFrame = [];
  focusRegistry = [];
  focusedWidget = null;
  focusVisible = false;
  focusTrapSeen = false;
  focusOverlayActive = false;
  focusBeforeOverlay = null;
  keyboardActivation = null;
  keyboardCommand = null;
  idScopes.length = 0;
  begunCtx = null;
  wired = false;
}
