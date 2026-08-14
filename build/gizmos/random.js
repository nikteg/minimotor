// ---------- Seeded RNG & shuffle bag ----------
// The stateful members of the randomness family: a deterministic generator you
// keep and draw from, and a without-replacement bag. The pure one-shot helpers
// (chance, weightedPick, shuffle, rollDice, damageRoll) live in Goodies.random.
import { clamp } from "../math/mathf.js";
/** A tiny deterministic PRNG (mulberry32). Returns a function producing floats
 *  in `[0, 1)`, so it drops straight into the `rng` argument of `chance`,
 *  `weightedPick`, `shuffleBag`, `rollDice` and `damageRoll`. Same seed → same
 *  stream, which is what makes a run replayable or a daily seed shareable.
 *
 *    const rng = Gizmos.seedRng(1234);
 *    const bag = Gizmos.shuffleBag(cards, rng); // deterministic */
export function seedRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Without-replacement random bag for cards, music, enemy varieties and fair
 * procedural selection. It automatically reshuffles when exhausted. */
export function shuffleBag(items, rng = Math.random) {
    let bag = [];
    function reset() {
        bag = [...items];
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    reset();
    return {
        next() {
            if (bag.length === 0)
                reset();
            return bag.pop();
        },
        reset,
        get remaining() {
            return bag.length;
        },
    };
}
