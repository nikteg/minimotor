/** Options for `createInterpolator`: render delay, buffer size, blend, and an
 *  injectable clock. */
export interface InterpolatorOptions<T> {
    /** How far behind real time to render, in ms. Should cover at least one
     *  packet interval plus jitter; default 100. `"auto"` adapts to arrival
     *  jitter, starting at `expectedIntervalMs`. */
    delayMs?: number | "auto";
    /** Initial packet interval for adaptive delay. Default 50 ms. */
    expectedIntervalMs?: number;
    /** Snapshots kept in the buffer (default 32). */
    maxSnapshots?: number;
    /** Blend two states with `t` in 0..1. The default lerps every field that is
     *  numeric in both states and copies the rest from the newer one — supply
     *  your own for angles (wrap-around) or nested objects. */
    lerp?: (a: T, b: T, t: number) => T;
    /** Optional short-horizon projection for when a snapshot is late or lost and
     *  the render target runs past the newest pair. Receives `t > 1`. It covers
     *  gaps; it does not replace the render buffer. */
    extrapolate?: (a: T, b: T, t: number) => T;
    /** Projection cap in milliseconds. Default 0 (disabled). */
    maxExtrapolationMs?: number;
    /** Millisecond clock — injectable for tests. Default `performance.now`. */
    now?: () => number;
}
/** A snapshot buffer that renders remote state a fixed delay in the past,
 *  blended between the two surrounding snapshots. */
export interface Interpolator<T> {
    /** Record a snapshot. `atMs` defaults to arrival time. Pass the sender's
     *  clock as `sentAt` when the protocol carries one: snapshots are then placed
     *  on a de-jittered timeline, and duplicates/reordered packets (unreliable
     *  channels) are dropped by their stamp rather than by arrival order. */
    push(state: T, atMs?: number, sentAt?: number): void;
    /** The state as of (now − delayMs). Interpolated between the two surrounding
     *  snapshots; clamps to the oldest/newest when the target time falls outside
     *  the buffer, unless `extrapolate` is set to cover the gap. Null until the
     *  first push. */
    sample(atMs?: number): T | null;
    /** Buffered snapshot count. */
    readonly size: number;
    /** Current fixed or adaptive render delay. */
    readonly delayMs: number;
    /** Estimated one-way arrival jitter in ms (0 without sender timestamps). */
    readonly jitterMs: number;
    /** Drop all snapshots (e.g. on respawn/teleport, to avoid a visible sweep). */
    clear(): void;
}
/** Create a snapshot interpolator for a remote entity: `push` incoming states,
 *  `sample()` each frame to read the blended state as of (now − `delayMs`). The
 *  default `lerp` blends numeric fields and copies the rest; see
 *  `InterpolatorOptions` to tune `delayMs`/`maxSnapshots`/`lerp`. */
export declare function createInterpolator<T>(opts?: InterpolatorOptions<T>): Interpolator<T>;
