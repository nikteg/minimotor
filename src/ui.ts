// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, sliders, scrollbars, panels, popovers, modals and meter
// bars. Everything draws with plain ctx calls in YOUR draw phase — no
// retained widget tree, no layout engine. Floating texts and spinners age on
// the fixed step (via Loop.onStep), so they pause with the loop like
// Clock/Tween.
//
//   Minimotor.UI.float("+100", x, y, { color: "#ffd43b" }); // spawn (update)
//   if (Minimotor.UI.button(ctx, { x, y, w: 160, h: 44, label: "PLAY" })) start();
//   Minimotor.UI.bar(ctx, 10, 10, 120, 10, hp / maxHp);
//   Minimotor.UI.drawFloats(ctx); // late in draw: floats, then tooltips
//   Minimotor.UI.drawTips(ctx);
//
// Colors and fonts come from the active theme — `UI.setTheme({...})` restyles
// every widget at once; per-widget style options still override.

import { pointInRect } from "./collision.js";
import { Loop, Pointer, Stage } from "./engine.js";

// ---------- Theme ----------

/** Every color and font the widgets use. Override any subset with
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
  const m = ctx.measureText(text);
  const asc = m.actualBoundingBoxAscent ?? 0;
  const desc = m.actualBoundingBoxDescent ?? 0;
  if (asc || desc) {
    ctx.textBaseline = "alphabetic";
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

// ---------- Shared input (modal capture + hover cursor) ----------

// While a modal is open, widgets drawn outside the modal pass must go dead —
// otherwise a click "through" the backdrop still lands on them.
let modalSeen = false; // modal() ran this frame
let modalActive = false; // modal() ran last frame → block the background
let inModalPass = false; // set by modal(); the rest of the frame is inside it

const DEAD_POINTER = { x: -1e9, y: -1e9, down: false, released: false, pressed: false, wheel: 0 };

/** The pointer as widgets see it: frame-scoped edges, and dead while a modal
 *  has the screen (unless we're in the modal's own pass). */
function uiPointer() {
  ensureWired(); // per-frame housekeeping keeps modal/tooltip state honest
  if (modalActive && !inModalPass) return DEAD_POINTER;
  return {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
    pressed: Pointer.framePressed,
    wheel: Pointer.wheel,
  };
}

/** Hovering an interactive widget asks for the hand cursor; the engine
 *  resets it every frame, so it clears the moment nothing is hovered. */
