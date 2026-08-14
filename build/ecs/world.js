// Entity id packing: id = generation * CAP + index. Plain arithmetic (not
// bit-shifts) to sidestep 32-bit sign issues on large generations.
const INDEX_CAP = 1 << 20; // up to ~1M live entities
// Shared empty result for `dense()` when a component has no store yet — a
// frozen singleton so the no-rows path allocates nothing.
const EMPTY = Object.freeze([]);
const indexOf = (e) => e % INDEX_CAP;
const genOf = (e) => Math.floor(e / INDEX_CAP);
const makeId = (index, gen) => (gen * INDEX_CAP + index);
/** Register `fn` under `name`, replacing any existing entry with that name. */
function upsert(list, name, fn) {
    const existing = list.find((s) => s.name === name);
    if (existing)
        existing.fn = fn;
    else
        list.push({ name, fn });
}
/** Swap-remove an entity's slot from a store, keeping the dense arrays packed. */
function removeAt(st, index) {
    const slot = st.slotOf[index];
    if (slot === undefined)
        return;
    const last = st.dense.length - 1;
    if (slot !== last) {
        // Move the last element into the freed slot and fix its reverse map.
        const movedOwner = st.owners[last];
        st.dense[slot] = st.dense[last];
        st.owners[slot] = movedOwner;
        st.slotOf[movedOwner] = slot;
    }
    st.dense.pop();
    st.owners.pop();
    st.slotOf[index] = undefined;
}
/** Create a fresh ECS world — its own entities, component stores, and
 *  systems, sharing nothing with other worlds. The blessed idiom is `const ecs
 *  = createEcs()`; make one per scene or per game and drop it to tear down. */
