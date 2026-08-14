import type { SyncCodec } from "./body-codec.js";
import type { RtcConfig } from "./types.js";
/** Options for `join`: the room to group into and how long to await the relay's
 *  welcome, plus the inherited `RtcConfig`. */
export interface RoomOptions extends RtcConfig {
    /** Room name — matchmaking folds into join. Appended to the signal URL as
     *  `?room=`; grouping requires relay support (the default dev relay hosts
     *  one room per endpoint, which amounts to the same isolation). */
    room?: string;
    /** Reject the join if the relay hasn't welcomed us in this long (ms).
     *  Default 8000. */
    timeoutMs?: number;
    /** Reopen the relay socket when it drops, so a flaky link or a relay restart
     *  doesn't end the room. Default true. Only applies AFTER a successful join —
     *  a relay that never answered rejects the promise as before, because
     *  "offline" is a normal outcome to `.catch` rather than something to retry
     *  behind the app's back. */
    reconnect?: boolean;
    /** First retry delay in ms, doubled after each failed attempt. Default 500. */
    retryMs?: number;
    /** Ceiling for the doubling retry delay, in ms. Default 8000. */
    maxRetryMs?: number;
    /** Give up (status `"closed"`) after this many consecutive failed attempts.
     *  Default 0 — keep trying for as long as the app is open. */
    maxRetries?: number;
    /** Resolve to a one-player local room if the initial relay join fails.
     *  Multiplayer code then remains the offline code path. */
    fallback?: "local";
}
/** Delivery mode for one send. A REQUIREMENT, not a transport detail: a
 *  transport that is always reliable (a WebSocket) simply satisfies both. */
export interface SendOptions {
    /** `true` (the default for `send`) means the message must arrive, exactly
     *  once, in order. Use it for facts — events, commands, pickups, chat.
     *
     *  `false` (the default for `sendBytes`) means a lost one is fine because a
     *  newer one replaces it, and it must never delay anything queued behind
     *  it. Use it for samples — snapshots. */
    reliable?: boolean;
}
/** Wire traffic actually sent and received, counted where the bytes already
 *  exist. Serializing a message a second time just to measure it is pure
 *  overhead on a path that runs at the snapshot rate. */
export interface RoomTraffic {
    /** Frames handed to a data channel (a host relay counts each forward). */
    sent: number;
    /** Frames taken off a data channel. */
    received: number;
    sentBytes: number;
    receivedBytes: number;
}
/** Where a room's relay link stands. `"reconnecting"` is the one worth
 *  surfacing: peer-to-peer traffic may still be flowing, but membership
 *  changes and new peers can't arrive until the relay is back. */
