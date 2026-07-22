// ---------- The symmetric Room (API_PLAN #48) + Net.sync (#49) ----------
// One vocabulary, no host/guest branches in game code:
//
//   const room = await Net.join("/ws-signal", { room: "api-lab" }).catch(() => null);
//   room.send({ hello: true });                  // to everyone
//   room.onMessage((from, msg) => { ... });      // from everyone
//
// Who hosts, the star fan-out, and host-drop healing are INTERNAL: the relay
// names a host; that member relays guest traffic to everyone else, and any
// member is ready to be promoted when the host drops. Offline is a normal
// outcome — the returned promise rejects and the game degrades gracefully.
//
// Rooms are RESOURCES (the stated exception to the pull law, #50): real IO,
// explicit close(). The asymmetric hostSession/joinSession pair remains one
// tier down for genuinely host-authoritative designs.

import { connect } from "./websocket.js";
import { createPeer } from "./webrtc.js";
import type { RtcConfig, Signal } from "./types.js";
import { createRoster } from "./roster.js";

type Notice =
  | { type: "welcome"; id: string; host: string | null; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "host"; id: string | null }
  | { type: "signal"; from: string; signal: Signal };

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
const encode = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));

interface Envelope {
  f: string; // original sender
  d: unknown; // payload
}

export interface RoomOptions extends RtcConfig {
  /** Room name — matchmaking folds into join. Appended to the signal URL as
   *  `?room=`; grouping requires relay support (the default dev relay hosts
   *  one room per endpoint, which amounts to the same isolation). */
  room?: string;
  /** Reject the join if the relay hasn't welcomed us in this long (ms).
   *  Default 8000. */
  timeoutMs?: number;
}

/** A symmetric room membership. */
export interface Room<Msg = unknown> {
  /** Our member id. */
  readonly id: string;
  /** The OTHER members' ids (relay-tracked membership). */
  readonly peers: string[];
  /** True while we are the relaying host (internal detail, exposed for
   *  debugging/net meters). */
  readonly hosting: boolean;
  readonly closed: boolean;
  /** Send to every other member. */
  send(msg: Msg): void;
  /** Hear from every other member. Returns unsubscribe. */
  onMessage(fn: (from: string, msg: Msg) => void): () => void;
  /** Membership changes (relay-tracked). Return unsubscribe. */
  onJoin(fn: (id: string) => void): () => void;
  onLeave(fn: (id: string) => void): () => void;
  /** Tear the room down (channels + signaling socket). */
  close(): void;
}

/** Join a room by name. Resolves once the relay welcomes us; rejects when
 *  the relay is unreachable (offline single-player is a `.catch` away). */
