// ---------- Server rooms ----------
// Node-side helpers for the authoritative/relay half of a multiplayer game.
// A "room" wraps a WebSocket-like server — the `ws` package's WebSocketServer
// fits structurally, so nothing here imports `ws` or Node — and hands you
// connection lifecycle plus broadcast/relay/send — JSON by default, or any
// format you like by passing `RoomOptions.codec`. An echo, a relay, or an
// authoritative world server becomes a few lines instead of hand-rolled socket
// bookkeeping. Reach these from the `minimotor/server` entry point (they are
// deliberately NOT part of the browser `Minimotor` bundle).
const OPEN = 1;
function isOpen(s) {
    return s.readyState === undefined || s.readyState === OPEN;
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
export function serve(server, opts = {}) {
    const clients = [];
    let nextId = 0;
    const codec = opts.codec;
    // One encode per call, reused across every recipient — the property
    // `broadcast` has always had with `JSON.stringify` and the reason a codec
    // must not be per-client.
    const encode = (msg) => codec ? codec.encode(msg) : JSON.stringify(msg);
    const room = {
        clients,
        send(client, msg) {
            if (isOpen(client.socket))
                client.socket.send(encode(msg));
        },
        broadcast(msg) {
            const data = encode(msg);
            for (const c of clients)
                if (isOpen(c.socket))
                    c.socket.send(data);
        },
        relay(from, msg) {
            const data = encode(msg);
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
            if (codec) {
                // `ws` hands both text and binary frames over as a Buffer, which IS a
                // Uint8Array, so a codec sees bytes for both and never has to be told
                // which kind of frame it was. A test double passing a plain string is
                // handed the string.
                const decoded = codec.decode(raw instanceof Uint8Array ? raw : typeof raw === "string" ? raw : String(raw));
                if (decoded !== undefined)
                    opts.onMessage?.(client, decoded);
                return;
            }
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
/** Serve the browser and server sides of one shared `Protocol`.
 *
 * JSON unless `opts.codec` says otherwise. The codec faces the way the SERVER
 * does — it encodes `ServerMessageOf<P>` and decodes `ClientMessageOf<P>` — and
 * `connectProtocol` takes its mirror image at the other end. */
export function serveProtocol(server, opts = {}) {
    return serve(server, opts);
}
