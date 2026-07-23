// ---------- Widgets ----------
// Interactive controls built on the immediate-mode kernel in ../core. Each is a
// thing you CALL to draw — button, dropdown, list, modal — as opposed to the
// kernel machinery they stand on (theme, layout, focus, the frame lifecycle).
// Nothing here is imported BY core: the native-backed widgets (select) hang
// their deferred draws off the kernel via its lifecycle hooks instead.
//
// Clean widget files re-export wholesale; select is re-exported selectively so
// its internal editor/overlay helpers stay private (matching the kernel's
// selective surface).
//   button / panel / toggle / tabs / list-item / slider / spinner / bar — the
//              basic controls (one file each)
//   layout    — row / col / group / spacer / clip
//   lists     — list / grid / scrollbar
//   table     — sortable data table
//   overlays  — popover / modal / confirm / dialog
//   dragdrop  — drag & drop
//   select    — native-backed dropdown
//   text-input — native-backed text field
export * from "./button.js";
export * from "./panel.js";
export * from "./toggle.js";
export * from "./tabs.js";
export * from "./list-item.js";
export * from "./slider.js";
export * from "./spinner.js";
export * from "./bar.js";
export * from "./layout.js";
export * from "./lists.js";
export * from "./table.js";
export * from "./overlays.js";
export * from "./dragdrop.js";
export { select } from "./select.js";
export type { SelectOption, SelectOptions, SelectResult } from "./select.js";
export { textInput } from "./text-input.js";
export type { TextInputOptions, TextInputResult } from "./text-input.js";
