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
  clearFloats,
  createFloats,
  defaultTheme,
  drawFloats,
  drawTips,
  float,
  focus,
  focusedId,
  focusNext,
  focusPrevious,
  getTheme,
  ids,
  idScope,
  select,
  setTheme,
  stack,
  text,
  textInput,
  textWidth,
  tooltip,
  _reset,
} from "./core/index.js";
export type {
  FloatManager,
  FloatOptions,
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
