// ---------- Gizmos: stateful game gadgets ----------
// Gizmos is the stateful sibling of Goodies. Where a Goodie is a pure function
// (call it, get a value), a Gizmo is a little machine you CREATE once and then
// tick or mutate across frames — it carries live state. The public surface is
// flat, matching Goodies: `Minimotor.Gizmos.<gadget>`.
//
//   random   — seeded RNG generator, without-replacement shuffle bag
//   motion   — patrol oscillator, motion-trail ring
//   scoring  — decaying hit-streak combo
//   pacing   — ordered checkpoint/lap tracker, regenerating charge pool
//   flash    — hit "white flash" timing latch
//   history  — capped undo snapshot stack
//   vehicle  — arcade car driving model (drives an injected physics body)
//   skidmarks— fading tyre rubber laid down while drifting

export * from "./random.js";
export * from "./motion.js";
export * from "./scoring.js";
export * from "./pacing.js";
export * from "./flash.js";
export * from "./history.js";
export * from "./vehicle.js";
export * from "./skidmarks.js";
