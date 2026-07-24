// ---------- Minimal game framework ----------
// The engine runtime: one default app (Stage.init) exposed through the
// Stage / Loop / Draw / Keys / Pointer / Mouse facade, plus createApp for
// isolated instances. Split into focused files:
//   app          — the app types + the createApp factory
//   default-app  — the shared default-instance slot the facades read
//   stage        — Stage + Loop (lifecycle / loop facade)
//   draw         — Draw + its primitives and sprite/tile/particle types
//   input        — Keys / Pointer / Mouse (polled input facade)
export * from "./app.js";
export * from "./default-app.js";
export * from "./stage.js";
export * from "./draw.js";
export * from "./input.js";
export * from "./keycodes.js";
