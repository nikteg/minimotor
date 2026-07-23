// ---------- Matchmaking (named rooms) ----------
// One WebSocket server, many independent rooms. Each connection is unassigned
// until it sends a message a `route` maps to a room code (join-by-code); after
// that its broadcasts/relays are scoped to that room, and an empty room is
// dropped. Build lobbies, party codes, or per-match instances without a socket
// server per room.

import type { RoomClient, ServerSocket, SocketServer } from "./room.js";

const OPEN = 1;
const isOpen = (s: ServerSocket): boolean => s.readyState === undefined || s.readyState === OPEN;

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
export function matchmake<Send = unknown, Recv = unknown>(
  server: SocketServer,
  opts: MatchOptions<Send, Recv>,
): Matchmaker<Send> {
  const rooms = new Map<string, MatchRoom<Send>>();
  const roomOf = new WeakMap<RoomClient, MatchRoom<Send>>();
  let nextId = 0;

  function makeRoom(code: string): MatchRoom<Send> {
    const clients: RoomClient[] = [];
    return {
      code,
      clients,
      send(client, msg) {
        if (isOpen(client.socket)) client.socket.send(JSON.stringify(msg));
      },
      broadcast(msg) {
        const data = JSON.stringify(msg);
        for (const c of clients) if (isOpen(c.socket)) c.socket.send(data);
      },
      relay(from, msg) {
        const data = JSON.stringify(msg);
        for (const c of clients) if (c !== from && isOpen(c.socket)) c.socket.send(data);
      },
    };
  }

  server.on("connection", (socket) => {
    const client: RoomClient = { id: `c${nextId++}`, socket };
    socket.on("message", (raw: unknown) => {
      let msg: Recv;
      try {
        msg = JSON.parse(String(raw)) as Recv;
      } catch {
        return;
      }
      const joined = roomOf.get(client);
      if (joined) {
        opts.onMessage?.(client, msg, joined);
        return;
      }
      const code = opts.route(msg, client);
      if (code == null) return; // unroutable — stay unassigned
      let room = rooms.get(code);
      if (!room) {
        room = makeRoom(code);
        rooms.set(code, room);
      }
      (room.clients as RoomClient[]).push(client);
      roomOf.set(client, room);
      opts.onJoin?.(client, room);
    });
    socket.on("close", () => {
      const room = roomOf.get(client);
      if (!room) return;
      const clients = room.clients as RoomClient[];
      const i = clients.indexOf(client);
      if (i >= 0) clients.splice(i, 1);
      roomOf.delete(client);
      opts.onLeave?.(client, room);
      if (clients.length === 0) rooms.delete(room.code);
    });
  });

  return {
    get rooms() {
      return [...rooms.values()];
    },
    room(code) {
      return rooms.get(code);
    },
  };
}
