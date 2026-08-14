// ---------- WebRTC sessions (host / join) ----------
// Pure peer-to-peer multiplayer with a star topology: one client is the HOST,
// every other client is a GUEST that opens a data channel straight to the host.
// A WebSocket only carries signaling (SDP/ICE) — once the channels are up, app
// traffic never touches the server. Pair with `signaling()` from the
// `minimotor/server` entry (or any relay that speaks the same protocol).
//
//   // host tab
//   const room = Net.host({ signal: "wss://relay.example/ws-signal" });
//   room.onGuestJoin = (id) => room.send(id, { type: "welcome" });
//   room.onMessage   = (id, msg) => room.broadcast(msg);   // fan-out
//
//   // guest tab
//   const me = Net.join({ signal: "wss://relay.example/ws-signal" });
//   me.onOpen    = () => me.send({ type: "hello" });
//   me.onMessage = (msg) => render(msg);
//
// Messages are plain JSON objects — `send`/`broadcast` encode, and the handlers
// receive decoded objects. Bring your own `Send`/`Recv` types for end-to-end
// safety. Both sessions self-heal on a host drop: `signaling()` promotes the
// oldest remaining guest and guests re-offer to the new host automatically.
import { connect } from "./websocket.js";
import { createPeer } from "./webrtc.js";
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
// App payloads travel as JSON text frames on the data channel (createPeer
// delivers both binary and text frames back as bytes).
const encode = (obj) => new TextEncoder().encode(JSON.stringify(obj));
/** Become the host of a session: accept a data channel from each guest that
 *  joins via the relay and fan messages out to them. The host is always the
 *  first peer the relay sees, so calling `host()` first claims the session. */
export function host(opts) {
    const ws = connect({ url: opts.signal });
    // One peer per guest, keyed by the guest's relay id. The host is the answerer,
    // so a peer is created lazily when the guest's offer (its first `signal`)
    // arrives — never by calling connect().
    const peers = new Map();
    let id = "";
    const session = {
        get id() {
            return id;
        },
        get guests() {
            return [...peers.keys()].filter((g) => peers.get(g).transport.state === "connected");
        },
        send(guestId, msg) {
            peers.get(guestId)?.transport.trySend(encode(msg));
        },
        broadcast(msg) {
            const bytes = encode(msg);
            for (const peer of peers.values())
                peer.transport.trySend(bytes);
        },
        onGuestJoin: null,
        onGuestLeave: null,
        onMessage: null,
        close() {
            for (const peer of peers.values())
                peer.close();
            peers.clear();
            ws.close();
        },
    };
    function peerFor(guestId) {
        let peer = peers.get(guestId);
        if (peer)
            return peer;
        peer = createPeer(opts);
        peers.set(guestId, peer);
        peer.onSignal = (signal) => ws.sendJson({ type: "signal", to: guestId, signal });
        peer.transport.onMessage = (bytes) => session.onMessage?.(guestId, decode(bytes));
        peer.transport.onState = (state) => {
            if (state === "connected")
                session.onGuestJoin?.(guestId);
        };
        peer.transport.onClose = () => {
            if (peers.delete(guestId))
                session.onGuestLeave?.(guestId);
        };
        return peer;
    }
    ws.onMessage = (bytes) => {
        const msg = decode(bytes);
        if (msg.type === "welcome") {
            id = msg.id;
        }
        else if (msg.type === "signal") {
            peerFor(msg.from).applySignal(msg.signal);
        }
        else if (msg.type === "peer-leave") {
            const peer = peers.get(msg.id);
            if (peer)
                peer.close(); // fires onClose → onGuestLeave
        }
    };
    return session;
}
/** Join a session as a guest: open one data channel to the host and exchange
 *  messages with it. The guest is the offerer — it sends its offer to whichever
 *  peer the relay names as host, and re-offers automatically if the host is
 *  handed over to another peer. */
export function join(opts) {
    const ws = connect({ url: opts.signal });
    let id = "";
    let hostId = null;
    let peer = makePeer();
    const session = {
        get id() {
            return id;
        },
        get hostId() {
            return hostId;
        },
        send(msg) {
            peer.transport.trySend(encode(msg));
        },
        onOpen: null,
        onClose: null,
        onMessage: null,
        close() {
            peer.close();
            ws.close();
        },
    };
    function makePeer() {
        const p = createPeer(opts);
        p.onSignal = (signal) => {
            if (hostId)
                ws.sendJson({ type: "signal", to: hostId, signal });
        };
        p.transport.onMessage = (bytes) => session.onMessage?.(decode(bytes));
        p.transport.onState = (state) => {
            if (state === "connected")
                session.onOpen?.();
        };
        p.transport.onClose = () => session.onClose?.();
        return p;
    }
    // Offer to the host, unless that's us (a lone `host()` should call host()).
    function offerHost() {
        if (hostId && hostId !== id)
            peer.connect();
    }
    ws.onMessage = (bytes) => {
        const msg = decode(bytes);
        if (msg.type === "welcome") {
            id = msg.id;
            hostId = msg.host;
            offerHost();
        }
        else if (msg.type === "host") {
            // Host handed over: drop the dead channel and re-offer to the new host.
            hostId = msg.id;
            peer.close();
            peer = makePeer();
            offerHost();
        }
        else if (msg.type === "signal" && msg.from === hostId) {
            peer.applySignal(msg.signal);
        }
    };
    return session;
}