export type RoomStatus = "connecting" | "connected" | "reconnecting" | "closed";
/** A symmetric room membership. */
export interface Room<Msg = unknown> {
    /** Our member id. */
    readonly id: string;
    /** The OTHER members' ids (relay-tracked membership). A LIVE array, rebuilt
     *  only when membership changes — safe to read every frame, but don't hold
     *  or mutate it; copy if you need a stable snapshot. */
    readonly peers: string[];
    /** How many other members are in the room. */
    readonly peerCount: number;
    /** Current relay host id. Changes when host migration occurs. */
    readonly hostId: string | null;
    /** True while we are the relaying host (internal detail, exposed for
     *  debugging/net meters). */
    readonly hosting: boolean;
    /** True for a local fallback room with no network transport. */
    readonly local: boolean;
    /** True once `close()` has torn the room down. */
    readonly closed: boolean;
    /** The relay link's current state — show "reconnecting…" from this. */
    readonly status: RoomStatus;
    /** Relay-link transitions (`"reconnecting"` → `"connected"` → …). Returns
     *  unsubscribe. Note a reconnect gets us a FRESH member id from the relay,
     *  so `room.id` may differ afterwards, and the other members see the old one
     *  leave and a new one join. */
    onStatus(fn: (status: RoomStatus) => void): () => void;
    /** Send to every other member. Reliable and ordered unless you say
     *  otherwise — see `SendOptions`. */
    send(msg: Msg, opts?: SendOptions): void;
    /** Hear from every other member. Returns unsubscribe. */
    onMessage(fn: (from: string, msg: Msg) => void): () => void;
    /** Send raw bytes on a named binary lane, unreliable by default. The
     *  low-level path behind `syncBody`; app code normally wants `send`. */
    sendBytes(tag: string, bytes: Uint8Array, opts?: SendOptions): void;
    /** Hear one binary lane. The `bytes` view is only valid for the duration of
     *  the call — copy what you need to keep. Returns unsubscribe. */
    onBytes(tag: string, fn: (from: string, bytes: Uint8Array) => void): () => void;
    /** Membership changes (relay-tracked). Return unsubscribe. */
    onJoin(fn: (id: string) => void): () => void;
    /** A member left. Returns unsubscribe. */
    onLeave(fn: (id: string) => void): () => void;
    /** Live byte/message counters, when the transport can supply them for free. */
    readonly traffic?: RoomTraffic;
    /** Tear the room down (channels + signaling socket). */
    close(): void;
}
/** A one-player room implementing the full Room API without a transport. */
export declare function localRoom<Msg = unknown>(): Room<Msg>;
/** Join a room by name. Resolves once the relay welcomes us. Set
 *  `fallback: "local"` to resolve to the same API as a one-player local host
 *  when the relay is unavailable; otherwise the initial failure rejects. */
export declare function join<Msg = unknown>(url: string, opts?: RoomOptions): Promise<Room<Msg>>;
/** Options for `sync`: broadcast rate, the local-state sampler, and the
 *  interpolation delay applied to remote peers. */
export interface SyncOptions<T> {
    /** Broadcasts per second. Default 30. */
    hz?: number;
    /** Sample OUR state to share — called on each send tick. */
    state: () => T;
    /** Interpolation delay (ms), or `"auto"` for an arrival-jitter buffer.
     *  Default `"auto"`: one send interval on a stable connection. */
    delayMs?: number | "auto";
    /** Forget a peer after this long without a snapshot (ms). Default 5000. */
    timeoutMs?: number;
    /** Custom blend (angles, nested shapes). Numbers lerp by default; other
     *  fields step. */
    lerp?: (a: T, b: T, t: number) => T;
    /** Optional short-horizon projection beyond the newest snapshot. */
    extrapolate?: (a: T, b: T, t: number) => T;
    /** Projection cap in milliseconds. Default 0 (disabled). */
    maxExtrapolationMs?: number;
    /** Millisecond clock — injectable for tests. */
    now?: () => number;
    /** Pack snapshots into a binary lane instead of JSON. `syncBody` supplies one
     *  for body state; without it, states travel as JSON, which is schema-free
     *  and readable in devtools. */
    codec?: SyncCodec<T>;
}
/** The other members' interpolated states — iterate it in draw. */
export interface PeerStates<T> extends Iterable<T & {
    id: string;
}> {
    /** How many peers currently have a state. */
    readonly size: number;
    /** The ids of those peers. */
    readonly ids: string[];
    /** Latest received state, without render interpolation delay. */
    latest(id: string): (T & {
        id: string;
    }) | null;
    /** Clear one peer's interpolation buffer so its next snapshot snaps. Use
     * for teleports and respawns. */
    reset(id: string): void;
    /** Stop broadcasting and listening (also stops when the room closes). */
    stop(): void;
}
/** Declarative replication: say WHAT you share and how often; get everyone
 *  else's states back, interpolated and timeout-pruned. Fuses the exported
 *  lower-tier parts (`createInterpolator` + `createRoster` + a send timer). */
export declare function sync<T>(room: Room<unknown>, opts: SyncOptions<T>): PeerStates<T>;
