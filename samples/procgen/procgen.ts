// Procgen demo: minimotor/procgen, end to end.
//
// Five generators, one screen. Each produces a plain char grid, which becomes a
// Tiles.Level and is drawn through a skin — so everything here is the ordinary
// tile pipeline, just with the grid invented instead of typed.
//
//   1  DUNGEON  graph topology first: entrance, critical path, locked door with
//               its key placed on a branch you can reach BEFORE the door.
//   2  CAVE     cellular automata, then `repair` to guarantee connectivity.
//   3  WFC      adjacency learned from the hand-drawn sample below; the output
//               never contains a tile join the sample did not.
//   4  STEERED  the same WFC model, but `steer` first descends a soft per-cell
//               field toward "rock ramps up toward the right", and hands that
//               to WFC as weights. Watch the right side thicken.
//   5  PATTERNS the OVERLAPPING model: legality over 3x3 windows instead of
//               glyph pairs. Flip between 3 and 5 and watch the water: mode 3
//               scatters single puddles because every join in that mess is
//               individually legal, mode 5 keeps 2x2 pools because a pool is
//               a fact it holds outright.
//
// The skin toggle (T) switches between a plain colour fill and `auto4` — DUAL
// GRID autotiling, where 16 atlas cells do the job of a 47-cell blob set
// because each drawn tile is decided by the four cells around a corner.
// C overlays the MERGED collision rects: runs of solid tiles become one box.
import { createPerformanceMonitoring } from "minimotor/performance";
import { createInput } from "minimotor/input";
import { createUI } from "minimotor/ui";
import { Tiles, createApp } from "minimotor";
import { createCamera } from "minimotor/camera";
import * as Sprites from "minimotor/sprites";
import * as Procgen from "minimotor/procgen";
import type { Solid } from "minimotor";

const game = createApp("game", { background: "#0d1118" });
createPerformanceMonitoring(game);
const { Draw, Keys, Loop, viewport } = game;
const Camera = createCamera(game);
const Input = createInput(game);
const UI = createUI(game, Input);

const TW = 12;
const COLS = 78;
const ROWS = 46;

// ---- the one hand-drawn thing in this file ----
// Every WFC level below is "more of this": a walled room with pillars and a
// pool. `edge: true` also learns that only "#" ever touched the sample's own
// border, so generated levels wall themselves in the same way.
const SAMPLE = `
##########
#........#
#..####..#
#..#~~#..#
#..#~~#..#
#..####..#
#........#
#...##...#
#........#
##########
`;
const model = Procgen.analyze(SAMPLE, { edge: true });

// The same sample, learned as 3x3 WINDOWS instead of glyph pairs. Generator 5
// is the direct comparison against 3: the tiled model knows only that "~" may
// touch "~", so it scatters puddles; this one holds "a 2x2 pool ringed by
// stone" as a single fact and gives pools back whole.
const pattern = Procgen.overlapping(SAMPLE, { n: 3 });

// Steering is computed once per size, not per seed: it is a property of the
// TARGET ("rock ramps rightward"), not of any particular level.
const steered = Procgen.steer(model, {
  cols: COLS,
  rows: ROWS,
  targets: [{ glyph: "#", share: Procgen.ramp("x", 0.15, 0.85, COLS) }],
  // The soft field is what we are aiming; `synthesize` re-imposes the real
  // adjacency rules afterwards, so there is nothing to gain by half-enforcing
  // them here — and dropping the term lets the ramp land exactly on target.
  adjacency: 0,
});

// ---- generators ----
// The glyphs the dungeon recipe writes; repair and measure must treat them as
// floor or the connectivity guarantee would wall the exit in.
const MARKERS = Procgen.DUNGEON_MARKERS;

type Kind = "dungeon" | "cave" | "wfc" | "steered" | "patterns";
const KINDS: Kind[] = ["dungeon", "cave", "wfc", "steered", "patterns"];
const LABELS: Record<Kind, string> = {
  dungeon: "DUNGEON — graph topology, locked door, key before it",
  cave: "CAVE — cellular automata + connectivity repair",
  wfc: "WFC — adjacency learned from the sample (glyph pairs)",
  steered: "STEERED WFC — gradient field: rock ramps rightward",
  patterns: "OVERLAPPING WFC — 3×3 windows: compare the pools against 3",
};

function build(kind: Kind, seed: number): Procgen.CharGrid {
  switch (kind) {
    case "dungeon":
      return Procgen.dungeon({ cols: COLS, rows: ROWS, seed, locks: 2 }).grid;
    case "cave":
      return Procgen.repair(Procgen.caves({ cols: COLS, rows: ROWS, seed }));
    case "wfc":
      return Procgen.repair(Procgen.synthesize(model, { cols: COLS, rows: ROWS, seed }), MARKERS);
    case "steered":
      return Procgen.repair(
        Procgen.synthesize(model, { cols: COLS, rows: ROWS, seed, weights: steered.weights }),
        MARKERS,
      );
    case "patterns":
      return Procgen.repair(
        pattern.render(Procgen.synthesize(pattern.model, { cols: COLS, rows: ROWS, seed })),
        MARKERS,
      );
  }
}

