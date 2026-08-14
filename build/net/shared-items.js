import { everyMs } from "./rate.js";
const SHARED_ITEMS_KEY = "__mm_shared_items";
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
export function sharedItems(room, source, options = {}) {
    const channel = options.channel ?? "items";
    const now = options.now ?? (() => performance.now());
    const items = source.map((item, index) => ({
        ...item,
        id: options.id?.(item, index) ??
            ("id" in item && (typeof item.id === "string" || typeof item.id === "number")
                ? item.id
                : index),
    }));
    const byId = new Map(items.map((item) => [item.id, item]));
    const unavailable = new Map();
    const pending = new Map();
    const predictedEffects = new Map();
    const idOf = (item) => typeof item === "object" ? item.id : item;
    const isMessage = (value) => typeof value === "object" &&
        value !== null &&
        value[SHARED_ITEMS_KEY] === 1 &&
        value.channel === channel;
    const send = (message) => room.send(message);
    const applyTaken = (id, by, availableAt, effect) => {
        const item = byId.get(id);
        if (!item)
            return;
        unavailable.set(id, Math.max(unavailable.get(id) ?? 0, availableAt));
        pending.delete(id);
        if (!effect)
            return;
        options.onTake?.(item, by);
        const predicted = (predictedEffects.get(id) ?? 0) > now();
        predictedEffects.delete(id);
        if (!predicted)
            options.onEffect?.(item, by);
    };
    const takeAsHost = (id, by) => {
        const item = byId.get(id);
        if (!item || (unavailable.get(id) ?? 0) > now() || options.canTake?.(item, by) === false)
            return;
        const availableAt = now() + (options.respawnMs ?? 0);
        applyTaken(id, by, availableAt, true);
        send({ [SHARED_ITEMS_KEY]: 1, channel, kind: "taken", id, by, availableAt });
    };
    const offMessage = room.onMessage((from, value) => {
        if (!isMessage(value))
            return;
        if (value.kind === "take") {
            if (room.hosting)
                takeAsHost(value.id, from);
        }
        else if (value.kind === "taken") {
            if (from === room.hostId)
                applyTaken(value.id, value.by, value.availableAt, true);
        }
        else if (from === room.hostId) {
            for (const [id, availableAt] of value.unavailable)
                unavailable.set(id, Math.max(unavailable.get(id) ?? 0, availableAt));
        }
    });
    const broadcast = () => {
        if (!room.hosting || room.closed || room.peerCount === 0)
            return;
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
            if (!byId.has(id) || (unavailable.get(id) ?? 0) > now())
                return;
            const timeout = now() + (options.requestTimeoutMs ?? 750);
            pending.set(id, timeout);
            if (room.hosting)
                takeAsHost(id, room.id);
            else {
                predictedEffects.set(id, timeout);
                options.onEffect?.(byId.get(id), room.id);
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
                if ((unavailable.get(item.id) ?? 0) <= t && (pending.get(item.id) ?? 0) <= t)
                    yield item;
        },
    };
}
