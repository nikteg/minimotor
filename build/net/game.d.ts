import { type BodyState, type SyncBody } from "./body-state.js";
import { type Events } from "./events.js";
import { type Room, type RoomStatus } from "./room.js";
import { type SharedItems, type SharedItemsOptions } from "./shared-items.js";
import type { NetMeter } from "../perf/net-meter.js";
/** One STUN or TURN server. A bare string is a STUN URL; TURN needs
 *  credentials, so give it the object form. Plain data — no WebRTC types
 *  needed to configure a game. */
export type IceServer = string | {
    /** e.g. `"turn:turn.example.com:3478"`. */
    url: string;
    username?: string;
    password?: string;
};
/** Options for `Net.game`. Every one has a sensible default: `Net.game()` on
 *  its own joins the room named `"game"` on this page's own server. */
export interface GameOptions {
    /** Room name — players who pass the same one play together. Default `"game"`. */
    room?: string;
    /** Peer-to-peer: the signaling URL peers meet at, defaulting to `/ws-signal`
     *  on the page's own origin (what `minimotor/server`'s `signaling()` serves).
     *  Players connect directly to each other; the relay only introduces them. */
    url?: string;
    /** Client/server instead: the URL of a `rooms()` server, which carries all
     *  traffic itself. Everything above this option is identical either way —
     *  same `share`, same events, same items, same clock. Use it when you want
     *  one authority, no NAT traversal, and no host migration. */
    server?: string;
    /** STUN/TURN servers for NAT traversal. Defaults to a public STUN server,
     *  which is enough for a LAN and most home connections; a TURN server is
     *  what gets you through symmetric NATs and restrictive firewalls.
     *
     *      ice: "stun:stun.example.com:3478"
     *      ice: [{ url: "turn:turn.example.com:3478", username, password }]
     *
     *  Drop to `Net.join` if you need the raw `RTCIceServer` shape. */
    ice?: IceServer | IceServer[];
    /** Give up on the relay after this long and play solo. Default 1500 ms. */
    timeoutMs?: number;
}
/** Someone else's replicated state, plus who it belongs to. */
export type Shared<T> = T & {
    /** Their stable room id. */
    id: string;
    /** Their stable 0-based slot — for spawn points, colors, and "P2" labels. */
    index: number;
};
/** What everyone else is sharing on one channel: iterate it every frame. */
export interface SharedStates<T> extends Iterable<Shared<T>> {
    /** How many peers currently have a state here. */
    readonly size: number;
    /** One peer's newest state WITHOUT the render delay — for authority checks.
     *  Draw from the iterator instead. */
    latest(id: string): Shared<T> | null;
    /** Make a peer's next update SNAP instead of sweeping — after a teleport or
     *  a respawn. */
    snap(id: string): void;
    /** Stop sharing and listening on this channel. */
    stop(): void;
}
/** Options for `share`. */
export interface ShareOptions<T = never> {
    /** Updates per second. Default 60. */
    hz?: number;
    /** Force the wire format. By default a body-shaped state (`x`/`y` plus
     *  `vel` or `vx`/`vy`) takes the packed binary path — smaller, and blended
     *  with shortest-arc rotation and position-derived projection — and anything
     *  else travels as JSON. Set it explicitly when your state happens to look
     *  like a body but is not one. */
    packed?: boolean;
    /** How far in the past to render remote copies, in ms, or `"auto"` to size
     *  the buffer from observed jitter. `"auto"` is right for most games; a
     *  shooter usually pins it, because a render delay that moves is a lead you
     *  cannot learn. */
    delayMs?: number | "auto";
    /** Blend two snapshots. The default lerps every numeric field, which is
     *  wrong for ANGLES: a player turning past ±π has their yaw blended the long
     *  way round and spins on every other screen. Supply a shortest-arc blend
     *  for any state carrying one. */
    lerp?: (a: T, b: T, t: number) => T;
    /** Cover a late or lost snapshot by projecting past the newest pair. `t`
     *  arrives greater than 1. Bounded by `maxExtrapolationMs`, which must also
     *  be set — projection is off by default. */
    extrapolate?: (a: T, b: T, t: number) => T;
    /** How far `extrapolate` may reach, in ms. Default 0, meaning no projection.
     *  One or two snapshot intervals is the usual budget; further than that and
     *  a stopped player keeps walking. */
    maxExtrapolationMs?: number;
}
/** A joined multiplayer game. */
export interface NetGame<P = unknown> {
    /** Our own room id. */
    readonly id: string;
    /** Our own stable 0-based slot. */
    readonly index: number;
    /** How many players are in the room, including us. */
    readonly count: number;
    /** False when no relay was reachable and this is a solo game. */
    readonly online: boolean;
    /** Whether we are the peer relaying for everyone else. */
    readonly hosting: boolean;
    /** Round-trip time to the host in ms (0 when hosting or offline). */
    readonly rttMs: number;
    /** A clock that reads the same on every client — use it for anything the
     *  room has to agree on, like respawn deadlines. */
    readonly now: number;
    /** Relay-link state, for a "reconnecting…" indicator. */
    readonly status: RoomStatus;
    /** Traffic meter — pass to `createPerformanceMonitoring(app, { net: meter })`. */
    readonly meter: NetMeter;
    /** The underlying room, for anything this high-level session does not cover. */
    readonly room: Room<unknown>;
    /** Typed one-shot events (shots, deaths, chat) — delivered reliably. */
    readonly events: Events<P>;
    /** Replicate one local thing to everyone, and get everyone else's back,
     *  interpolated and ready to draw. Call it once per thing you share; pass a
     *  getter when the instance is replaced on respawn. */
    share<B extends SyncBody>(body: B | (() => B), options?: ShareOptions<BodyState<B>>): SharedStates<BodyState<B>>;
    share<T extends object>(state: () => T, options?: ShareOptions<T>): SharedStates<T>;
    /** The stable slot of any player id. */
    indexOf(id: string): number;
    /** A host-authoritative, respawning collection shared by the room: coins,
     *  pickups, powerups, switches. Already on the shared clock. */
    items<T extends object>(source: readonly T[], options?: SharedItemsOptions<T>): SharedItems<T>;
    /** Leave the game and stop everything it started. */
    close(): void;
}
/** A distinct, readable color per player slot, spaced by the golden angle so
 *  neighbouring slots never look alike. */
export declare function playerColor(index: number): string;
/** Join a multiplayer game: one room, with events, shared items and a shared
 *  clock already wired to it. Call `share` for anything you want replicated.
 *  Falls back to a solo game when no relay answers, so there is only ever one
 *  code path. */
export declare function game<P = unknown>(options?: GameOptions): Promise<NetGame<P>>;
