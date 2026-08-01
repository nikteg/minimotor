// ---------- Cellular-automata caves ----------
// The best organic-caves-per-line ratio there is: fill the grid with noise,
// then repeatedly make each cell agree with its neighbours. Five or six passes
// turn static into caverns.

import { createRng } from "@src/rng/index.js";
import { type CharGrid, makeGrid } from "./grid.js";

export interface CaveOptions {
  /** Grid width in cells. */
  cols: number;
  /** Grid height in cells. */
  rows: number;
  /** Seed for the initial noise. */
  seed?: number;
  /** Fraction of cells that start as wall. Around 0.45 gives open caverns;
   *  above ~0.55 the map closes up into isolated pockets. Default 0.45. */
  fill?: number;
  /** Smoothing passes. Default 5 — more rounds off the walls further. */
  steps?: number;
  /** Wall neighbour count (of 8) at which an open cell becomes wall. Default 5. */
  birth?: number;
  /** Wall neighbour count at or above which a wall cell stays wall. Default 4. */
  survive?: number;
  /** Glyph for wall cells. Default "#". */
  wall?: string;
  /** Glyph for open cells. Default ".". */
  floor?: string;
  /** Force a solid ring of wall around the edge. Default true. */
  border?: boolean;
}

/** Generate a cave. The result is organic but NOT guaranteed connected — run
 *  `repair` on it if the player has to reach everything:
 *
 *      const cave = Procgen.repair(Procgen.caves({ cols: 60, rows: 40, seed }));
 */
export function caves(options: CaveOptions): CharGrid {
  const width = options.cols;
  const height = options.rows;
  const wall = options.wall ?? "#";
  const floor = options.floor ?? ".";
  const fill = options.fill ?? 0.45;
  const steps = options.steps ?? 5;
  const birth = options.birth ?? 5;
  const survive = options.survive ?? 4;
  const ring = options.border !== false;
  const rng = createRng(options.seed ?? 0);

  let grid = makeGrid(width, height, floor);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = ring && (x === 0 || y === 0 || x === width - 1 || y === height - 1);
      grid[y][x] = edge || rng.random() < fill ? wall : floor;
    }
  }

  for (let step = 0; step < steps; step++) {
    const next = makeGrid(width, height, floor);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (ring && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) {
          next[y][x] = wall;
          continue;
        }
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            // Outside counts as wall, which keeps caves from bleeding off-map.
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || grid[ny][nx] === wall) walls++;
          }
        }
        next[y][x] =
          grid[y][x] === wall ? (walls >= survive ? wall : floor) : walls >= birth ? wall : floor;
      }
    }
    grid = next;
  }
  return grid;
}
