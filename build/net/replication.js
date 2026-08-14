export function createReplication() {
    const objects = new Map();
    return {
        sync(id, value, schema) {
            objects.set(id, { id, value, schema });
            return () => objects.delete(id);
        },
        get(id) {
            return objects.get(id);
        },
        get objects() {
            return [...objects.values()];
        },
    };
}
