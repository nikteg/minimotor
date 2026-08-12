import { RtcConfig, Signal, Transport } from "./types.js";

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

/** A WebRTC peer with both delivery modes wired up. */
export interface RtcPeer {
  /** Unreliable/unordered channel — snapshots and other resendable samples. */
  transport: Transport;
  /** Reliable/ordered channel — events, commands, and anything that must not
   *  be silently dropped. */
  reliable: Transport;
  /** Call when you want to start the connection (creates an offer). */
  connect(): void;
  /** Deliver a signaling message from the remote peer. */
  applySignal(signal: Signal): void;
  /** Called when this peer has a signaling message to send out-of-band. */
  onSignal: ((signal: Signal) => void) | null;
  /** Close both channels and the connection. */
  close(): void;
}

/** Create a WebRTC data-channel peer. Exposes an unreliable `transport` (for
 *  snapshots) and a `reliable` channel (for events); the caller side calls
 *  `connect()` to make the offer, and both sides relay signaling out-of-band
 *  via `onSignal` / `applySignal` (see `RtcConfig` for `iceServers` and
 *  `trickle`). */
export function createPeer(config: RtcConfig = {}): RtcPeer {
  const iceServers = config.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
  const trickle = config.trickle ?? true;

  let pc: RTCPeerConnection | null = null;
  let queuedSignals: Signal[] = [];
  let onSignal: ((signal: Signal) => void) | null = null;

  /** One Transport façade over one RTCDataChannel, attached once it exists. */
  function lane(): Transport & { attach(channel: RTCDataChannel): void } {
    let dc: RTCDataChannel | null = null;
    let state: Transport["state"] = "connecting";

    const setState = (next: Transport["state"]): void => {
      if (state === next) return;
      state = next;
      transport.onState?.(next);
    };

    const transport: Transport & { attach(channel: RTCDataChannel): void } = {
      onMessage: null,
      onClose: null,
      onState: null,

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
        setState("closed");
      },

      attach(channel: RTCDataChannel) {
        dc = channel;
        dc.binaryType = "arraybuffer";
        if (dc.readyState === "open") setState("connected");
        dc.onopen = () => setState("connected");
        dc.onmessage = (e: MessageEvent) => {
          const handler = transport.onMessage;
          if (!handler) return;
          if (e.data instanceof ArrayBuffer) handler(new Uint8Array(e.data));
          // Text frames (e.g. from sendJson) arrive as strings — deliver bytes.
          else if (typeof e.data === "string") handler(textEncoder.encode(e.data));
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

  function setupPeer(conn: RTCPeerConnection) {
    conn.onicecandidate = (e) => {
      if (e.candidate) emitSignal({ type: "candidate", candidate: e.candidate.toJSON() });
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
        .then((offer) => pc!.setLocalDescription(offer))
        .then(() => {
          // Trickle: send the offer as soon as the local description is set;
          // candidates follow via onicecandidate. Non-trickle: wait for ICE
          // gathering so the SDP already contains every candidate.
          if (trickle) emitLocalDescription("offer");
          else whenGatheringComplete(pc!, () => emitLocalDescription("offer"));
        })
        .catch((err) => {
          console.warn("createNet: creating WebRTC offer failed", err);
          fast.close();
          safe.close();
          fast.onClose?.();
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

    close() {
      fast.close();
      safe.close();
      pc?.close();
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
