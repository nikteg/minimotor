import type { Room } from "./room.js";
import type { EventsOf, RequestsOf } from "./protocol.js";
type Handler<T> = (data: T, from: string) => void;
export interface Events<P> {
    emit<K extends keyof EventsOf<P> & string>(type: K, data: EventsOf<P>[K]): void;
    /** Send a command to the host, including when this peer is the host. */
    request<K extends keyof RequestsOf<P> & string>(type: K, data: RequestsOf<P>[K]): void;
    on<K extends keyof EventsOf<P> & string>(type: K, handler: Handler<EventsOf<P>[K]>): () => void;
    /** Handle commands only while this peer is the room host. */
    onRequest<K extends keyof RequestsOf<P> & string>(type: K, handler: Handler<RequestsOf<P>[K]>): () => void;
    once<K extends keyof EventsOf<P> & string>(type: K, handler: Handler<EventsOf<P>[K]>): () => void;
    stop(): void;
}
/** A typed event channel over a Room for one-shot gameplay facts: shots,
 * damage, pickups, chat, emotes. Tagged envelopes coexist with state sync. */
export declare function events<P>(room: Room<unknown>): Events<P>;
export {};
