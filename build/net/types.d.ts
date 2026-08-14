/** Configuration for a WebSocket transport (`connect`): URL, reconnect,
 *  heartbeat, and idle-timeout behaviour. */
export interface WsConfig {
    /** WebSocket URL (e.g. "wss://server.example/game") */
    url: string;
    /** Binary type for messages ("arraybuffer" recommended for Uint8Array) */
    binaryType?: BinaryType;
    /** Reconnect delay in ms (0 = no reconnect) */
    reconnectMs?: number;
    /** Send a keep-alive frame every N ms while connected (0 = off). Keeps
     *  proxies/load-balancers from dropping a quiet connection. */
    heartbeatMs?: number;
    /** The keep-alive frame (default a 0-byte binary frame). Match whatever your
     *  server ignores/expects — e.g. `"ping"`. */
    heartbeatPayload?: Uint8Array | string;
    /** Treat the link as dead when nothing is received for N ms (0 = off): the
     *  socket is closed, which triggers `reconnectMs` if configured — a half-open
     *  TCP connection otherwise looks "connected" forever. Pair with a server
     *  that sends something periodically (or echoes the heartbeat). */
    idleTimeoutMs?: number;
}
/** WebRTC peer configuration (`createPeer`): ICE servers and trickle mode. */
export interface RtcConfig {
    /** STUN / TURN servers for NAT traversal */
    iceServers?: RTCIceServer[];
    /** Whether to use trickle ICE (send candidates as they arrive) */
    trickle?: boolean;
}
/** A signaling message exchanged out-of-band between WebRTC peers.
 *  The app is responsible for delivering these (e.g. via a WebSocket relay). */
export interface Signal {
    /** Signal kind: `"offer"`/`"answer"` carry `sdp`; `"candidate"` carries `candidate`. */
    type: "offer" | "answer" | "candidate";
    /** Session description (present on `"offer"`/`"answer"`). */
    sdp?: string;
    /** A single ICE candidate (present on `"candidate"`). */
    candidate?: RTCIceCandidateInit;
}
/** The common interface for a binary message channel — implemented by both the
 *  WebSocket and WebRTC transports. */
export interface Transport {
    /** Send binary data over the transport. Throws if not connected. */
    send(data: Uint8Array): void;
    /** Like `send`, but returns false instead of throwing when the transport
     *  isn't connected — safe to call every frame from the update loop. */
    trySend(data: Uint8Array): boolean;
    /** Send a JSON-serializable object (convenience wrapper around send). */
    sendJson(obj: unknown): void;
    /** Called when binary data is received. */
    onMessage: ((data: Uint8Array) => void) | null;
    /** Called when the transport closes (intentionally or due to error). */
    onClose: (() => void) | null;
    /** Called on every connection-state transition (connecting → connected →
     *  closed; the WebSocket transport (`connect`) also re-enters connecting on
     *  reconnect — `createPeer` never does). Saves polling `state` from a timer
     *  just to reflect it in the UI. */
    onState: ((state: "connecting" | "connected" | "closed") => void) | null;
    /** Current connection state. */
    readonly state: "connecting" | "connected" | "closed";
    /** Close the transport. */
    close(): void;
}
