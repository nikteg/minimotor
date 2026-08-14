import { createInterpolator } from "./interpolation.js";
/** Track a set of remote peers, each with its own snapshot interpolator. */
export function createRoster(options = {}) {
    const timeout = options.timeoutMs ?? 5000;
    const clock = options.now ?? (() => performance.now());
    const peers = new Map();
    return {
        update(id, state, atMs = clock(), sentAt) {
            let peer = peers.get(id);
            const isNew = !peer;
            if (!peer) {
                peer = {
                    interp: createInterpolator({
                        delayMs: options.delayMs,
                        expectedIntervalMs: options.expectedIntervalMs,
                        lerp: options.lerp,
                        extrapolate: options.extrapolate,
                        maxExtrapolationMs: options.maxExtrapolationMs,
                        now: options.now,
                    }),
                    latest: state,
                    lastSeen: atMs,
                };
                peers.set(id, peer);
            }
            peer.latest = state;
            peer.lastSeen = atMs;
            peer.interp.push(state, atMs, sentAt);
            return { isNew };
        },
        remove(id) {
            return peers.delete(id);
        },
        prune(atMs = clock()) {
            const dropped = [];
            for (const [id, peer] of peers) {
                if (atMs - peer.lastSeen > timeout) {
                    peers.delete(id);
                    dropped.push(id);
                }
            }
            return dropped;
        },
        sample(atMs = clock()) {
            const out = [];
            for (const [id, peer] of peers) {
                const s = peer.interp.sample(atMs);
                if (s !== null)
                    out.push([id, s]);
            }
            return out;
        },
        sampleOne(id, atMs = clock()) {
            const peer = peers.get(id);
            return peer ? peer.interp.sample(atMs) : null;
        },
        latest(id) {
            return peers.get(id)?.latest ?? null;
        },
        reset(id) {
            peers.get(id)?.interp.clear();
        },
        get ids() {
            return [...peers.keys()];
        },
        get size() {
            return peers.size;
        },
        clear() {
            peers.clear();
        },
    };
}
