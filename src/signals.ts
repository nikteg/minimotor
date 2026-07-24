// ---------- Signals ----------
// A tiny synchronous pub/sub bus for decoupling app modules: emit a named
// event with a payload; any number of listeners react. No engine/DOM
// dependency. Handler exceptions are isolated so one bad listener can't stop
// the rest (or crash the loop).
//
//   Minimotor.Signals.on("score", n => hud.score += n);
//   Minimotor.Signals.emit("score", 10);

type Handler = (payload: unknown) => void;

/** A named synchronous event bus. `on`/`once`/`emit` take a payload type
 *  parameter — inferred from the handler, or pinned explicitly
 *  (`Signals.on<number>("score", n => …)`) for cross-module type safety. */
export interface SignalBus {
  /** Subscribe to `event`. Returns an unsubscribe function. */
  on<T = unknown>(event: string, handler: (payload: T) => void): () => void;
  /** Subscribe for a single emission, then auto-unsubscribe. */
  once<T = unknown>(event: string, handler: (payload: T) => void): () => void;
  /** Emit `event` to all current listeners, synchronously. */
  emit<T = unknown>(event: string, payload?: T): void;
  /** Remove a handler, or all handlers for `event`, or everything. */
  off(event?: string, handler?: (payload: never) => void): void;
  /** Live listener count for `event`. */
  count(event: string): number;
}

export function createSignals(): SignalBus {
  const map = new Map<string, Set<Handler>>();
  // Cached emit-order snapshot per event, dropped on any listener change —
  // emit iterates it instead of copying the Set every dispatch.
  const snapshots = new Map<string, Handler[]>();

  function on(event: string, handler: Handler): () => void {
    let set = map.get(event);
    if (!set) {
      set = new Set();
      map.set(event, set);
    }
    set.add(handler);
    snapshots.delete(event);
    return () => {
      set!.delete(handler);
      snapshots.delete(event);
      if (set!.size === 0) map.delete(event);
    };
  }

  const bus: SignalBus = {
    on: on as SignalBus["on"],

    once(event, handler) {
      const off = on(event, (payload: unknown) => {
        off();
        (handler as Handler)(payload);
      });
      return off;
    },

    emit(event, payload) {
      const set = map.get(event);
      if (!set) return;
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
        } catch (err) {
          // A listener must never break the emitter or the loop.
          console.error(`Minimotor.Signals: handler for "${event}" threw`, err);
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
      set?.delete(handler as Handler);
      if (set && set.size === 0) map.delete(event);
    },

    count(event) {
      return map.get(event)?.size ?? 0;
    },
  };
  return bus;
}

/** The default global bus (`Minimotor.Signals`) — fire-and-forget events that
 *  decouple systems (gameplay emits, HUD/audio listen). `on` returns its own
 *  unsubscribe function.
 *
 *    const off = Signals.on("score", (n) => (hud.score += n));
 *    Signals.emit("score", 10);
 */
export const Signals = createSignals();
