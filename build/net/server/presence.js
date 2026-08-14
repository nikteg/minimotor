// ---------- Server-side presence ----------
// An authoritative server keeps the latest state of each connected player and
// forgets anyone who's gone quiet (a dropped socket the OS hasn't reported yet,
// or a client that stopped sending). This is that registry: `set` on each
// inbound snapshot, `get` for lookups, and `prune` once per tick to expire the
// silent — the server-side mirror of the client's `Net.createRoster`, replacing
// the hand-rolled `Map<id, { …, seenAt }>` + manual timeout sweep.
/** A player-state registry that expires quiet entries. `set(id, state)` on each
 *  snapshot, `prune()` each tick to drop the silent (broadcast the returned
 *  ids as leaves), `get`/`entries` to read.
 *
 *    const players = createPresence<{ x: number; y: number }>({ timeoutMs: 6000 });
 *    // on message: players.set(msg.id, { x: msg.x, y: msg.y });
 *    // each tick:  for (const id of players.prune()) room.broadcast({ type: "leave", id });
 *    //             for (const [id, p] of players.entries()) simulateAgainst(p); */
export function createPresence(options = {}) {
    const timeoutMs = options.timeoutMs ?? 6000;
    const now = options.now ?? Date.now;
    const states = new Map();
    const seenAt = new Map();
    return {
        set(id, state) {
            states.set(id, state);
            seenAt.set(id, now());
        },
        touch(id) {
            if (states.has(id))
                seenAt.set(id, now());
        },
        get(id) {
            return states.get(id);
        },
        has(id) {
            return states.has(id);
        },
        delete(id) {
            seenAt.delete(id);
            return states.delete(id);
        },
        prune() {
            const cutoff = now() - timeoutMs;
            const dropped = [];
            for (const [id, at] of seenAt) {
                if (at < cutoff) {
                    states.delete(id);
                    seenAt.delete(id);
                    dropped.push(id);
                }
            }
            return dropped;
        },
        entries() {
            return [...states.entries()];
        },
        get ids() {
            return [...states.keys()];
        },
        get size() {
            return states.size;
        },
        clear() {
            states.clear();
            seenAt.clear();
        },
    };
}
