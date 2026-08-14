export function createPresence() {
    const players = new Map();
    return {
        get players() {
            return [...players.values()];
        },
        set(id, metadata) {
            players.set(id, { id, joined: true, metadata });
        },
        remove(id) {
            players.delete(id);
        },
        get(id) {
            return players.get(id);
        },
        clear() {
            players.clear();
        },
    };
}
