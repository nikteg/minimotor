import { everyMs } from "./rate.js";
import { createRoster } from "./roster.js";
const ENTITIES_KEY = "__mm_entities";
const composite = (owner, id) => `${owner}\0${id}`;
/** Synchronize a dynamic collection. Each peer owns its advertised entities;
 * missing ids despawn automatically and states interpolate independently. */
export function syncEntities(room, options) {
    const intervalMs = 1000 / (options.hz ?? 30);
    const roster = createRoster({
        delayMs: options.delayMs ?? "auto",
        expectedIntervalMs: intervalMs,
        timeoutMs: options.timeoutMs,
        lerp: options.lerp,
        extrapolate: options.extrapolate,
        maxExtrapolationMs: options.maxExtrapolationMs,
        now: options.now,
    });
    const ownerIds = new Map();
    const parseKey = (key) => {
        const split = key.indexOf("\0");
        return { owner: key.slice(0, split), id: key.slice(split + 1) };
    };
    const isMessage = (value) => typeof value === "object" &&
        value !== null &&
        value[ENTITIES_KEY] === 1;
    const clock = options.now ?? (() => performance.now());
    const codec = options.codec;
    /** One peer's advertised set: update what it still owns, despawn the rest. */
    const applyBatch = (owner, entities, sentAt) => {
        const next = new Set();
        const at = clock();
        for (const entity of entities) {
            next.add(entity.id);
            roster.update(composite(owner, entity.id), entity.state, at, sentAt);
        }
        for (const old of ownerIds.get(owner) ?? []) {
            if (!next.has(old))
                roster.remove(composite(owner, old));
        }
        ownerIds.set(owner, next);
    };
    const offMessage = codec
        ? room.onBytes(codec.tag, (owner, bytes) => {
            const packet = codec.decode(bytes);
            if (packet)
                applyBatch(owner, packet.state, packet.sentAt);
        })
        : room.onMessage((owner, message) => {
            if (isMessage(message))
                applyBatch(owner, message.entities, message.t);
        });
    const offLeave = room.onLeave((owner) => {
        for (const id of ownerIds.get(owner) ?? [])
            roster.remove(composite(owner, id));
        ownerIds.delete(owner);
    });
    const broadcast = () => {
        if (room.closed)
            return stop();
        if (room.peerCount === 0)
            return;
        const entities = [...options.entities()].map((entity) => ({
            id: options.id(entity),
            state: options.state(entity),
        }));
        const sentAt = clock();
        if (codec)
            room.sendBytes(codec.tag, codec.encode(entities, sentAt), { reliable: false });
        else {
            room.send({ [ENTITIES_KEY]: 1, entities, t: sentAt }, { reliable: false });
        }
    };
    const offTick = everyMs(intervalMs, broadcast);
    let stopped = false;
    function stop() {
        if (stopped)
            return;
        stopped = true;
        offTick();
        offMessage();
        offLeave();
        roster.clear();
        ownerIds.clear();
    }
    return {
        get size() {
            return roster.size;
        },
        get ids() {
            return roster.ids.map(parseKey);
        },
        stop,
        *[Symbol.iterator]() {
            roster.prune();
            for (const [key, state] of roster.sample())
                yield { ...state, ...parseKey(key) };
        },
    };
}
/** Bind synchronized states to live render objects or kinematic physics
 * proxies. Call `update` from the game loop, or use app-bound `Net.bindEntities`
 * to have it scheduled automatically. */
export function bindEntities(states, options) {
    const bound = new Map();
    const update = () => {
        const live = new Set();
        for (const state of states) {
            const key = composite(state.owner, state.id);
            live.add(key);
            let target = bound.get(key);
            if (!target) {
                target = options.create(state);
                bound.set(key, target);
            }
            options.apply(target, state);
        }
        for (const [key, target] of bound) {
            if (live.has(key))
                continue;
            options.destroy?.(target);
            bound.delete(key);
        }
    };
    return {
        entities: bound,
        update,
        stop() {
            for (const target of bound.values())
                options.destroy?.(target);
            bound.clear();
        },
    };
}
