export function createInspector() {
    const entries = new Map();
    return {
        watch(name, read) {
            entries.set(name, { name, read });
            return () => entries.delete(name);
        },
        snapshot() {
            return Object.fromEntries([...entries].map(([name, entry]) => [name, entry.read()]));
        },
        get entries() {
            return [...entries.values()];
        },
    };
}
