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
// `createUI(app)` surface while keeping every raw widget implementation private.
export * from "./widgets/index.js";
export { createTilesetSkin, createTilesetSkinFromManifest, drawThemeSprite, frameFromCell, inspectTilesetSkin, } from "./core/index.js";
export { blur, buttonState, captureOverlay, holdOverlay, releaseOverlay, defaultTheme, drawLayoutOverlay, focus, focusedId, focusNext, focusPrevious, getTheme, ids, idScope, lastWidgetRect as lastRect, layoutCapture, layoutIssues, layoutLag, layoutTree, measureWidth, metrics as textMetrics, paintIssues, pointerOverUi, pressOrigin, setBaseSize, setCursor, setNavPad, setScale, setTheme, withTheme, flow, text, textWidth, uiHeight as height, uiWidth as width, vh, vw, uiToScreen as toScreen, uiFromScreen as fromScreen, _reset, } from "./core/index.js";
