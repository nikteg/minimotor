/** A frame-timing snapshot: `fps` plus last/min/max/avg frame durations. */
export interface PerfStats {
    /** Frames per second, rounded, from the rolling average frame time. */
    fps: number;
    /** The most recent frame's duration in ms, rounded to 0.1. */
    frameMs: number;
    /** Shortest frame time over the window, in ms (rounded to 0.1). */
    minMs: number;
    /** Longest frame time over the window, in ms (rounded to 0.1) — the spike. */
    maxMs: number;
    /** Mean frame time over the window, in ms (rounded to 0.1). */
    avgMs: number;
}
/** A per-frame perf sampler with its own private rolling history.
 *  Each tracker is independent — no shared module state. */
export interface PerfTracker {
    /** Call once per frame with a monotonic timestamp. Returns current stats. */
    (nowMs: number): PerfStats;
}
/** Create an isolated FPS/frame-time tracker. Ring buffer + running sum: a
 *  perf tool shouldn't do O(n) shifts and allocations per frame itself. */
export declare function createPerfTracker(window?: number): PerfTracker;
