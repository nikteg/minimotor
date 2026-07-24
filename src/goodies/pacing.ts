// ---------- Pacing: progression and cycles ----------
// The pure clocks a game runs on: endless wave scaling and a looping day/night
// cycle. The stateful pacers — `Gizmos.checkpointRoute` (laps) and
// `Gizmos.charges` (a refilling ability meter) — live in Gizmos.

import { wrap } from "./wrapping.js";

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
export function waveScale(
  wave: number,
  options: {
    count?: number;
    countPerWave?: number;
    health?: number;
    healthGrowth?: number;
    speed?: number;
    speedGrowth?: number;
  } = {},
): WaveScale {
  const n = Math.max(0, Math.floor(wave) - 1);
  return {
    count: Math.max(0, Math.floor((options.count ?? 3) + n * (options.countPerWave ?? 1))),
    health: (options.health ?? 1) * Math.pow(options.healthGrowth ?? 1.15, n),
    speed: (options.speed ?? 1) * Math.pow(options.speedGrowth ?? 1.04, n),
  };
}

/** One of the four parts of the day cycle returned by `dayCycle()`. */
export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Normalized looping time and a conventional four-part day phase. `time` and
 *  `dayLength` share one arbitrary unit (seconds, steps — your pick); `t` is
 *  the 0..1 position within the current day. Phases: dawn while `t < 0.1`,
 *  day while `t < 0.55`, dusk while `t < 0.7`, night otherwise. */
export function dayCycle(time: number, dayLength: number): { t: number; phase: DayPhase } {
  const t = wrap(time, dayLength) / dayLength;
  const phase: DayPhase = t < 0.1 ? "dawn" : t < 0.55 ? "day" : t < 0.7 ? "dusk" : "night";
  return { t, phase };
}
