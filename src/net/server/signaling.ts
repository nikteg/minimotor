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
  /** Discriminant tag; always `"signal"`. */
  type: "signal";
  /** Target peer id (learned from `welcome`/`peer-join`). */
  to: string;
  /** A `Net.Signal` (offer / answer / candidate). */
  signal: unknown;
}

/** Server → client messages. `welcome` carries your own id, the current `host`
 *  (the first peer to connect; equals your own id when you *are* the host, and
 *  `null` only in the instant before anyone is host), and the peers already
 *  present; `peer-join`/`peer-leave` track the mesh; `host` announces a new host
 *  after the old one leaves; `signal` delivers a relayed message tagged with its
 *  sender. */
export type SignalingNotice =
  | { type: "welcome"; id: string; host: string | null; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "host"; id: string | null }
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
  // The host is the first peer to connect to a given `?room=`. If it leaves,
  // the oldest remaining peer in that room is promoted so a session survives a
  // host drop (guests re-offer to the new host on the `host` notice). Rooms are
  // fully isolated: one endpoint can carry as many as clients ask for.
  const hosts = new Map<string, string>();
  const hostOf = (group: string): string | null => hosts.get(group) ?? null;
  const tell = (group: string, msg: SignalingNotice, except?: RoomClient): void => {
    for (const client of room.group(group)) if (client !== except) room.send(client, msg);
  };
  const room: Room<SignalingNotice> = serve<SignalingNotice, SignalRelay>(server, {
    onJoin(client) {
      if (!hosts.has(client.group)) hosts.set(client.group, client.id);
      const peers = room
        .group(client.group)
        .filter((c) => c !== client)
        .map((c) => c.id);
      room.send(client, {
        type: "welcome",
        id: client.id,
        host: hostOf(client.group),
        peers,
      });
      tell(client.group, { type: "peer-join", id: client.id }, client);
    },
    onMessage(client, msg) {
      if (msg?.type !== "signal" || typeof msg.to !== "string") return;
      // Only ever route within the sender's own room.
      const target = room.group(client.group).find((c) => c.id === msg.to);
      if (target) room.send(target, { type: "signal", from: client.id, signal: msg.signal });
    },
    onLeave(client) {
      tell(client.group, { type: "peer-leave", id: client.id });
      if (client.id === hostOf(client.group)) {
        const next = room.group(client.group)[0]?.id;
        if (next === undefined) hosts.delete(client.group);
        else hosts.set(client.group, next);
        tell(client.group, { type: "host", id: hostOf(client.group) });
      }
    },
  });
  return room;
}
