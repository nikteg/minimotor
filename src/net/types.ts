// ---------- Networking ----------
// WebSocket and WebRTC data channel transports with a common interface.
//
// WebSocket:
//   const ws = Net.connect("wss://server.example/game");
//   ws.send(new Uint8Array([1, 2, 3]));
//   ws.onMessage = (data) => { ... };
//
// WebRTC (peer-to-peer):
//   const peer = Net.createPeer();
//   peer.onSignal = (signal) => signalingServer.send(signal);
//   // When you receive a signal from the other peer:
//   peer.applySignal(receivedSignal);
//   peer.onMessage = (data) => { ... };
//   peer.send(data);

// ---------- Configuration ----------

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

export interface RtcConfig {
  /** STUN / TURN servers for NAT traversal */
  iceServers?: RTCIceServer[];
  /** Whether to use trickle ICE (send candidates as they arrive) */
  trickle?: boolean;
}

/** A signaling message exchanged out-of-band between WebRTC peers.
 *  The game is responsible for delivering these (e.g. via a WebSocket relay). */
export interface Signal {
  type: "offer" | "answer" | "candidate";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

// ---------- Transport interface ----------

export interface Transport {
  /** Send binary data over the transport. Throws if not connected. */
  send(data: Uint8Array): void;

  /** Like `send`, but returns false instead of throwing when the transport
   *  isn't connected — safe to call every frame from a game loop. */
  trySend(data: Uint8Array): boolean;

  /** Send a JSON-serializable object (convenience wrapper around send). */
  sendJson(obj: unknown): void;

  /** Called when binary data is received. */
  onMessage: ((data: Uint8Array) => void) | null;

  /** Called when the transport closes (intentionally or due to error). */
  onClose: (() => void) | null;

  /** Called on every connection-state transition (connecting → connected →
   *  closed, and back to connecting on reconnect). Saves polling `state` from a
   *  timer just to reflect it in the UI. */
  onState: ((state: "connecting" | "connected" | "closed") => void) | null;

  /** Current connection state. */
  readonly state: "connecting" | "connected" | "closed";

  /** Close the transport. */
  close(): void;
}
