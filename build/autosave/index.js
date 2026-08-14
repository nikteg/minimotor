/** Periodically persist explicit snapshots through an explicit storage service. */
export function createAutosave(app, snapshots, storage, { key = "autosave", everySteps = 300, store } = {}) {
    const selected = store ? storage.store(store) : storage;
    const save = () => selected.save(key, snapshots.capture());
    const api = {
        save,
        async load() {
            const snapshot = await selected.load(key, null);
            if (!snapshot)
                return false;
            snapshots.restore(snapshot);
            return true;
        },
        clear: () => selected.remove(key),
    };
    const every = Math.max(1, everySteps);
    const unsubscribe = app.Loop.onStep(() => {
        if (app.Loop.steps % every === 0)
            void save();
    });
    app.onDestroy(unsubscribe);
    return api;
}
