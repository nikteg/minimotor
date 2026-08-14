/** Options for `createPresence`: idle timeout and an injectable clock. */
export interface PresenceOptions {
    /** Expire an entry not `set`/`touch`ed within this many ms. Default 6000. */
    timeoutMs?: number;
    /** Clock source (ms). Defaults to `Date.now`; override in tests. */
    now?: () => number;
}
/** A server-side registry of each player's latest state that expires anyone who
 *  goes quiet. */
export interface Presence<T> {
    /** Store `id`'s latest state and stamp it seen now. */
    set(id: string, state: T): void;
    /** Refresh `id`'s seen-time without changing its state (e.g. a keep-alive).
     *  No-op if `id` isn't present. */
    touch(id: string): void;
    /** The current state for `id`, or `undefined`. */
    get(id: string): T | undefined;
    /** Is `id` present? */
    has(id: string): boolean;
    /** Remove `id`; true if it was present. */
    delete(id: string): boolean;
    /** Drop every entry not seen within `timeoutMs` and return the removed ids —
     *  broadcast them as leaves. Call once per server tick. */
    prune(): string[];
    /** Live `[id, state]` pairs (a fresh array; safe to iterate while mutating). */
    entries(): [string, T][];
    /** Live ids. */
    readonly ids: string[];
    /** Number of live entries. */
    readonly size: number;
    /** Forget everyone. */
    clear(): void;
}
/** A player-state registry that expires quiet entries. `set(id, state)` on each
 *  snapshot, `prune()` each tick to drop the silent (broadcast the returned
 *  ids as leaves), `get`/`entries` to read.
 *
 *    const players = createPresence<{ x: number; y: number }>({ timeoutMs: 6000 });
 *    // on message: players.set(msg.id, { x: msg.x, y: msg.y });
 *    // each tick:  for (const id of players.prune()) room.broadcast({ type: "leave", id });
 *    //             for (const [id, p] of players.entries()) simulateAgainst(p); */
export declare function createPresence<T>(options?: PresenceOptions): Presence<T>;
