// ---------- UI ----------
// Immediate-mode canvas UI kit, split two ways:
//   core/     the runtime kernel — implicit context, theme, layout primitives,
//             input, focus, and the per-frame lifecycle (overlay-capture flags,
//             ensureWired housekeeping, and the step/frame-end/reset hooks that
//             widgets register into).
//   widgets/  the controls built on the kernel — buttons/toggles/etc, layout,
//             lists, table, overlays, dragdrop, float-text, tooltip, and the
//             native-backed select + text-input.
// The kernel depends on nothing above it; widgets depend on the kernel. The
// widgets barrel re-exports wholesale (select selectively, so its editor
// internals stay private); core is re-exported selectively, keeping the public
// `Minimotor.UI.*` surface exactly what it was before the split.
export * from "./widgets/index.js";

export {
  begin,
  blur,
  buttonState,
  defaultTheme,
  focus,
  focusedId,
  focusNext,
  focusPrevious,
  getTheme,
  ids,
  idScope,
  lastWidgetRect as lastRect,
  layoutCapture,
  layoutIssues,
  layoutTree,
  measureWidth,
  metrics as textMetrics,
  setBaseSize,
  setCursor,
  setNavPad,
  setScale,
  setTheme,
  flow,
  text,
  textWidth,
  uiHeight as height,
  uiWidth as width,
  uiToScreen as toScreen,
  uiFromScreen as fromScreen,
  _reset,
} from "./core/index.js";
export type {
  Fillable,
  Flowable,
  GlyphMetrics,
  IdPart,
  LayoutChildren,
  LayoutEntry,
  LayoutIssue,
  LayoutOptions,
  Flow,
  FlowOptions,
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
