// ---------- Minimal game framework ----------
// The engine runtime: one default game (Stage.init) exposed through the
// Stage / Loop / Draw / Keys / Pointer / Mouse facade, plus createGame for
// isolated instances. Split into game (types + the game factory) and facade
// (the default-game global + its namespaces).
export * from "./game.js";
export * from "./facade.js";
export * from "./keycodes.js";
