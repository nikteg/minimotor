// ---------- slider ----------
import {
  Flowable,
  centeredText,
  claimPointerGesture,
  consumeKeyboardCommand,
  drawBox,
  dragPointer,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  lifecycleOnce,
  measureWidth,
  onFrameEnd,
  placeField,
  rawPointer,
  registerFocusable,
  uiSlot,
  theme,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
} from "@src/ui/core/index.js";
import { clamp } from "@src/math/mathf.js";
import { pointInRect } from "@src/collision/index.js";

/** A horizontal value slider. */
export interface SliderOptions extends Flowable {
  /** Widget width in px (label + track). Default `140`. */
  w?: number;
  /** Slot height in px. Default `30`. */
  h?: number;
  /** Range minimum. Default `0`. */
  min?: number;
  /** Range maximum. Default `1`. */
  max?: number;
  /** Current value — pass your state in, assign the return value back. */
  value: number;
  /** Snap increment (e.g. 5) — also the arrow-key step when the slider has
   *  keyboard focus. Default continuous, with arrow keys stepping by
   *  (max − min) / 100. */
  step?: number;
  /** Caption drawn left of the track. */
  label?: string;
  /** Value text drawn right of the track. By default unit ranges show two
   *  decimals, stepped ranges match their step precision, and others round. */
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
  /** The grab: the pointer went down on this slider's track or knob. Paired
   *  with `onRelease`, and NOTHING is called for the value changes in
   *  between — which is the whole point of the pair.
   *
   *  A slider's value moves once per frame while it is being dragged, so a
   *  caller that hangs a click, a haptic or a save on "the value changed" fires
   *  it sixty times a second. A consumer's volume sliders played the
   *  interface's click on every step and machine-gunned across a drag
   *  (31 clips for one sweep of the track). Grab and let-go are the two edges a
   *  gesture actually has, and they are the two the kit had no way to report. */
  onPress?: () => void;
  /** The let-go: the drag this slider owned has ended, wherever the pointer
   *  came up — including outside the widget, and including a press that never
   *  moved the value at all.
   *
   *  Exactly one per `onPress`, EXCEPT when the slider stops being drawn while
   *  the drag is live (its modal closed under the finger): a widget that is not
   *  drawn cannot be told anything, and the pending let-go is dropped rather
   *  than saved up for whenever it is next drawn. */
  onRelease?: () => void;
}

// One slider drag at a time (per UI runtime), tracked across frames by id.
//
// `released` is the id whose drag ENDED this frame, announced rather than acted
// on because the slider that owned the drag is not necessarily the one that
// notices the pointer went up: the slot is shared, so whichever slider is drawn
// FIRST is the one that runs the release check, and in a settings panel that is
// usually not the one under the finger.
const sliderDragSlot = uiSlot<{ id: string | null; released: string | null }>(() => ({
  id: null,
  released: null,
}));

// Frame-end housekeeping for a gesture whose slider may no longer be on screen.
// An unclaimed announcement lives for one frame and no longer, and a drag whose
// slider was not drawn at all ends here — otherwise a modal dismissed under the
// finger leaves `id` set, and the next time that panel is opened the first
// slider drawn announces a let-go for a gesture that finished a minute ago.
const ensureSliderHooks = lifecycleOnce(() =>
  onFrameEnd(() => {
    const sd = sliderDragSlot();
    sd.released = null;
    if (!rawPointer().down) sd.id = null;
  }),
);

/** How many stops `valueSpace` will walk before it gives up and reads the ends
 *  only. A stepped range longer than this is a continuous control with a snap
 *  on it, not a list of positions with names, and its formatter is a number
 *  whose widest form is at one end. */
const MEASURED_STOPS_LIMIT = 64;