// ---- a 4x4 dual-grid atlas, baked at runtime ----
// The 16 cells of a dual-grid set, indexed by CORNER mask: bit 1 top-left,
// 2 top-right, 4 bottom-right, 8 bottom-left. Each is drawn by filling the
// quadrants its bits name — which is literally what the mask means, and why
// dual-grid corners come out right without any extra cases.
// `cols: 4` matters: auto4 reads a 4×4 BLOCK indexed row-major by mask, not a
// 16-wide strip.
const dualAtlas = Sprites.atlas(
  TW,
  TW,
  16,
  (g, mask) => {
    const half = TW / 2;
    g.clearRect(0, 0, TW, TW);
    g.fillStyle = "#3a4a63";
    const quadrant = (bit: number, x: number, y: number) => {
      if (mask & bit) g.fillRect(x, y, half, half);
    };
    quadrant(1, 0, 0);
    quadrant(2, half, 0);
    quadrant(4, half, half);
    quadrant(8, 0, half);
    // A lighter lip reads as a walkable surface. Only draw it where a filled
    // quadrant has an EMPTY one above it — inside a solid body the mask's own
    // bits tell us that, and skipping it is what keeps rock from looking
    // horizontally striped.
    g.fillStyle = "#5b7a9e";
    if (mask & 8 && !(mask & 1)) g.fillRect(0, half, half, 2);
    if (mask & 4 && !(mask & 2)) g.fillRect(half, half, half, 2);
  },
  { cols: 4 },
);

const dualTiles = Tiles.set(dualAtlas, { size: TW, names: { base: [0, 0] } });
const dualLayer = dualTiles.auto4(dualTiles.base, { connect: "solid" });

const FLAT_SKIN: Record<string, string | null> = {
  "#": "#3a4a63",
  "~": "#1f5673",
  S: "#69db7c",
  E: "#ffd43b",
  D: "#e8590c",
  k: "#f783ac",
};
const DUAL_SKIN: Record<string, unknown> = {
  ...FLAT_SKIN,
  "#": dualLayer,
};

// ---- state ----
let kind: Kind = "dungeon";
let seed = 1;
let dual = true;
let showCollision = false;
let level = make();
let stats = Procgen.measure(level.grid, MARKERS);

function make() {
  const grid = build(kind, seed);
  return {
    grid,
    tiles: Tiles.grid(grid, {
      size: TW,
      legend: { "#": { solid: true }, "~": { solid: false } },
    }),
  };
}

function regenerate() {
  level = make();
  stats = Procgen.measure(level.grid, MARKERS);
}

Camera.snap();

const solids: Solid[] = [];

Loop.run({
  update() {
    for (let i = 0; i < KINDS.length; i++) {
      if (Keys.pressed(`Digit${i + 1}` as never)) {
        kind = KINDS[i];
        regenerate();
      }
    }
    if (Keys.pressed("KeyR")) {
      seed++;
      regenerate();
    }
    if (Keys.pressed("KeyT")) dual = !dual;
    if (Keys.pressed("KeyC")) showCollision = !showCollision;
  },

  draw() {
    // Fit the whole level on screen, leaving room for the HUD lines.
    const scale = Math.min(viewport.w / (COLS * TW), (viewport.h - 96) / (ROWS * TW));
    Camera.zoom = scale;
    Camera.x = (COLS * TW - viewport.w / scale) / 2;
    Camera.y = (ROWS * TW - viewport.h / scale) / 2;
    Camera.render(() => {
      Draw.tiles(level.tiles, (dual ? DUAL_SKIN : FLAT_SKIN) as never);
      if (showCollision) {
        // The rects Collision actually sweeps against: whole runs of solid
        // tiles merged into single boxes, with no internal edges between them.
        solids.length = 0;
        level.tiles.solidsNear(level.tiles.rect, solids);
        for (const rect of solids) Draw.rectStroke(rect, "#ffd43b", 1 / scale);
      }
    });

    UI.text(LABELS[kind], { x: 12, y: 10 });
    UI.text(
      `seed ${seed}   ·   ${COLS}×${ROWS}   ·   ` +
        `open ${(stats.openness * 100).toFixed(0)}%   ` +
        `corridor ${(stats.corridorRatio * 100).toFixed(0)}%   ` +
        `longest walk ${stats.longestPath}   ` +
        `dead ends ${stats.deadEnds}   ` +
        `connected ${Procgen.isConnected(level.grid, MARKERS) ? "yes" : "NO"}`,
      { x: 12, y: 30, color: "dim" },
    );
    UI.text(
      `1-5 generator   R reseed   T ${dual ? "dual-grid autotiling (on)" : "flat colour"}   ` +
        `C ${showCollision ? "merged collision rects (on)" : "collision overlay"}`,
      { x: 12, y: viewport.h - 22, color: "dim" },
    );
  },
});
