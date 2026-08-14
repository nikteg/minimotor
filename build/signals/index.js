// ---------- Signal bus ----------
// A tiny synchronous pub/sub bus for decoupling app modules: emit a named
// event with a payload; any number of listeners react. No engine/DOM
// dependency. Handler exceptions are isolated so one bad listener can't stop
// the rest (or crash the loop). This is a small typed bus, not a required
// engine pillar; scenes and ECS cover most fan-out.
//
//   const Signals = createSignals();
//   Signals.on("score", n => hud.score += n);
//   Signals.emit("score", 10);
export function createSignals() {
    const map = new Map();
    // Cached emit-order snapshot per event, dropped on any listener change —
    // emit iterates it instead of copying the Set every dispatch.
    const snapshots = new Map();
    function on(event, handler) {
        let set = map.get(event);
        if (!set) {
            set = new Set();
            map.set(event, set);
        }
        set.add(handler);
        snapshots.delete(event);
        return () => {
            set.delete(handler);
            snapshots.delete(event);
            if (set.size === 0)
                map.delete(event);
        };
    }
    const bus = {
        on: on,
        once(event, handler) {
            const off = on(event, (payload) => {
                off();
                handler(payload);
            });
            return off;
        },
        emit(event, payload) {
            const set = map.get(event);
            if (!set)
                return;
            // Dispatch over a snapshot so handlers may unsubscribe (or emit) during
            // dispatch — rebuilt only when the listener list changed.
            let snap = snapshots.get(event);
            if (!snap) {
                snap = Array.from(set);
                snapshots.set(event, snap);
            }
            for (const h of snap) {
                try {
                    h(payload);
                }
                catch (err) {
                    // A listener must never break the emitter or the loop.
                    console.error(`createSignals: handler for "${event}" threw`, err);
                }
            }
        },
        off(event, handler) {
            if (!event) {
                map.clear();
                snapshots.clear();
                return;
            }
            snapshots.delete(event);
            if (!handler) {
                map.delete(event);
                return;
            }
            const set = map.get(event);
            set?.delete(handler);
            if (set && set.size === 0)
                map.delete(event);
        },
        count(event) {
            return map.get(event)?.size ?? 0;
        },
    };
    return bus;
}
