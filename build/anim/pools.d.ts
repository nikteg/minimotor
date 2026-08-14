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
export declare function keyed<K, V>(factory?: (key: K) => V): KeyedPool<K, V>;
/** A collection of one-shot effects that removes completed entries lazily. */
export interface EffectPool<I, E> extends Iterable<E> {
    play(input: I): E;
    prune(): void;
    clear(): void;
    readonly size: number;
}
/** Own short-lived animation/effect objects without splice/cleanup loops. */
export declare function effects<I, E>(create: (input: I) => E, done: (effect: E) => boolean): EffectPool<I, E>;
