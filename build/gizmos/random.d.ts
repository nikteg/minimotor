/** A tiny deterministic PRNG (mulberry32). Returns a function producing floats
 *  in `[0, 1)`, so it drops straight into the `rng` argument of `chance`,
 *  `weightedPick`, `shuffleBag`, `rollDice` and `damageRoll`. Same seed → same
 *  stream, which is what makes a run replayable or a daily seed shareable.
 *
 *    const rng = Gizmos.seedRng(1234);
 *    const bag = Gizmos.shuffleBag(cards, rng); // deterministic */
export declare function seedRng(seed: number): () => number;
/** A without-replacement random bag returned by `shuffleBag()`; auto-reshuffles when drained. */
export interface ShuffleBag<T> {
    /** Draw one item; automatically refills after the last item. */
    next(): T | undefined;
    /** Reshuffle a fresh copy of the source items. */
    reset(): void;
    /** Items left before the bag auto-reshuffles (`0` right after the last draw). */
    readonly remaining: number;
}
/** Without-replacement random bag for cards, music, enemy varieties and fair
 * procedural selection. It automatically reshuffles when exhausted. */
export declare function shuffleBag<T>(items: readonly T[], rng?: () => number): ShuffleBag<T>;
