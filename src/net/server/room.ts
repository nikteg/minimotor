// ---------- Server rooms ----------
// Node-side helpers for the authoritative/relay half of a multiplayer game.
// A "room" wraps a WebSocket-like server — the `ws` package's WebSocketServer
// fits structurally, so nothing here imports `ws` or Node — and hands you
// connection lifecycle plus JSON broadcast/relay/send. An echo, a relay, or an
// authoritative world server becomes a few lines instead of hand-rolled socket
// bookkeeping. Reach these from the `minimotor/server` entry point (they are
// deliberately NOT part of the browser `Minimotor` bundle).

/** The slice of a WebSocket connection a room uses. `ws`'s WebSocket satisfies
 *  it structurally, so callers pass their sockets with no cast or `ws` import. */
export interface ServerSocket {
  /** Send a (already-serialized) string frame to this client. */
  send(data: string): void;
  /** 1 === OPEN in the `ws`/browser convention; `undefined` is treated as open
   *  (test doubles need not model it). */
  readyState?: number;
  /** Subscribe to a socket event (`"message"`, `"close"`). */
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/** The slice of a WebSocket *server* a room uses — `ws`'s WebSocketServer. */
export interface SocketServer {
  /** Subscribe to new client connections. */
  on(event: "connection", handler: (socket: ServerSocket) => void): void;
}

/** One connected client: a stable id plus its socket. */
export interface RoomClient {
  /** Stable id for this connection, unique within the room. */
  readonly id: string;
  /** The underlying connection. */
  readonly socket: ServerSocket;
}

/** Lifecycle callbacks for `serve`: join, per-client message, and leave. */
export interface RoomOptions<Recv> {
  /** A client connected (after it's added to `room.clients`). */
  onJoin?(client: RoomClient): void;
  /** A JSON message arrived from `client`. Non-JSON frames are ignored. */
  onMessage?(client: RoomClient, msg: Recv): void;
  /** A client disconnected (after it's removed from `room.clients`). */
  onLeave?(client: RoomClient): void;
}

/** A server-side room: the live client list plus JSON send/broadcast/relay. */
export interface Room<Send> {
  /** Currently-connected clients (live array; don't mutate). */
  readonly clients: RoomClient[];
  /** JSON-encode and send to one client. */
  send(client: RoomClient, msg: Send): void;
  /** JSON-encode and send to every connected client. */
  broadcast(msg: Send): void;
  /** JSON-encode and send to every client except `from` — the classic relay. */
  relay(from: RoomClient, msg: Send): void;
}

const OPEN = 1;
function isOpen(s: ServerSocket): boolean {
  return s.readyState === undefined || s.readyState === OPEN;
}

/** Wire a WebSocket-like server into a room: it tracks connections with stable
 *  ids, parses inbound JSON into `onMessage`, and gives you broadcast/relay/
 *  send (each JSON-encodes and skips closing sockets). `ws`'s WebSocketServer
 *  fits `SocketServer` structurally.
 *
 *    import { WebSocketServer } from "ws";
 *    import { serve } from "minimotor/server";
 *    const wss = new WebSocketServer({ port: 8080 });
 *    const room = serve(wss, {
 *      onJoin:    (c) => room.send(c, { type: "welcome", id: c.id }),
 *      onMessage: (c, msg) => room.relay(c, msg),   // a relay server
 *    }); */
export function serve<Send = unknown, Recv = unknown>(
  server: SocketServer,
  opts: RoomOptions<Recv> = {},
): Room<Send> {
  const clients: RoomClient[] = [];
  let nextId = 0;

  const room: Room<Send> = {
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

  server.on("connection", (socket) => {
    const client: RoomClient = { id: `c${nextId++}`, socket };
    clients.push(client);
    opts.onJoin?.(client);
    socket.on("message", (raw: unknown) => {
      let msg: Recv;
      try {
        msg = JSON.parse(String(raw)) as Recv;
      } catch {
        return; // non-JSON frame — ignore
      }
      opts.onMessage?.(client, msg);
    });
    socket.on("close", () => {
      const i = clients.indexOf(client);
      if (i >= 0) clients.splice(i, 1);
      opts.onLeave?.(client);
    });
  });

  return room;
}
