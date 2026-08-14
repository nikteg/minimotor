export function createSnapshots() {
    const bindings = new Map();
    return {
        register(name, binding) {
            if (bindings.has(name))
                throw new Error(`Minimotor: duplicate snapshot binding "${name}"`);
            bindings.set(name, binding);
            return () => bindings.delete(name);
        },
        capture() {
            const snapshot = {};
            for (const [name, binding] of bindings)
                snapshot[name] = structuredClone(binding.save());
            return snapshot;
        },
        restore(snapshot) {
            for (const [name, value] of Object.entries(snapshot))
                bindings.get(name)?.load(structuredClone(value));
        },
    };
}
