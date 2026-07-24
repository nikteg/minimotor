// ---------- LRU cache ----------
// The shared bounded-cache primitive for engine-internal canvas/object caches
// (baked layers, per-color particle dots). Engine-internal on purpose — not
// exported from index.ts.
//
// Which cache to reach for:
//   - `lruCache(cap)` — string-keyed caches whose key space is OPEN (sizes,
//     colors, themes fold into the key) and whose values are heavy (offscreen
//     canvases). The cap turns "unbounded growth footgun" into "worst case N
//     re-bakes".
//   - plain `Map` — small CLOSED key sets (16 autotile masks, a fixed palette)
//     where eviction would only cause pointless re-bakes.
//   - `WeakMap` — identity-keyed caches (per-source-image tints) that should
//     die with the object they decorate.

/** A bounded string-keyed cache with least-recently-used eviction. */
export interface LruCache<V> {
  /** The cached value, refreshing its recency — or undefined on a miss. */
  get(key: string): V | undefined;
  /** Store `value` as most recent, evicting the oldest entry beyond the cap. */
  set(key: string, value: V): void;
  /** Remove one entry; true when it existed. */
  delete(key: string): boolean;
  /** Drop everything. */
  clear(): void;
  /** Live entry count. */
  readonly size: number;
  /** Iterate entries (for sweeps); insertion/recency order, oldest first. */
  entries(): IterableIterator<[string, V]>;
}

/** Create an `LruCache` holding at most `cap` entries. Backed by a Map:
 *  iteration order IS insertion order, so delete+reinsert on a hit marks the
 *  key most-recently-used and the first key is always the eviction victim. */
export function lruCache<V>(cap: number): LruCache<V> {
  const map = new Map<string, V>();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key)!;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key); // reinsert moves an existing key to most-recent
      map.set(key, value);
      while (map.size > cap) map.delete(map.keys().next().value!);
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    entries() {
      return map.entries();
    },
  };
}
