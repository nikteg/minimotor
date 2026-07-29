// ---------- button ----------
import {
  Flowable,
  buttonState,
  centeredText,
  consumeKeyboardActivation,
  drawBox,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  measureWidth,
  place,
  registerFocusable,
  theme,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
} from "../core/index.js";
import { tooltip } from "./tooltip.js";
import { pointInRect } from "../../collision.js";

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
 *  layout `Flow` via `at` and skip the geometry entirely. */
export interface ButtonOptions extends ButtonStyle, Flowable {
  /** Stable identity enables Tab focus and keyboard activation. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the button. */
  tabIndex?: number;
  /** Omit to auto-size to the label (+ padding). */
  w?: number;
  /** Button height in logical px. Default `30`. */
  h?: number;
  /** Text drawn centered on the button. */
  label: string;
  /** Grayed out and unclickable. */
  disabled?: boolean;
  /** Shown near the pointer after hovering a moment (see `drawTips`). Works
   *  on disabled buttons too — the place to say WHY it's disabled. */
  tooltip?: string;
}

/** Resolve a variant into (idle, hover, active) fills, border and label
 *  colors — mixing in the theme and any per-button overrides. */
// Nudge a color toward black/white without parsing it — CSS color-mix is
// understood by canvas fillStyle in every browser we target. Memoized: the
// inputs are theme colors (a handful), and buttons call this every frame.
const shadeCache = new Map<string, string>();
function shade(c: string, dark: boolean): string {
  const key = dark ? `d:${c}` : `l:${c}`;
  let mixed = shadeCache.get(key);
  if (!mixed) {
    mixed = `color-mix(in srgb, ${c} ${dark ? 82 : 88}%, ${dark ? "#000" : "#fff"})`;
    shadeCache.set(key, mixed);
  }
  return mixed;
}

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
 *    if (UI.button({ x, y, w: 160, h: 44, label: "PLAY" })) start();
 *
 *  Hit-testing uses the polled `Pointer` in canvas coordinates — draw the
 *  button outside game-world/camera transforms. To draw UI scaled, wrap it in
 *  `UI.scaled`, which remaps the pointer to match. */
export function button(label: string, opts?: Omit<ButtonOptions, "label">): boolean;
export function button(opts: ButtonOptions): boolean;
export function button(
  optsOrLabel: ButtonOptions | string,
  rest?: Omit<ButtonOptions, "label">,
): boolean {
  // Label-first sugar: `if (UI.button("Resume")) ...` (API_PLAN #43).
  if (typeof optsOrLabel === "string") return button({ ...rest, label: optsOrLabel });
  const opts = optsOrLabel;
  const ctx = uiCtx();
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize + 2, true);
  // Auto width: the label plus comfortable padding.
  const w = opts.w ?? Math.ceil(measureWidth(ctx, opts.label)) + theme.buttonPadX;
  const rect = place(opts, w, opts.h ?? 30, "button");
  const id = widgetId(opts.id, "button");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    rect,
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
