import { clamp } from "../mathf.js";

// ---------- Randomness: seeds, chance, loot and dice ----------
// Everything that draws on a random source. The recipes take an injectable
// `rng: () => number` (default Math.random); pass `seedRng(n)` for seeded,
// replayable runs — daily challenges, shareable procedural worlds, tests.

/** A tiny deterministic PRNG (mulberry32). Returns a function producing floats
 *  in `[0, 1)`, so it drops straight into the `rng` argument of `chance`,
 *  `weightedPick`, `shuffleBag`, `rollDice` and `damageRoll`. Same seed → same
 *  stream, which is what makes a run replayable or a daily seed shareable.
 *
 *    const rng = Minimotor.Goodies.seedRng(1234);
 *    const bag = Minimotor.Goodies.shuffleBag(cards, rng); // deterministic */
export function seedRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bernoulli chance with injectable RNG. Probability is clamped to 0..1. */
export function chance(probability: number, rng: () => number = Math.random): boolean {
  return rng() < clamp(probability, 0, 1);
}

export interface Weighted<T> {
  value: T;
  weight: number;
}

/** Pick from weighted entries. Non-positive weights are ignored; returns
 * `undefined` when no entry has positive weight. RNG is injectable for seeded
 * roguelikes, loot tables and deterministic tests. */
export function weightedPick<T>(
  entries: readonly Weighted<T>[],
  rng: () => number = Math.random,
): T | undefined {
  let total = 0;
  for (const entry of entries) if (entry.weight > 0) total += entry.weight;
  if (!(total > 0)) return undefined;
  let cursor = clamp(rng(), 0, 1 - Number.EPSILON) * total;
  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    cursor -= entry.weight;
    if (cursor < 0) return entry.value;
  }
  return entries.find((entry) => entry.weight > 0)?.value;
}

export interface ShuffleBag<T> {
  /** Draw one item; automatically refills after the last item. */
  next(): T | undefined;
  /** Reshuffle a fresh copy of the source items. */
  reset(): void;
  readonly remaining: number;
}

/** Without-replacement random bag for cards, music, enemy varieties and fair
 * procedural selection. It automatically reshuffles when exhausted. */
export function shuffleBag<T>(items: readonly T[], rng: () => number = Math.random): ShuffleBag<T> {
  let bag: T[] = [];
  function reset(): void {
    bag = [...items];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  reset();
  return {
    next() {
      if (bag.length === 0) reset();
      return bag.pop();
    },
    reset,
    get remaining() {
      return bag.length;
    },
  };
}

/** Return a shuffled COPY of `items` (Fisher-Yates, injectable RNG). Use this
 *  for a one-shot shuffle — a deck, a quiz order, a playlist. The tempting
 *  `[...items].sort(() => rng() - 0.5)` is measurably biased; this isn't.
 *  (For repeated without-replacement draws, use `shuffleBag`.) */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Roll conventional integer dice and return the total. */
export function rollDice(count: number, sides: number, rng: () => number = Math.random): number {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(sides) || sides < 1) {
    throw new RangeError("Goodies.rollDice: count must be >= 0 and sides must be >= 1");
  }
  let total = 0;
  for (let i = 0; i < count; i++)
    total += 1 + Math.floor(clamp(rng(), 0, 1 - Number.EPSILON) * sides);
  return total;
}

export interface DamageRoll {
  amount: number;
  critical: boolean;
}

/** Action/RPG damage roll with symmetric variance and an optional critical. */
export function damageRoll(
  base: number,
  options: { variance?: number; critChance?: number; critMultiplier?: number } = {},
  rng: () => number = Math.random,
): DamageRoll {
  const variance = Math.max(0, options.variance ?? 0.1);
  const varied = base * (1 + (rng() * 2 - 1) * variance);
  const critical = chance(options.critChance ?? 0, rng);
  return {
    amount: Math.max(0, Math.round(varied * (critical ? (options.critMultiplier ?? 2) : 1))),
    critical,
  };
}
