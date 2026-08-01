// ---------- button ----------
import {
  Flowable,
  buttonState,
  centeredText,
  consumeKeyboardActivation,
  dragPayloadHeld,
  drawBox,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  measureWidth,
  place,
  registerFocusable,
  shade,
  theme,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
} from "@src/ui/core/index.js";
import { tooltip } from "./tooltip.js";
import { pointInRect } from "@src/collision/index.js";

/** Button look. `"default"` is the neutral filled button; `"primary"` fills
 *  with the theme accent (calls to action); `"danger"` fills red (destructive
 *  actions); `"ghost"` is text-only with no fill/border until hovered. */
export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** Style knobs for `button()`. Every color defaults from the theme. */
export interface ButtonStyle {
  /** Label size in px. Default `theme.fontSize + 2`. */
  size?: number;
  /** Bold label. Default true. */
  bold?: boolean;
  /** Full font string for the label — overrides `size`/`bold`/the theme font. */
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
  /** Use the theme's pixel button frame when available. Default true. */
  skin?: boolean;
}

/** A button's geometry + label. Position it yourself (`x`/`y` required,
 *  `w` optional — auto-sized to the label when omitted), or hand it a
 *  layout `Flow` via `at` and skip the geometry entirely. */
export interface ButtonOptions extends ButtonStyle, Flowable {
  /** Stable identity enables Tab focus and keyboard activation. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the button. */
  tabIndex?: number;
  /** Omit to use `theme.buttonW`, or auto-size to the label when it is 0. */
  w?: number;
  /** Button height in logical px. Default `theme.buttonH`. */
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
    base = { bg: theme.primary, label: theme.buttonText.primary, border: theme.primary };
  } else if (v === "danger") {
    base = { bg: theme.danger, label: theme.buttonText.danger, border: theme.danger };
  } else if (v === "ghost") {
    base = { bg: "transparent", label: theme.buttonText.ghost, border: "transparent" };
  } else {
    base = { bg: theme.bg, label: theme.buttonText.default, border: theme.border };
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

/** The width `button` would choose for this label under the active theme.
 *
 *  For laying out AROUND a button before it is placed — a `spacer` that pushes
 *  one flush right has to know how much room to leave, and a hardcoded number
 *  is wrong the moment a skin changes `buttonPadX`, `buttonMinW` or the font.
 *  Pass the same `font`/`size`/`bold` the button will get. */
export function buttonWidth(
  label: string,
  opts?: Pick<ButtonOptions, "font" | "size" | "bold">,
): number {
  const ctx = uiCtx();
  const prev = ctx.font;
  ctx.font = opts?.font ?? uiFont(opts?.size ?? theme.fontSize + 2, opts?.bold ?? true);
  const autoW = Math.ceil(measureWidth(ctx, label)) + theme.buttonPadX;
  ctx.font = prev;
  return theme.buttonW > 0 ? theme.buttonW : Math.max(autoW, theme.buttonMinW);
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
  ctx.font = opts.font ?? uiFont(opts.size ?? theme.fontSize + 2, opts.bold ?? true);
  // Auto width: the label plus comfortable padding. `buttonWidth` restates
  // this so a caller can reserve the same space before the button is placed.
  const autoW = Math.ceil(measureWidth(ctx, opts.label)) + theme.buttonPadX;
  const w = opts.w ?? (theme.buttonW > 0 ? theme.buttonW : Math.max(autoW, theme.buttonMinW));
  const rect = place(opts, w, opts.h ?? theme.buttonH, "button");
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
  // While a drag-and-drop payload is in flight the pointer is CARRYING it, not
  // pointing at controls: every button it crosses would otherwise light up and
  // compete with the drop target for the eye. Only the LOOK is suppressed —
  // `clicked` below is untouched, so a button that is also a drag source still
  // clicks when the pointer is released on it without a drag starting.
  const carrying = dragPayloadHeld();
  const hover = state.hover && !carrying;
  const active = state.active && !carrying;
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
    role: opts.skin === false ? undefined : "button",
    state: opts.disabled ? "disabled" : active ? "active" : hover ? "hover" : "default",
    variant: opts.variant ?? "default",
  });
  ctx.fillStyle = opts.disabled ? theme.buttonText.disabled : c.label;
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
