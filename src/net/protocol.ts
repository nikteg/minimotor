/** One shared game contract, safe to import from browser and server code. */
export type Protocol<
  Shape extends {
    state?: unknown;
    events?: Record<string, unknown>;
    requests?: Record<string, unknown>;
    client?: unknown;
    server?: unknown;
  },
> = Shape;

export type ProtocolShape = Protocol<{
  state?: unknown;
  events?: Record<string, unknown>;
  requests?: Record<string, unknown>;
  client?: unknown;
  server?: unknown;
}>;

export type StateOf<P> = P extends { state: infer State } ? State : P;
export type EventsOf<P> = P extends { events: infer Events extends Record<string, unknown> }
  ? Events
  : P extends Record<string, unknown>
    ? P
    : never;
export type RequestsOf<P> = P extends {
  requests: infer Requests extends Record<string, unknown>;
}
  ? Requests
  : EventsOf<P>;
export type ClientMessageOf<P> = P extends { client: infer Message } ? Message : never;
export type ServerMessageOf<P> = P extends { server: infer Message } ? Message : never;
