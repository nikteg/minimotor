import type { Room } from "./room.js";
import type { EventsOf, RequestsOf } from "./protocol.js";

const EVENT_KEY = "__mm_event";

type Handler<T> = (data: T, from: string) => void;

interface EventEnvelope {
  [EVENT_KEY]: 1;
  type: string;
  data: unknown;
  request?: true;
}

export interface Events<P> {
  emit<K extends keyof EventsOf<P> & string>(type: K, data: EventsOf<P>[K]): void;
  /** Send a command to the host, including when this peer is the host. */
  request<K extends keyof RequestsOf<P> & string>(type: K, data: RequestsOf<P>[K]): void;
  on<K extends keyof EventsOf<P> & string>(type: K, handler: Handler<EventsOf<P>[K]>): () => void;
  /** Handle commands only while this peer is the room host. */
  onRequest<K extends keyof RequestsOf<P> & string>(
    type: K,
    handler: Handler<RequestsOf<P>[K]>,
  ): () => void;
  once<K extends keyof EventsOf<P> & string>(type: K, handler: Handler<EventsOf<P>[K]>): () => void;
  stop(): void;
}

/** A typed event channel over a Room for one-shot gameplay facts: shots,
 * damage, pickups, chat, emotes. Tagged envelopes coexist with state sync. */
export function events<P>(room: Room<unknown>): Events<P> {
  const handlers = new Map<string, Set<Handler<unknown>>>();
  const requestHandlers = new Map<string, Set<Handler<unknown>>>();
  const dispatch = (
    target: Map<string, Set<Handler<unknown>>>,
    type: string,
    data: unknown,
    from: string,
  ) => {
    for (const handler of target.get(type) ?? []) handler(data, from);
  };
  const off = room.onMessage((from, message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      (message as Record<string, unknown>)[EVENT_KEY] !== 1
    )
      return;
    const event = message as EventEnvelope;
    if (event.request) {
      if (room.hosting) dispatch(requestHandlers, event.type, event.data, from);
    } else dispatch(handlers, event.type, event.data, from);
  });
  const add = <T, K extends keyof T & string>(
    target: Map<string, Set<Handler<unknown>>>,
    type: K,
    handler: Handler<T[K]>,
  ): (() => void) => {
    let set = target.get(type);
    if (!set) target.set(type, (set = new Set()));
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  };
  const on = <K extends keyof EventsOf<P> & string>(
    type: K,
    handler: Handler<EventsOf<P>[K]>,
  ): (() => void) => add<EventsOf<P>, K>(handlers, type, handler);

  return {
    emit(type, data) {
      (room as Room<EventEnvelope>).send({ [EVENT_KEY]: 1, type, data });
    },
    request(type, data) {
      if (room.hosting) dispatch(requestHandlers, type, data, room.id);
      else (room as Room<EventEnvelope>).send({ [EVENT_KEY]: 1, type, data, request: true });
    },
    on,
    onRequest(type, handler) {
      return add<RequestsOf<P>, typeof type>(requestHandlers, type, handler);
    },
    once(type, handler) {
      let unsubscribe = () => {};
      unsubscribe = on(type, (data, from) => {
        unsubscribe();
        handler(data, from);
      });
      return unsubscribe;
    },
    stop() {
      off();
      handlers.clear();
      requestHandlers.clear();
    },
  };
}
