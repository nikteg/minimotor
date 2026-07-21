// ---------- WebRTC signaling relay ----------
// A "WebRTC server" is really a signaling relay: peers connect it over a
// WebSocket, discover each other, and shuttle SDP offers/answers + ICE
// candidates through it until their direct data channel is up. This builds
// that relay on a room, so a signaling server is one call. Pair it with the
// client `Net.createPeer`: forward each peer's `onSignal` out as
// `{ type: "signal", to, signal }`, and feed relayed signals into
// `applySignal`.

import { serve, type Room, type RoomClient, type SocketServer } from "./room.js";

/** Client → server: relay `signal` to peer `to`. */
export interface SignalRelay {
  type: "signal";
  /** Target peer id (learned from `welcome`/`peer-join`). */
  to: string;
  /** A `Net.Signal` (offer / answer / candidate). */
  signal: unknown;
}

/** Server → client messages. `welcome` carries your own id and the peers
 *  already present; `peer-join`/`peer-leave` track the mesh; `signal` delivers
 *  a relayed message tagged with its sender. */
export type SignalingNotice =
  | { type: "welcome"; id: string; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "signal"; from: string; signal: unknown };

/** Stand up a signaling relay on a WebSocket-like server: each connection gets
 *  a peer id, joins/leaves are announced to the mesh, and `signal` messages are
 *  routed to their target peer (tagged with the sender). Returns the underlying
 *  room. `ws`'s WebSocketServer fits `SocketServer` structurally.
 *
 *    import { WebSocketServer } from "ws";
 *    import { signaling } from "minimotor/server";
 *    signaling(new WebSocketServer({ port: 8080 })); */
export function signaling(server: SocketServer): Room<SignalingNotice> {
  const room: Room<SignalingNotice> = serve<SignalingNotice, SignalRelay>(server, {
    onJoin(client) {
      const peers = room.clients.filter((c) => c !== client).map((c) => c.id);
      room.send(client, { type: "welcome", id: client.id, peers });
      room.relay(client, { type: "peer-join", id: client.id });
    },
    onMessage(client, msg) {
      if (msg?.type !== "signal" || typeof msg.to !== "string") return;
      const target: RoomClient | undefined = room.clients.find((c) => c.id === msg.to);
      if (target) room.send(target, { type: "signal", from: client.id, signal: msg.signal });
    },
    onLeave(client) {
      room.broadcast({ type: "peer-leave", id: client.id });
    },
  });
  return room;
}
