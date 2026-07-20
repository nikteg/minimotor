// ---------- Grid, puzzle and roguelike ----------
// Tile-map reasoning: neighbours, connected regions, Bresenham lines, sight and
// distance fields. `passable`/`blocks` predicates keep these map-agnostic — the
// game owns what a wall is.

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridNeighborOptions {
  diagonal?: boolean;
  cols?: number;
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
 * the level; `limit` guards malformed infinite maps. */
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
 *  out-of-bounds cells; `limit` guards malformed infinite maps.
 *
 *    const field = Minimotor.Goodies.distanceField(exit, (x, y) => open(x, y));
 *    const step = Minimotor.Goodies.gridNeighbors(e.x, e.y)
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
      if (Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, rng())) * seen) === 0) {
        chosen = { x, y };
      }
    }
  }
  return chosen;
}
