// ---------- Server rooms ----------
// Node-side helpers for the authoritative/relay half of a multiplayer game.
// A "room" wraps a WebSocket-like server — the `ws` package's WebSocketServer
// fits structurally, so nothing here imports `ws` or Node — and hands you
// connection lifecycle plus JSON broadcast/relay/send. An echo, a relay, or an
// authoritative world server becomes a few lines instead of hand-rolled socket
// bookkeeping. Reach these from the `minimotor/server` entry point (they are
// deliberately NOT part of the browser `Minimotor` bundle).
const OPEN = 1;
function isOpen(s) {
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
export function serve(server, opts = {}) {
    const clients = [];
    let nextId = 0;
    const room = {
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
        group(name) {
            return clients.filter((c) => c.group === name);
        },
    };
    server.on("connection", (socket, request) => {
        const query = request?.url?.indexOf("?") ?? -1;
        const group = query >= 0 ? (new URLSearchParams(request.url.slice(query)).get("room") ?? "") : "";
        const client = { id: `c${nextId++}`, socket, group };
        clients.push(client);
        opts.onJoin?.(client);
        socket.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(String(raw));
            }
            catch {
                return; // non-JSON frame — ignore
            }
            opts.onMessage?.(client, msg);
        });
        socket.on("close", () => {
            const i = clients.indexOf(client);
            if (i >= 0)
                clients.splice(i, 1);
            opts.onLeave?.(client);
        });
    });
    return room;
}
/** Serve the browser and server sides of one shared JSON `Protocol`. */
export function serveProtocol(server, opts = {}) {
    return serve(server, opts);
}
