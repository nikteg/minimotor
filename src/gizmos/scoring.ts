// ---------- Scoring: the stateful members ----------
// `combo` is a decaying hit streak, clock-derived: it decays as `Clock.world`
// advances — no tick(), just `hit()` and read. `scoreTracker` carries a
// score/best pair and persists `best`. (The pure raters — timingGrade,
// scoreRank, beatClock — and `formatClock` stay in Goodies.scoring.)

import type { ClockHandle } from "@src/clock/index.js";
import * as Storage from "@src/storage/local.js";

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

/** Where a `scoreTracker` keeps its best score. Synchronous by design: `best`
 *  is read in `draw` every frame, so an async round-trip has nowhere to go.
 *  Defaults to plain `localStorage`; pass your own to scope or redirect it
 *  (e.g. prefix per save slot, or keep it in memory for tests). */
export interface ScoreStore {
  load(key: string, fallback: number): number;
  save(key: string, value: number): void;
}

/** Score + best-score tracker returned by `scoreTracker()`. */
export interface ScoreTracker {
  readonly score: number;
  readonly best: number;
  /** Add points; auto-saves best if exceeded */
  add(points: number): void;
  /** Reset the current score to 0 (keeps `best`) — call on restart. */
  reset(): void;
  /** Force-save current best (e.g. on game over) */
  save(): void;
}

/** A score paired with a persistent best: `best` is loaded under `storageKey`
 *  now and re-saved whenever the score passes it. The default store is
 *  crash-safe, so private browsing or a full quota degrades to an in-memory
 *  best rather than throwing. Like every Gizmo it takes its collaborators
 *  directly, not the app — pass `store` to scope the key to a game or slot.
 *
 *    const scores = Minimotor.Gizmos.scoreTracker("snake_best");
 *    scores.add(10);   // score 10, best follows if exceeded */
export function scoreTracker(storageKey: string, store: ScoreStore = Storage): ScoreTracker {
  let _score = 0;
  let _best = store.load(storageKey, 0);
  return {
    get score() {
      return _score;
    },
    get best() {
      return _best;
    },
    add(points: number) {
      _score += points;
      if (_score > _best) {
        _best = _score;
        store.save(storageKey, _best);
      }
    },
    reset() {
      _score = 0;
    },
    save() {
      store.save(storageKey, _best);
    },
  };
}
