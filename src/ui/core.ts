// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons,
// toggles, tabs, text/select inputs, sliders, scrollbars, panels, popovers,
// modals, dialogue, drag/drop, confirm dialogs and meter bars. Everything draws in YOUR draw phase — no retained
// widget tree, no layout engine. Floating texts and spinners age on the
// fixed step (via Loop.onStep), so they pause with the loop like Clock/Tween.
//
// The canvas context is implicit: widgets draw to the default game's ctx —
// no plumbing. Pass one explicitly only for isolated games/offscreen work
// (`UI.begin(ctx)` per frame, or the `(ctx, opts)` call form):
//
//   Minimotor.UI.float("+100", x, y, { color: "#ffd43b" }); // spawn (update)
//   if (Minimotor.UI.button({ x, y, label: "PLAY" })) start();
//   Minimotor.UI.bar(10, 10, 120, 10, hp / maxHp);
//   Minimotor.UI.drawFloats(); // late in draw: floats, then tooltips
//   Minimotor.UI.drawTips();
//
// Colors and fonts come from the active theme — `UI.setTheme({...})` restyles
// every widget at once; per-widget style options still override.
//
// core.ts is a barrel over the kernel sub-modules; widgets and index.ts still
// import from "./core.js" unchanged. Split: context / theme (+ draw helpers) /
// stack (layout primitives) / identity / input (pointer + buttonState) / text /
// frame (the coupled focus + overlay + editor + tooltip + float machinery, the
// per-frame ensureWired housekeeping, and the frame-welded textInput/select).

export * from "./context.js";
export * from "./theme.js";
export * from "./stack.js";
export * from "./identity.js";
export * from "./input.js";
export * from "./text.js";
export * from "./frame.js";
