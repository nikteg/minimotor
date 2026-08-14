// ---------- The symmetric Room (API_PLAN #48) + Net.sync (#49) ----------
// One vocabulary, no host/guest branches in app code:
//
//   const room = await Net.join("/ws-signal", { room: "api-lab" }).catch(() => null);
//   room.send({ hello: true });                  // to everyone
//   room.onMessage((from, msg) => { ... });      // from everyone
//
// Who hosts, the star fan-out, and host-drop healing are INTERNAL: the relay
// names a host; that member relays guest traffic to everyone else, and any
// member is ready to be promoted when the host drops. Offline is a normal
// outcome — the returned promise rejects and the app degrades gracefully.
//
// Rooms are RESOURCES (the stated exception to the pull law, #50): real IO,
// explicit close(). The asymmetric hostSession/joinSession pair remains one
// tier down for genuinely host-authoritative designs.
import { decodeJson, encodeJson, frame, unframe } from "./frame.js";
import { everyMs } from "./rate.js";
import { connect } from "./websocket.js";
import { createPeer } from "./webrtc.js";
import { createRoster } from "./roster.js";
// The wire format lives in ./frame.ts because a server-backed room speaks the
// very same one — see `socketRoom`.
const decode = decodeJson;
const encode = encodeJson;
/** A one-player room implementing the full Room API without a transport. */
export function localRoom() {
    let closed = false;
    let status = "connected";
    const statusFns = new Set();
    return {
        id: "local",
        peers: [],
        peerCount: 0,
        hostId: "local",
        hosting: true,
        local: true,
        get closed() {
            return closed;
        },
        get status() {
            return status;
        },
        onStatus(fn) {
            statusFns.add(fn);
            return () => statusFns.delete(fn);
        },
        send() { },
        onMessage: () => () => { },
        sendBytes() { },
        onBytes: () => () => { },
        onJoin: () => () => { },
        onLeave: () => () => { },
        close() {
            if (closed)
                return;
            closed = true;
            status = "closed";
            for (const fn of statusFns)
                fn(status);
            statusFns.clear();
        },
    };
}
/** Join a room by name. Resolves once the relay welcomes us. Set
 *  `fallback: "local"` to resolve to the same API as a one-player local host
 *  when the relay is unavailable; otherwise the initial failure rejects. */
