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
export declare function lruCache<V>(cap: number): LruCache<V>;
