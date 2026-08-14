/** Back-and-forth patrol between `min` and `max` along one axis. `tick(dist)`
 *  advances by `dist` (= speed × dt), reverses at each bound without jitter or
 *  overshoot, and returns the new position; `dir` is the current facing (+1 /
 *  -1) for flipping a sprite. Goombas, moving platforms, sweeping hazards. */
export interface Patrol {
    /** Current position along the axis, within `[min, max]`. */
    readonly pos: number;
    /** Current facing: `+1` moving toward `max`, `-1` toward `min` — flip a sprite by it. */
    readonly dir: 1 | -1;
    /** Advance by `dist` (= speed × dt), reversing at either bound, and return the new `pos`. */
    tick(dist: number): number;
}
/** Create a back-and-forth `Patrol` oscillating between `min` and `max`.
 *  `options.start` sets the initial `pos` (default `min`), `options.dir` the
 *  initial facing (default `+1`). Goombas, moving platforms, sweeping hazards. */
export declare function patrol(min: number, max: number, options?: {
    start?: number;
    dir?: 1 | -1;
}): Patrol;
/** A fixed-length motion trail — `push(x, y)` each frame, read `points`
 *  (newest first) to draw a fading tail behind a ball/dash/cursor. Bounded ring
 *  so it never grows without limit. */
export interface Trail {
    /** Record a point at the head; drops the oldest once past `maxLen`. Call once per frame. */
    push(x: number, y: number): void;
    /** The recorded points, newest first — index `0` is the latest `push`. Don't hold across frames. */
    readonly points: ReadonlyArray<{
        x: number;
        y: number;
    }>;
    /** Discard all points (e.g. on teleport/respawn so the tail doesn't streak). */
    clear(): void;
}
/** Create a `Trail` ring holding at most `maxLen` points — `push(x, y)` each
 *  frame, read `points` (newest first) to draw a fading tail behind a
 *  ball/dash/cursor. */
export declare function trail(maxLen: number): Trail;