// The room the value readout needs, measured over the WHOLE range rather than
// the live value — the track must not resize, and the knob must not wobble,
// while the thing is being dragged.
//
// The ends are not the widest text. `step` turns the range into a fixed set of
// stops, and a caller that NAMES them can easily put its longest name in the
// middle: a UI-scale slider stepping over 1x, 1.125x, 1.25x, 1.5x,
// 1.75x, 2x, where every interior stop is wider than both ends and "1.125x"
// is three times the width of "1x". Reserving for the ends alone left that one
// painting over the bar.
function valueSpaceFor(
  ctx: CanvasRenderingContext2D,
  fmt: (v: number) => string,
  min: number,
  max: number,
  step: number | undefined,
): number {
  let widest = Math.max(measureWidth(ctx, fmt(min)), measureWidth(ctx, fmt(max)));
  const stops = step && step > 0 ? (max - min) / step : Infinity;
  if (!Number.isFinite(stops) || stops > MEASURED_STOPS_LIMIT) return widest;
  for (let i = 1; i < stops; i++)
    widest = Math.max(widest, measureWidth(ctx, fmt(min + i * step!)));
  return widest;
}

/** Draw a slider and return the (possibly changed) new value — drag the knob
 *  or click anywhere on the track:
 *
 *    volume = UI.slider({ x, y, w: 140, value: volume, label: "VOL" }); */
