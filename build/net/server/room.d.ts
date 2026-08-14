import type { ClientMessageOf, MessageCodec, ProtocolShape, ServerMessageOf } from "../protocol.js";
/** The slice of a WebSocket connection a room uses. `ws`'s WebSocket satisfies
 *  it structurally, so callers pass their sockets with no cast or `ws` import. */
export interface ServerSocket {
    /** Send an already-serialized frame to this client: a string, or bytes when
     *  the room was given a `codec`. `ws`'s `send` takes both, and a method
     *  parameter is bivariant, so a text-only test double still satisfies this. */
    send(data: string | Uint8Array): void;
    /** 1 === OPEN in the `ws`/browser convention; `undefined` is treated as open
     *  (test doubles need not model it). */
    readyState?: number;
    /** Bytes handed to `send` that have not gone out yet. A client on a link too
     *  slow for what it is being sent accumulates these in the server's own
     *  memory, and every queued frame is stale before it arrives. Rooms do not
     *  act on this — dropping a message is only safe when the sender knows it
     *  carries full state rather than a delta — but a caller that publishes
     *  snapshots can read it and skip a client that is behind. `undefined` on a
     *  test double, which reads as nothing queued. */
    readonly bufferedAmount?: number;
    /** Subscribe to a socket event (`"message"`, `"close"`). */
    on(event: string, handler: (...args: unknown[]) => void): void;
}
/** The upgrade request behind a connection — `ws` passes it as the second
 *  argument to its `connection` event, and `url` carries the query string. */
export interface ConnectionRequest {
    url?: string;
}
/** The slice of a WebSocket *server* a room uses — `ws`'s WebSocketServer. */
export interface SocketServer {
    /** Subscribe to new client connections. */
    on(event: "connection", handler: (socket: ServerSocket, request?: ConnectionRequest) => void): void;
}
/** One connected client: a stable id plus its socket. */
export interface RoomClient {
    /** Stable id for this connection, unique within the room. */
    readonly id: string;
    /** The underlying connection. */
    readonly socket: ServerSocket;
    /** The `?room=` this client asked for, `""` when it named none. Clients in
     *  different groups never see each other — one endpoint hosts many rooms. */
    readonly group: string;
}
/** Lifecycle callbacks for `serve`: join, per-client message, and leave — plus
 *  the optional `codec` that decides what a frame IS. */
export interface RoomOptions<Recv, Send = unknown> {
    /** A client connected (after it's added to `room.clients`). */
    onJoin?(client: RoomClient): void;
    /** A message arrived from `client`, already decoded.
     *
     * WHICH frames reach here is the `codec`'s decision, and that is the one
     * behavioural thing this option changes rather than just re-spelling. With no
     * codec the room parses JSON and silently drops anything that is not valid
     * JSON — a heartbeat, a binary frame from another lane, a truncated write.
     * With a codec the room hands it every frame verbatim and drops exactly what
     * `decode` returns `undefined` for, so a codec that accepts too much delivers
     * junk as a message and one that accepts too little is invisible. */
    onMessage?(client: RoomClient, msg: Recv): void;
    /** A client disconnected (after it's removed from `room.clients`). */
    onLeave?(client: RoomClient): void;
    /** Encode outbound and decode inbound frames instead of using JSON.
     *
     * ABSENT IS THE DEFAULT AND THE DEFAULT IS JSON — a room given no codec
     * behaves exactly as it always has, down to calling `JSON.stringify` once per
     * `broadcast` and reusing the string across clients.
     *
     * It covers the whole room, not one lane: `send`, `broadcast`, `relay` and
     * the inbound parse all go through it, which is the point. The snapshot-only
     * packing in `body-codec.ts` is the other trade — pack the one message that
     * repeats and keep the rest readable — and both are legitimate. This is for
     * the caller who wants no text on the wire at all and is willing to give up
     * a readable network tab for it. */
    codec?: MessageCodec<Send, Recv>;
}
/** A server-side room: the live client list plus encode-and-send/broadcast/
 *  relay. Encoding is `JSON.stringify` unless `RoomOptions.codec` says
 *  otherwise. */
export interface Room<Send> {
    /** Currently-connected clients (live array; don't mutate). */
    readonly clients: RoomClient[];
    /** Encode and send to one client. */
    send(client: RoomClient, msg: Send): void;
    /** Encode and send to every connected client. */
    broadcast(msg: Send): void;
    /** Encode and send to every client except `from` — the classic relay. */
    relay(from: RoomClient, msg: Send): void;
    /** The clients sharing one `?room=` group. */
    group(name: string): RoomClient[];
}
/** Wire a WebSocket-like server into a room: it tracks connections with stable
 *  ids, parses inbound frames into `onMessage`, and gives you broadcast/relay/
 *  send (each encodes once and skips closing sockets). Encoding is JSON unless
 *  `opts.codec` says otherwise; see `RoomOptions.codec`. `ws`'s WebSocketServer
 *  fits `SocketServer` structurally.
 *
 *    import { WebSocketServer } from "ws";
 *    import { serve } from "minimotor/server";
 *    const wss = new WebSocketServer({ port: 8080 });
 *    const room = serve(wss, {
 *      onJoin:    (c) => room.send(c, { type: "welcome", id: c.id }),
 *      onMessage: (c, msg) => room.relay(c, msg),   // a relay server
 *    }); */
export declare function serve<Send = unknown, Recv = unknown>(server: SocketServer, opts?: RoomOptions<Recv, Send>): Room<Send>;
/** Serve the browser and server sides of one shared `Protocol`.
 *
 * JSON unless `opts.codec` says otherwise. The codec faces the way the SERVER
 * does — it encodes `ServerMessageOf<P>` and decodes `ClientMessageOf<P>` — and
 * `connectProtocol` takes its mirror image at the other end. */
export declare function serveProtocol<P extends ProtocolShape>(server: SocketServer, opts?: RoomOptions<ClientMessageOf<P>, ServerMessageOf<P>>): Room<ServerMessageOf<P>>;
