/** A lazily-created value per stable entity key. */
export interface KeyedPool<K, V> extends Iterable<readonly [K, V]> {
  get(key: K, create?: (key: K) => V): V;
  has(key: K): boolean;
  delete(key: K): boolean;
  /** Drop entries whose keys are absent from `live`. */
  retain(live: Iterable<K>): void;
  clear(): void;
  readonly size: number;
}

/** Own per-entity animation cursors without hand-maintaining Maps. */
export function keyed<K, V>(factory?: (key: K) => V): KeyedPool<K, V> {
  const values = new Map<K, V>();
  return {
    get(key, create = factory) {
      const existing = values.get(key);
      if (existing !== undefined || values.has(key)) return existing as V;
      if (!create) throw new Error("Anim.keyed: no factory supplied");
      const value = create(key);
      values.set(key, value);
      return value;
    },
    has: (key) => values.has(key),
    delete: (key) => values.delete(key),
    retain(live) {
      const keep = new Set(live);
      for (const key of values.keys()) if (!keep.has(key)) values.delete(key);
    },
    clear: () => values.clear(),
    get size() {
      return values.size;
    },
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}

/** A collection of one-shot effects that removes completed entries lazily. */
export interface EffectPool<I, E> extends Iterable<E> {
  play(input: I): E;
  prune(): void;
  clear(): void;
  readonly size: number;
}

/** Own short-lived animation/effect objects without splice/cleanup loops. */
export function effects<I, E>(
  create: (input: I) => E,
  done: (effect: E) => boolean,
): EffectPool<I, E> {
  const active: E[] = [];
  const prune = () => {
    for (let i = active.length - 1; i >= 0; i--) {
      if (done(active[i])) active.splice(i, 1);
    }
  };
  return {
    play(input) {
      const effect = create(input);
      active.push(effect);
      return effect;
    },
    prune,
    clear() {
      active.length = 0;
    },
    get size() {
      prune();
      return active.length;
    },
    [Symbol.iterator]() {
      prune();
      return active[Symbol.iterator]();
    },
  };
}
