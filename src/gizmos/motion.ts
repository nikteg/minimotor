// ---------- Motion gadgets: patrol & trail ----------
// Stateful movement helpers you create once and tick: a back-and-forth patrol
// oscillator and a bounded motion-trail ring. (The pure steering math —
// approachAngle / leadTarget / formations — stays in Goodies.steering.)

/** Back-and-forth patrol between `min` and `max` along one axis. `tick(dist)`
 *  advances by `dist` (= speed × dt), reverses at each bound without jitter or
 *  overshoot, and returns the new position; `dir` is the current facing (+1 /
 *  -1) for flipping a sprite. Goombas, moving platforms, sweeping hazards. */
export interface Patrol {
  readonly pos: number;
  readonly dir: 1 | -1;
  tick(dist: number): number;
}

export function patrol(
  min: number,
  max: number,
  options: { start?: number; dir?: 1 | -1 } = {},
): Patrol {
  let pos = options.start ?? min;
  let dir: 1 | -1 = options.dir ?? 1;
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
      } else if (pos >= max) {
        pos = max;
        dir = -1;
      }
      return pos;
    },
  };
}

/** A fixed-length motion trail — `push(x, y)` each frame, read `points`
 *  (newest first) to draw a fading tail behind a ball/dash/cursor. Bounded ring
 *  so it never grows without limit. */
export interface Trail {
  push(x: number, y: number): void;
  readonly points: ReadonlyArray<{ x: number; y: number }>;
  clear(): void;
}

export function trail(maxLen: number): Trail {
  const points: Array<{ x: number; y: number }> = [];
  return {
    push(x, y) {
      points.unshift({ x, y });
      if (points.length > maxLen) points.pop();
    },
    get points() {
      return points;
    },
    clear() {
      points.length = 0;
    },
  };
}
