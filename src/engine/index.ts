// ---------- Minimal game framework ----------
// The engine runtime: one default game (Stage.init) exposed through the
// Stage / Loop / Draw / Keys / Pointer / Mouse facade, plus createGame for
// isolated instances. Split into focused files:
//   game         — the game types + the createGame factory
//   default-game — the shared default-instance slot the facades read
//   stage        — Stage + Loop (lifecycle / loop facade)
//   draw         — Draw + its primitives and sprite/tile/particle types
//   input        — Keys / Pointer / Mouse (polled input facade)
export * from "./game.js";
export * from "./default-game.js";
export * from "./stage.js";
export * from "./draw.js";
export * from "./input.js";
export * from "./keycodes.js";
