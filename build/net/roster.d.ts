/** Options for `createRoster`: interpolation delay, idle timeout, blend, and an
 *  injectable clock. */
export interface RosterOptions<T> {
    /** Interpolation delay passed to each peer's interpolator (see
     *  `createInterpolator`). */
    delayMs?: number | "auto";
    /** Initial packet interval for adaptive interpolation. */
    expectedIntervalMs?: number;
    /** Drop a peer after this long without an update, in ms. Default 5000. */
    timeoutMs?: number;
    /** Custom blend for interpolation (angles, nested objects). */
    lerp?: (a: T, b: T, t: number) => T;
    /** Optional projection beyond the newest snapshot. */
    extrapolate?: (a: T, b: T, t: number) => T;
    /** Projection cap in milliseconds. Default 0. */
    maxExtrapolationMs?: number;
    /** Millisecond clock — injectable for tests. Default `performance.now`. */
    now?: () => number;
}
/** Tracks remote peers: interpolates each one's state, detects joins, and
 *  prunes any that go quiet. */
export interface Roster<T> {
    /** Feed a state update for peer `id` (creating its interpolator on first
     *  sight and stamping last-seen). Pass the sender's clock as `sentAt` when
     *  the protocol carries one — see `Interpolator.push`. `{ isNew }` flags a
     *  just-joined peer. */
    update(id: string, state: T, atMs?: number, sentAt?: number): {
        isNew: boolean;
    };
    /** Remove a peer explicitly (e.g. on a `bye`). True if it existed. */
    remove(id: string): boolean;
    /** Drop peers unseen for `timeoutMs`; returns the removed ids. Call each
     *  step — it's the cleanup that's easy to forget or get wrong. */
    prune(atMs?: number): string[];
    /** Interpolated `[id, state]` for every peer that has a sample yet. */
    sample(atMs?: number): Array<[string, T]>;
    /** Interpolated state for ONE peer (its own on-demand `sample`), or null if
     *  it isn't tracked or has no sample yet. */
    sampleOne(id: string, atMs?: number): T | null;
    /** Most recently received state, without interpolation delay. Use for
     *  authority checks; render with `sample`/`sampleOne`. */
    latest(id: string): T | null;
    /** Clear a peer's interpolation buffer so its next update SNAPS instead of
     *  sweeping — for a respawn or teleport. Keeps the peer tracked; no-op if the
     *  id is unknown. */
    reset(id: string): void;
    /** The tracked peer ids. */
    readonly ids: string[];
    /** How many peers are tracked. */
    readonly size: number;
    /** Forget every peer. */
    clear(): void;
}
/** Track a set of remote peers, each with its own snapshot interpolator. */
export declare function createRoster<T>(options?: RosterOptions<T>): Roster<T>;
