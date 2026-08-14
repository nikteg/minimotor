// ---------- Procgen ----------
// Level generation as pure, seeded functions over CHAR GRIDS — the same
// `string[][]` that `Tiles.grid` already accepts as a level source. Nothing
// here touches a canvas, so the identical code runs in the browser (a new
// dungeon every run), under the `mm` CLI at author time, and on a server.
//
// The pieces do different jobs, and the useful thing is the ORDER they compose
// in. Each layer can only guarantee what it is actually able to see:
//
//   STRUCTURE   `rooms` / `chunks` / `caves`, then `topology` over the result
//               Where the rooms are and what leads where. Combinatorial,
//               all-or-nothing facts, so they are built by construction rather
//               than searched for.
//
//   TEXTURE     `analyze` or `overlapping`, then `synthesize`
//               "More tiles like the ones I drew." Both learn from one
//               hand-drawn sample and fill space with it; neither has any idea
//               whether the exit is reachable.
//                 `analyze`     rules between single glyphs. Cheap, forgiving,
//                               never an illegal join — but it reproduces
//                               legality, not motifs.
//                 `overlapping` rules between N x N windows, so a 2x2 pool or a
//                               pillar shape is a fact the model holds rather
//                               than something it must rediscover cell by cell.
//                               Costs more patterns; looks far more like you.
//
//   AIM         `metrics` + `illuminate` (MAP-Elites), and `steer` (gradient
//               descent). Push generation toward what you actually want —
//               15% water, a difficulty ramp, a spread of long-and-open versus
//               short-and-twisty levels. Aiming is a preference, never a
//               guarantee.
//
//   GUARANTEE   `repair`
//               Reachability, enforced last. Nothing above it can promise this,
//               so nothing above it should try.
//
// Everything above is a TECHNIQUE — it describes how to generate space, and
// takes no view on what the space is for. A generator that encodes one game's
// conventions instead ("locked door, key on a side branch") is a RECIPE, and
// recipes live under `./recipes` so the difference stays visible. `dungeon` is
// the one shipped: read it as a worked example, copy it, disagree with it.
//
// A typical pipeline reads top to bottom:
//
//     import * as Procgen from "minimotor/procgen";
//
//     const model = Procgen.analyze(handDrawnRoom, { border: "#" });
//     const field = Procgen.steer(model, { cols: 60, rows: 40, targets: [...] });
//     const raw = Procgen.synthesize(model, { cols: 60, rows: 40, seed, weights: field });
//     const grid = Procgen.repair(raw);
//     const level = Tiles.grid(grid, { size: 16, legend });
export { EMPTY, asGrid, at, cloneGrid, cols, fillRect, fromText, glyphs, makeGrid, put, rows, toText, } from "./grid.js";
export { OUTSIDE, analyze, defineModel, resynthesize, synthesize, } from "./wfc.js";
export { glyphWeights, overlapping, } from "./overlapping.js";
export { caves } from "./caves.js";
export { chunks, roomBounds, rooms, } from "./rooms.js";
export { adjacencyOf, bfs, branchesBefore, farthest, pathBetween, topology, } from "./graph.js";
// ---------- recipes ----------
// One game's conventions, built on the techniques above. Re-exported for
// convenience; nothing else in this module depends on them.
export { DUNGEON_MARKERS, dungeon, } from "./recipes/dungeon.js";
export { corridorRatio, deadEnds, frequencies, longestPath, measure, openness, pathLength, reachableFraction, symmetry, } from "./metrics.js";
export { ramp, steer } from "./steer.js";
export { illuminate } from "./elites.js";
export { isConnected, openNeighbours, regions, repair, sealEdges, } from "./repair.js";
