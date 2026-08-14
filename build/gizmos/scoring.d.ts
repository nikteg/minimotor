import type { ClockHandle } from "../clock/index.js";
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
 *    const combo = Gizmos.combo({ windowMs: 2000 });
 *    // on hit: combo.hit(); score += points * combo.multiplier; */
export declare function combo(options: {
    windowMs?: number;
    step?: number;
    max?: number;
    clock: ClockHandle;
}): Combo;
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
 *    const scores = Gizmos.scoreTracker("snake_best");
 *    scores.add(10);   // score 10, best follows if exceeded */
export declare function scoreTracker(storageKey: string, store?: ScoreStore): ScoreTracker;
