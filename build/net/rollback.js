export function createRollback() {
    const history = new Map();
    return {
        save(step, state) {
            history.set(step, structuredClone(state));
        },
        load(step) {
            const state = history.get(step);
            return state === undefined ? undefined : structuredClone(state);
        },
        discardBefore(step) {
            for (const at of history.keys())
                if (at < step)
                    history.delete(at);
        },
        clear() {
            history.clear();
        },
    };
}