export function createEcs() {
    const generations = [];
    const alive = [];
    const free = [];
    const stores = new Map();
    // Which component ids each entity index holds — so despawn touches only the
    // entity's own stores instead of scanning every registered component type.
    const owned = [];
    let iterating = 0;
    let liveCount = 0;
    const commands = [];
    // Reused per-call scratch (each row) — hot-path, no allocs.
    const eachRow = [];
    const updateSystems = [];
    const renderSystems = [];
    function flush() {
        // A command may itself queue more (rare); drain until settled.
        while (commands.length) {
            const batch = commands.splice(0, commands.length);
            for (const fn of batch)
                fn();
        }
    }
    function store(cid) {
        let st = stores.get(cid);
        if (!st) {
            st = { dense: [], owners: [], slotOf: [] };
            stores.set(cid, st);
        }
        return st;
    }
    function addAt(index, cid, data) {
        const st = store(cid);
        const slot = st.slotOf[index];
        if (slot !== undefined) {
            st.dense[slot] = data; // overwrite
            return;
        }
        st.slotOf[index] = st.dense.length;
        st.dense.push(data);
        st.owners.push(index);
        (owned[index] ?? (owned[index] = new Set())).add(cid);
    }
    function despawnAt(index) {
        const cids = owned[index];
        if (cids) {
            for (const cid of cids)
                removeAt(stores.get(cid), index);
            cids.clear();
        }
        generations[index]++;
        alive[index] = false;
        liveCount--;
        free.push(index);
    }
    const self = {
        spawn(...inits) {
            let index;
            if (free.length) {
                index = free.pop();
                alive[index] = true;
            }
            else {
                index = generations.length;
                generations.push(0);
                alive.push(true);
            }
            liveCount++;
            // Attaching is an append — safe even mid-query (queries snapshot length).
            for (const init of inits)
                addAt(index, init.component.id, init.data);
            return makeId(index, generations[index]);
        },
        get size() {
            return liveCount;
        },
        despawn(e) {
            if (!self.alive(e))
                return;
            const index = indexOf(e);
            // Run immediately when safe — the deferral closure is only allocated
            // mid-iteration.
            if (iterating === 0)
                despawnAt(index);
            else
                commands.push(() => despawnAt(index));
        },
        alive(e) {
            const index = indexOf(e);
            return alive[index] === true && generations[index] === genOf(e);
        },
        add(e, c, data) {
            if (!self.alive(e))
                return;
            addAt(indexOf(e), c.id, data);
        },
        get(e, c) {
            if (!self.alive(e))
                return undefined;
            const st = stores.get(c.id);
            const slot = st?.slotOf[indexOf(e)];
            return slot === undefined ? undefined : st.dense[slot];
        },
        has(e, c) {
            if (!self.alive(e))
                return false;
            return stores.get(c.id)?.slotOf[indexOf(e)] !== undefined;
        },
        remove(e, c) {
            if (!self.alive(e))
                return;
            const index = indexOf(e);
            const st = stores.get(c.id);
            if (!st)
                return;
            // Run immediately when safe — the deferral closure is only allocated
            // mid-iteration.
            if (iterating === 0) {
                removeAt(st, index);
                owned[index]?.delete(c.id);
            }
            else {
                commands.push(() => {
                    removeAt(st, index);
                    owned[index]?.delete(c.id);
                });
            }
        },
        count(c) {
            return stores.get(c.id)?.dense.length ?? 0;
        },
        clear() {
            stores.clear();
            generations.length = 0;
            alive.length = 0;
            free.length = 0;
            owned.length = 0;
            commands.length = 0;
            iterating = 0;
            liveCount = 0;
        },
        system(name, fn) {
            upsert(updateSystems, name, fn);
        },
        renderSystem(name, fn) {
            upsert(renderSystems, name, fn);
        },
        update() {
            for (const s of updateSystems)
                s.fn(self);
            flush();
        },
        draw(ctx) {
            for (const s of renderSystems)
                s.fn(self, ctx);
        },
        dense(c) {
            // The store's own packed data array, handed out as-is — the zero-copy
            // bridge to bulk consumers (e.g. the sprite renderer). The ECS stays
            // content-agnostic: it doesn't know or care what `c` is. Empty when
            // nothing holds `c`.
            const st = stores.get(c.id);
            return (st ? st.dense : EMPTY);
        },
        // Callback query: shares the matching logic shape with `query` but calls
        // straight through — no generator machinery, no per-entity tuple.
        each: ((...args) => {
            const fn = args.pop();
            const cs = args;
            if (cs.length === 0)
                return;
            let driver = null;
            for (const c of cs) {
                const st = stores.get(c.id);
                if (!st || st.dense.length === 0)
                    return;
                if (!driver || st.dense.length < driver.dense.length)
                    driver = st;
            }
            const cols = cs.map((c) => stores.get(c.id));
            iterating++;
            try {
                const len = driver.dense.length; // snapshot: new spawns aren't visited
                outer: for (let i = 0; i < len; i++) {
                    const index = driver.owners[i];
                    eachRow.length = 0;
                    eachRow.push(makeId(index, generations[index]));
                    for (const col of cols) {
                        if (col === driver) {
                            eachRow.push(col.dense[i]);
                            continue;
                        }
                        const slot = col.slotOf[index];
                        if (slot === undefined)
                            continue outer;
                        eachRow.push(col.dense[slot]);
                    }
                    // Call directly for the arities real queries use: `fn(...eachRow)`
                    // materializes an arguments array per entity, which on the engine's
                    // hottest loop is the whole cost of the row.
                    switch (eachRow.length) {
                        case 2:
                            fn(eachRow[0], eachRow[1]);
                            break;
                        case 3:
                            fn(eachRow[0], eachRow[1], eachRow[2]);
                            break;
                        case 4:
                            fn(eachRow[0], eachRow[1], eachRow[2], eachRow[3]);
                            break;
                        default:
                            fn(...eachRow);
                    }
                }
            }
            finally {
                if (--iterating === 0)
                    flush();
            }
        }),
        // Implementation is one loose signature; the typed overloads live on the
        // Ecs interface, so the cast just bridges impl → declared overloads.
        query: ((...cs) => {
            const gen = function* () {
                if (cs.length === 0)
                    return;
                // Drive iteration from the smallest matching store; bail if any is empty.
                let driver = null;
                for (const c of cs) {
                    const st = stores.get(c.id);
                    if (!st || st.dense.length === 0)
                        return;
                    if (!driver || st.dense.length < driver.dense.length)
                        driver = st;
                }
                const cols = cs.map((c) => stores.get(c.id));
                const slots = []; // per-row scratch, reused across rows
                iterating++;
                try {
                    const len = driver.dense.length; // snapshot: new spawns aren't visited
                    outer: for (let i = 0; i < len; i++) {
                        const index = driver.owners[i];
                        // Check every non-driver column's membership BEFORE allocating
                        // the row — rows that fail pay nothing.
                        slots.length = 0;
                        for (const col of cols) {
                            // The driver's data is already at hand — no membership re-check.
                            if (col === driver) {
                                slots.push(i);
                                continue;
                            }
                            const slot = col.slotOf[index];
                            if (slot === undefined)
                                continue outer;
                            slots.push(slot);
                        }
                        const row = [makeId(index, generations[index])];
                        for (let k = 0; k < cols.length; k++)
                            row.push(cols[k].dense[slots[k]]);
                        yield row;
                    }
                }
                finally {
                    if (--iterating === 0)
                        flush();
                }
            };
            return { [Symbol.iterator]: gen };
        }),
    };
    return self;
}
