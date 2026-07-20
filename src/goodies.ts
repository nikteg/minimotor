// ---------- Essential game recipes ----------
// Goodies is Minimotor's intentional grab bag: familiar, dependency-free
// recipes that recur across arcade, grid, platformer, shooter, roguelike and
// other genres. Unlike low-level Mathf primitives, a Goodie may encode a small
// piece of game-domain knowledge. Recipes stay optional, composable and tested;
// games can use one without adopting a framework or prescribed architecture.

/** Wrap `value` into `[0, max)`, including negative and multi-span values. */
export function wrap(value: number, max: number): number;
/** Wrap `value` into `[min, max)`, including negative and multi-span values. */
export function wrap(value: number, min: number, max: number): number;
export function wrap(value: number, minOrMax: number, maybeMax?: number): number {
  const min = maybeMax === undefined ? 0 : minOrMax;
  const max = maybeMax === undefined ? minOrMax : maybeMax;
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) {
    throw new RangeError("Goodies.wrap: max must be finite and greater than min");
  }
  return ((((value - min) % span) + span) % span) + min;
}

/** Shortest signed displacement from `from` to `to` on a wrapping axis.
 * The result is in `[-size/2, size/2)`. */
export function wrappedDelta(from: number, to: number, size: number): number {
  return wrap(to - from + size / 2, size) - size / 2;
}

/** Shortest distance between two points in a wrapping (toroidal) world. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  worldW: number,
  worldH: number,
): number {
  return Math.hypot(wrappedDelta(ax, bx, worldW), wrappedDelta(ay, by, worldH));
}

// ---------- Loot, cards and procedural generation ----------

export interface Weighted<T> {
  value: T;
  weight: number;
}

/** Pick from weighted entries. Non-positive weights are ignored; returns
 * `undefined` when no entry has positive weight. RNG is injectable for seeded
 * roguelikes, loot tables and deterministic tests. */
export function weightedPick<T>(
  entries: readonly Weighted<T>[],
  rng: () => number = Math.random,
): T | undefined {
  let total = 0;
  for (const entry of entries) if (entry.weight > 0) total += entry.weight;
  if (!(total > 0)) return undefined;
  let cursor = Math.max(0, Math.min(1 - Number.EPSILON, rng())) * total;
  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    cursor -= entry.weight;
    if (cursor < 0) return entry.value;
  }
  return entries.find((entry) => entry.weight > 0)?.value;
}

export interface ShuffleBag<T> {
  /** Draw one item; automatically refills after the last item. */
  next(): T | undefined;
  /** Reshuffle a fresh copy of the source items. */
  reset(): void;
  readonly remaining: number;
}

/** Without-replacement random bag for cards, music, enemy varieties and fair
 * procedural selection. It automatically reshuffles when exhausted. */
export function shuffleBag<T>(items: readonly T[], rng: () => number = Math.random): ShuffleBag<T> {
  let bag: T[] = [];
  function reset(): void {
    bag = [...items];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, rng())) * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  reset();
  return {
    next() {
      if (bag.length === 0) reset();
      return bag.pop();
    },
    reset,
    get remaining() {
      return bag.length;
    },
  };
}

// ---------- Grid, puzzle and roguelike ----------

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

// ---------- Shooter, racing and steering ----------

/** Move an angle toward a target by at most `maxDelta`, taking the shortest
 * route across the -π/π seam. Result is normalized to [-π, π). */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  const delta = wrappedDelta(current, target, Math.PI * 2);
  if (Math.abs(delta) <= maxDelta) return wrap(target, -Math.PI, Math.PI);
  return wrap(current + Math.sign(delta) * Math.max(0, maxDelta), -Math.PI, Math.PI);
}

export interface LeadTarget {
  x: number;
  y: number;
  time: number;
}

/** Predict where to aim a constant-speed projectile at a constant-velocity
 * target. Returns `null` when no future intercept exists. */
export function leadTarget(
  shooterX: number,
  shooterY: number,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  projectileSpeed: number,
): LeadTarget | null {
  if (!(projectileSpeed > 0)) return null;
  const rx = targetX - shooterX,
    ry = targetY - shooterY;
  const a = targetVx * targetVx + targetVy * targetVy - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * targetVx + ry * targetVy);
  const c = rx * rx + ry * ry;
  let time = Infinity;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) time = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-b - root) / (2 * a),
        t2 = (-b + root) / (2 * a);
      if (t1 > 0) time = t1;
      if (t2 > 0) time = Math.min(time, t2);
    }
  }
  if (!Number.isFinite(time) || time < 0) return null;
  return { x: targetX + targetVx * time, y: targetY + targetVy * time, time };
}

// ---------- Rhythm ----------

export type TimingGrade = "perfect" | "great" | "good" | "miss";

/** Grade the absolute distance from a rhythm event. Windows are inclusive and
 * ordered from strictest to loosest. */
export function timingGrade(
  offsetMs: number,
  windows: { perfect?: number; great?: number; good?: number } = {},
): TimingGrade {
  const distance = Math.abs(offsetMs);
  if (distance <= (windows.perfect ?? 35)) return "perfect";
  if (distance <= (windows.great ?? 75)) return "great";
  if (distance <= (windows.good ?? 130)) return "good";
  return "miss";
}

// ---------- Racing and ordered objectives ----------

export interface CheckpointRoute {
  readonly next: number;
  readonly lap: number;
  /** Accept a checkpoint only in order. Returns true when accepted. */
  visit(index: number): boolean;
  reset(): void;
}

