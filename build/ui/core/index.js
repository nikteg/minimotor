// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, text/select inputs, sliders, scrollbars, panels, popovers,
// modals, dialogue, drag/drop, confirm dialogs and meter bars. Everything draws in YOUR draw phase — no retained
// widget tree, no layout engine. Floating texts and spinners age on the
// fixed step (via Loop.onStep), so they pause with the loop like Clock/Tween.
//
// The canvas context is implicit inside an app-bound `createUI(app)` API.
// Driving the raw widget layer directly (what the tests do) means building a
// app and selecting it — which is exactly what `createUI` does for you:
//
//   selectUiApp(app);
//   button("PLAY");
//
// Colors and fonts come from the active theme — `UI.setTheme({...})` restyles
// every widget at once; per-widget style options still override.
//
// This is the kernel barrel: widgets and index.ts import from "./core/index.js".
// Split: context / theme (+ draw helpers) / flow (the `flow` layout cursor +
// container primitives) / identity / input (pointer + buttonState) / text / focus (the focusable
// registry + keyboard/pad nav) / lifecycle (per-frame overlay-pass
// flags, tooltip + float machinery, the ensureWired housekeeping, and the
// frame-end/reset hooks widgets register into). Widgets live in ../widgets and
// depend on this kernel, never the other way around.
export * from "./context.js";
export * from "./frame-cache.js";
export * from "./measure.js";
export * from "./layout-capture.js";
export * from "./state.js";
export * from "./theme.js";
export * from "./flow.js";
export * from "./identity.js";
export * from "./input.js";
export * from "./text.js";
export * from "./focus.js";
export * from "./lifecycle.js";