export function join(url, opts = {}) {
    const full = opts.room
        ? `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(opts.room)}`
        : url;
    const reconnectOn = opts.reconnect ?? true;
    const retryMs = opts.retryMs ?? 500;
    const maxRetryMs = opts.maxRetryMs ?? 8000;
    const maxRetries = opts.maxRetries ?? 0;
    let ws;
    let myId = "";
    let hostId = null;
    let closed = false;
    let status = "connecting";
    let attempt = 0;
    let retryTimer = null;
    const statusFns = new Set();
    const setStatus = (next) => {
        if (status === next)
            return;
        status = next;
        for (const fn of statusFns)
            fn(next);
    };
    const members = new Set();
    // `peers` is read in draw loops; rebuild the array on membership change
    // rather than spreading the Set on every read.
    let peerList = [];
    const refreshPeers = () => {
        peerList = [...members];
    };
    const channels = new Map();
    const messageFns = new Set();
    const byteFns = new Map();
    const joinFns = new Set();
    const leaveFns = new Set();
    const traffic = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
    const hosting = () => hostId !== null && hostId === myId;
    /** Put a finished frame on the star: as host, to every member but the one it
     *  came from; as guest, to the host, who fans it out. */
    function dispatch(bytes, reliable, exceptId) {
        const put = (peer) => {
            if ((reliable ? peer.reliable : peer.transport).trySend(bytes)) {
                traffic.sent++;
                traffic.sentBytes += bytes.length;
            }
        };
        if (hosting()) {
            for (const [gid, peer] of channels)
                if (gid !== exceptId)
                    put(peer);
        }
        else if (hostId) {
            const peer = channels.get(hostId);
            if (peer)
                put(peer);
        }
    }
    /** One inbound frame: deliver it locally, then — as host — forward the SAME
     *  bytes to the rest of the room on the lane they arrived on. No decode and
     *  re-encode per recipient. */
    function receive(bytes, fromPeer, reliable) {
        traffic.received++;
        traffic.receivedBytes += bytes.length;
        const parsed = unframe(bytes);
        if (!parsed || parsed.from === myId)
            return; // own broadcast echoed back
        if (parsed.tag === "") {
            try {
                const msg = decode(parsed.payload);
                for (const fn of messageFns)
                    fn(parsed.from, msg);
            }
            catch {
                /* malformed JSON from a peer must not take the room down */
            }
        }
        else {
            const fns = byteFns.get(parsed.tag);
            if (fns)
                for (const fn of fns)
                    fn(parsed.from, parsed.payload);
        }
        if (hosting())
            dispatch(bytes, reliable, fromPeer);
    }
    function channelFor(peerId) {
        let peer = channels.get(peerId);
        if (peer)
            return peer;
        peer = createPeer(opts);
        channels.set(peerId, peer);
        peer.onSignal = (signal) => {
            // Signaling only works while the relay link is up; a signal produced
            // mid-reconnect is dropped, and `adopt()` re-offers once we're back.
            try {
                ws.sendJson({ type: "signal", to: peerId, signal });
            }
            catch {
                /* relay down — the post-welcome adopt() starts the handshake over */
            }
        };
        peer.transport.onMessage = (bytes) => receive(bytes, peerId, false);
        peer.reliable.onMessage = (bytes) => receive(bytes, peerId, true);
        peer.transport.onClose = () => {
            if (channels.get(peerId) === peer)
                channels.delete(peerId);
        };
        return peer;
    }
    /** Close a peer connection and forget it. */
    function dropChannel(peerId) {
        channels.get(peerId)?.close();
        channels.delete(peerId);
    }
    /** Adopt the current topology: as a guest, (re)offer one channel to the
     *  host; as the host, drop nothing and answer offers as they arrive. */
    function adopt() {
        if (hosting())
            return; // guests offer to us
        // Snapshot the keys: dropChannel mutates the map we are walking.
        for (const pid of Array.from(channels.keys()))
            if (pid !== hostId)
                dropChannel(pid);
        if (hostId)
            channelFor(hostId).connect();
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
            return hosting();
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
        send(msg, sendOpts) {
            dispatch(frame(myId, "", encode(msg)), sendOpts?.reliable ?? true, myId);
        },
        onMessage(fn) {
            messageFns.add(fn);
            return () => messageFns.delete(fn);
        },
        sendBytes(tag, bytes, sendOpts) {
            dispatch(frame(myId, tag, bytes), sendOpts?.reliable ?? false, myId);
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
            for (const peer of channels.values())
                peer.close();
            channels.clear();
            ws.close();
            setStatus("closed");
        },
    };
    const joining = new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                room.close();
                reject(new Error("createNet: relay never answered"));
            }
        }, opts.timeoutMs ?? 8000);
        // A welcome after a reconnect is a fresh membership list, not the first
        // one: diff it against what we had so the app hears the churn as ordinary
        // join/leave events rather than having to special-case the reconnect.
        const applyWelcome = (msg) => {
            myId = msg.id;
            hostId = msg.host ?? msg.id; // alone: we are the host-in-waiting
            const next = new Set(msg.peers.filter((p) => p !== myId));
            const gone = [...members].filter((id) => !next.has(id));
            const arrived = [...next].filter((id) => !members.has(id));
            for (const id of gone) {
                members.delete(id);
                dropChannel(id);
            }
            for (const id of arrived)
                members.add(id);
            refreshPeers();
            for (const id of gone)
                for (const fn of leaveFns)
                    fn(id);
            for (const id of arrived)
                for (const fn of joinFns)
                    fn(id);
            adopt();
        };
        const scheduleRetry = () => {
            if (maxRetries > 0 && attempt >= maxRetries) {
                closed = true;
                setStatus("closed");
                return;
            }
            // Exponential backoff from `retryMs`, capped: a relay that is down stays
            // down for a while, and a roomful of clients shouldn't stampede it.
            const delay = Math.min(maxRetryMs, retryMs * 2 ** attempt);
            attempt++;
            setStatus("reconnecting");
            retryTimer = setTimeout(open, delay);
        };
        const handleClose = () => {
            if (closed)
                return;
            if (!settled) {
                // Never joined: offline is the app's business, not something to retry.
                settled = true;
                clearTimeout(timer);
                setStatus("closed");
                reject(new Error("createNet: relay unreachable"));
                return;
            }
            if (!reconnectOn) {
                closed = true;
                setStatus("closed");
                return;
            }
            scheduleRetry();
        };
        function open() {
            retryTimer = null;
            ws = connect({ url: full });
            ws.onClose = handleClose;
            ws.onMessage = handleNotice;
        }
        function handleNotice(bytes) {
            const msg = decode(bytes);
            if (msg.type === "welcome") {
                applyWelcome(msg);
                attempt = 0; // the link is good again; next drop starts the backoff over
                setStatus("connected");
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(room);
                }
            }
            else if (msg.type === "peer-join") {
                if (msg.id !== myId && !members.has(msg.id)) {
                    members.add(msg.id);
                    refreshPeers();
                    for (const fn of joinFns)
                        fn(msg.id);
                }
            }
            else if (msg.type === "peer-leave") {
                if (members.delete(msg.id)) {
                    refreshPeers();
                    // Close AND forget: relying on the channel's own onclose leaks the
                    // entry whenever the connection dies without firing it.
                    dropChannel(msg.id);
                    for (const fn of leaveFns)
                        fn(msg.id);
                }
            }
            else if (msg.type === "host") {
                hostId = msg.id;
                adopt(); // promotion heals the star — possibly to US
            }
            else if (msg.type === "signal") {
                // As host we answer any member's offer; as guest only the host's.
                if (hosting() || msg.from === hostId)
                    channelFor(msg.from).applySignal(msg.signal);
            }
        }
        open();
    });
    return opts.fallback === "local" ? joining.catch(() => localRoom()) : joining;
}
// ---------- Net.sync: declarative state replication (#49) ----------
const SYNC_KEY = "__mm_sync";
/** Declarative replication: say WHAT you share and how often; get everyone
 *  else's states back, interpolated and timeout-pruned. Fuses the exported
 *  lower-tier parts (`createInterpolator` + `createRoster` + a send timer). */
