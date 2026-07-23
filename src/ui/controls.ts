import {
  Stack,
  buttonState,
  centeredText,
  consumeKeyboardActivation,
  consumeKeyboardCommand,
  drawBox,
  drawFocusRing,
  ensureWired,
  focusFromPointer,
  hoverCursor,
  place,
  registerFocusable,
  roundRectPath,
  spinAngle,
  theme,
  tooltip,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
  withCtx,
  runContainer,
  anchorViewport,
  ANCHOR_H,
  ANCHOR_V,
  type TextAnchor,
} from "./core/index.js";
import { clamp } from "../mathf.js";
import { pointInRect } from "../collision.js";

// ---------- Button ----------

/** Button look. `"default"` is the neutral filled button; `"primary"` fills
 *  with the theme accent (calls to action); `"danger"` fills red (destructive
 *  actions); `"ghost"` is text-only with no fill/border until hovered. */
export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** Style knobs for `button()`. Every color defaults from the theme. */
export interface ButtonStyle {
  /** Full font string for the label. Default bold `theme.fontSize + 2`. */
  font?: string;
  /** Preset look — see `ButtonVariant`. Default `"default"`. */
  variant?: ButtonVariant;
  /** Label color. */
  color?: string;
  /** Fill when idle. */
  bg?: string;
  /** Fill when hovered. */
  bgHover?: string;
  /** Fill when held down (pressed). */
  bgActive?: string;
  /** Corner radius override (px). Defaults to `theme.radius`. */
  radius?: number;
}

/** A button's geometry + label. Position it yourself (`x`/`y` required,
 *  `w` optional — auto-sized to the label when omitted), or hand it a
 *  layout `Stack` via `at` and skip the geometry entirely. */
export interface ButtonOptions extends ButtonStyle {
  /** Stable identity enables Tab focus and keyboard activation. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the button. */
  tabIndex?: number;
  /** Top-left x in logical px. */
  x?: number;
  /** Top-left y in logical px. */
  y?: number;
  /** Omit to auto-size to the label (+ padding). */
  w?: number;
  /** Button height in logical px. Default `30`. */
  h?: number;
  /** Text drawn centered on the button. */
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

/** Draw an immediate-mode button and report whether it was clicked this
 *  frame. Call it every frame from `draw` — there is no retained widget:
 *
 *    if (UI.button(ctx, { x, y, w: 160, h: 44, label: "PLAY" })) start();
 *
 *  Hit-testing uses the polled `Pointer` in canvas coordinates — draw the
 *  button untransformed (outside camera/letterbox transforms). */
export function button(label: string, opts?: Omit<ButtonOptions, "label">): boolean;
export function button(opts: ButtonOptions): boolean;
export function button(ctx: CanvasRenderingContext2D, opts: ButtonOptions): boolean;
export function button(
  a: CanvasRenderingContext2D | ButtonOptions | string,
  b?: ButtonOptions | Omit<ButtonOptions, "label">,
): boolean {
  // Label-first sugar: `if (UI.button("Resume")) ...` (API_PLAN #43).
  if (typeof a === "string") return button({ ...(b as Omit<ButtonOptions, "label">), label: a });
  const [ctx, opts] = withCtx(a, b as ButtonOptions);
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize + 2, true);
  // Auto width: the label plus comfortable padding.
  const w = opts.w ?? Math.ceil(ctx.measureText(opts.label).width) + theme.buttonPadX;
  const rect = place(opts, w, opts.h ?? 30);
  const id = widgetId(opts.id, "button");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
  });

  const p = uiPointer();
  const over = pointInRect(p.x, p.y, rect);
  if (over && opts.tooltip) tooltip(opts.tooltip);
  const state = opts.disabled
    ? { hover: false, active: false, clicked: false }
    : buttonState(rect, p);
  const { hover, active } = state;
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
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
  if (keyboardFocused) drawFocusRing(ctx, rect);

  return clicked;
}

// ---------- Panel ----------

