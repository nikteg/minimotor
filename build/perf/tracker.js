const WINDOW = 60; // frames of history
/** Create an isolated FPS/frame-time tracker. Ring buffer + running sum: a
 *  perf tool shouldn't do O(n) shifts and allocations per frame itself. */
export function createPerfTracker(window = WINDOW) {
    const times = new Float64Array(window);
    let head = 0; // next slot to overwrite
    let count = 0;
    let sum = 0;
    let lastTime = 0;
    let current = { fps: 60, frameMs: 16.7, minMs: 16.7, maxMs: 16.7, avgMs: 16.7 };
    return function tick(nowMs) {
        if (lastTime === 0) {
            lastTime = nowMs;
            return current;
        }
        const dt = nowMs - lastTime;
        lastTime = nowMs;
        if (count === window)
            sum -= times[head];
        else
            count++;
        times[head] = dt;
        head = (head + 1) % window;
        sum += dt;
        // Min/max over ≤`window` entries — a plain loop, no spread/allocs. (A
        // monotonic deque would be O(1), but at 60 entries the loop is simpler.)
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < count; i++) {
            const t = times[i];
            if (t < min)
                min = t;
            if (t > max)
                max = t;
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