function hoverCursor(hover: boolean): void {
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

// ---------- Button ----------

/** Style knobs for `button()`. Every color defaults from the theme. */
export interface ButtonStyle {
  font?: string;
  /** Label color. */
  color?: string;
  /** Fill when idle / hovered / held down. */
  bg?: string;
  bgHover?: string;
  bgActive?: string;
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
export function button(ctx: CanvasRenderingContext2D, opts: ButtonOptions): boolean {
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize + 2, true);
  // Auto width: the label plus comfortable padding.
  const w = opts.w ?? Math.ceil(ctx.measureText(opts.label).width) + 28;
  const rect = opts.at
    ? opts.at.next(w, opts.h)
    : { x: opts.x ?? 0, y: opts.y ?? 0, w, h: opts.h ?? 30 };

  const p = uiPointer();
  const over = pointInRect(p.x, p.y, rect);
  if (over && opts.tooltip) tooltip(opts.tooltip);
  const { hover, active, clicked } = opts.disabled
    ? { hover: false, active: false, clicked: false }
    : buttonState(rect, p);
  hoverCursor(hover);

  ctx.fillStyle = active
    ? (opts.bgActive ?? theme.bgActive)
    : hover
      ? (opts.bgHover ?? theme.bgHover)
      : (opts.bg ?? theme.bg);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = hover ? theme.accent : theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  ctx.fillStyle = opts.disabled ? theme.textDisabled : (opts.color ?? theme.text);
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

export function panel(ctx: CanvasRenderingContext2D, opts: PanelOptions): void {
  ctx.save();
  ctx.fillStyle = opts.bg ?? theme.panelBg;
  ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  ctx.strokeStyle = opts.border ?? theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(opts.x + 1, opts.y + 1, opts.w - 2, opts.h - 2);
  if (opts.title) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(opts.x + 2, opts.y + 2, opts.w - 4, 30);
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
export function toggle(ctx: CanvasRenderingContext2D, opts: ToggleOptions): boolean {
  const size = opts.size ?? 16;
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelW = ctx.measureText(opts.label).width;
  const w = size + 8 + Math.ceil(labelW);
  // Hit region spans box + label, so the text is clickable too. In a stack
  // the slot is vertically centered on the cross axis.
  let rect;
  if (opts.at) {
    const slot = opts.at.next(w);
    rect = { x: slot.x, y: slot.y + (slot.h - size) / 2, w, h: size };
  } else {
    rect = { x: opts.x ?? 0, y: opts.y ?? 0, w, h: size };
  }
  const { hover, clicked } = buttonState(rect, uiPointer());
  hoverCursor(hover);
  if (hover && opts.tooltip) tooltip(opts.tooltip);
  const on = clicked ? !opts.on : opts.on;

  ctx.fillStyle = theme.bgActive;
  ctx.fillRect(rect.x, rect.y, size, size);
  ctx.strokeStyle = hover ? theme.accent : theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, size - 2, size - 2);
  if (on) {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(rect.x + 4, rect.y + 4, size - 8, size - 8);
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
export function tabs(ctx: CanvasRenderingContext2D, opts: TabsOptions): number {
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize, true);
  // Auto width: equal cells sized to the widest label.
  const w =
    opts.w ??
    (Math.ceil(Math.max(...opts.items.map((t) => ctx.measureText(t).width))) + 26) *
      opts.items.length;
  const rect = opts.at
    ? opts.at.next(w, opts.h)
    : { x: opts.x ?? 0, y: opts.y ?? 0, w, h: opts.h ?? 30 };
  const cellW = rect.w / opts.items.length;
  const p = uiPointer();
  let active = opts.active;
  ctx.textAlign = "center";
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
  return active;
}

// ---------- Row ----------

/** A selectable list row. */
export interface RowOptions {
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

/** Draw a row background with hover/selected states and report a click.
 *  Draw your own content (columns, icons) on top afterwards:
 *
 *    if (UI.row(ctx, { x, y, w, h, selected: i === sel })) sel = i; */
export function row(ctx: CanvasRenderingContext2D, opts: RowOptions): boolean {
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
export function slider(ctx: CanvasRenderingContext2D, opts: SliderOptions): number {
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
export function spinner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: SpinnerOptions = {},
): void {
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
export function scrollbar(ctx: CanvasRenderingContext2D, opts: ScrollbarOptions): number {
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
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style: BarStyle = {},
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.save();
  ctx.fillStyle = style.bg ?? "rgba(255,255,255,0.15)";
  ctx.fillRect(x, y, w, h);
  if (f > 0) {
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

/** Draw a popover panel while open; a click anywhere outside closes it.
 *  Returns the new open state. Draw the contents (any UI widgets) after the
 *  call, inside the rect, when it returns true:
 *
 *    if (UI.button(ctx, trigger)) filtersOpen = !filtersOpen;
 *    filtersOpen = UI.popover(ctx, { x, y, w: 240, h: 120, open: filtersOpen });
 *    if (filtersOpen) { ...toggles/sliders at x/y... } */
export function popover(ctx: CanvasRenderingContext2D, opts: PopoverOptions): boolean {
  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const was = popoverWasOpen.get(id) ?? false;
  let open = opts.open;
  const p = uiPointer();
  if (open && was && p.released && !pointInRect(p.x, p.y, opts)) open = false;
  popoverWasOpen.set(id, open);
  if (open) panel(ctx, opts);
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
 *  (the dialog's own) work normally. Call it LAST in your draw:
 *
 *    if (confirming) {
 *      const r = UI.modal(ctx, { w: 340, h: 150, title: "CONFIRM" });
 *      if (UI.button(ctx, { x: r.x + 12, ... label: "OK" })) { ... }
 *    } */
export function modal(
  ctx: CanvasRenderingContext2D,
  opts: ModalOptions,
): { x: number; y: number; w: number; h: number } {
  ensureWired();
  modalSeen = true;
  inModalPass = true;
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

// ---------- Tooltip ----------

let tipRequest: string | null = null; // asked for this frame
let tipShown: { text: string; since: number } | null = null; // hover-stable

/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms. */
export function tooltip(text: string): void {
  ensureWired();
  tipRequest = text;
}

/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloats`, after any modal) so it sits on top. */
export function drawTips(ctx: CanvasRenderingContext2D): void {
  if (!tipShown || performance.now() - tipShown.since < 350) return;
  const text = tipShown.text;
  const vp = Stage.viewport;
  ctx.save();
  ctx.font = uiFont(theme.fontSize - 1);
  const w = ctx.measureText(text).width + 16;
  const h = 24;
  let x = Pointer.x + 14;
  let y = Pointer.y + 20;
  if (x + w > vp.w - 4) x = vp.w - 4 - w;
  if (y + h > vp.h - 4) y = Pointer.y - 8 - h;
  ctx.fillStyle = theme.panelBg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = theme.text;
  ctx.textAlign = "left";
  centeredText(ctx, text, x + 8, y + h / 2);
  ctx.restore();
}

// ---------- Default facade (aged by the default Loop's fixed step) ----------

let floats = createFloats();
let spinAngle = 0;
let wired = false;

function ensureWired(): void {
  if (wired) return;
  wired = true;
  Loop.onStep(() => {
    floats.advance(Loop.step);
    spinAngle += 0.12; // ~7 rad/s at 60 steps
  });
  // Frame-end housekeeping for the immediate-mode state machines.
  Loop.onFrame(() => {
    // Modal capture: what was drawn this frame gates input next frame.
    modalActive = modalSeen;
    modalSeen = false;
    inModalPass = false;
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
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloats`. */
export function float(text: string, x: number, y: number, opts?: FloatOptions): void {
  ensureWired();
  floats.spawn(text, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloats(ctx: CanvasRenderingContext2D): void {
  floats.draw(ctx);
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
  modalSeen = false;
  modalActive = false;
  inModalPass = false;
  wired = false;
}
