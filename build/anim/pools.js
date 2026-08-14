/** Own per-entity animation cursors without hand-maintaining Maps. */
export function keyed(factory) {
    const values = new Map();
    return {
        get(key, create = factory) {
            const existing = values.get(key);
            if (existing !== undefined || values.has(key))
                return existing;
            if (!create)
                throw new Error("Anim.keyed: no factory supplied");
            const value = create(key);
            values.set(key, value);
            return value;
        },
        has: (key) => values.has(key),
        delete: (key) => values.delete(key),
        retain(live) {
            const keep = new Set(live);
            for (const key of values.keys())
                if (!keep.has(key))
                    values.delete(key);
        },
        clear: () => values.clear(),
        get size() {
            return values.size;
        },
        [Symbol.iterator]: () => values[Symbol.iterator](),
    };
}
/** Own short-lived animation/effect objects without splice/cleanup loops. */
export function effects(create, done) {
    const active = [];
    const prune = () => {
        for (let i = active.length - 1; i >= 0; i--) {
            if (done(active[i]))
                active.splice(i, 1);
        }
    };
    return {
        play(input) {
            const effect = create(input);
            active.push(effect);
            return effect;
        },
        prune,
        clear() {
            active.length = 0;
        },
        get size() {
            prune();
            return active.length;
        },
        [Symbol.iterator]() {
            prune();
            return active[Symbol.iterator]();
        },
    };
}
