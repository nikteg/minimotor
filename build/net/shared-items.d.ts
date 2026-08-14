import type { Room } from "./room.js";
export type SharedItemId = string | number;
export type SharedItem<T extends object> = T & {
    readonly id: SharedItemId;
};
export interface SharedItemsOptions<T extends object> {
    /** Message namespace when a room has several shared collections. Default `"items"`. */
    channel?: string;
    /** Stable item id. Defaults to the array index. */
    id?: (item: T, index: number) => SharedItemId;
    /** Delay before a taken item becomes available again. Default 0 (never hidden past this instant). */
    respawnMs?: number;
    /** Host-state snapshots per second for late join and recovery. Default 4. */
    hz?: number;
    /** Shared monotonic clock. Pair with `networkTime(room).now`. */
    now?: () => number;
    /** Host-side authority check. Returning false rejects the request. */
    canTake?: (item: SharedItem<T>, by: string) => boolean;
    /** Authoritative game logic. Runs after host confirmation, never from a snapshot. */
    onTake?: (item: SharedItem<T>, by: string) => void;
    /** Responsive presentation. Runs immediately for the requesting guest and
     * exactly once elsewhere after confirmation. Use for sound and particles. */
    onEffect?: (item: SharedItem<T>, by: string) => void;
    /** How long a guest hides an optimistically taken item while awaiting authority. Default 750ms. */
    requestTimeoutMs?: number;
}
export interface SharedItems<T extends object> extends Iterable<SharedItem<T>> {
    /** Every item, including currently unavailable ones. */
    readonly all: readonly SharedItem<T>[];
    /** Ask the host to take an item; hides it optimistically for this client. */
    take(item: SharedItem<T> | SharedItemId): void;
    /** Whether an item is currently available on this client. */
    available(item: SharedItem<T> | SharedItemId): boolean;
    stop(): void;
}
/** A host-authoritative, respawning collection with optimistic local hiding,
 * late-join snapshots, authoritative effects, and host migration. Useful for
 * coins, pickups, powerups, switches, loot, and destructible props.
 *
 *     const coins = Net.sharedItems(room, spawns, {
 *       channel: "coins",
 *       respawnMs: 4000,
 *       now: () => netTime.now,
 *       canTake: (coin, by) => overlaps(coin, player(by)),
 *       onEffect: (coin) => sfx.coin.play(),
 *     });
 *     for (const coin of coins) Draw.circle(coin, 8); */
export declare function sharedItems<T extends object>(room: Room<unknown>, source: readonly T[], options?: SharedItemsOptions<T>): SharedItems<T>;
