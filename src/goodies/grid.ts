import { clamp } from "../math/mathf.js";

// ---------- Grid, puzzle and roguelike ----------
// Tile-map reasoning: neighbours, connected regions, Bresenham lines, sight and
// distance fields. `passable`/`blocks` predicates keep these map-agnostic — the
// game owns what a wall is.

/** Integer cell coordinates on a tile grid. */
export interface GridPoint {
  /** Column. */
  x: number;
  /** Row. */
  y: number;
}

/** Options for `gridNeighbors()`: 8-way toggle and optional bounds to clip against. */
export interface GridNeighborOptions {
  /** Include the four diagonals (8-way) as well as the cardinals. Default false. */
  diagonal?: boolean;
  /** Grid width — neighbours with `x < 0` or `x >= cols` are clipped. Unbounded when omitted. */
  cols?: number;
  /** Grid height — neighbours with `y < 0` or `y >= rows` are clipped. Unbounded when omitted. */
  rows?: number;
}

/** Cardinal (and optionally diagonal) neighboring cells, optionally clipped to
 * grid bounds. Useful for board games, tactics, puzzles and pathfinding. */
export function gridNeighbors(
  x: number,
  y: number,
  options: GridNeighborOptions = {},
): GridPoint[] {
  const dirs = options.diagonal
    ? [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ]
    : [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ];
  const result: GridPoint[] = [];
  for (const [dx, dy] of dirs) {
    const nx = x + dx,
      ny = y + dy;
    if (options.cols !== undefined && (nx < 0 || nx >= options.cols)) continue;
    if (options.rows !== undefined && (ny < 0 || ny >= options.rows)) continue;
    result.push({ x: nx, y: ny });
  }
  return result;
}

/** Breadth-first connected-region fill. `passable` must reject cells outside
 * the level; `limit` caps the number of filled cells (default 10 000) to
 * guard malformed infinite maps. */
export function floodFill(
  start: GridPoint,
  passable: (x: number, y: number) => boolean,
  options: { diagonal?: boolean; limit?: number } = {},
): GridPoint[] {
  if (!passable(start.x, start.y)) return [];
  const limit = options.limit ?? 10_000;
  const found: GridPoint[] = [];
  const queue: GridPoint[] = [{ ...start }];
  const seen = new Set([`${start.x},${start.y}`]);
  for (let head = 0; head < queue.length && found.length < limit; head++) {
    const point = queue[head];
    found.push(point);
    for (const next of gridNeighbors(point.x, point.y, { diagonal: options.diagonal })) {
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !passable(next.x, next.y)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return found;
}

/** A multi-source BFS distance map returned by `distanceField()`. */
export interface DistanceField {
  /** Step distance from the nearest source to (x, y); `Infinity` if
   *  unreachable. */
  at(x: number, y: number): number;
  /** Every reachable cell with its distance, in BFS order (sources first). */
  cells: Array<GridPoint & { dist: number }>;
}

/** Multi-source breadth-first distance map: the step distance from the nearest
 *  `start` to every reachable cell. Drives "walk toward the player/exit" chase
 *  AI and tower-defense creep routing without a full pathfinder — an agent
 *  just steps to the neighbour with the lowest `at()`. `passable` must reject
 *  out-of-bounds cells; `limit` caps the number of mapped cells
 *  (default 10 000) to guard malformed infinite maps.
 *
 *    const field = Goodies.distanceField(exit, (x, y) => open(x, y));
 *    const step = Goodies.gridNeighbors(e.x, e.y)
 *      .reduce((best, n) => (field.at(n.x, n.y) < field.at(best.x, best.y) ? n : best)); */
export function distanceField(
  starts: GridPoint | readonly GridPoint[],
  passable: (x: number, y: number) => boolean,
  options: { diagonal?: boolean; limit?: number } = {},
): DistanceField {
  const sources = Array.isArray(starts) ? starts : [starts as GridPoint];
  const limit = options.limit ?? 10_000;
  const dist = new Map<string, number>();
  const queue: GridPoint[] = [];
  for (const s of sources) {
    if (!passable(s.x, s.y)) continue;
    const key = `${s.x},${s.y}`;
    if (dist.has(key)) continue;
    dist.set(key, 0);
    queue.push({ x: s.x, y: s.y });
  }
  const cells: Array<GridPoint & { dist: number }> = [];
  for (let head = 0; head < queue.length && cells.length < limit; head++) {
    const point = queue[head];
    const d = dist.get(`${point.x},${point.y}`) ?? 0;
    cells.push({ x: point.x, y: point.y, dist: d });
    for (const next of gridNeighbors(point.x, point.y, { diagonal: options.diagonal })) {
      const key = `${next.x},${next.y}`;
      if (dist.has(key) || !passable(next.x, next.y)) continue;
      dist.set(key, d + 1);
      queue.push(next);
    }
  }
  return {
    at: (x, y) => dist.get(`${x},${y}`) ?? Infinity,
    cells,
  };
}

export interface AstarOptions {
  /** Include the four diagonals (8-way) as well as the cardinals. Default false. */
  diagonal?: boolean;
  /** Cap on expansions. Default 10_000. */
  limit?: number;
}

interface AstarNode {
  x: number;
  y: number;
  g: number;
  f: number;
  i: number;
  parent: AstarNode | null;
}

function astarHeuristic(ax: number, ay: number, bx: number, by: number, diagonal: boolean): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return diagonal ? dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy) : dx + dy;
}