/** A framed box with an optional title strip — visual grouping for menus,
 *  dialogs and HUD clusters. Purely decorative; it captures no input. */
export interface PanelOptions {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px. */
  w: number;
  /** Height in px. */
  h: number;
  /** Optional title; when set, a title strip is drawn along the top. */
  title?: string;
  /** Fill color. Default `theme.panelBg`. */
  bg?: string;
  /** Border color. Default `theme.border`. */
  border?: string;
  /** Title text color. Default `theme.accent`. */
  titleColor?: string;
  /** Title font. Default a bold `theme.fontSize + 1` UI font. */
  font?: string;
}

/** Options for the container form of `panel` — a panel that LAYS OUT its
 *  children (a column with gap/pad), anchored to the screen or positioned
 *  absolutely. Auto-height panels measure their children and remember the
 *  height per `id` (one-frame lag on first appearance — standard IM). */
export interface PanelContainerOptions {
  /** Named screen anchor (center for menus). x/y become offsets from it. */
  anchor?: TextAnchor;
  x?: number;
  y?: number;
  /** Panel width. Default 260. */
  w?: number;
  /** Panel height. Omit to size to the children (measured, 1-frame lag). */
  h?: number;
  /** Inner padding. Default 16. */
  pad?: number;
  /** Gap between children. Default 10. */
  gap?: number;
  /** Identity for the height memo (defaults to anchor+size). */
  id?: string;
  title?: string;
  bg?: string;
  border?: string;
}

const panelHeights = new Map<string, number>();

function panelContainer<R>(opts: PanelContainerOptions, children: () => R): R {
  const ctx = uiCtx();
  const w = opts.w ?? 260;
  const pad = opts.pad ?? 16;
  const key = opts.id ?? `panel:${opts.anchor ?? "abs"}:${w}`;
  const h = opts.h ?? panelHeights.get(key) ?? 64;
  let x = opts.x ?? 0;
  let y = opts.y ?? 0;
  if (opts.anchor) {
    const view = anchorViewport(ctx);
    const hx = ANCHOR_H[opts.anchor];
    const vy = ANCHOR_V[opts.anchor];
    const baseX = hx === 0 ? view.safeLeft : hx === 0.5 ? view.w / 2 : view.w;
    const baseY = vy === 0 ? view.safeTop : vy === 0.5 ? view.h / 2 : view.h;
    x = baseX - hx * w + (opts.x ?? 0);
    y = baseY - vy * h + (opts.y ?? 0);
  }
  panel(ctx, { x, y, w, h, title: opts.title, bg: opts.bg, border: opts.border });
  const top = opts.title ? 32 : 0;
  let measured = h;
  const out = runContainer(
    "col",
    { x, y: y + top, w, h: h - top },
    opts.gap ?? 10,
    pad,
    "start",
    (st) => {
      const r = children();
      const ext = st.extent;
      measured = ext.y + ext.h - y + pad;
      return r;
    },
  );
  if (opts.h === undefined) panelHeights.set(key, measured);
  return out;
}

/** Draw a framed box (value form, `PanelOptions`) or — when passed a
 *  `children` callback — a self-laying-out panel (`PanelContainerOptions`) that
 *  flows children down a padded column and can `anchor` to the screen. Optional
 *  `title` strip; captures no input either way. */
export function panel(opts: PanelOptions): void;
export function panel(ctx: CanvasRenderingContext2D, opts: PanelOptions): void;
export function panel<R>(opts: PanelContainerOptions, children: () => R): R;
export function panel<R>(
  a: CanvasRenderingContext2D | PanelOptions | PanelContainerOptions,
  b?: PanelOptions | (() => R),
): R | void {
  // Container form: `UI.panel({ anchor: "center", w: 260 }, () => {...})`.
  if (typeof b === "function") return panelContainer(a as PanelContainerOptions, b);
  const [ctx, opts] = withCtx(a as CanvasRenderingContext2D | PanelOptions, b as PanelOptions);
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
    // Inset the title by the same theme.pad as a group's body, so a titled
    // group's header text and its content line up on the same left edge.
    centeredText(ctx, opts.title, opts.x + theme.pad, opts.y + 17, opts.w - theme.pad * 2);
  }
  ctx.restore();
}

