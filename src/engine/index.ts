// ---------- Minimal 2D canvas framework ----------
// The engine runtime: one default app (App.init) exposed through the
// App / Loop / Draw / Keys / Pointer / Mouse facade, plus createApp for
// isolated instances. Split into focused files:
//   app          — the app types + the createApp factory
//   default-app  — the shared default-instance slot the facades read
//   facade       — App + Loop (lifecycle / loop facade)
//   draw         — Draw + its primitives and sprite/tile/particle types
//   input        — Keys / Pointer / Mouse (polled input facade)
export * from "./app.js";
export * from "./default-app.js";
export * from "./facade.js";
// `App` is exported ambiguously above — the interface (app.js) and the facade
// const + type alias (facade.js) share the name, and `export *` drops
// ambiguous names. facade.js carries BOTH meanings (its const plus a type
// alias of the interface), so one explicit re-export resolves the name.
export { App } from "./facade.js";
export * from "./draw.js";
export * from "./input.js";
export * from "./keycodes.js";
