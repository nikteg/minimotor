import { everyMs } from "./rate.js";
import type { Room } from "./room.js";

const SHARED_ITEMS_KEY = "__mm_shared_items";

export type SharedItemId = string | number;
export type SharedItem<T extends object> = T & { readonly id: SharedItemId };

type SharedItemsMessage =
  | { [SHARED_ITEMS_KEY]: 1; channel: string; kind: "take"; id: SharedItemId }
  | {
      [SHARED_ITEMS_KEY]: 1;
      channel: string;
      kind: "taken";
      id: SharedItemId;
      by: string;
      availableAt: number;
    }
  | {
      [SHARED_ITEMS_KEY]: 1;
      channel: string;
      kind: "state";
      unavailable: [SharedItemId, number][];
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
export function sharedItems<T extends object>(
  room: Room<unknown>,
  source: readonly T[],
  options: SharedItemsOptions<T> = {},
): SharedItems<T> {
  const channel = options.channel ?? "items";
  const now = options.now ?? (() => performance.now());
  const items = source.map(
    (item, index) =>
      ({
        ...item,
        id:
          options.id?.(item, index) ??
          ("id" in item && (typeof item.id === "string" || typeof item.id === "number")
            ? item.id
            : index),
      }) as SharedItem<T>,
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const unavailable = new Map<SharedItemId, number>();
  const pending = new Map<SharedItemId, number>();
  const predictedEffects = new Map<SharedItemId, number>();

  const idOf = (item: SharedItem<T> | SharedItemId): SharedItemId =>
    typeof item === "object" ? item.id : item;
  const isMessage = (value: unknown): value is SharedItemsMessage =>
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[SHARED_ITEMS_KEY] === 1 &&
    (value as SharedItemsMessage).channel === channel;
  const send = (message: SharedItemsMessage) => (room as Room<SharedItemsMessage>).send(message);

  const applyTaken = (id: SharedItemId, by: string, availableAt: number, effect: boolean) => {
    const item = byId.get(id);
    if (!item) return;
    unavailable.set(id, Math.max(unavailable.get(id) ?? 0, availableAt));
    pending.delete(id);
    if (!effect) return;
    options.onTake?.(item, by);
    const predicted = (predictedEffects.get(id) ?? 0) > now();
    predictedEffects.delete(id);
    if (!predicted) options.onEffect?.(item, by);
  };

  const takeAsHost = (id: SharedItemId, by: string) => {
    const item = byId.get(id);
    if (!item || (unavailable.get(id) ?? 0) > now() || options.canTake?.(item, by) === false)
      return;
    const availableAt = now() + (options.respawnMs ?? 0);
    applyTaken(id, by, availableAt, true);
    send({ [SHARED_ITEMS_KEY]: 1, channel, kind: "taken", id, by, availableAt });
  };

  const offMessage = room.onMessage((from, value) => {
    if (!isMessage(value)) return;
    if (value.kind === "take") {
      if (room.hosting) takeAsHost(value.id, from);
    } else if (value.kind === "taken") {
      if (from === room.hostId) applyTaken(value.id, value.by, value.availableAt, true);
    } else if (from === room.hostId) {
      for (const [id, availableAt] of value.unavailable)
        unavailable.set(id, Math.max(unavailable.get(id) ?? 0, availableAt));
    }
  });

  const broadcast = () => {
    if (!room.hosting || room.closed || room.peerCount === 0) return;
    const t = now();
    send({
      [SHARED_ITEMS_KEY]: 1,
      channel,
      kind: "state",
      unavailable: [...unavailable].filter(([, availableAt]) => availableAt > t),
    });
  };
  const offJoin = room.onJoin(broadcast);
  const offTick = everyMs(1000 / (options.hz ?? 4), broadcast);

  return {
    all: items,
    take(item) {
      const id = idOf(item);
      if (!byId.has(id) || (unavailable.get(id) ?? 0) > now()) return;
      const timeout = now() + (options.requestTimeoutMs ?? 750);
      pending.set(id, timeout);
      if (room.hosting) takeAsHost(id, room.id);
      else {
        predictedEffects.set(id, timeout);
        options.onEffect?.(byId.get(id)!, room.id);
        send({ [SHARED_ITEMS_KEY]: 1, channel, kind: "take", id });
      }
    },
    available(item) {
      const id = idOf(item);
      const t = now();
      return byId.has(id) && (unavailable.get(id) ?? 0) <= t && (pending.get(id) ?? 0) <= t;
    },
    stop() {
      offTick();
      offMessage();
      offJoin();
      pending.clear();
      predictedEffects.clear();
    },
    *[Symbol.iterator]() {
      const t = now();
      for (const item of items)
        if ((unavailable.get(item.id) ?? 0) <= t && (pending.get(item.id) ?? 0) <= t) yield item;
    },
  };
}