// ---------- Toggle ----------

/** A labeled checkbox. */
export interface ToggleOptions {
  /** Stable identity enables Tab focus and keyboard activation. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the toggle. */
  tabIndex?: number;
  /** Grayed out and unclickable. */
  disabled?: boolean;
  /** Top-left x in logical px. */
  x?: number;
  /** Top-left y in logical px. */
  y?: number;
  /** Slot height when placed in a layout (the box centers within it). */
  h?: number;
  /** Text drawn right of the box (also part of the click target). */
  label: string;
  /** Current value — pass your state in, assign the return value back. */
  on: boolean;
  /** Place in this layout stack — supplies x/y; width is the box + label. */
  at?: Stack;
  /** Box side length in px. Default `16`. */
  size?: number;
  /** Label font. Default `uiFont()`. */
  font?: string;
  /** Label color. Default `theme.text`. */
  color?: string;
  /** Shown near the pointer after hovering a moment (see `drawTips`). */
  tooltip?: string;
}

/** Draw a checkbox + label; returns the (possibly flipped) new value:
 *
 *    hideFull = UI.toggle(ctx, { x, y, label: "Hide full", on: hideFull }); */
export function toggle(
  label: string,
  on: boolean,
  opts?: Omit<ToggleOptions, "label" | "on">,
): boolean;
export function toggle(opts: ToggleOptions): boolean;
export function toggle(ctx: CanvasRenderingContext2D, opts: ToggleOptions): boolean;
export function toggle(
  a: CanvasRenderingContext2D | ToggleOptions | string,
  b?: ToggleOptions | boolean,
  c?: Omit<ToggleOptions, "label" | "on">,
): boolean {
  // Label-first sugar: `muted = UI.toggle("Mute", muted)` (API_PLAN #43).
  if (typeof a === "string") return toggle({ ...c, label: a, on: b as boolean });
  const [ctx, opts] = withCtx(a, b as ToggleOptions);
  const size = opts.size ?? 16;
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelW = ctx.measureText(opts.label).width;
  const w = size + 8 + Math.ceil(labelW);
  // Hit region spans box + label, so the text is clickable too. Placed via a
  // layout, the box is vertically centered on the taller slot.
  const slot = place({ x: opts.x, y: opts.y, w, h: opts.h, at: opts.at }, w, size);
  const rect = { x: slot.x, y: slot.y + Math.max(0, (slot.h - size) / 2), w, h: size };
  const id = widgetId(opts.id, "toggle");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
  });
  const state = opts.disabled ? { hover: false, clicked: false } : buttonState(rect, uiPointer());
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
  hoverCursor(state.hover);
  if (state.hover && opts.tooltip) tooltip(opts.tooltip);
  const on = clicked ? !opts.on : opts.on;

  // Checkbox radius scales down with the theme so a big radius doesn't turn
  // the little box into a circle.
  const boxR = Math.min(theme.radius, 4);
  drawBox(ctx, rect.x, rect.y, size, size, {
    fill: theme.bgActive,
    stroke: state.hover ? theme.accent : theme.border,
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
  if (keyboardFocused) drawFocusRing(ctx, rect);
  return on;
}

// ---------- Tabs ----------

/** A horizontal tab strip. */
export interface TabsOptions {
  /** Stable identity enables Tab focus and arrow-key selection. */
  id?: string;
  /** Position in the keyboard tab order. */
  tabIndex?: number;
  /** Left edge in px. */
  x?: number;
  /** Top edge in px. */
  y?: number;
  /** Total width, split equally between the tabs. Omit to auto-size every
   *  cell to the widest label. */
  w?: number;
  /** Strip height in px. Default `30`. */
  h?: number;
  /** Tab labels, left to right. */
  items: string[];
  /** Current tab index — pass your state in, assign the return value back. */
  active: number;
  /** Place in this layout stack — supplies x/y (and h); auto width. */
  at?: Stack;
  /** Label font. Default a bold `theme.fontSize` UI font. */
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
  const id = widgetId(opts.id, "tabs");
  const keyboardFocused = registerFocusable(ctx, { id, tabIndex: opts.tabIndex });
  const cellW = rect.w / opts.items.length;
  const p = uiPointer();
  let active = opts.active;
  const command = consumeKeyboardCommand(id);
  if (command === "ArrowRight" || command === "ArrowDown")
    active = (active + 1) % opts.items.length;
  if (command === "ArrowLeft" || command === "ArrowUp")
    active = (active - 1 + opts.items.length) % opts.items.length;
  ctx.textAlign = "center";
  // Uniform baseline across the row: `centeredText` centers each label's own
  // ink box, so labels with descenders (g/q) would sit higher than others.
  // "middle" is font-relative (string-independent), so every tab lines up.
  ctx.textBaseline = "middle";
  // Round only the strip's outer corners: clip the whole strip, fill cells
  // square inside it.
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius);
  ctx.clip();
  opts.items.forEach((label, i) => {
    const x = rect.x + i * cellW;
    const { hover, clicked } = buttonState({ x, y: rect.y, w: cellW, h: rect.h }, p);
    hoverCursor(hover);
    if (clicked) {
      active = i;
      focusFromPointer(ctx, id);
    }
    const isActive = i === active;
    ctx.fillStyle = isActive ? theme.bg : hover ? theme.bgHover : theme.bgActive;
    ctx.fillRect(x, rect.y, cellW - 2, rect.h);
    if (isActive) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(x, rect.y + rect.h - 3, cellW - 2, 3);
    }
    ctx.fillStyle = isActive ? theme.text : theme.textDim;
    ctx.fillText(label, x + cellW / 2, rect.y + rect.h / 2, cellW - 10);
  });
  ctx.restore();
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);
  return active;
}

