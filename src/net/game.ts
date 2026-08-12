// ---------- Net.game: the room, assembled ----------
// The pieces below this file — room, networkTime, events, sharedItems,
// monitorRoom, memberIndex — are each worth having on their own, but a game
// that just wants "everyone together" should not have to assemble six of them
// and know which clock to hand to which. `Net.game` is that assembly:
//
//   const net = await Net.game({ room: "api-lab" });
//   const players = net.share(player);
//   for (const other of players) drawHero(other);
//
// Replication is a separate call because a game may share nothing, one thing,
// or several — the room is the connection, `share` is what you put on it.
//
// Offline is not a special case: with no relay reachable you get the same
// object back with `online === false`, one player, and every call still valid.

import { syncBody, type BodyState, type SyncBody, type SyncBodyOptions } from "./body-state.js";
import { events, type Events } from "./events.js";
import { join, localRoom, sync, type PeerStates, type Room, type RoomStatus } from "./room.js";
import { socketRoom } from "./socket-room.js";
import { monitorRoom, type MonitoredRoom } from "./diagnostics.js";
import { networkTime } from "./time.js";
import { sharedItems, type SharedItems, type SharedItemsOptions } from "./shared-items.js";
import type { NetMeter } from "@src/perf/net-meter.js";

/** One STUN or TURN server. A bare string is a STUN URL; TURN needs
 *  credentials, so give it the object form. Plain data — no WebRTC types
 *  needed to configure a game. */
export type IceServer =
  | string
  | {
      /** e.g. `"turn:turn.example.com:3478"`. */
      url: string;
      username?: string;
      password?: string;
    };

/** Translate the friendly shape into what `RTCPeerConnection` wants. */
function iceServers(ice: IceServer | IceServer[] | undefined): RTCIceServer[] | undefined {
  if (ice === undefined) return undefined;
  const list = Array.isArray(ice) ? ice : [ice];
  return list.map((server) =>
    typeof server === "string"
      ? { urls: server }
      : { urls: server.url, username: server.username, credential: server.password },
  );
}

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
  share<B extends SyncBody>(
    body: B | (() => B),
    options?: ShareOptions<BodyState<B>>,
  ): SharedStates<BodyState<B>>;
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
export function playerColor(index: number): string {
  return `hsl(${(index * 137.508 + 320) % 360} 90% 65%)`;
}

/** Whether a state carries the position/velocity pair the packed body codec
 *  and its blending are built for. */
function looksLikeBody(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.x !== "number" || typeof body.y !== "number") return false;
  return typeof body.vx === "number" || (typeof body.vel === "object" && body.vel !== null);
}

function defaultUrl(): string {
  if (typeof location === "undefined") {
    throw new Error("createNet: no page origin to infer a relay URL from — pass `url`");
  }
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-signal`;
}

/** Join a multiplayer game: one room, with events, shared items and a shared
 *  clock already wired to it. Call `share` for anything you want replicated.
 *  Falls back to a solo game when no relay answers, so there is only ever one
 *  code path. */
export async function game<P = unknown>(options: GameOptions = {}): Promise<NetGame<P>> {
  const name = options.room ?? "game";
  const timeoutMs = options.timeoutMs ?? 1500;
  // The ONLY line that knows which topology this is. Everything below — and
  // everything the caller does with the result — is identical either way.
  const raw = await (
    options.server
      ? socketRoom(options.server, { room: name, timeoutMs, fallback: "local" })
      : join(options.url ?? defaultUrl(), {
          room: name,
          timeoutMs,
          iceServers: iceServers(options.ice),
          fallback: "local",
        })
  ).catch(() => localRoom());
  const room: MonitoredRoom<unknown> = monitorRoom(raw);
  const time = networkTime(room);
  const channel = events<P>(room);
  const shares = new Set<{ stop(): void }>();

  // Slots are the sorted member ids, rebuilt only when membership changes:
  // every player derives the same order without another protocol message.
  let slots: string[] = [];
  let slotsFor: readonly string[] | null = null;
  const indexOf = (id: string): number => {
    if (room.peers !== slotsFor) {
      slotsFor = room.peers;
      slots = [room.id, ...room.peers].sort();
    }
    return slots.indexOf(id);
  };

  function share<T extends object>(
    state: T | (() => T),
    shareOptions: ShareOptions<T> = {},
  ): SharedStates<T> {
    const read = (typeof state === "function" ? state : () => state) as () => T;
    const { hz = 60, packed = looksLikeBody(read()), ...blend } = shareOptions;
    // `blend` is delayMs/lerp/extrapolate/maxExtrapolationMs, and BOTH paths
    // take them: `syncBody` only defaults the ones it is not given, so a body
    // keeps its packed codec and its rotation-aware blend unless this overrides
    // them explicitly.
    const peers = (
      packed
        ? // `T` is only known to be an object here, so the blend callbacks
          // cannot be proven to take a `BodyState`. The overloads above are
          // what make that true at every call site; this is the one cast that
          // erasure costs.
          syncBody(room, read as unknown as () => SyncBody, {
            ...(blend as SyncBodyOptions<SyncBody>),
            hz,
          })
        : sync(room, { ...blend, hz, state: read })
    ) as PeerStates<T>;

    const withSlot = (value: T & { id: string }): Shared<T> =>
      Object.assign(value, { index: indexOf(value.id) });

    const handle: SharedStates<T> = {
      get size() {
        return peers.size;
      },
      latest(id) {
        const value = peers.latest(id);
        return value ? withSlot(value) : null;
      },
      snap(id) {
        peers.reset(id);
      },
      stop() {
        peers.stop();
        shares.delete(handle);
      },
      *[Symbol.iterator]() {
        for (const value of peers) yield withSlot(value);
      },
    };
    shares.add(handle);
    return handle;
  }

  return {
    get id() {
      return room.id;
    },
    get index() {
      return indexOf(room.id);
    },
    get count() {
      return room.peerCount + 1;
    },
    get online() {
      return !room.local;
    },
    get hosting() {
      return room.hosting;
    },
    get rttMs() {
      return time.rttMs;
    },
    get now() {
      return time.now;
    },
    get status() {
      return room.status;
    },
    get meter() {
      return room.meter;
    },
    room,
    events: channel,
    share: share as NetGame<P>["share"],
    indexOf,
    items(source, itemOptions = {}) {
      return sharedItems(room, source, { now: () => time.now, ...itemOptions });
    },
    close() {
      // Snapshot the set: each stop() removes itself from it.
      for (const handle of Array.from(shares)) handle.stop();
      channel.stop();
      time.stop();
      room.close();
    },
  };
}
