// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, text/select inputs, sliders, scrollbars, panels, popovers,
// modals, dialogue, drag/drop, confirm dialogs and meter bars. Everything draws in YOUR draw phase — no retained
// widget tree, no layout engine. Floating texts and spinners age on the
// fixed step (via Loop.onStep), so they pause with the loop like Clock/Tween.
//
// The canvas context is implicit: widgets draw to the default app's ctx —
// no plumbing. Point them at another context (isolated apps/offscreen work)
// with `UI.begin(ctx)` once per frame:
//
//   Minimotor.UI.floatText("+100", x, y, { color: "#ffd43b" }); // spawn (update)
//   if (Minimotor.UI.button({ x, y, label: "PLAY" })) start();
//   Minimotor.UI.bar(10, 10, 120, 10, hp / maxHp);
//   Minimotor.UI.drawFloatText(); // late in draw: texts, then tooltips
//   Minimotor.UI.drawTips();
//
// Colors and fonts come from the active theme — `UI.setTheme({...})` restyles
// every widget at once; per-widget style options still override.
//
// This is the kernel barrel: widgets and index.ts import from "./core/index.js".
// Split: context / theme (+ draw helpers) / flow (the `flow` layout cursor +
// container primitives) / identity / input (pointer + buttonState) / text / focus (the focusable
// registry + keyboard/pad nav) / lifecycle (the per-frame runtime — overlay-pass
// flags, tooltip + float machinery, the ensureWired housekeeping, and the
// frame-end/reset hooks widgets register into). Widgets live in ../widgets and
// depend on this kernel, never the other way around.

export * from "./context.js";
export * from "./frame-cache.js";
export * from "./runtime.js";
export * from "./theme.js";
export * from "./flow.js";
export * from "./identity.js";
export * from "./input.js";
export * from "./text.js";
export * from "./focus.js";
export * from "./lifecycle.js";