export function join<Msg = unknown>(url: string, opts: RoomOptions = {}): Promise<Room<Msg>> {
  const full = opts.room
    ? `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(opts.room)}`
    : url;
  const ws = connect({ url: full });

  let myId = "";
  let hostId: string | null = null;
  let closed = false;
  const members = new Set<string>();
  const channels = new Map<string, ReturnType<typeof createPeer>>();
  const messageFns = new Set<(from: string, msg: Msg) => void>();
  const joinFns = new Set<(id: string) => void>();
  const leaveFns = new Set<(id: string) => void>();

  const hosting = (): boolean => hostId !== null && hostId === myId;

  function deliver(env: Envelope): void {
    if (env.f === myId) return; // own broadcast echoed back
    for (const fn of messageFns) fn(env.f, env.d as Msg);
  }

  /** Host duty: pass a guest's envelope on to every other guest. */
  function relay(env: Envelope, exceptId: string): void {
    const bytes = encode(env);
    for (const [gid, peer] of channels) {
      if (gid !== exceptId) peer.transport.trySend(bytes);
    }
  }

  function channelFor(peerId: string): ReturnType<typeof createPeer> {
    let peer = channels.get(peerId);
    if (peer) return peer;
    peer = createPeer(opts);
    channels.set(peerId, peer);
    peer.onSignal = (signal) => ws.sendJson({ type: "signal", to: peerId, signal });
    peer.transport.onMessage = (bytes) => {
      const env = decode(bytes) as Envelope;
      deliver(env);
      if (hosting()) relay(env, peerId);
    };
    peer.transport.onClose = () => {
      channels.delete(peerId);
    };
    return peer;
  }

  /** Adopt the current topology: as a guest, (re)offer one channel to the
   *  host; as the host, drop nothing and answer offers as they arrive. */
  function adopt(): void {
    if (hosting()) return; // guests offer to us
    for (const [pid, peer] of channels) {
      if (pid !== hostId) {
        peer.transport.close();
        channels.delete(pid);
      }
    }
    if (hostId) channelFor(hostId).connect();
  }

  const room: Room<Msg> = {
    get id() {
      return myId;
    },
    get peers() {
      return [...members];
    },
    get hosting() {
      return hosting();
    },
    get closed() {
      return closed;
    },
    send(msg) {
      const env: Envelope = { f: myId, d: msg };
      if (hosting()) {
        relay(env, myId);
      } else if (hostId) {
        channels.get(hostId)?.transport.trySend(encode(env));
      }
    },
    onMessage(fn) {
      messageFns.add(fn);
      return () => messageFns.delete(fn);
    },
    onJoin(fn) {
      joinFns.add(fn);
      return () => joinFns.delete(fn);
    },
    onLeave(fn) {
      leaveFns.add(fn);
      return () => leaveFns.delete(fn);
    },
    close() {
      closed = true;
      for (const peer of channels.values()) peer.transport.close();
      channels.clear();
      ws.close();
    },
  };

  return new Promise<Room<Msg>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        room.close();
        reject(new Error("Minimotor.Net: relay never answered"));
      }
    }, opts.timeoutMs ?? 8000);

    ws.onClose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Minimotor.Net: relay unreachable"));
      }
    };

    ws.onMessage = (bytes) => {
      const msg = decode(bytes) as Notice;
      if (msg.type === "welcome") {
        myId = msg.id;
        hostId = msg.host ?? msg.id; // alone: we are the host-in-waiting
        for (const p of msg.peers) if (p !== myId) members.add(p);
        adopt();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(room);
        }
      } else if (msg.type === "peer-join") {
        if (msg.id !== myId && !members.has(msg.id)) {
          members.add(msg.id);
          for (const fn of joinFns) fn(msg.id);
        }
      } else if (msg.type === "peer-leave") {
        if (members.delete(msg.id)) {
          channels.get(msg.id)?.transport.close();
          for (const fn of leaveFns) fn(msg.id);
        }
      } else if (msg.type === "host") {
        hostId = msg.id;
        adopt(); // promotion heals the star — possibly to US
      } else if (msg.type === "signal") {
        // As host we answer any member's offer; as guest only the host's.
        if (hosting() || msg.from === hostId) channelFor(msg.from).applySignal(msg.signal);
      }
    };
  });
}

// ---------- Net.sync: declarative state replication (#49) ----------

const SYNC_KEY = "__mm_sync";

interface SyncEnvelope<T> {
  [SYNC_KEY]: 1;
  s: T;
}

export interface SyncOptions<T> {
  /** Broadcasts per second. Default 15. */
  hz?: number;
  /** Sample OUR state to share — called on each send tick. */
  state: () => T;
  /** Interpolation delay (ms) — how far behind live the ghosts render. */
  delayMs?: number;
  /** Forget a peer after this long without a snapshot (ms). Default 5000. */
  timeoutMs?: number;
  /** Custom blend (angles, nested shapes). Numbers lerp by default; other
   *  fields step. */
  lerp?: (a: T, b: T, t: number) => T;
  /** Millisecond clock — injectable for tests. */
  now?: () => number;
}

/** The other members' interpolated states — iterate it in draw. */
export interface PeerStates<T> extends Iterable<T & { id: string }> {
  readonly size: number;
  readonly ids: string[];
  /** Stop broadcasting and listening (also stops when the room closes). */
  stop(): void;
}

/** Declarative replication: say WHAT you share and how often; get everyone
 *  else's states back, interpolated and timeout-pruned. Fuses the exported
 *  lower-tier parts (`createInterpolator` + `createRoster` + a send timer). */
export function sync<T>(room: Room<unknown>, opts: SyncOptions<T>): PeerStates<T> {
  const roster = createRoster<T>({
    delayMs: opts.delayMs,
    timeoutMs: opts.timeoutMs,
    lerp: opts.lerp,
    now: opts.now,
  });

  const isSync = (msg: unknown): msg is SyncEnvelope<T> =>
    typeof msg === "object" && msg !== null && (msg as Record<string, unknown>)[SYNC_KEY] === 1;

  const unsubscribe = room.onMessage((from, msg) => {
    if (isSync(msg)) roster.update(from, msg.s);
  });
  const offLeave = room.onLeave((id) => roster.remove(id));

  const interval = setInterval(
    () => {
      if (room.closed) {
        stop();
        return;
      }
      (room as Room<SyncEnvelope<T>>).send({ [SYNC_KEY]: 1, s: opts.state() } as SyncEnvelope<T>);
    },
    1000 / (opts.hz ?? 15),
  );

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    unsubscribe();
    offLeave();
  }

  return {
    get size() {
      return roster.size;
    },
    get ids() {
      return roster.ids;
    },
    stop,
    *[Symbol.iterator]() {
      roster.prune();
      for (const [id, state] of roster.sample()) {
        yield { ...state, id };
      }
    },
  };
}
