// ---------- slider ----------
import {
  Flow,
  centeredText,
  consumeKeyboardCommand,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  place,
  registerFocusable,
  theme,
  uiFont,
  uiPointer,
  widgetId,
  withCtx,
} from "../core/index.js";
import { clamp } from "../../mathf.js";
import { pointInRect } from "../../collision.js";

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
  at?: Flow;
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
  ctxOrOptsOrLabel: CanvasRenderingContext2D | SliderOptions | string,
  optsOrValue?: SliderOptions | number,
  rest?: Omit<SliderOptions, "label" | "value">,
): number {
  // Label-first, value-in/value-out sugar (API_PLAN #43):
  //   Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume);
  if (typeof ctxOrOptsOrLabel === "string")
    return slider({ ...rest, label: ctxOrOptsOrLabel, value: optsOrValue as number });
  const [ctx, opts] = withCtx(ctxOrOptsOrLabel, optsOrValue as SliderOptions);
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const slot = place(opts, opts.w ?? 140, opts.h ?? 30);
  const fmt = (v: number) => (opts.format ? opts.format(v) : `${Math.round(v)}`);
  // Reserve room INSIDE the slot for both the left label and the right value
  // readout, so the track sits between them and neither spills past the
  // widget's box. The value width is taken from the range extremes (not the
  // live value) so the track doesn't resize — and the knob doesn't wobble —
  // while dragging.
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelSpace = opts.label ? Math.ceil(ctx.measureText(opts.label).width) + 10 : 0;
  const valueSpace =
    Math.ceil(Math.max(ctx.measureText(fmt(min)).width, ctx.measureText(fmt(max)).width)) + 12;
  ctx.restore();
  const sx = slot.x + labelSpace;
  const sy = slot.y + slot.h / 2;
  const sw = Math.max(10, slot.w - labelSpace - valueSpace);
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
  ctx.textAlign = "right";
  centeredText(ctx, fmt(value), slot.x + slot.w, sy);
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, hit);
  return value;
}
