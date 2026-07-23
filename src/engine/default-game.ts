import type { Game } from "./game.js";

// ---------- Global default-engine slot ----------
// The whole engine is reached as `Minimotor.*` namespaces backed by ONE default
// game built by `Stage.init()`. Game code reads these instead of importing a
// game instance. `createGame()` (game.ts) stays for isolated instances (tests).
//
// The slot lives here so `Stage`, `Loop`, `Draw`, `Keys` and `Pointer` — now in
// their own files — all share it through these accessors rather than a binding
// none of them could reassign across modules.

let current: Game | null = null;

/** The default game, or `null` before `Stage.init`. */
export function getDefaultGame(): Game | null {
  return current;
}

/** Install (or clear) the default game — used by `Stage.init`. */
export function setDefaultGame(g: Game | null): void {
  current = g;
}

/** Clear the default-game slot if `g` holds it — called from a game's own
 *  `destroy()` in game.ts, which can't reassign this imported binding. */
export function clearDefaultGame(g: Game): void {
  if (current === g) current = null;
}

export function requireDefault(): Game {
  if (!current) {
    throw new Error(
      "Minimotor: call Minimotor.Stage.init(canvas) before using Stage / Loop / Keys / Pointer / Draw",
    );
  }
  return current;
}
