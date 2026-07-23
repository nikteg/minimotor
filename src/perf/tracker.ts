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

const WINDOW = 60; // frames of history

/** A per-frame perf sampler with its own private rolling history.
 *  Each tracker is independent — no shared module state. */
export interface PerfTracker {
  /** Call once per frame with a monotonic timestamp. Returns current stats. */
  (nowMs: number): PerfStats;
}

/** Create an isolated FPS/frame-time tracker. Ring buffer + running sum: a
 *  perf tool shouldn't do O(n) shifts and allocations per frame itself. */
export function createPerfTracker(window = WINDOW): PerfTracker {
  const times = new Float64Array(window);
  let head = 0; // next slot to overwrite
  let count = 0;
  let sum = 0;
  let lastTime = 0;
  let current: PerfStats = { fps: 60, frameMs: 16.7, minMs: 16.7, maxMs: 16.7, avgMs: 16.7 };

  return function tick(nowMs: number): PerfStats {
    if (lastTime === 0) {
      lastTime = nowMs;
      return current;
    }
    const dt = nowMs - lastTime;
    lastTime = nowMs;

    if (count === window) sum -= times[head];
    else count++;
    times[head] = dt;
    head = (head + 1) % window;
    sum += dt;

    // Min/max over ≤`window` entries — a plain loop, no spread/allocs. (A
    // monotonic deque would be O(1), but at 60 entries the loop is simpler.)
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
      const t = times[i];
      if (t < min) min = t;
      if (t > max) max = t;
    }

    const avg = sum / count;
    current = {
      fps: Math.round(1000 / avg),
      frameMs: Math.round(dt * 10) / 10,
      minMs: Math.round(min * 10) / 10,
      maxMs: Math.round(max * 10) / 10,
      avgMs: Math.round(avg * 10) / 10,
    };
    return current;
  };
}