function popOpen(open: AstarNode[]): AstarNode {
  let best = 0;
  for (let i = 1; i < open.length; i++) {
    const a = open[i],
      b = open[best];
    if (a.f < b.f || (a.f === b.f && a.i < b.i)) best = i;
  }
  const node = open[best];
  open[best] = open[open.length - 1];
  open.pop();
  return node;
}

/** Shortest 4-way (or 8-way) path from `start` to `goal`, or null if none.
 *  `passable(x,y)` must reject walls and out-of-bounds. */
export function astar(
  start: GridPoint,
  goal: GridPoint,
  passable: (x: number, y: number) => boolean,
  options?: AstarOptions,
): GridPoint[] | null {
  if (!passable(start.x, start.y) || !passable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];

  const diagonal = options?.diagonal === true;
  const limit = options?.limit ?? 10_000;
  const startNode: AstarNode = {
    x: start.x,
    y: start.y,
    g: 0,
    f: astarHeuristic(start.x, start.y, goal.x, goal.y, diagonal),
    i: 0,
    parent: null,
  };
  const open: AstarNode[] = [startNode];
  const bestG = new Map<string, number>([[`${start.x},${start.y}`, 0]]);
  const closed = new Set<string>();
  let nextI = 1;
  let expansions = 0;

  while (open.length > 0) {
    const current = popOpen(open);
    const ck = `${current.x},${current.y}`;
    if (closed.has(ck)) continue;
    if (current.x === goal.x && current.y === goal.y) {
      const path: GridPoint[] = [];
      for (let n: AstarNode | null = current; n; n = n.parent) path.push({ x: n.x, y: n.y });
      path.reverse();
      return path;
    }
    closed.add(ck);
    expansions++;
    if (expansions > limit) return null;

    for (const next of gridNeighbors(current.x, current.y, { diagonal })) {
      const nk = `${next.x},${next.y}`;
      if (closed.has(nk) || !passable(next.x, next.y)) continue;
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      if (dx !== 0 && dy !== 0) {
        if (!passable(current.x + dx, current.y) || !passable(current.x, current.y + dy)) continue;
      }
      const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const g = current.g + step;
      const known = bestG.get(nk);
      if (known !== undefined && g >= known) continue;
      bestG.set(nk, g);
      open.push({
        x: next.x,
        y: next.y,
        g,
        f: g + astarHeuristic(next.x, next.y, goal.x, goal.y, diagonal),
        i: nextI++,
        parent: current,
      });
    }
  }
  return null;
}

/** Integer cells crossed by a Bresenham line, including both endpoints. */
export function gridLine(ax: number, ay: number, bx: number, by: number): GridPoint[] {
  if (![ax, ay, bx, by].every(Number.isInteger)) {
    throw new RangeError("Goodies.gridLine: endpoints must be integer grid coordinates");
  }
  const points: GridPoint[] = [];
  let x = ax,
    y = ay;
  const dx = Math.abs(bx - ax),
    sx = ax < bx ? 1 : -1;
  const dy = -Math.abs(by - ay),
    sy = ay < by ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === bx && y === by) break;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

/** Grid line-of-sight. The origin never blocks itself; destination blocking is
 * configurable for targeting walls (`includeTarget`, default true). */
export function lineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocks: (x: number, y: number) => boolean,
  includeTarget = true,
): boolean {
  const cells = gridLine(ax, ay, bx, by);
  const end = includeTarget ? cells.length : cells.length - 1;
  for (let i = 1; i < end; i++) if (blocks(cells[i].x, cells[i].y)) return false;
  return true;
}

/** Pick a uniformly-random free cell of a `cols`×`rows` grid — food, loot
 *  drops, spawn points. `isOccupied(x, y)` marks taken cells. Uses a single
 *  reservoir pass, so it's O(cells) and returns `null` when the grid is full
 *  instead of spinning forever — the trap in the usual `do { rand } while
 *  (taken)` loop as the board fills up. */
export function randFreeCell(
  cols: number,
  rows: number,
  isOccupied: (x: number, y: number) => boolean,
  rng: () => number = Math.random,
): GridPoint | null {
  let chosen: GridPoint | null = null;
  let seen = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isOccupied(x, y)) continue;
      seen++;
      if (Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * seen) === 0) {
        chosen = { x, y };
      }
    }
  }
  return chosen;
}
