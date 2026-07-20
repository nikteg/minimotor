// ---------- Essential game recipes ----------
// Goodies is Minimotor's intentional grab bag: familiar, dependency-free
// recipes that recur across arcade, grid, platformer, shooter, roguelike and
// other genres. Unlike low-level Mathf primitives, a Goodie may encode a small
// piece of game-domain knowledge. Recipes stay optional, composable and tested;
// games can use one without adopting a framework or prescribed architecture.
//
// The catalog is split into family modules for readability, but the public
// surface stays FLAT — everything is `Minimotor.Goodies.<recipe>`, no nested
// namespaces. Add a recipe to the family file it belongs to; this barrel just
// re-exports.
//
//   wrapping   — toroidal / wrap-around world math
//   random     — seeded RNG, chance, loot picks, shuffle bags, dice
//   grid       — neighbours, flood fill, lines, sight, distance fields
//   steering   — aim/lead a target, ring/grid formations
//   inventory  — item-stack move / merge / swap
//   scoring    — timing grades, score ranks, decaying combos
//   pacing     — checkpoints/laps, wave scaling, day cycle, charge meters
//   flash      — hit "white flash" timing latch

export * from "./goodies/wrapping.js";
export * from "./goodies/random.js";
export * from "./goodies/grid.js";
export * from "./goodies/steering.js";
export * from "./goodies/inventory.js";
export * from "./goodies/scoring.js";
export * from "./goodies/pacing.js";
export * from "./goodies/flash.js";
