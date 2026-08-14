/** Bernoulli chance with injectable RNG. Probability is clamped to 0..1. */
export declare function chance(probability: number, rng?: () => number): boolean;
/** One entry in a weighted table for `weightedPick`. */
export interface Weighted<T> {
    /** The value returned when this entry is picked. */
    value: T;
    /** Relative likelihood. Non-positive weights are ignored; probability is
     *  `weight` over the sum of positive weights. */
    weight: number;
}
/** Pick from weighted entries. Non-positive weights are ignored; returns
 * `undefined` when no entry has positive weight. RNG is injectable for seeded
 * roguelikes, loot tables and deterministic tests. */
export declare function weightedPick<T>(entries: readonly Weighted<T>[], rng?: () => number): T | undefined;
/** Return a shuffled COPY of `items` (Fisher-Yates, injectable RNG). Use this
 *  for a one-shot shuffle — a deck, a quiz order, a playlist. The tempting
 *  `[...items].sort(() => rng() - 0.5)` is measurably biased; this isn't.
 *  (For repeated without-replacement draws, use `shuffleBag`.) */
export declare function shuffle<T>(items: readonly T[], rng?: () => number): T[];
/** Roll conventional integer dice and return the total. */
export declare function rollDice(count: number, sides: number, rng?: () => number): number;
/** The outcome of a `damageRoll`. */
export interface DamageRoll {
    /** Damage dealt — a non-negative rounded integer, crit multiplier already applied. */
    amount: number;
    /** Whether this roll critically hit (rolled under `critChance`). */
    critical: boolean;
}
/** Action/RPG damage roll with symmetric variance and an optional critical. */
export declare function damageRoll(base: number, options?: {
    variance?: number;
    critChance?: number;
    critMultiplier?: number;
}, rng?: () => number): DamageRoll;
