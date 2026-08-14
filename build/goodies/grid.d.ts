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
export declare function gridNeighbors(x: number, y: number, options?: GridNeighborOptions): GridPoint[];
/** Breadth-first connected-region fill. `passable` must reject cells outside
 * the level; `limit` caps the number of filled cells (default 10 000) to
 * guard malformed infinite maps. */
export declare function floodFill(start: GridPoint, passable: (x: number, y: number) => boolean, options?: {
    diagonal?: boolean;
    limit?: number;
}): GridPoint[];
/** A multi-source BFS distance map returned by `distanceField()`. */
export interface DistanceField {
    /** Step distance from the nearest source to (x, y); `Infinity` if
     *  unreachable. */
    at(x: number, y: number): number;
    /** Every reachable cell with its distance, in BFS order (sources first). */
    cells: Array<GridPoint & {
        dist: number;
    }>;
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
export declare function distanceField(starts: GridPoint | readonly GridPoint[], passable: (x: number, y: number) => boolean, options?: {
    diagonal?: boolean;
    limit?: number;
}): DistanceField;
export interface AstarOptions {
    /** Include the four diagonals (8-way) as well as the cardinals. Default false. */
    diagonal?: boolean;
    /** Cap on expansions. Default 10_000. */
    limit?: number;
}
/** Shortest 4-way (or 8-way) path from `start` to `goal`, or null if none.
 *  `passable(x,y)` must reject walls and out-of-bounds. */
export declare function astar(start: GridPoint, goal: GridPoint, passable: (x: number, y: number) => boolean, options?: AstarOptions): GridPoint[] | null;
/** Integer cells crossed by a Bresenham line, including both endpoints. */
export declare function gridLine(ax: number, ay: number, bx: number, by: number): GridPoint[];
/** Grid line-of-sight. The origin never blocks itself; destination blocking is
 * configurable for targeting walls (`includeTarget`, default true). */
export declare function lineOfSight(ax: number, ay: number, bx: number, by: number, blocks: (x: number, y: number) => boolean, includeTarget?: boolean): boolean;
/** Pick a uniformly-random free cell of a `cols`×`rows` grid — food, loot
 *  drops, spawn points. `isOccupied(x, y)` marks taken cells. Uses a single
 *  reservoir pass, so it's O(cells) and returns `null` when the grid is full
 *  instead of spinning forever — the trap in the usual `do { rand } while
 *  (taken)` loop as the board fills up. */
export declare function randFreeCell(cols: number, rows: number, isOccupied: (x: number, y: number) => boolean, rng?: () => number): GridPoint | null;
