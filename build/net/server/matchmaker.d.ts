import type { RoomClient, SocketServer } from "./room.js";
/** One named room's fan-out. `clients` is the live membership (don't mutate). */
export interface MatchRoom<Send> {
    /** The join code that names this room. */
    readonly code: string;
    /** Live membership of this room (don't mutate). */
    readonly clients: RoomClient[];
    /** JSON-encode and send to one client in this room. */
    send(client: RoomClient, msg: Send): void;
    /** JSON-encode and send to every client in this room. */
    broadcast(msg: Send): void;
    /** Send to every client in the room except `from`. */
    relay(from: RoomClient, msg: Send): void;
}
/** Configuration for `matchmake`: the `route` that assigns a client to a room
 *  code, plus per-room join/message/leave callbacks. */
export interface MatchOptions<Send, Recv> {
    /** Map a message from a not-yet-joined client to a room code — usually the
     *  first `{ join: code }` message. Return `null` to leave the client
     *  unassigned (its messages are dropped until it sends a routable one). */
    route(msg: Recv, client: RoomClient): string | null;
    /** A client joined `room` (after it's added to `room.clients`). The join
     *  message that routed it is consumed by `route`, not delivered here. */
    onJoin?(client: RoomClient, room: MatchRoom<Send>): void;
    /** A post-join message from `client`, tagged with its room. */
    onMessage?(client: RoomClient, msg: Recv, room: MatchRoom<Send>): void;
    /** A client left `room` (after removal; the room may now be empty/dropped). */
    onLeave?(client: RoomClient, room: MatchRoom<Send>): void;
}
/** A running matchmaker: read-only access to the currently open `MatchRoom`s. */
export interface Matchmaker<Send> {
    /** The currently non-empty rooms. */
    readonly rooms: MatchRoom<Send>[];
    /** The room for `code`, or `undefined` if none is open. */
    room(code: string): MatchRoom<Send> | undefined;
}
/** Partition a WebSocket-like server into named rooms. A connection is routed
 *  to a room by its first message's code (`route`); thereafter its messages hit
 *  `onMessage` with that room, and `room.broadcast`/`relay` stay scoped to it.
 *  Rooms are created on demand and dropped when empty. `ws`'s WebSocketServer
 *  fits `SocketServer` structurally.
 *
 *    matchmake(wss, {
 *      route: (msg) => (msg.type === "join" ? String(msg.code) : null),
 *      onJoin:    (c, room) => room.send(c, { type: "joined", code: room.code }),
 *      onMessage: (c, msg, room) => room.relay(c, msg),
 *    }); */
export declare function matchmake<Send = unknown, Recv = unknown>(server: SocketServer, opts: MatchOptions<Send, Recv>): Matchmaker<Send>;
