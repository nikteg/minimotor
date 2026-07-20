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

  /** Current connection state. */
  readonly state: "connecting" | "connected" | "closed";

  /** Close the transport. */
  close(): void;
}

// ---------- WebSocket ----------

export function connect(config: WsConfig): Transport {
  const binaryType: BinaryType = config.binaryType ?? "arraybuffer";
  const reconnectMs = config.reconnectMs ?? 0;
  const heartbeatMs = config.heartbeatMs ?? 0;
  const heartbeatPayload = config.heartbeatPayload ?? new Uint8Array(0);
  const idleTimeoutMs = config.idleTimeoutMs ?? 0;

  let ws: WebSocket | null = null;
  let state: Transport["state"] = "connecting";
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let lastRecv = 0;
  let intentionalClose = false;

  function stopTimers() {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    if (idleTimer !== null) clearInterval(idleTimer);
    heartbeatTimer = null;
    idleTimer = null;
  }

  const transport: Transport = {
    onMessage: null,
    onClose: null,

    get state() {
      return state;
    },

    send(data: Uint8Array) {
      if (state !== "connected") throw new Error("WebSocket not connected");
      ws!.send(data);
    },

    trySend(data: Uint8Array) {
      if (state !== "connected") return false;
      try {
        ws!.send(data);
        return true;
      } catch {
        return false;
      }
    },

    sendJson(obj: unknown) {
      if (state !== "connected") throw new Error("WebSocket not connected");
      ws!.send(JSON.stringify(obj));
    },

    close() {
      intentionalClose = true;
      state = "closed";
      stopTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    },
  };

  function doConnect() {
    state = "connecting";
    ws = new WebSocket(config.url);
    ws.binaryType = binaryType;

    ws.onopen = () => {
      state = "connected";
      lastRecv = Date.now();
      if (heartbeatMs > 0) {
        heartbeatTimer = setInterval(() => {
          try {
            ws!.send(heartbeatPayload);
          } catch {
            /* racing a close — the onclose path cleans up */
          }
        }, heartbeatMs);
      }
      if (idleTimeoutMs > 0) {
        // Closing a half-open link routes into the normal onclose path, so
        // reconnectMs (if set) kicks in.
        idleTimer = setInterval(
          () => {
            if (Date.now() - lastRecv > idleTimeoutMs) ws!.close();
          },
          Math.max(250, idleTimeoutMs / 2),
        );
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      lastRecv = Date.now();
      const handler = transport.onMessage;
      if (!handler) return;
      if (e.data instanceof ArrayBuffer) {
        handler(new Uint8Array(e.data));
      } else if (e.data instanceof Blob) {
        e.data.arrayBuffer().then((buf) => {
          handler(new Uint8Array(buf));
        });
      } else if (typeof e.data === "string") {
        // Text frames (e.g. from sendJson) arrive as strings — deliver the bytes.
        handler(new TextEncoder().encode(e.data));
      }
    };

    ws.onclose = () => {
      state = "closed";
      stopTimers();
      if (!intentionalClose && reconnectMs > 0) {
        reconnectTimer = setTimeout(doConnect, reconnectMs);
      } else if (transport.onClose) {
        transport.onClose();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror — no action needed here
    };
  }

  doConnect();
  return transport;
}

// ---------- WebRTC ----------

/** Run `cb` once ICE gathering finishes (event-driven, no polling). */
function whenGatheringComplete(conn: RTCPeerConnection, cb: () => void) {
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

export function createPeer(config: RtcConfig = {}): {
  transport: Transport;
  /** Call when you want to start the connection (creates an offer). */
  connect(): void;
  /** Deliver a signaling message from the remote peer. */
  applySignal(signal: Signal): void;
  /** Called when this peer has a signaling message to send out-of-band. */
  onSignal: ((signal: Signal) => void) | null;
} {
  const iceServers = config.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  const trickle = config.trickle ?? true;

  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let state: Transport["state"] = "connecting";
  let queuedSignals: Signal[] = [];

  const transport: Transport = {
    onMessage: null,
    onClose: null,

    get state() {
      return state;
    },

    send(data: Uint8Array) {
      if (state !== "connected" || !dc) throw new Error("Data channel not connected");
      dc.send(data as Uint8Array<ArrayBuffer>);
    },

    trySend(data: Uint8Array) {
      if (state !== "connected" || !dc) return false;
      try {
        dc.send(data as Uint8Array<ArrayBuffer>);
        return true;
      } catch {
        return false;
      }
    },

    sendJson(obj: unknown) {
      if (state !== "connected" || !dc) throw new Error("Data channel not connected");
      dc.send(JSON.stringify(obj));
    },

    close() {
      if (dc) dc.close();
      if (pc) pc.close();
      state = "closed";
    },
  };

  let onSignal: ((signal: Signal) => void) | null = null;

  function flushSignals() {
    if (!onSignal) return;
    for (const s of queuedSignals) onSignal(s);
    queuedSignals = [];
  }

  function emitSignal(signal: Signal) {
    if (onSignal) onSignal(signal);
    else queuedSignals.push(signal);
  }

  function emitLocalDescription(type: "offer" | "answer") {
    emitSignal({ type, sdp: JSON.stringify(pc!.localDescription) });
  }

  function setupPeer(pc2: RTCPeerConnection) {
    pc2.onicecandidate = (e) => {
      if (e.candidate) {
        const signal: Signal = { type: "candidate", candidate: e.candidate.toJSON() };
        if (onSignal) onSignal(signal);
        else queuedSignals.push(signal);
      }
    };

    pc2.ondatachannel = (e) => {
      setupDataChannel(e.channel);
    };

    pc2.onconnectionstatechange = () => {
      if (pc2.connectionState === "failed" || pc2.connectionState === "disconnected") {
        state = "closed";
        if (transport.onClose) transport.onClose();
      }
    };
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dc = channel;
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
      state = "connected";
    };

    dc.onmessage = (e: MessageEvent) => {
      const handler = transport.onMessage;
      if (!handler) return;
      if (e.data instanceof ArrayBuffer) {
        handler(new Uint8Array(e.data));
      } else if (typeof e.data === "string") {
        // Text frames (e.g. from sendJson) arrive as strings — deliver the bytes.
        handler(new TextEncoder().encode(e.data));
      }
    };

    dc.onclose = () => {
      state = "closed";
      if (transport.onClose) transport.onClose();
    };
  }

  return {
    transport,

    connect() {
      pc = new RTCPeerConnection({ iceServers });

      const channel = pc.createDataChannel("game", {
        ordered: false, // allow out-of-order delivery for lower latency
        maxRetransmits: 0, // unreliable mode (like UDP) — game should handle lost packets
      });
      setupDataChannel(channel);
      setupPeer(pc);

      pc.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .then(() => {
          // Trickle: send the offer as soon as the local description is set;
          // candidates follow via onicecandidate. Non-trickle: wait for ICE
          // gathering so the SDP already contains every candidate.
          if (trickle) emitLocalDescription("offer");
          else whenGatheringComplete(pc!, () => emitLocalDescription("offer"));
        })
        .catch((err) => {
          console.warn("Minimotor.Net: creating WebRTC offer failed", err);
          state = "closed";
          if (transport.onClose) transport.onClose();
        });
    },

    applySignal(signal: Signal) {
      if (!pc) {
        pc = new RTCPeerConnection({ iceServers });
        setupPeer(pc);
      }

      if (signal.type === "offer" || signal.type === "answer") {
        const desc = JSON.parse(signal.sdp!);
        pc.setRemoteDescription(new RTCSessionDescription(desc))
          .then(() => {
            if (signal.type === "offer") {
              return pc!.createAnswer().then((answer) => pc!.setLocalDescription(answer));
            }
          })
          .then(() => {
            if (signal.type === "offer") {
              if (trickle) emitLocalDescription("answer");
              else whenGatheringComplete(pc!, () => emitLocalDescription("answer"));
            }
          })
          .catch((err) => {
            console.warn("WebRTC signaling error:", err);
          });
      } else if (signal.type === "candidate" && signal.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {
          // candidate may arrive before remote description — safe to ignore
        });
      }

      flushSignals();
    },

    set onSignal(handler: ((signal: Signal) => void) | null) {
      onSignal = handler;
      flushSignals();
    },

    get onSignal() {
      return onSignal;
    },
  };
}

// ---------- Snapshot interpolation ----------
// Remote entities look best rendered a little in the past, blended between two
// *known* states, instead of teleporting to whatever the latest packet said.
// Buffer incoming snapshots with `push`, then `sample()` each frame to get the
// state as of (now − delayMs):
//
//   const remote = Net.createInterpolator<{ x: number; y: number }>();
//   transport.onMessage = (data) => remote.push(decode(data));
//   // in draw():
//   const s = remote.sample();
//   if (s) drawPlayer(s.x, s.y);

export interface InterpolatorOptions<T> {
  /** How far behind real time to render, in ms. Should cover at least one
   *  packet interval plus jitter; default 100 (two packets at 20 Hz). */
  delayMs?: number;
  /** Snapshots kept in the buffer (default 32). */
  maxSnapshots?: number;
  /** Blend two states with `t` in 0..1. The default lerps every field that is
   *  numeric in both states and copies the rest from the newer one — supply
   *  your own for angles (wrap-around) or nested objects. */
  lerp?: (a: T, b: T, t: number) => T;
  /** Millisecond clock — injectable for tests. Default `performance.now`. */
  now?: () => number;
}

export interface Interpolator<T> {
  /** Record a snapshot. `atMs` defaults to arrival time; pass the sender's
   *  timestamp when the protocol carries one (steadier under receive jitter).
   *  Out-of-order snapshots (unreliable channels) are dropped. */
  push(state: T, atMs?: number): void;
  /** The state as of (now − delayMs). Interpolated between the two surrounding
   *  snapshots; clamps to the oldest/newest when the target time falls outside
   *  the buffer (no extrapolation). Null until the first push. */
  sample(atMs?: number): T | null;
  /** Buffered snapshot count. */
  readonly size: number;
  /** Drop all snapshots (e.g. on respawn/teleport, to avoid a visible sweep). */
  clear(): void;
}

function defaultLerp<T>(a: T, b: T, t: number): T {
  if (typeof a === "number" && typeof b === "number") {
    return (a + (b - a) * t) as T;
  }
  const out = { ...(b as object) } as Record<string, unknown>;
  const from = a as Record<string, unknown>;
  for (const k in from) {
    const av = from[k];
    const bv = out[k];
    if (typeof av === "number" && typeof bv === "number") out[k] = av + (bv - av) * t;
  }
  return out as T;
}

export function createInterpolator<T>(opts: InterpolatorOptions<T> = {}): Interpolator<T> {
  const delay = opts.delayMs ?? 100;
  const max = opts.maxSnapshots ?? 32;
  const now = opts.now ?? (() => performance.now());
  const blend = opts.lerp ?? defaultLerp<T>;

  const times: number[] = [];
  const states: T[] = [];

  return {
    push(state, atMs = now()) {
      // The buffer must stay time-ordered for sampling; late packets from an
      // unreliable channel are stale by definition — drop them.
      if (times.length && atMs <= times[times.length - 1]) return;
      times.push(atMs);
      states.push(state);
      if (times.length > max) {
        times.shift();
        states.shift();
      }
    },

    sample(atMs = now()) {
      const last = times.length - 1;
      if (last < 0) return null;
      const target = atMs - delay;
      if (target <= times[0]) return states[0];
      if (target >= times[last]) return states[last]; // buffer ran dry: hold
      // The target sits near the tail — scan back from the end.
      let i = last;
      while (times[i - 1] > target) i--;
      const t = (target - times[i - 1]) / (times[i] - times[i - 1]);
      return blend(states[i - 1], states[i], t);
    },

    get size() {
      return times.length;
    },

    clear() {
      times.length = 0;
      states.length = 0;
    },
  };
}
