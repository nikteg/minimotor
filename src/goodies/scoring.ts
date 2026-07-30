// ---------- Scoring: grades, ranks and readouts ----------
// The pure raters of the player's performance: `timingGrade` grades a rhythm
// hit, `scoreRank` labels a final score, `beatClock` turns a clock into beat
// timing, `formatClock` renders a duration for the HUD. The stateful members
// live in Gizmos as `Gizmos.combo` and `Gizmos.scoreTracker`.

/** A rhythm-hit accuracy grade returned by `timingGrade()`, strictest to loosest. */
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

/** Beat timing for a moment in a track, returned by `beatClock()`. */
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

/** Format milliseconds as `m:ss` (or `h:mm:ss` past an hour) — the timer/score
 *  screen clock that otherwise gets re-derived, with the seconds always padded.
 *  Negative input reads as `0:00`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
