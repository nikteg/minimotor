// ---------- Connectivity repair ----------
// The guarantee gradients and adjacency rules cannot give you. Reachability is
// all-or-nothing and global, so it is not something to optimize toward — it is
// something to enforce afterwards, deterministically, as the last pass.

import { floodFill } from "@src/goodies/grid.js";
import { type CharGrid, type CellRect, at, cloneGrid, cols, rows } from "./grid.js";

export interface RepairOptions {
  /** Glyph that counts as walkable. Default ".". */
  floor?: string;
  /** Glyph to carve through when joining regions. Default "#". */
  wall?: string;
  /** Drop regions smaller than this instead of connecting them (they become
   *  wall). Default 0 — connect everything. */
  minRegion?: number;
  /** Keep only the largest region and wall off the rest, rather than digging
   *  tunnels between them. Default false. */
  discard?: boolean;
  /** Extra glyphs that also count as walkable when measuring regions — doors,
   *  water, ladders. */
  alsoWalkable?: readonly string[];
}

/** One connected walkable region. */
export interface Region {
  /** Every cell in the region. */
  cells: Array<{ x: number; y: number }>;
  /** Tight bounds around it, in cells. */
  bounds: CellRect;
}

/** Find every connected walkable region, largest first. */
export function regions(grid: CharGrid, options: RepairOptions = {}): Region[] {
  const width = cols(grid);
  const height = rows(grid);
  const walkable = new Set<string>([options.floor ?? ".", ...(options.alsoWalkable ?? [])]);
  const seen = new Uint8Array(width * height);
  const found: Region[] = [];
  const passable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && walkable.has(grid[y][x]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (seen[y * width + x] || !passable(x, y)) continue;
      const cells = floodFill({ x, y }, passable, { limit: width * height });
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      for (const cell of cells) {
        seen[cell.y * width + cell.x] = 1;
        if (cell.x < minX) minX = cell.x;
        if (cell.y < minY) minY = cell.y;
        if (cell.x > maxX) maxX = cell.x;
        if (cell.y > maxY) maxY = cell.y;
      }
      found.push({ cells, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } });
    }
  }
  // Largest first, ties broken by position so the result is stable.
  found.sort(
    (a, b) => b.cells.length - a.cells.length || a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x,
  );
  return found;
}

/** Guarantee every walkable cell is reachable from every other one. Small
 *  regions can be discarded (`minRegion`, `discard`); the rest are joined by
 *  carving straight L-shaped tunnels between the closest pair of cells. */
export function repair(grid: CharGrid, options: RepairOptions = {}): CharGrid {
  const floor = options.floor ?? ".";
  const wall = options.wall ?? "#";
  const minRegion = options.minRegion ?? 0;
  const out = cloneGrid(grid);

  let found = regions(out, options);
  if (found.length === 0) return out;

  // Wall off anything too small to be worth keeping.
  const keep: Region[] = [];
  for (const region of found) {
    if (region.cells.length >= minRegion && (!options.discard || keep.length === 0)) {
      keep.push(region);
      continue;
    }
    for (const cell of region.cells) out[cell.y][cell.x] = wall;
  }
  found = keep;

  // Join the rest into the trunk, nearest first. Each pass floods the WHOLE
  // grid (walls included) outward from the trunk, so the cheapest tunnel to
  // every remaining region falls out of one BFS; carving follows that shortest
  // path back, which naturally threads existing gaps instead of boring straight
  // through thick rock.
  const width = cols(out);
  const height = rows(out);
  const trunk = found.shift();
  if (!trunk) return out;
  const inTrunk = new Uint8Array(width * height);
  for (const cell of trunk.cells) inTrunk[cell.y * width + cell.x] = 1;

  const dist = new Int32Array(width * height);
  const parent = new Int32Array(width * height);
  const queue = new Int32Array(width * height);

  while (found.length > 0) {
    dist.fill(-1);
    parent.fill(-1);
    let tail = 0;
    for (let i = 0; i < inTrunk.length; i++) {
      if (!inTrunk[i]) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
    for (let head = 0; head < tail; head++) {
      const cell = queue[head];
      const cx = cell % width;
      const cy = (cell / width) | 0;
      for (let dir = 0; dir < 4; dir++) {
        const nx = cx + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const ny = cy + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (dist[next] >= 0) continue;
        dist[next] = dist[cell] + 1;
        parent[next] = cell;
        queue[tail++] = next;
      }
    }

    let bestRegion = -1;
    let bestCell = -1;
    let bestDist = Infinity;
    for (let r = 0; r < found.length; r++) {
      for (const cell of found[r].cells) {
        const index = cell.y * width + cell.x;
        if (dist[index] >= 0 && dist[index] < bestDist) {
          bestDist = dist[index];
          bestCell = index;
          bestRegion = r;
        }
      }
    }
    // Nothing reachable at all (a region walled off the grid edge) — give up
    // rather than loop forever.
    if (bestRegion < 0) break;

    for (let cell = bestCell; cell >= 0 && !inTrunk[cell]; cell = parent[cell]) {
      out[(cell / width) | 0][cell % width] = floor;
      inTrunk[cell] = 1;
    }
    for (const cell of found[bestRegion].cells) inTrunk[cell.y * width + cell.x] = 1;
    found.splice(bestRegion, 1);
  }
  return out;
}

/** Is every walkable cell reachable from every other? The check `repair`
 *  guarantees, exposed so tests and the CLI can assert it. */
export function isConnected(grid: CharGrid, options: RepairOptions = {}): boolean {
  return regions(grid, options).length <= 1;
}

/** Wall off every cell of a region that touches the grid edge — useful after
 *  carving, when a tunnel has broken out of the level. */
export function sealEdges(grid: CharGrid, wall = "#"): CharGrid {
  const out = cloneGrid(grid);
  const width = cols(out);
  const height = rows(out);
  for (let x = 0; x < width; x++) {
    out[0][x] = wall;
    out[height - 1][x] = wall;
  }
  for (let y = 0; y < height; y++) {
    out[y][0] = wall;
    out[y][width - 1] = wall;
  }
  return out;
}

/** Count the walkable neighbours of a cell — the primitive behind corridor and
 *  dead-end detection in `metrics`. */
export function openNeighbours(grid: CharGrid, x: number, y: number, floor = "."): number {
  let open = 0;
  if (at(grid, x, y - 1, "#") === floor) open++;
  if (at(grid, x + 1, y, "#") === floor) open++;
  if (at(grid, x, y + 1, "#") === floor) open++;
  if (at(grid, x - 1, y, "#") === floor) open++;
  return open;
}
