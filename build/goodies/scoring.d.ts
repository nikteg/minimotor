/** A rhythm-hit accuracy grade returned by `timingGrade()`, strictest to loosest. */
export type TimingGrade = "perfect" | "great" | "good" | "miss";
/** Grade the absolute distance from a rhythm event. Windows are inclusive and
 * ordered from strictest to loosest. */
export declare function timingGrade(offsetMs: number, windows?: {
    perfect?: number;
    great?: number;
    good?: number;
}): TimingGrade;
/** Label a score from ascending thresholds, e.g. `[0,1000,5000]` and
 * `["C","B","A"]`. Scores below the first threshold use the first rank. */
export declare function scoreRank(score: number, thresholds: readonly number[], ranks: readonly string[]): string | undefined;
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
export declare function beatClock(elapsedMs: number, periodMs: number): Beat;
/** Format milliseconds as `m:ss` (or `h:mm:ss` past an hour) — the timer/score
 *  screen clock that otherwise gets re-derived, with the seconds always padded.
 *  Negative input reads as `0:00`. */
export declare function formatClock(ms: number): string;
