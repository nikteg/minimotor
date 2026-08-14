// ---------- WebRTC ----------
// Each peer gets TWO data channels, because a game has two kinds of traffic and
// one channel cannot serve both:
//
//   "mm-fast"  unreliable + unordered — snapshots. A lost one is replaced by
//              the next one 16 ms later; retransmitting it would only add
//              latency to everything queued behind it.
//   "mm-safe"  reliable + ordered — events, commands, pickups. These are facts,
//              not samples: losing one is not recoverable by waiting.
/** Label of the unreliable/unordered channel (snapshots). */
const FAST = "mm-fast";
/** Label of the reliable/ordered channel (events and commands). */
const SAFE = "mm-safe";
// One encoder for the module: allocating per string frame is pure overhead on a
// path that runs at the snapshot rate.
const textEncoder = new TextEncoder();
/** Run `cb` once ICE gathering finishes (event-driven, no polling). */
function whenGatheringComplete(conn, cb) {
    if (conn.iceGatheringState === "complete") {
        cb();
        return;
    }
    const onChange = () => {
        if (conn.iceGatheringState === "complete") {
            conn.removeEventListener("icegatheringstatechange", onChange);
            cb();
        }
    };
    conn.addEventListener("icegatheringstatechange", onChange);
}
/** Create a WebRTC data-channel peer. Exposes an unreliable `transport` (for
 *  snapshots) and a `reliable` channel (for events); the caller side calls
 *  `connect()` to make the offer, and both sides relay signaling out-of-band
 *  via `onSignal` / `applySignal` (see `RtcConfig` for `iceServers` and
 *  `trickle`). */
export function createPeer(config = {}) {
    const iceServers = config.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
    const trickle = config.trickle ?? true;
    let pc = null;
    let queuedSignals = [];
    let onSignal = null;
    /** One Transport façade over one RTCDataChannel, attached once it exists. */
    function lane() {
        let dc = null;
        let state = "connecting";
        const setState = (next) => {
            if (state === next)
                return;
            state = next;
            transport.onState?.(next);
        };
        const transport = {
            onMessage: null,
            onClose: null,
            onState: null,
            get state() {
                return state;
            },
            send(data) {
                if (state !== "connected" || !dc)
                    throw new Error("Data channel not connected");
                dc.send(data);
            },
            trySend(data) {
                if (state !== "connected" || !dc)
                    return false;
                try {
                    dc.send(data);
                    return true;
                }
                catch {
                    return false;
                }
            },
            sendJson(obj) {
                if (state !== "connected" || !dc)
                    throw new Error("Data channel not connected");
                dc.send(JSON.stringify(obj));
            },
            close() {
                if (dc)
                    dc.close();
                setState("closed");
            },
            attach(channel) {
                dc = channel;
                dc.binaryType = "arraybuffer";
                if (dc.readyState === "open")
                    setState("connected");
                dc.onopen = () => setState("connected");
                dc.onmessage = (e) => {
                    const handler = transport.onMessage;
                    if (!handler)
                        return;
                    if (e.data instanceof ArrayBuffer)
                        handler(new Uint8Array(e.data));
                    // Text frames (e.g. from sendJson) arrive as strings — deliver bytes.
                    else if (typeof e.data === "string")
                        handler(textEncoder.encode(e.data));
                };
                dc.onclose = () => {
                    setState("closed");
                    transport.onClose?.();
                };
            },
        };
        return transport;
    }
    const fast = lane();
    const safe = lane();
    function flushSignals() {
        if (!onSignal)
            return;
        for (const s of queuedSignals)
            onSignal(s);
        queuedSignals = [];
    }
    function emitSignal(signal) {
        if (onSignal)
            onSignal(signal);
        else
            queuedSignals.push(signal);
    }
    function emitLocalDescription(type) {
        emitSignal({ type, sdp: JSON.stringify(pc.localDescription) });
    }
    function setupPeer(conn) {
        conn.onicecandidate = (e) => {
            if (e.candidate)
                emitSignal({ type: "candidate", candidate: e.candidate.toJSON() });
        };
        // The answering side receives both channels the offerer created; route them
        // by label so each keeps its delivery guarantees.
        conn.ondatachannel = (e) => {
            (e.channel.label === SAFE ? safe : fast).attach(e.channel);
        };
        conn.onconnectionstatechange = () => {
            if (conn.connectionState === "failed" || conn.connectionState === "disconnected") {
                // A dead connection may never fire `onclose` on its channels, so drive
                // the shutdown from here and let both lanes report it once.
                fast.close();
                safe.close();
                fast.onClose?.();
            }
        };
    }
    return {
        transport: fast,
        reliable: safe,
        connect() {
            pc = new RTCPeerConnection({ iceServers });
            fast.attach(pc.createDataChannel(FAST, { ordered: false, maxRetransmits: 0 }));
            safe.attach(pc.createDataChannel(SAFE, { ordered: true }));
            setupPeer(pc);
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => {
                // Trickle: send the offer as soon as the local description is set;
                // candidates follow via onicecandidate. Non-trickle: wait for ICE
                // gathering so the SDP already contains every candidate.
                if (trickle)
                    emitLocalDescription("offer");
                else
                    whenGatheringComplete(pc, () => emitLocalDescription("offer"));
            })
                .catch((err) => {
                console.warn("createNet: creating WebRTC offer failed", err);
                fast.close();
                safe.close();
                fast.onClose?.();
            });
        },
        applySignal(signal) {
            if (!pc) {
                pc = new RTCPeerConnection({ iceServers });
                setupPeer(pc);
            }
            if (signal.type === "offer" || signal.type === "answer") {
                const desc = JSON.parse(signal.sdp);
                pc.setRemoteDescription(new RTCSessionDescription(desc))
                    .then(() => {
                    if (signal.type === "offer") {
                        return pc.createAnswer().then((answer) => pc.setLocalDescription(answer));
                    }
                })
                    .then(() => {
                    if (signal.type === "offer") {
                        if (trickle)
                            emitLocalDescription("answer");
                        else
                            whenGatheringComplete(pc, () => emitLocalDescription("answer"));
                    }
                })
                    .catch((err) => {
                    console.warn("WebRTC signaling error:", err);
                });
            }
            else if (signal.type === "candidate" && signal.candidate) {
                pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {
                    // candidate may arrive before remote description — safe to ignore
                });
            }
            flushSignals();
        },
        close() {
            fast.close();
            safe.close();
            pc?.close();
        },
        set onSignal(handler) {
            onSignal = handler;
            flushSignals();
        },
        get onSignal() {
            return onSignal;
        },
    };
}
