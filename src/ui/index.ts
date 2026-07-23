// ---------- UI ----------
// Immediate-mode canvas UI kit. `core.ts` is the runtime kernel (implicit
// context, theme, layout primitives, input, focus, overlay/editor/tooltip/
// float frame-machinery) plus the two widgets welded to that machinery
// (textInput, select). The other files are widgets built on the kernel:
//   layout    — row / col / group / spacer / clip
//   controls  — button / panel / toggle / tabs / listItem / slider / spinner / bar
//   lists     — list / grid / scrollbar
//   table     — sortable data table
//   overlays  — popover / modal / confirm / dialog
//   dragdrop  — drag & drop
// Widget files re-export wholesale; core is re-exported selectively so its
// internal kernel helpers stay private and the public `Minimotor.UI.*` surface
// is exactly what it was before the split.
export * from "./layout.js";
export * from "./controls.js";
export * from "./lists.js";
export * from "./table.js";
export * from "./overlays.js";
export * from "./dragdrop.js";

export {
  begin,
  blur,
  buttonState,
  clearFloatText,
  createFloatText,
  defaultTheme,
  drawFloatText,
  drawTips,
  floatText,
  focus,
  focusedId,
  focusNext,
  focusPrevious,
  getTheme,
  ids,
  idScope,
  select,
  setCursor,
  setTheme,
  stack,
  text,
  textInput,
  textWidth,
  tooltip,
  _reset,
} from "./core/index.js";
export type {
  FloatTextManager,
  FloatTextOptions,
  IdPart,
  LayoutChildren,
  LayoutOptions,
  SelectOption,
  SelectOptions,
  SelectResult,
  Stack,
  StackOptions,
  TextInputOptions,
  TextInputResult,
  TextOptions,
  Theme,
} from "./core/index.js";

// ---------- Interface time ----------
import { animate as animateValue, type AnimateOptions, type Motion } from "../anim/value.js";
import { Clock } from "../clock.js";

/** A Motion in INTERFACE time (`Clock.ui`) — pause-menu pulses, HUD flashes.
 *  Never frozen by modal pushes, never bent by slow-mo. World effects use
 *  `Anim.animate` (game time). */
export function animate(opts: Omit<AnimateOptions, "clock">): Motion {
  return animateValue({ ...opts, clock: Clock.ui });
}