/** Ordered checkpoint/lap tracker for racing, tours and multi-step objectives. */
export function checkpointRoute(checkpoints: number): CheckpointRoute {
  if (!Number.isInteger(checkpoints) || checkpoints < 1) {
    throw new RangeError("Goodies.checkpointRoute: checkpoints must be a positive integer");
  }
  let next = 0;
  let lap = 0;
  return {
    get next() {
      return next;
    },
    get lap() {
      return lap;
    },
    visit(index) {
      if (index !== next) return false;
      next++;
      if (next === checkpoints) {
        next = 0;
        lap++;
      }
      return true;
    },
    reset() {
      next = 0;
      lap = 0;
    },
  };
}

// ---------- Tabletop, RPG and combat ----------

/** Bernoulli chance with injectable RNG. Probability is clamped to 0..1. */
export function chance(probability: number, rng: () => number = Math.random): boolean {
  return rng() < Math.max(0, Math.min(1, probability));
}

/** Roll conventional integer dice and return the total. */
export function rollDice(count: number, sides: number, rng: () => number = Math.random): number {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(sides) || sides < 1) {
    throw new RangeError("Goodies.rollDice: count must be >= 0 and sides must be >= 1");
  }
  let total = 0;
  for (let i = 0; i < count; i++)
    total += 1 + Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, rng())) * sides);
  return total;
}

export interface DamageRoll {
  amount: number;
  critical: boolean;
}

/** Action/RPG damage roll with symmetric variance and an optional critical. */
export function damageRoll(
  base: number,
  options: { variance?: number; critChance?: number; critMultiplier?: number } = {},
  rng: () => number = Math.random,
): DamageRoll {
  const variance = Math.max(0, options.variance ?? 0.1);
  const varied = base * (1 + (rng() * 2 - 1) * variance);
  const critical = chance(options.critChance ?? 0, rng);
  return {
    amount: Math.max(0, Math.round(varied * (critical ? (options.critMultiplier ?? 2) : 1))),
    critical,
  };
}

// ---------- Inventory and crafting ----------

export interface ItemStack<T> {
  item: T;
  count: number;
  max: number;
}

/** Move/merge/swap inventory stacks. Returns false only when a requested
 * partial move cannot be swapped into an incompatible occupied slot. */
export function transferStack<T>(
  slots: Array<ItemStack<T> | null>,
  from: number,
  to: number,
  amount = Infinity,
  same: (a: T, b: T) => boolean = Object.is,
): boolean {
  if (from === to) return true;
  const source = slots[from];
  if (!source || !slots.hasOwnProperty(to)) return false;
  const moved = Math.max(0, Math.min(source.count, Math.floor(amount)));
  if (moved === 0) return true;
  const target = slots[to];
  if (!target) {
    slots[to] = { ...source, count: moved };
    source.count -= moved;
    if (source.count === 0) slots[from] = null;
    return true;
  }
  if (same(source.item, target.item)) {
    const accepted = Math.min(moved, Math.max(0, target.max - target.count));
    target.count += accepted;
    source.count -= accepted;
    if (source.count === 0) slots[from] = null;
    return accepted > 0;
  }
  if (moved < source.count) return false;
  [slots[from], slots[to]] = [target, source];
  return true;
}

// ---------- Grid sight and tactics ----------

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

// ---------- Bullet hell, tactics and formations ----------

/** Even points around a circle for bullet rings, radial spawns and arena props. */
export function ringFormation(
  count: number,
  cx: number,
  cy: number,
  radius: number,
  phase = 0,
): Array<GridPoint & { angle: number }> {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = phase + (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, angle };
  });
}

/** Centered row-major formation for squads, invaders, cards and puzzle pieces. */
export function gridFormation(
  count: number,
  columns: number,
  spacingX: number,
  spacingY: number,
  cx = 0,
  cy = 0,
): GridPoint[] {
  if (count <= 0 || columns <= 0) return [];
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => ({
    x: cx + ((i % columns) - (Math.min(columns, count) - 1) / 2) * spacingX,
    y: cy + (Math.floor(i / columns) - (rows - 1) / 2) * spacingY,
  }));
}

// ---------- Arcade progression and simulation ----------

/** Label a score from ascending thresholds, e.g. `[0,1000,5000]` and
 * `["C","B","A"]`. Scores below the first threshold use the first rank. */
export function scoreRank(
  score: number,
  thresholds: readonly number[],
  ranks: readonly string[],
): string | undefined {
  if (ranks.length === 0) return undefined;
  let index = 0;
  while (
    index + 1 < thresholds.length &&
    index + 1 < ranks.length &&
    score >= thresholds[index + 1]
  )
    index++;
  return ranks[index];
}

export interface WaveScale {
  count: number;
  health: number;
  speed: number;
}

/** Common endless/wave progression curve. Wave 1 returns the configured bases. */
export function waveScale(
  wave: number,
  options: {
    count?: number;
    countPerWave?: number;
    health?: number;
    healthGrowth?: number;
    speed?: number;
    speedGrowth?: number;
  } = {},
): WaveScale {
  const n = Math.max(0, Math.floor(wave) - 1);
  return {
    count: Math.max(0, Math.floor((options.count ?? 3) + n * (options.countPerWave ?? 1))),
    health: (options.health ?? 1) * Math.pow(options.healthGrowth ?? 1.15, n),
    speed: (options.speed ?? 1) * Math.pow(options.speedGrowth ?? 1.04, n),
  };
}

export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Normalized looping time and a conventional four-part day phase. */
export function dayCycle(time: number, dayLength: number): { t: number; phase: DayPhase } {
  const t = wrap(time, dayLength) / dayLength;
  const phase: DayPhase = t < 0.1 ? "dawn" : t < 0.55 ? "day" : t < 0.7 ? "dusk" : "night";
  return { t, phase };
}
