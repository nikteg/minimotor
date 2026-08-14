// ---------- Matchmaking (named rooms) ----------
// One WebSocket server, many independent rooms. Each connection is unassigned
// until it sends a message a `route` maps to a room code (join-by-code); after
// that its broadcasts/relays are scoped to that room, and an empty room is
// dropped. Build lobbies, party codes, or per-match instances without a socket
// server per room.
const OPEN = 1;
const isOpen = (s) => s.readyState === undefined || s.readyState === OPEN;
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
export function matchmake(server, opts) {
    const rooms = new Map();
    const roomOf = new WeakMap();
    let nextId = 0;
    function makeRoom(code) {
        const clients = [];
        return {
            code,
            clients,
            send(client, msg) {
                if (isOpen(client.socket))
                    client.socket.send(JSON.stringify(msg));
            },
            broadcast(msg) {
                const data = JSON.stringify(msg);
                for (const c of clients)
                    if (isOpen(c.socket))
                        c.socket.send(data);
            },
            relay(from, msg) {
                const data = JSON.stringify(msg);
                for (const c of clients)
                    if (c !== from && isOpen(c.socket))
                        c.socket.send(data);
            },
        };
    }
    server.on("connection", (socket) => {
        // Matchmaking has its own room codes, so the URL's `?room=` group is unused.
        const client = { id: `c${nextId++}`, socket, group: "" };
        socket.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(String(raw));
            }
            catch {
                return;
            }
            const joined = roomOf.get(client);
            if (joined) {
                opts.onMessage?.(client, msg, joined);
                return;
            }
            const code = opts.route(msg, client);
            if (code == null)
                return; // unroutable — stay unassigned
            let room = rooms.get(code);
            if (!room) {
                room = makeRoom(code);
                rooms.set(code, room);
            }
            room.clients.push(client);
            roomOf.set(client, room);
            opts.onJoin?.(client, room);
        });
        socket.on("close", () => {
            const room = roomOf.get(client);
            if (!room)
                return;
            const clients = room.clients;
            const i = clients.indexOf(client);
            if (i >= 0)
                clients.splice(i, 1);
            roomOf.delete(client);
            opts.onLeave?.(client, room);
            if (clients.length === 0)
                rooms.delete(room.code);
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
