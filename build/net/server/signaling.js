// ---------- WebRTC signaling relay ----------
// A "WebRTC server" is really a signaling relay: peers connect it over a
// WebSocket, discover each other, and shuttle SDP offers/answers + ICE
// candidates through it until their direct data channel is up. This builds
// that relay on a room, so a signaling server is one call. Pair it with the
// client `Net.createPeer`: forward each peer's `onSignal` out as
// `{ type: "signal", to, signal }`, and feed relayed signals into
// `applySignal`.
import { serve } from "./room.js";
/** Stand up a signaling relay on a WebSocket-like server: each connection gets
 *  a peer id, joins/leaves are announced to the mesh, and `signal` messages are
 *  routed to their target peer (tagged with the sender). Returns the underlying
 *  room. `ws`'s WebSocketServer fits `SocketServer` structurally.
 *
 *    import { WebSocketServer } from "ws";
 *    import { signaling } from "minimotor/server";
 *    signaling(new WebSocketServer({ port: 8080 })); */
export function signaling(server) {
    // The host is the first peer to connect to a given `?room=`. If it leaves,
    // the oldest remaining peer in that room is promoted so a session survives a
    // host drop (guests re-offer to the new host on the `host` notice). Rooms are
    // fully isolated: one endpoint can carry as many as clients ask for.
    const hosts = new Map();
    const hostOf = (group) => hosts.get(group) ?? null;
    const tell = (group, msg, except) => {
        for (const client of room.group(group))
            if (client !== except)
                room.send(client, msg);
    };
    const room = serve(server, {
        onJoin(client) {
            if (!hosts.has(client.group))
                hosts.set(client.group, client.id);
            const peers = room
                .group(client.group)
                .filter((c) => c !== client)
                .map((c) => c.id);
            room.send(client, {
                type: "welcome",
                id: client.id,
                host: hostOf(client.group),
                peers,
            });
            tell(client.group, { type: "peer-join", id: client.id }, client);
        },
        onMessage(client, msg) {
            if (msg?.type !== "signal" || typeof msg.to !== "string")
                return;
            // Only ever route within the sender's own room.
            const target = room.group(client.group).find((c) => c.id === msg.to);
            if (target)
                room.send(target, { type: "signal", from: client.id, signal: msg.signal });
        },
        onLeave(client) {
            tell(client.group, { type: "peer-leave", id: client.id });
            if (client.id === hostOf(client.group)) {
                const next = room.group(client.group)[0]?.id;
                if (next === undefined)
                    hosts.delete(client.group);
                else
                    hosts.set(client.group, next);
                tell(client.group, { type: "host", id: hostOf(client.group) });
            }
        },
    });
    return room;
}
