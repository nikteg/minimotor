/** Per-wave difficulty knobs from `waveScale`. */
export interface WaveScale {
    /** How many enemies to spawn this wave (integer, `>= 0`). */
    count: number;
    /** Enemy health — the `health` base on wave 1, multiplied by `healthGrowth` per later wave. */
    health: number;
    /** Enemy speed — the `speed` base on wave 1, multiplied by `speedGrowth` per later wave. */
    speed: number;
}
/** Common endless/wave progression curve. Wave 1 returns the configured bases. */
export declare function waveScale(wave: number, options?: {
    count?: number;
    countPerWave?: number;
    health?: number;
    healthGrowth?: number;
    speed?: number;
    speedGrowth?: number;
}): WaveScale;
/** One of the four parts of the day cycle returned by `dayCycle()`. */
export type DayPhase = "dawn" | "day" | "dusk" | "night";
/** Normalized looping time and a conventional four-part day phase. `time` and
 *  `dayLength` share one arbitrary unit (seconds, steps — your pick); `t` is
 *  the 0..1 position within the current day. Phases: dawn while `t < 0.1`,
 *  day while `t < 0.55`, dusk while `t < 0.7`, night otherwise. */
export declare function dayCycle(time: number, dayLength: number): {
    t: number;
    phase: DayPhase;
};
