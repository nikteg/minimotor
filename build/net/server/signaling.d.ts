import { type Room, type SocketServer } from "./room.js";
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
export type SignalingNotice = {
    type: "welcome";
    id: string;
    host: string | null;
    peers: string[];
} | {
    type: "peer-join";
    id: string;
} | {
    type: "peer-leave";
    id: string;
} | {
    type: "host";
    id: string | null;
} | {
    type: "signal";
    from: string;
    signal: unknown;
};
/** Stand up a signaling relay on a WebSocket-like server: each connection gets
 *  a peer id, joins/leaves are announced to the mesh, and `signal` messages are
 *  routed to their target peer (tagged with the sender). Returns the underlying
 *  room. `ws`'s WebSocketServer fits `SocketServer` structurally.
 *
 *    import { WebSocketServer } from "ws";
 *    import { signaling } from "minimotor/server";
 *    signaling(new WebSocketServer({ port: 8080 })); */
export declare function signaling(server: SocketServer): Room<SignalingNotice>;
