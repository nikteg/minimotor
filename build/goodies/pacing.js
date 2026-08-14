// ---------- Pacing: progression and cycles ----------
// The pure clocks a game runs on: endless wave scaling and a looping day/night
// cycle. The stateful pacers — `Gizmos.checkpointRoute` (laps) and
// `Gizmos.charges` (a refilling ability meter) — live in Gizmos.
import { wrap } from "./wrapping.js";
/** Common endless/wave progression curve. Wave 1 returns the configured bases. */
export function waveScale(wave, options = {}) {
    const n = Math.max(0, Math.floor(wave) - 1);
    return {
        count: Math.max(0, Math.floor((options.count ?? 3) + n * (options.countPerWave ?? 1))),
        health: (options.health ?? 1) * Math.pow(options.healthGrowth ?? 1.15, n),
        speed: (options.speed ?? 1) * Math.pow(options.speedGrowth ?? 1.04, n),
    };
}
/** Normalized looping time and a conventional four-part day phase. `time` and
 *  `dayLength` share one arbitrary unit (seconds, steps — your pick); `t` is
 *  the 0..1 position within the current day. Phases: dawn while `t < 0.1`,
 *  day while `t < 0.55`, dusk while `t < 0.7`, night otherwise. */
export function dayCycle(time, dayLength) {
    const t = wrap(time, dayLength) / dayLength;
    const phase = t < 0.1 ? "dawn" : t < 0.55 ? "day" : t < 0.7 ? "dusk" : "night";
    return { t, phase };
}
