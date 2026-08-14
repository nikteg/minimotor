// ---------- The same Room, over one WebSocket ----------
// `join` builds a room out of a WebRTC mesh; `socketRoom` builds the identical
// `Room` out of a single socket to a dedicated server (`rooms()` from
// `minimotor/server`). Nothing above this line cares which: `sync`, `syncBody`,
// `events`, `sharedItems`, `hostState` and `Net.game` are written against
// `Room` and work unchanged in either topology.
//
//   const room = await Net.socketRoom("wss://game.example/ws-rooms", { room: "arena" });
//   const players = Net.syncBody(room, player);   // exactly as with `join`
//
// What differs is only what a topology can honestly promise:
//   • the server is the relay, so there is no host migration to heal, and
//     `hosting` marks the client the server elected to own shared state;
//   • a WebSocket is always reliable and ordered, so `reliable: false` is a
//     permission the transport simply does not need to use.
import { connect } from "./websocket.js";
import { CONTROL, decodeJson, encodeJson, frame, unframe } from "./frame.js";
import { localRoom } from "./room.js";
/** Join a room hosted by a dedicated server. Resolves on the server's welcome
 *  and gives back the same `Room` every Net primitive already speaks. */
export function socketRoom(url, opts = {}) {
    const full = opts.room
        ? `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(opts.room)}`
        : url;
    const reconnectOn = opts.reconnect ?? true;
    const retryMs = opts.retryMs ?? 500;
    const maxRetryMs = opts.maxRetryMs ?? 8000;
    let socket;
    let myId = "";
    let hostId = null;
    let closed = false;
    let status = "connecting";
    let attempt = 0;
    let retryTimer = null;
    const traffic = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
    const members = new Set();
    let peerList = [];
    const refreshPeers = () => void (peerList = [...members]);
    const statusFns = new Set();
    const messageFns = new Set();
    const byteFns = new Map();
    const joinFns = new Set();
    const leaveFns = new Set();
    const setStatus = (next) => {
        if (status === next)
            return;
        status = next;
        for (const fn of statusFns)
            fn(next);
    };
    /** Everything goes to the server, which fans it out to the rest of the room. */
    function dispatch(bytes) {
        if (socket.trySend(bytes)) {
            traffic.sent++;
            traffic.sentBytes += bytes.length;
        }
    }
    const room = {
        get id() {
            return myId;
        },
        get peers() {
            return peerList;
        },
        get peerCount() {
            return members.size;
        },
        get hostId() {
            return hostId;
        },
        get hosting() {
            return hostId !== null && hostId === myId;
        },
        local: false,
        get closed() {
            return closed;
        },
        get status() {
            return status;
        },
        traffic,
        onStatus(fn) {
            statusFns.add(fn);
            return () => statusFns.delete(fn);
        },
        send(msg) {
            dispatch(frame(myId, "", encodeJson(msg)));
        },
        onMessage(fn) {
            messageFns.add(fn);
            return () => messageFns.delete(fn);
        },
        sendBytes(tag, bytes) {
            dispatch(frame(myId, tag, bytes));
        },
        onBytes(tag, fn) {
            let fns = byteFns.get(tag);
            if (!fns)
                byteFns.set(tag, (fns = new Set()));
            fns.add(fn);
            return () => fns.delete(fn);
        },
        onJoin(fn) {
            joinFns.add(fn);
            return () => joinFns.delete(fn);
        },
        onLeave(fn) {
            leaveFns.add(fn);
            return () => leaveFns.delete(fn);
        },
        close() {
            closed = true;
            if (retryTimer !== null)
                clearTimeout(retryTimer);
            retryTimer = null;
            socket.close();
            setStatus("closed");
        },
    };
    const joining = new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            room.close();
            reject(new Error("createNet: room server never answered"));
        }, opts.timeoutMs ?? 8000);
        /** A welcome after a reconnect is a fresh membership list: diff it so the
         *  app hears ordinary join/leave events instead of a special case. */
        const applyWelcome = (notice) => {
            myId = notice.id;
            hostId = notice.host;
            const next = new Set(notice.peers.filter((p) => p !== myId));
            const gone = [...members].filter((id) => !next.has(id));
            const arrived = [...next].filter((id) => !members.has(id));
            for (const id of gone)
                members.delete(id);
            for (const id of arrived)
                members.add(id);
            refreshPeers();
            for (const id of gone)
                for (const fn of leaveFns)
                    fn(id);
            for (const id of arrived)
                for (const fn of joinFns)
                    fn(id);
        };
        function control(notice) {
            if (notice.type === "welcome") {
                applyWelcome(notice);
                attempt = 0;
                setStatus("connected");
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(room);
                }
            }
            else if (notice.type === "peer-join") {
                if (notice.id !== myId && !members.has(notice.id)) {
                    members.add(notice.id);
                    refreshPeers();
                    for (const fn of joinFns)
                        fn(notice.id);
                }
            }
            else if (notice.type === "peer-leave") {
                if (members.delete(notice.id)) {
                    refreshPeers();
                    for (const fn of leaveFns)
                        fn(notice.id);
                }
            }
            else {
                hostId = notice.id;
            }
        }
        function receive(bytes) {
            traffic.received++;
            traffic.receivedBytes += bytes.length;
            const parsed = unframe(bytes);
            if (!parsed)
                return;
            try {
                if (parsed.from === CONTROL) {
                    control(decodeJson(parsed.payload));
                    return;
                }
                if (parsed.from === myId)
                    return; // our own frame, echoed
                if (parsed.tag === "") {
                    const msg = decodeJson(parsed.payload);
                    for (const fn of messageFns)
                        fn(parsed.from, msg);
                }
                else {
                    const fns = byteFns.get(parsed.tag);
                    if (fns)
                        for (const fn of fns)
                            fn(parsed.from, parsed.payload);
                }
            }
            catch {
                /* a malformed frame from the wire must not take the room down */
            }
        }
        function handleClose() {
            if (closed)
                return;
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                setStatus("closed");
                reject(new Error("createNet: room server unreachable"));
                return;
            }
            if (!reconnectOn) {
                closed = true;
                setStatus("closed");
                return;
            }
            const delay = Math.min(maxRetryMs, retryMs * 2 ** attempt);
            attempt++;
            setStatus("reconnecting");
            retryTimer = setTimeout(open, delay);
        }
        function open() {
            retryTimer = null;
            socket = connect({ url: full });
            socket.onClose = handleClose;
            socket.onMessage = receive;
        }
        open();
    });
    return opts.fallback === "local" ? joining.catch(() => localRoom()) : joining;
}
