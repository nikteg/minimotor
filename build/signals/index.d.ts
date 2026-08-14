/** A named synchronous event bus. `on`/`once`/`emit` take a payload type
 *  parameter — inferred from the handler, or pinned explicitly
 *  (`Signals.on<number>("score", n => …)`) for cross-module type safety. */
export interface SignalBus {
    /** Subscribe to `event`. Returns an unsubscribe function. */
    on<T = unknown>(event: string, handler: (payload: T) => void): () => void;
    /** Subscribe for a single emission, then auto-unsubscribe. */
    once<T = unknown>(event: string, handler: (payload: T) => void): () => void;
    /** Emit `event` to all current listeners, synchronously. */
    emit<T = unknown>(event: string, payload?: T): void;
    /** Remove a handler, or all handlers for `event`, or everything. */
    off(event?: string, handler?: (payload: never) => void): void;
    /** Live listener count for `event`. */
    count(event: string): number;
}
export declare function createSignals(): SignalBus;
