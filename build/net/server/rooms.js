// ---------- Dedicated room server ----------
// The server side of `Net.socketRoom`: it does exactly what the peer host does
// in a WebRTC room — hand out ids, track membership, elect an owner for shared
// state, and forward frames verbatim — so every Net primitive behaves the same
// in both topologies.
//
//    import { WebSocketServer } from "ws";
//    import { rooms } from "minimotor/server";
//    rooms(new WebSocketServer({ port: 8080 }));
//
// Forwarding is byte-for-byte: the sender id is inside the frame, so the
// server never parses a snapshot it has no schema for. Add `onMessage` when
// you want the server to actually READ the traffic (an authoritative build);
// leave it off and this is a pure relay.
import { CONTROL, controlFrame, unframe } from "../frame.js";
const OPEN = 1;
const isOpen = (socket) => socket.readyState === undefined || socket.readyState === OPEN;
/** Host a set of rooms on a WebSocket server. Clients connect with
 *  `Net.socketRoom(url, { room })`. */
export function rooms(server, options = {}) {
    const members = [];
    const hosts = new Map();
    let nextId = 0;
    const group = (name) => members.filter((m) => m.group === name);
    const send = (member, bytes) => {
        if (isOpen(member.socket))
            member.socket.send(bytes);
    };
    const notify = (member, notice) => send(member, controlFrame(notice));
    const tell = (name, notice, except) => {
        const bytes = controlFrame(notice);
        for (const member of group(name))
            if (member !== except)
                send(member, bytes);
    };
    server.on("connection", (socket, request) => {
        const query = request?.url?.indexOf("?") ?? -1;
        const name = query >= 0 ? (new URLSearchParams(request.url.slice(query)).get("room") ?? "") : "";
        const member = { id: `c${nextId++}`, group: name, socket };
        members.push(member);
        // First in owns shared state, exactly as the first peer does in a mesh.
        if (!hosts.has(name))
            hosts.set(name, member.id);
        notify(member, {
            type: "welcome",
            id: member.id,
            host: hosts.get(name) ?? null,
            peers: group(name)
                .filter((m) => m !== member)
                .map((m) => m.id),
        });
        tell(name, { type: "peer-join", id: member.id }, member);
        options.onJoin?.(member);
        socket.on("message", (raw) => {
            const bytes = toBytes(raw);
            if (!bytes)
                return;
            const parsed = unframe(bytes);
            // A member may only speak as itself, and never as the relay.
            if (!parsed || parsed.from === CONTROL || parsed.from !== member.id)
                return;
            if (options.onFrame?.(member, parsed.tag, parsed.payload) === false)
                return;
            for (const other of group(name))
                if (other !== member)
                    send(other, bytes);
        });
        socket.on("close", () => {
            const at = members.indexOf(member);
            if (at >= 0)
                members.splice(at, 1);
            tell(name, { type: "peer-leave", id: member.id });
            if (hosts.get(name) === member.id) {
                const next = group(name)[0]?.id;
                if (next === undefined)
                    hosts.delete(name);
                else
                    hosts.set(name, next);
                tell(name, { type: "host", id: hosts.get(name) ?? null });
            }
            options.onLeave?.(member);
        });
    });
    return {
        members: group,
        host: (name) => hosts.get(name) ?? null,
        notify,
    };
}
/** Normalize whatever the socket library hands us into bytes. */
function toBytes(raw) {
    if (raw instanceof Uint8Array)
        return raw;
    if (raw instanceof ArrayBuffer)
        return new Uint8Array(raw);
    if (Array.isArray(raw))
        return concat(raw); // ws fragment list
    return null;
}
function concat(chunks) {
    let size = 0;
    for (const chunk of chunks)
        size += chunk.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
