// ---------- Signals ----------
// A tiny synchronous pub/sub bus for decoupling game modules: emit a named
// event with a payload; any number of listeners react. No engine/DOM
// dependency. Handler exceptions are isolated so one bad listener can't stop
// the rest (or crash the game loop).
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

  function on(event: string, handler: Handler): () => void {
    let set = map.get(event);
    if (!set) {
      set = new Set();
      map.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
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
      // Copy so handlers may unsubscribe (or emit) during dispatch.
      for (const h of Array.from(set)) {
        try {
          h(payload);
        } catch (err) {
          // A listener must never break the emitter or the game loop.
          console.error(`Minimotor.Signals: handler for "${event}" threw`, err);
        }
      }
    },

    off(event, handler) {
      if (!event) {
        map.clear();
        return;
      }
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

/** The default global bus (`Minimotor.Signals`). */
export const Signals = createSignals();
