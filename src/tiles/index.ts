// ---------- Tiles ----------
// Three clean layers:
//
//   LEVEL = DATA.  `Tiles.grid(ascii, { size, legend })` — the ASCII grid IS
//   the source file. Legend glyphs are tiles with SEMANTICS ONLY (solid,
//   oneWay, slope, region TAGS, multi-cell span — plain JSON facts); "." and " "
//   are empty; any other char is a spawn MARKER the game queries (`spawns`,
//   `spawnOne`). The whole level definition is serializable and collides
//   server-side (no canvas anywhere).
//
//   TILESET = NAMED CELLS.  `Tiles.set(image, { size, names })` — the
//   space-indexed cousin of `Anim.fromGrid`, plus cell SELECTORS: `pick`
//   (coord-seeded variants), `anim` (clock-derived water), `auto9`/`auto16`
//   (neighbor-aware autotiling).
//
//   SKIN = THE OPTIONAL JOIN, AT THE DRAW SITE. A semantic grid uses a plain
//   `{ key: color | cell | selector | null }` map, allowing themes/minimaps.
//   An authored LDtk Tile/AutoLayer already owns its pixels and renders
//   directly with `Draw.tiles(layer)`.
//
// The level is a `SolidSource`: `Collision.moveAndSlide(player, level)` gets
// grid broadphase for free.
//
// ONE RULE KEEPS THIS FROM TURNING INTO A GENRE
//
// The core names no game concepts. `solid`/`oneWay`/`slope` are here only
// because `Collision.Solid` has those exact fields, so a level has to be able
// to produce them; anything else a region might MEAN is an open-ended string
// `tag` read back through `rectsNear`/`tagAt`. There is therefore nowhere in
// this file to put "ladder", "ice" or "lava" even if you wanted to.
//
// The vocabulary lives one file over in `./presets` — plain data, no privileges,
// yours extensible — and `__tests__/tiles.core.test.ts` fails the build if a
// domain noun ever creeps back in here.

// The capability is one export subpath (`minimotor/tiles`) split into files by
// concern, the same shape `src/procgen` uses:
//
//   types.ts     every interface, no runtime
//   glyphs.ts    the empty-glyph contract — no imports, shared with procgen
//   cells.ts     oriented blitting and the coord hash
//   mesh.ts      greedy meshing + the row index — pure geometry, no semantics
//   grid.ts      `grid()` and `world()`: the Level and its queries
//   paint.ts     skin → pixels: selectors, the dual-grid lattice, the bake
//   tileset.ts   `set()`, the selectors, `recolor()`
//   tiled.ts     the Tiled .tmj/.tsj importer
//   presets.ts   THE BATTERIES — the only file allowed a game vocabulary

export type * from "./types.js";
export { orient } from "./cells.js";
export { EMPTY, isEmptyChar } from "./glyphs.js";
export { grid, world } from "./grid.js";
export { recolor, set } from "./tileset.js";
export { Tiled } from "./tiled.js";

// ---------- batteries ----------
// Re-exported so `Tiles.ladder` and `Tiles.climbable` are one import away, while
// the core above stays free of the vocabulary they define.
export * from "./presets.js";
