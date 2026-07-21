// ---------- Essential game recipes ----------
// Goodies is Minimotor's intentional grab bag: familiar, dependency-free, PURE
// recipes (call one, get a value) that recur across arcade, grid, platformer,
// shooter, roguelike and other genres. Unlike low-level Mathf primitives, a
// Goodie may encode a small piece of game-domain knowledge. Recipes stay
// optional, composable and tested; games can use one without adopting a
// framework or prescribed architecture.
//
// Stateful gadgets you create-then-tick (combo, checkpointRoute, flash, trail,
// charges, seedRng, shuffleBag, patrol, undoStack, car) live in the sibling
// module `Gizmos`.
//
// The catalog is split into family modules for readability, but the public
// surface stays FLAT — everything is `Minimotor.Goodies.<recipe>`, no nested
// namespaces. Add a recipe to the family file it belongs to; this barrel just
// re-exports.
//
//   wrapping   — toroidal / wrap-around world math
//   random     — chance, loot picks, one-shot shuffle, dice
//   grid       — neighbours, flood fill, lines, sight, distance fields
//   steering   — aim/lead a target, ring/grid formations
//   inventory  — item-stack move / merge / swap
//   scoring    — timing grades, score ranks, beat timing
//   pacing     — wave scaling, day cycle

export * from "./wrapping.js";
export * from "./random.js";
export * from "./grid.js";
export * from "./steering.js";
export * from "./inventory.js";
export * from "./scoring.js";
export * from "./pacing.js";
