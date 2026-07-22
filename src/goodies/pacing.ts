// ---------- Pacing: progression and cycles ----------
// The pure clocks a game runs on: endless wave scaling and a looping day/night
// cycle. The stateful pacers — `checkpointRoute` (laps) and `charges` (a
// refilling ability meter) — live in Gizmos.pacing.

import { wrap } from "./wrapping.js";

export interface WaveScale {
  count: number;
  health: number;
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

export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Normalized looping time and a conventional four-part day phase. */
export function dayCycle(time: number, dayLength: number): { t: number; phase: DayPhase } {
  const t = wrap(time, dayLength) / dayLength;
  const phase: DayPhase = t < 0.1 ? "dawn" : t < 0.55 ? "day" : t < 0.7 ? "dusk" : "night";
  return { t, phase };
}
