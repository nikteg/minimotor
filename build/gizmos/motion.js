// ---------- Motion gadgets: patrol & trail ----------
// Stateful movement helpers you create once and tick: a back-and-forth patrol
// oscillator and a bounded motion-trail ring. (The pure steering math —
// approachAngle / leadTarget / formations — stays in Goodies.steering.)
/** Create a back-and-forth `Patrol` oscillating between `min` and `max`.
 *  `options.start` sets the initial `pos` (default `min`), `options.dir` the
 *  initial facing (default `+1`). Goombas, moving platforms, sweeping hazards. */
export function patrol(min, max, options = {}) {
    let pos = options.start ?? min;
    let dir = options.dir ?? 1;
    return {
        get pos() {
            return pos;
        },
        get dir() {
            return dir;
        },
        tick(dist) {
            pos += dir * dist;
            if (pos <= min) {
                pos = min;
                dir = 1;
            }
            else if (pos >= max) {
                pos = max;
                dir = -1;
            }
            return pos;
        },
    };
}
/** Create a `Trail` ring holding at most `maxLen` points — `push(x, y)` each
 *  frame, read `points` (newest first) to draw a fading tail behind a
 *  ball/dash/cursor. */
export function trail(maxLen) {
    const points = [];
    return {
        push(x, y) {
            points.unshift({ x, y });
            if (points.length > maxLen)
                points.pop();
        },
        get points() {
            return points;
        },
        clear() {
            points.length = 0;
        },
    };
}
