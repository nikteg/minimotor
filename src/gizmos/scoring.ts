// ---------- Combo: a decaying hit streak ----------
// The stateful member of the scoring family. (The pure raters — timingGrade,
// scoreRank, beatClock — stay in Goodies.scoring.) Clock-derived: the streak
// decays as `Clock.world` advances — no tick(), just `hit()` and read.

import type { ClockHandle } from "../clock.js";

/** A decaying hit-streak multiplier returned by `combo()`. */
export interface Combo {
  /** Register a successful hit: extends the streak and refreshes the window. */
  hit(): void;
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
 *  success; read `count`/`multiplier`. Decays on its clock (default
 *  `Clock.world`, so it freezes on pause).
 *
 *    const combo = Minimotor.Gizmos.combo({ windowMs: 2000 });
 *    // on hit: combo.hit(); score += points * combo.multiplier; */
export function combo(options: {
  windowMs?: number;
  step?: number;
  max?: number;
  clock: ClockHandle;
}): Combo {
  const windowMs = Math.max(1, options.windowMs ?? 2000);
  const step = options.step ?? 1;
  const cap = options.max ?? Infinity;
  const clock = options.clock;
  let count = 0;
  let lastHit = -Infinity;

  const lapsed = () => clock.now - lastHit >= windowMs;
  const live = () => (lapsed() ? 0 : count);

  return {
    hit() {
      count = live() + 1; // a hit after the window lapsed restarts at 1
      lastHit = clock.now;
    },
    reset() {
      count = 0;
      lastHit = -Infinity;
    },
    get count() {
      return live();
    },
    get multiplier() {
      return Math.min(cap, 1 + Math.max(0, live() - 1) * step);
    },
    get fraction() {
      return lapsed() ? 0 : Math.max(0, 1 - (clock.now - lastHit) / windowMs);
    },
    get active() {
      return live() > 0;
    },
  };
}
