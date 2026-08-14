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

/** How one end of a protocol puts its frames on the wire.
 *
 * `serveProtocol` and `connectProtocol` are JSON by default and stay that way:
 * pass a codec to either and it takes over both directions for that end, so
 * nothing in the room or the transport still assumes text. The two ends are
 * separate objects because they face opposite ways — the server encodes
 * `ServerMessageOf<P>` and decodes `ClientMessageOf<P>`, the client the other
 * way round — and one implementation can back both.
 *
 * DIRECTIONAL rather than a four-method `ProtocolCodec` on purpose: `serve`
 * itself is only `serve<Send, Recv>`, and half a dozen things that are not a
 * `Protocol` at all (a relay, a lobby socket, `party-server`-shaped middleware)
 * want a codec without owning both halves of a contract.
 *
 * This is deliberately NOT `SyncCodec` (`body-codec.ts`). That one packs ONE
 * known state shape on the snapshot lane and is stateless because that lane is
 * unreliable. This one is the whole message union of a protocol on the ordered,
 * reliable WebSocket — but the stateless rule carries anyway and for a second
 * reason: a codec that built up a shared string dictionary would have to be
 * rebuilt from scratch on every reconnect, and a reconnect is the one moment
 * nobody tests.
 *
 * `encode` may return either a string or bytes; a room sends whatever it gets,
 * and the client transport sends a string as its UTF-8 bytes.
 *
 * `decode` returns `undefined` for a frame this end cannot read, and that
 * return is load-bearing rather than defensive: a heartbeat (`WsConfig`'s
 * default is a 0-byte binary frame), a frame from a peer on an older build, and
 * a frame belonging to the OTHER direction all arrive here, and all three must
 * be dropped rather than handed on as a message. It is the binary counterpart
 * of the `try/catch` around `JSON.parse` — with the difference that a codec can
 * check what it decoded, where `JSON.parse` casts blind. */
export interface MessageCodec<Out = unknown, In = unknown> {
  /** Put one outbound message on the wire. */
  encode(message: Out): string | Uint8Array;
  /** Read one inbound frame, or `undefined` to ignore it. */
  decode(frame: string | Uint8Array): In | undefined;
}
