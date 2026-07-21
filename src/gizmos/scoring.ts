// ---------- Combo: a decaying hit streak ----------
// The stateful member of the scoring family. (The pure raters — timingGrade,
// scoreRank, beatClock — stay in Goodies.scoring.)

export interface Combo {
  /** Register a successful hit: extends the streak and refreshes the window. */
  hit(): void;
  /** Decay the window by `dtMs`; when it lapses the streak resets to 0. */
  tick(dtMs: number): void;
  /** Force the streak back to 0 (a miss or reset). */
  reset(): void;
  /** Consecutive hits inside the window. */
  readonly count: number;
  /** Scoring multiplier: `1 + max(0, count - 1) * step`, capped at `max`
   *  (so with the default step 1 the streak reads x1, x2, x3…). */
  readonly multiplier: number;
  /** Fraction of the window left before the streak drops, 1..0. */
  readonly fraction: number;
  /** True while a streak is alive. */
  readonly active: boolean;
}

/** A decaying hit-streak multiplier — the arcade staple where landing hits in
 *  quick succession builds a bonus that fades if you stall. `hit()` on each
 *  success, `tick(stepMs)` each step; read `count` for the "x N" display and
 *  `multiplier` for scoring.
 *
 *    const combo = Minimotor.Gizmos.combo({ windowMs: 2000 });
 *    // on hit: combo.hit(); score += points * combo.multiplier;
 *    // each step: combo.tick(Loop.step); */
export function combo(options: { windowMs?: number; step?: number; max?: number } = {}): Combo {
  const windowMs = Math.max(1, options.windowMs ?? 2000);
  const step = options.step ?? 1;
  const cap = options.max ?? Infinity;
  let count = 0;
  let remaining = 0;
  return {
    hit() {
      count++;
      remaining = windowMs;
    },
    tick(dtMs) {
      if (remaining > 0) {
        remaining = Math.max(0, remaining - dtMs);
        if (remaining === 0) count = 0;
      }
    },
    reset() {
      count = 0;
      remaining = 0;
    },
    get count() {
      return count;
    },
    get multiplier() {
      return Math.min(cap, 1 + Math.max(0, count - 1) * step);
    },
    get fraction() {
      return remaining / windowMs;
    },
    get active() {
      return count > 0;
    },
  };
}
