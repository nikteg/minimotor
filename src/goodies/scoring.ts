// ---------- Scoring: grades, ranks and combos ----------
// Rating the player's performance. `timingGrade` grades a rhythm hit,
// `scoreRank` labels a final score, and `combo` tracks a decaying hit streak —
// the multiplier that rewards not missing.

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
 *    const combo = Minimotor.Goodies.combo({ windowMs: 2000 });
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

export interface Beat {
  /** Whole beats elapsed. */
  beat: number;
  /** Position within the current beat, 0..1. */
  phase: number;
  /** Signed ms to the NEAREST beat line, in `[-period/2, period/2)`. Pass its
   *  absolute value straight to `timingGrade`. */
  offset: number;
  /** Triangle pulse 0→1→0 across the beat — for a metronome flash / bounce. */
  pulse: number;
}

/** Turn a running clock into beat timing: which beat, how far into it, the
 *  signed distance to the nearest beat line (the exact quantity `timingGrade`
 *  wants, and the modular-arithmetic bit rhythm games get wrong), and a
 *  metronome pulse. `elapsedMs` since the track started, `periodMs` per beat. */
export function beatClock(elapsedMs: number, periodMs: number): Beat {
  const p = elapsedMs / periodMs;
  const beat = Math.floor(p);
  const phase = p - beat;
  const offset = (phase < 0.5 ? phase : phase - 1) * periodMs;
  const pulse = 1 - Math.abs(phase * 2 - 1);
  return { beat, phase, offset, pulse };
}
