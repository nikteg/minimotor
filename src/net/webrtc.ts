import { RtcConfig, Signal, Transport } from "./types.js";

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
      if (pc) pc.close();
      setState("closed");
    },
  };

  // Update `state` and notify onState only on a real transition.
  const setState = (next: Transport["state"]): void => {
    if (state === next) return;
    state = next;
    transport.onState?.(next);
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
        setState("closed");
        if (transport.onClose) transport.onClose();
      }
    };
  }

  function setupDataChannel(channel: RTCDataChannel) {
    dc = channel;
    dc.binaryType = "arraybuffer";

    dc.onopen = () => {
      setState("connected");
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
      setState("closed");
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
          setState("closed");
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
