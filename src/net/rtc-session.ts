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
import type { RtcConfig, Signal } from "./types.js";

/** Shared options: where to reach the signaling relay, plus any WebRTC config
 *  (STUN/TURN servers, trickle) forwarded to each peer connection. */
export interface RtcSessionOptions extends RtcConfig {
  /** WebSocket URL of the signaling relay (e.g. `signaling()` on the server). */
  signal: string;
}

/** The signaling messages the relay sends us. Mirrors `SignalingNotice` from
 *  the server entry, kept local so the browser bundle never imports server code. */
type Notice =
  | { type: "welcome"; id: string; host: string | null; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "host"; id: string | null }
  | { type: "signal"; from: string; signal: Signal };

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

// App payloads travel as JSON text frames on the data channel (createPeer
// delivers both binary and text frames back as bytes).
const encode = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

/** The host side of a session: a data channel to each connected guest. */
export interface HostSession<Send = unknown, Recv = unknown> {
  /** This host's own id (empty until the relay's `welcome` arrives). */
  readonly id: string;
  /** Ids of guests with an open data channel (live snapshot). */
  readonly guests: string[];
  /** Send a message to one guest (no-op if that channel isn't open). */
  send(guestId: string, msg: Send): void;
  /** Send a message to every connected guest. */
  broadcast(msg: Send): void;
  /** A guest's data channel opened. */
  onGuestJoin: ((guestId: string) => void) | null;
  /** A guest's data channel closed. */
  onGuestLeave: ((guestId: string) => void) | null;
  /** A message arrived from a guest. */
  onMessage: ((guestId: string, msg: Recv) => void) | null;
  /** Tear down every guest channel and the signaling socket. */
  close(): void;
}

/** The guest side of a session: a single data channel to the host. */
export interface GuestSession<Send = unknown, Recv = unknown> {
  /** This guest's own id (empty until the relay's `welcome` arrives). */
  readonly id: string;
  /** The current host's id, or null before `welcome` / during a host handover. */
  readonly hostId: string | null;
  /** Send a message to the host (no-op until the channel is open). */
  send(msg: Send): void;
  /** The data channel to the host opened. */
  onOpen: (() => void) | null;
  /** The data channel to the host closed (a handover may open a new one). */
  onClose: (() => void) | null;
  /** A message arrived from the host. */
  onMessage: ((msg: Recv) => void) | null;
  /** Tear down the host channel and the signaling socket. */
  close(): void;
}

/** Become the host of a session: accept a data channel from each guest that
 *  joins via the relay and fan messages out to them. The host is always the
 *  first peer the relay sees, so calling `host()` first claims the session. */
export function host<Send = unknown, Recv = unknown>(
  opts: RtcSessionOptions,
): HostSession<Send, Recv> {
  const ws = connect({ url: opts.signal });
  // One peer per guest, keyed by the guest's relay id. The host is the answerer,
  // so a peer is created lazily when the guest's offer (its first `signal`)
  // arrives — never by calling connect().
  const peers = new Map<string, ReturnType<typeof createPeer>>();
  let id = "";

  const session: HostSession<Send, Recv> = {
    get id() {
      return id;
    },
    get guests() {
      return [...peers.keys()].filter((g) => peers.get(g)!.transport.state === "connected");
    },
    send(guestId, msg) {
      peers.get(guestId)?.transport.trySend(encode(msg));
    },
    broadcast(msg) {
      const bytes = encode(msg);
      for (const peer of peers.values()) peer.transport.trySend(bytes);
    },
    onGuestJoin: null,
    onGuestLeave: null,
    onMessage: null,
    close() {
      for (const peer of peers.values()) peer.close();
      peers.clear();
      ws.close();
    },
  };

  function peerFor(guestId: string): ReturnType<typeof createPeer> {
    let peer = peers.get(guestId);
    if (peer) return peer;
    peer = createPeer(opts);
    peers.set(guestId, peer);
    peer.onSignal = (signal) => ws.sendJson({ type: "signal", to: guestId, signal });
    peer.transport.onMessage = (bytes) => session.onMessage?.(guestId, decode(bytes) as Recv);
    peer.transport.onState = (state) => {
      if (state === "connected") session.onGuestJoin?.(guestId);
    };
    peer.transport.onClose = () => {
      if (peers.delete(guestId)) session.onGuestLeave?.(guestId);
    };
    return peer;
  }

  ws.onMessage = (bytes) => {
    const msg = decode(bytes) as Notice;
    if (msg.type === "welcome") {
      id = msg.id;
    } else if (msg.type === "signal") {
      peerFor(msg.from).applySignal(msg.signal);
    } else if (msg.type === "peer-leave") {
      const peer = peers.get(msg.id);
      if (peer) peer.close(); // fires onClose → onGuestLeave
    }
  };

  return session;
}

/** Join a session as a guest: open one data channel to the host and exchange
 *  messages with it. The guest is the offerer — it sends its offer to whichever
 *  peer the relay names as host, and re-offers automatically if the host is
 *  handed over to another peer. */
export function join<Send = unknown, Recv = unknown>(
  opts: RtcSessionOptions,
): GuestSession<Send, Recv> {
  const ws = connect({ url: opts.signal });
  let id = "";
  let hostId: string | null = null;
  let peer = makePeer();

  const session: GuestSession<Send, Recv> = {
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

  function makePeer(): ReturnType<typeof createPeer> {
    const p = createPeer(opts);
    p.onSignal = (signal) => {
      if (hostId) ws.sendJson({ type: "signal", to: hostId, signal });
    };
    p.transport.onMessage = (bytes) => session.onMessage?.(decode(bytes) as Recv);
    p.transport.onState = (state) => {
      if (state === "connected") session.onOpen?.();
    };
    p.transport.onClose = () => session.onClose?.();
    return p;
  }

  // Offer to the host, unless that's us (a lone `host()` should call host()).
  function offerHost() {
    if (hostId && hostId !== id) peer.connect();
  }

  ws.onMessage = (bytes) => {
    const msg = decode(bytes) as Notice;
    if (msg.type === "welcome") {
      id = msg.id;
      hostId = msg.host;
      offerHost();
    } else if (msg.type === "host") {
      // Host handed over: drop the dead channel and re-offer to the new host.
      hostId = msg.id;
      peer.close();
      peer = makePeer();
      offerHost();
    } else if (msg.type === "signal" && msg.from === hostId) {
      peer.applySignal(msg.signal);
    }
  };

  return session;
}