// ---------- List item ----------

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
export function listItem(opts: ListItemOptions): boolean;
export function listItem(ctx: CanvasRenderingContext2D, opts: ListItemOptions): boolean;
export function listItem(
  a: CanvasRenderingContext2D | ListItemOptions,
  b?: ListItemOptions,
): boolean {
  const [ctx, opts] = withCtx(a, b);
  const id = widgetId(opts.id, "list-item");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
  });
  const state = opts.disabled ? { hover: false, clicked: false } : buttonState(opts, uiPointer());
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
  const { hover } = state;
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
  if (keyboardFocused) drawFocusRing(ctx, opts);
  return clicked;
}

// ---------- Slider ----------

/** A horizontal value slider. */
export interface SliderOptions {
  /** Top-left x in logical px. */
  x?: number;
  /** Top-left y in logical px. */
  y?: number;
  /** Widget width in px (label + track). Default `140`. */
  w?: number;
  /** Slot height in px. Default `30`. */
  h?: number;
  /** Place in this layout stack — supplies x/y (and h). */
  at?: Stack;
  /** Range minimum. Default `0`. */
  min?: number;
  /** Range maximum. Default `1`. */
  max?: number;
  /** Current value — pass your state in, assign the return value back. */
  value: number;
  /** Snap increment (e.g. 5). Default continuous. */
  step?: number;
  /** Caption drawn left of the track. */
  label?: string;
  /** Value text drawn right of the track. Default the rounded value. */
  format?: (v: number) => string;
  /** Identity for drag tracking and keyboard focus. Defaults to the position. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the slider. */
  tabIndex?: number;
  /** Grayed out; ignores pointer and arrow keys. */
  disabled?: boolean;
  /** Label/value font. Default `uiFont()`. */
  font?: string;
  /** Label and value-text color. Default `theme.text`. */
  color?: string;
}

// One slider drag at a time, tracked across frames by id.
let sliderDrag: string | null = null;