export function sync(room, opts) {
    const intervalMs = 1000 / (opts.hz ?? 30);
    const roster = createRoster({
        delayMs: opts.delayMs ?? "auto",
        expectedIntervalMs: intervalMs,
        timeoutMs: opts.timeoutMs,
        lerp: opts.lerp,
        extrapolate: opts.extrapolate,
        maxExtrapolationMs: opts.maxExtrapolationMs,
        now: opts.now,
    });
    const isSync = (msg) => typeof msg === "object" && msg !== null && msg[SYNC_KEY] === 1;
    const clock = opts.now ?? (() => performance.now());
    const codec = opts.codec;
    const unsubscribe = codec
        ? room.onBytes(codec.tag, (from, bytes) => {
            const packet = codec.decode(bytes);
            if (packet)
                roster.update(from, packet.state, clock(), packet.sentAt);
        })
        : room.onMessage((from, msg) => {
            if (isSync(msg))
                roster.update(from, msg.s, clock(), msg.t);
        });
    const offLeave = room.onLeave((id) => roster.remove(id));
    /** One broadcast tick. Sampling is skipped outright when we're alone in the
     *  room — `send` would be a no-op anyway, and `opts.state()` is the app's
     *  code, which shouldn't run for nobody. */
    function broadcast() {
        if (room.closed) {
            stop();
            return;
        }
        if (room.peerCount === 0)
            return;
        // Unreliable: a snapshot that needs retransmitting has already been
        // replaced by a newer one, and waiting for it would stall the whole lane.
        const state = opts.state();
        const sentAt = clock();
        if (codec)
            room.sendBytes(codec.tag, codec.encode(state, sentAt), { reliable: false });
        else {
            room.send({ [SYNC_KEY]: 1, s: state, t: sentAt }, {
                reliable: false,
            });
        }
    }
    // Evenly spaced on a wall clock, independent of frame pacing and of whether
    // the game is paused — see `everyMs`.
    const offTick = everyMs(intervalMs, broadcast);
    let stopped = false;
    function stop() {
        if (stopped)
            return;
        stopped = true;
        offTick();
        unsubscribe();
        offLeave();
    }
    return {
        get size() {
            return roster.size;
        },
        get ids() {
            return roster.ids;
        },
        latest(id) {
            const state = roster.latest(id);
            return state === null ? null : { ...state, id };
        },
        reset(id) {
            roster.reset(id);
        },
        stop,
        *[Symbol.iterator]() {
            roster.prune();
            for (const [id, state] of roster.sample()) {
                yield { ...state, id };
            }
        },
    };
}
