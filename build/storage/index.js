// ---------- Storage ----------
// Crash-safe persistence, async-first so browser, IndexedDB, cloud, and server
// backends share one honest contract. Keys are namespaced per game
// (`minimotor:<canvas-id>:<store>:`), and every operation swallows its errors —
// private browsing, quota, or corrupt data fall back to the supplied default
// rather than throwing. `createBrowserStorage(app)` is the localStorage case;
// `createStorage(app, { stores, default })` names several.
const unavailable = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
};
function browserBackend() {
    try {
        return globalThis.localStorage ?? unavailable;
    }
    catch {
        return unavailable;
    }
}
/** Wrap a browser `Storage` object or another raw string backend. */
export function browserStorage(backend = browserBackend()) {
    return backend;
}
export function createStorage(app, options) {
    const prefix = options.prefix ?? `minimotor:${app.canvas.id || "game"}:`;
    const names = Object.keys(options.stores);
    const areas = new Map();
    const area = (name) => {
        const existing = areas.get(name);
        if (existing)
            return existing;
        const backend = options.stores[name];
        if (!backend)
            throw new Error(`createStorage: no store named "${name}"`);
        const key = (value) => `${prefix}${name}:${value}`;
        const result = {
            async load(item, fallback) {
                try {
                    const raw = await backend.getItem(key(item));
                    return raw === null ? fallback : JSON.parse(raw);
                }
                catch {
                    return fallback;
                }
            },
            async save(item, data) {
                try {
                    await backend.setItem(key(item), JSON.stringify(data));
                }
                catch {
                    // Storage is intentionally crash-safe.
                }
            },
            async remove(item) {
                try {
                    await backend.removeItem(key(item));
                }
                catch {
                    // Storage is intentionally crash-safe.
                }
            },
        };
        areas.set(name, result);
        return result;
    };
    const defaultArea = area(options.default);
    return {
        names,
        store: area,
        load: defaultArea.load,
        save: defaultArea.save,
        remove: defaultArea.remove,
    };
}
export function createBrowserStorage(app, backend = browserStorage()) {
    return createStorage(app, { stores: { browser: backend }, default: "browser" });
}
export * from "./local.js";
