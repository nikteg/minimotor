// ---------- Widgets ----------
// Interactive controls built on the immediate-mode kernel in ../core. Each is a
// thing you CALL to draw — button, dropdown, list, modal — as opposed to the
// kernel machinery they stand on (theme, layout, focus, the frame lifecycle).
// Nothing here is imported BY core: the native-backed widgets (select) hang
// their deferred draws off the kernel via its lifecycle hooks instead.
//
// Clean widget files re-export wholesale; select/text-input are re-exported
// selectively so their internal editor/overlay helpers stay private (matching
// the kernel's selective surface).
//   button / toggle / tabs / slider / spinner / bar — the basic controls
//              (one file each)
//   layout     — row / col / panel (framed container) / spacer / clip
//   lists      — list / grid / scrollbar / listItem
//   table      — sortable data table
//   overlays   — popover / modal / confirm / dialog
//   dragdrop   — drag & drop
//   float-text — rising score/damage numbers
//   tooltip    — hover tooltip
//   select     — native-backed dropdown
//   text-input — native-backed text field
// (panel.ts holds the internal frame painter used by panel/overlays/select — not
//  a public widget, so it is NOT re-exported here.)
export * from "./button.js";
export * from "./toggle.js";
export * from "./tabs.js";
export * from "./slider.js";
export * from "./spinner.js";
export * from "./bar.js";
export * from "./layout.js";
export * from "./lists.js";
export * from "./table.js";
export * from "./overlays.js";
export * from "./dragdrop.js";
export * from "./float-text.js";
export * from "./tooltip.js";
export { select } from "./select.js";
export type { SelectOption, SelectOptions, SelectResult } from "./select.js";
export { textInput } from "./text-input.js";
export type { TextInputOptions, TextInputResult } from "./text-input.js";
