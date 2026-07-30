// ---------- toggle ----------
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

/** A labeled checkbox. */
export interface ToggleOptions extends Flowable {
  /** Stable identity enables Tab focus and keyboard activation. */
  id?: string;
  /** Keyboard traversal order. Negative values exclude the toggle. */
  tabIndex?: number;
  /** Grayed out and unclickable. */
  disabled?: boolean;
  /** Slot height when placed in a layout (the box centers within it). */
  h?: number;
  /** Text drawn right of the box (also part of the click target). */
  label: string;
  /** Current value — pass your state in, assign the return value back. */
  on: boolean;
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
 *    hideFull = UI.toggle({ x, y, label: "Hide full", on: hideFull }); */
export function toggle(
  label: string,
  on: boolean,
  opts?: Omit<ToggleOptions, "label" | "on">,
): boolean;
export function toggle(opts: ToggleOptions): boolean;
export function toggle(
  optsOrLabel: ToggleOptions | string,
  onArg?: boolean,
  rest?: Omit<ToggleOptions, "label" | "on">,
): boolean {
  // Label-first sugar: `muted = UI.toggle("Mute", muted)` (API_PLAN #43).
  if (typeof optsOrLabel === "string") return toggle({ ...rest, label: optsOrLabel, on: !!onArg });
  const opts = optsOrLabel;
  const ctx = uiCtx();
  const size = opts.size ?? 16;
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelW = measureWidth(ctx, opts.label);
  const w = size + 8 + Math.ceil(labelW);
  // Hit region spans box + label, so the text is clickable too. Placed via a
  // layout, the box is vertically centered on the taller slot.
  const slot = place({ x: opts.x, y: opts.y, w, h: opts.h, at: opts.at }, w, size, "toggle");
  const rect = { x: slot.x, y: slot.y + Math.max(0, (slot.h - size) / 2), w, h: size };
  const id = widgetId(opts.id, "toggle");
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    rect,
  });
  const state = opts.disabled ? { hover: false, clicked: false } : buttonState(rect, uiPointer());
  const clicked = state.clicked || (!opts.disabled && consumeKeyboardActivation(id));
  if (state.clicked) focusFromPointer(ctx, id);
  hoverCursor(state.hover);
  if (state.hover && opts.tooltip) tooltip(opts.tooltip);
  const on = clicked ? !opts.on : opts.on;

  // Dim a locked/disabled checkbox AND its label so it reads as unavailable
  // (covers the box, the check, and the text — all drawn under this alpha).
  if (opts.disabled) ctx.globalAlpha *= 0.45;

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
