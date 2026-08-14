import { RtcConfig, Signal, Transport } from "./types.js";
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
export declare function createPeer(config?: RtcConfig): RtcPeer;