export function slider(
  label: string,
  value: number,
  opts?: Omit<SliderOptions, "label" | "value">,
): number;
export function slider(opts: SliderOptions): number;
export function slider(
  optsOrLabel: SliderOptions | string,
  valueArg?: number,
  rest?: Omit<SliderOptions, "label" | "value">,
): number {
  // Label-first, value-in/value-out sugar (API_PLAN #43):
  //   Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume);
  if (typeof optsOrLabel === "string")
    return slider({ ...rest, label: optsOrLabel, value: valueArg as number });
  const opts = optsOrLabel;
  ensureSliderHooks();
  const ctx = uiCtx();
  const min = opts.min ?? 0;
  const max = opts.max ?? 1;
  const slot = placeField(opts, opts.w ?? 140, opts.h ?? 30, "slider");
  const stepText = opts.step?.toString() ?? "";
  const stepDecimals = stepText.includes(".") ? stepText.length - stepText.indexOf(".") - 1 : 0;
  const decimals = opts.step !== undefined ? stepDecimals : max - min <= 1 ? 2 : 0;
  const fmt = (v: number) => (opts.format ? opts.format(v) : v.toFixed(decimals));
  // Reserve room INSIDE the slot for both the left label and the right value
  // readout, so the track sits between them and neither spills past the
  // widget's box. See `valueSpaceFor` for where the value's width comes from.
  ctx.save();
  ctx.font = opts.font ?? uiFont();
  const labelSpace = opts.label ? Math.ceil(measureWidth(ctx, opts.label)) + 10 : 0;
  const valueSpace = Math.ceil(valueSpaceFor(ctx, fmt, min, max, opts.step)) + 12;
  ctx.restore();
  const sx = slot.x + labelSpace;
  const sy = slot.y + slot.h / 2;
  const sw = Math.max(10, slot.w - labelSpace - valueSpace);
  const id = widgetId(opts.id, "slider") ?? `${sx}:${sy}`;
  const knobSprite = theme.skin?.sprites.sliderKnob;
  const knobW = knobSprite?.region.sw ?? 14;
  const knobH = knobSprite?.region.sh ?? 14;
  const knobHalfW = knobW / 2;
  const knobHalfH = knobH / 2;
  // Where the value sits INSIDE the knob art. Centered unless the skin says
  // otherwise — the Tiny RPG knob is a comet whose head is the handle and whose
  // tail is decoration, so its anchor is over the head.
  const knobAnchorX = knobSprite?.anchor?.x ?? knobHalfW;
  const knobAnchorY = knobSprite?.anchor?.y ?? knobHalfH;
  const p = uiPointer();
  // Generous hit region: the whole track strip, plus the knob art either side
  // of the anchor at the endpoints.
  const hit = {
    x: sx - knobAnchorX,
    y: sy - knobAnchorY,
    w: sw + knobW,
    h: knobH,
  };
  const keyboardFocused = registerFocusable(ctx, {
    id,
    disabled: opts.disabled,
    tabIndex: opts.tabIndex,
    rect: slot,
  });
  const pointerHover = !opts.disabled && pointInRect(p.x, p.y, hit);
  const focusHover = keyboardFocused && theme.focusStyle === "hover";
  const hover = pointerHover || focusHover;
  const sd = sliderDragSlot();
  hoverCursor(pointerHover || sd.id === id);

  // Release the drag on the REAL pointer-up, not the clip/overlay-gated one:
  // the drag slot is SHARED by every slider, and a slider sitting inside a
  // clipped scroll region sees a DEAD pointer (down=false) whenever the finger
  // is outside ITS clip — it must not cancel another slider's live drag (nor
  // its own when the finger wanders out of the clip mid-drag).
  if (!rawPointer().down && sd.id) {
    sd.released = sd.id;
    sd.id = null;
  }
  if (p.pressed && pointerHover && !sd.id) {
    sd.id = id;
    focusFromPointer(ctx, id);
    opts.onPress?.();
  }
  // Read AFTER the clear above so a slider that ends its own drag still hears
  // about it in the same frame, and consumed so the frame-end sweep only ever
  // has to drop an announcement nobody was drawn to collect.
  if (sd.released === id) {
    sd.released = null;
    opts.onRelease?.();
  }
  // While dragging, the slider owns the pointer — a slider inside a scroll
  // region must never also swipe-scroll it.
  if (sd.id === id) claimPointerGesture();

  let value = clamp(opts.value, min, max);
  const command = consumeKeyboardCommand(id);
  const keyboardStep = opts.step ?? (max - min) / 100;
  if (command === "ArrowRight" || command === "ArrowUp") value += keyboardStep;
  if (command === "ArrowLeft" || command === "ArrowDown") value -= keyboardStep;
  value = clamp(value, min, max);
  if (sd.id === id) {
    // Track through `dragPointer`: mapped into the same space as the track but
    // never clip-gated, so the knob keeps following a finger that strays
    // outside the widget's clip region mid-drag.
    value = min + ((dragPointer().x - sx) / sw) * (max - min);
    if (opts.step) value = Math.round(value / opts.step) * opts.step;
    value = clamp(value, min, max);
  }
  const valueRatio = (value - min) / (max - min || 1);
  // ONE position drives the fill and the knob, and it is the same mapping the
  // drag above reads the value back through — so the knob sits exactly under
  // the cursor, and the fill spans the whole track at `max`. (Travelling the
  // knob's LEFT edge over `sw - knobW` instead makes it lag the pointer by up
  // to a knob width and stops the fill short of the end.)
  const valueX = sx + valueRatio * sw;
  const knobX = valueX - knobAnchorX;

  ctx.save();
  ctx.font = opts.font ?? uiFont();
  if (opts.label) {
    ctx.fillStyle = opts.color ?? theme.text;
    ctx.textAlign = "left";
    centeredText(ctx, opts.label, slot.x, sy);
  }
  const trackH = theme.skin?.frames.sliderTrack ? theme.sliderH : 4;
  const trackY = sy - trackH / 2;
  drawBox(ctx, sx, trackY, sw, trackH, {
    fill: theme.track,
    role: "sliderTrack",
  });
  if (valueX > sx) {
    drawBox(ctx, sx, trackY, valueX - sx, trackH, {
      fill: theme.accent,
      role: "sliderFill",
    });
  }
  if (knobSprite) {
    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      knobSprite.image,
      knobSprite.region.sx,
      knobSprite.region.sy,
      knobSprite.region.sw,
      knobSprite.region.sh,
      knobX,
      sy - knobAnchorY,
      knobW,
      knobH,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
  } else {
    ctx.beginPath();
    ctx.arc(valueX, sy, knobHalfW, 0, Math.PI * 2);
    ctx.fillStyle = sd.id === id || hover ? theme.accent : theme.accentSoft;
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? theme.text;
  ctx.textAlign = "right";
  centeredText(ctx, fmt(value), slot.x + slot.w, sy);
  ctx.restore();
  if (keyboardFocused && !focusHover) drawFocusRing(ctx, hit);
  return value;
}
