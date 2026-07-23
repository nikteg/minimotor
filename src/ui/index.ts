// ---------- UI ----------
// Immediate-mode canvas UI kit, split two ways:
//   core/     the runtime kernel — implicit context, theme, layout primitives,
//             input, focus, and the per-frame lifecycle (overlay-pass flags,
//             text-editor / tooltip / float machinery, ensureWired housekeeping).
//   widgets/  the controls built on the kernel — layout, buttons/toggles/etc,
//             lists, table, overlays, dragdrop, the native-backed select.
// The kernel depends on nothing above it; widgets depend on the kernel. The
// widgets barrel re-exports wholesale (select selectively, so its editor
// internals stay private); core is re-exported selectively, keeping the public
// `Minimotor.UI.*` surface exactly what it was before the split.
export * from "./widgets/index.js";

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
  setCursor,
  setNavPad,
  setTheme,
  stack,
  text,
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
  Stack,
  StackOptions,
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
