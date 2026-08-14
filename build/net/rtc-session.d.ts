import type { RtcConfig } from "./types.js";
/** Shared options: where to reach the signaling relay, plus any WebRTC config
 *  (STUN/TURN servers, trickle) forwarded to each peer connection. */
export interface RtcSessionOptions extends RtcConfig {
    /** WebSocket URL of the signaling relay (e.g. `signaling()` on the server). */
    signal: string;
}
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
export declare function host<Send = unknown, Recv = unknown>(opts: RtcSessionOptions): HostSession<Send, Recv>;
/** Join a session as a guest: open one data channel to the host and exchange
 *  messages with it. The guest is the offerer — it sends its offer to whichever
 *  peer the relay names as host, and re-offers automatically if the host is
 *  handed over to another peer. */
export declare function join<Send = unknown, Recv = unknown>(opts: RtcSessionOptions): GuestSession<Send, Recv>;