/** Draw a slider and return the (possibly changed) new value — drag the knob
 *  or click anywhere on the track:
 *
 *    volume = UI.slider(ctx, { x, y, w: 140, value: volume, label: "VOL" }); */
export function slider(
  label: string,
  value: number,
  opts?: Omit<SliderOptions, "label" | "value">,
): number;
export function slider(opts: SliderOptions): number;
export function slider(ctx: CanvasRenderingContext2D, opts: SliderOptions): number;
export function slider(
  a: CanvasRenderingContext2D | SliderOptions | string,
  b?: SliderOptions | number,
  c?: Omit<SliderOptions, "label" | "value">,
): number {
  // Label-first, value-in/value-out sugar (API_PLAN #43):
  //   Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume);
  if (typeof a === "string") return slider({ ...c, label: a, value: b as number });
  const [ctx, opts] = withCtx(a, b as SliderOptions);
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const slot = place(opts, opts.w ?? 140, opts.h ?? 30);
  // Reserve room for the label inside the slot's left edge so the label and
  // track stay within the widget's slot even when it's placed flush-left in a
  // container (a bare left-hung label would spill outside the box). The value
  // still trails the track on the right, as before.
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelSpace = opts.label ? Math.ceil(ctx.measureText(opts.label).width) + 10 : 0;
  ctx.restore();
  const sx = slot.x + labelSpace;
  const sy = slot.y + slot.h / 2;
  const sw = Math.max(10, slot.w - labelSpace);
  const id = widgetId(opts.id, "slider") ?? `${sx}:${sy}`;
  const knobR = 7;
  const p = uiPointer();
  // Generous hit region: the whole track strip, knob included.
  const hit = { x: sx - knobR, y: sy - knobR, w: sw + knobR * 2, h: knobR * 2 };
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
  });
  const hover = !opts.disabled && pointInRect(p.x, p.y, hit);
  hoverCursor(hover || sliderDrag === id);

  if (!p.down) sliderDrag = null;
  if (p.pressed && hover && !sliderDrag) {
    sliderDrag = id;
    focusFromPointer(ctx, id);
  }

  let value = clamp(opts.value, min, max);
  const command = consumeKeyboardCommand(id);
  const keyboardStep = opts.step ?? (max - min) / 100;
  if (command === "ArrowRight" || command === "ArrowUp") value += keyboardStep;
  if (command === "ArrowLeft" || command === "ArrowDown") value -= keyboardStep;
  value = clamp(value, min, max);
  if (sliderDrag === id) {
    value = min + ((p.x - sx) / sw) * (max - min);
    if (opts.step) value = Math.round(value / opts.step) * opts.step;
    value = clamp(value, min, max);
  }
  const knobX = sx + ((value - min) / (max - min || 1)) * sw;

  ctx.save();
  ctx.font = opts.font ?? uiFont();
  if (opts.label) {
    ctx.fillStyle = opts.color ?? theme.text;
    ctx.textAlign = "left";
    centeredText(ctx, opts.label, slot.x, sy);
  }
  ctx.fillStyle = theme.track;
  ctx.fillRect(sx, sy - 2, sw, 4);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(sx, sy - 2, knobX - sx, 4);
  ctx.beginPath();
  ctx.arc(knobX, sy, knobR, 0, Math.PI * 2);
  ctx.fillStyle = sliderDrag === id || hover ? theme.accent : theme.accentSoft;
  ctx.fill();
  ctx.fillStyle = opts.color ?? theme.text;
  ctx.textAlign = "left";
  const valueText = opts.format ? opts.format(value) : `${Math.round(value)}`;
  centeredText(ctx, valueText, sx + sw + 12, sy);
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, hit);
  return value;
}

// ---------- Spinner ----------

/** Style knobs for `spinner()`. */
export interface SpinnerOptions {
  /** Arc radius in px. Default `8`. */
  r?: number;
  /** Stroke color. Default `theme.accent`. */
  color?: string;
  /** Stroke width in px. Default `3`. */
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
  const f = clamp(frac, 0, 1);
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
