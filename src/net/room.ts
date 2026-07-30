// ---------- The symmetric Room (API_PLAN #48) + Net.sync (#49) ----------
// One vocabulary, no host/guest branches in app code:
//
//   const room = await Net.join("/ws-signal", { room: "api-lab" }).catch(() => null);
//   room.send({ hello: true });                  // to everyone
//   room.onMessage((from, msg) => { ... });      // from everyone
//
// Who hosts, the star fan-out, and host-drop healing are INTERNAL: the relay
// names a host; that member relays guest traffic to everyone else, and any
// member is ready to be promoted when the host drops. Offline is a normal
// outcome — the returned promise rejects and the app degrades gracefully.
//
// Rooms are RESOURCES (the stated exception to the pull law, #50): real IO,
// explicit close(). The asymmetric hostSession/joinSession pair remains one
// tier down for genuinely host-authoritative designs.

import { decodeJson, encodeJson, frame, unframe } from "./frame.js";
import { everyMs } from "./rate.js";
import type { SyncCodec } from "./body-codec.js";
import { connect } from "./websocket.js";
import { createPeer, type RtcPeer } from "./webrtc.js";
import type { RtcConfig, Signal } from "./types.js";
import { createRoster } from "./roster.js";

type Notice =
  | { type: "welcome"; id: string; host: string | null; peers: string[] }
  | { type: "peer-join"; id: string }
  | { type: "peer-leave"; id: string }
  | { type: "host"; id: string | null }
  | { type: "signal"; from: string; signal: Signal };

// The wire format lives in ./frame.ts because a server-backed room speaks the
// very same one — see `socketRoom`.
const decode = decodeJson;
const encode = encodeJson;

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
export function localRoom<Msg = unknown>(): Room<Msg> {
  let closed = false;
  let status: RoomStatus = "connected";
  const statusFns = new Set<(status: RoomStatus) => void>();
  return {
    id: "local",
    peers: [],
    peerCount: 0,
    hostId: "local",
    hosting: true,
    local: true,
    get closed() {
      return closed;
    },
    get status() {
      return status;
    },
    onStatus(fn) {
      statusFns.add(fn);
      return () => statusFns.delete(fn);
    },
    send() {},
    onMessage: () => () => {},
    sendBytes() {},
    onBytes: () => () => {},
    onJoin: () => () => {},
    onLeave: () => () => {},
    close() {
      if (closed) return;
      closed = true;
      status = "closed";
      for (const fn of statusFns) fn(status);
      statusFns.clear();
    },
  };
}

/** Join a room by name. Resolves once the relay welcomes us. Set
 *  `fallback: "local"` to resolve to the same API as a one-player local host
 *  when the relay is unavailable; otherwise the initial failure rejects. */
export function join<Msg = unknown>(url: string, opts: RoomOptions = {}): Promise<Room<Msg>> {
  const full = opts.room
    ? `${url}${url.includes("?") ? "&" : "?"}room=${encodeURIComponent(opts.room)}`
    : url;
  const reconnectOn = opts.reconnect ?? true;
  const retryMs = opts.retryMs ?? 500;
  const maxRetryMs = opts.maxRetryMs ?? 8000;
  const maxRetries = opts.maxRetries ?? 0;

  let ws: ReturnType<typeof connect>;
  let myId = "";
  let hostId: string | null = null;
  let closed = false;
  let status: RoomStatus = "connecting";
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const statusFns = new Set<(s: RoomStatus) => void>();
  const setStatus = (next: RoomStatus): void => {
    if (status === next) return;
    status = next;
    for (const fn of statusFns) fn(next);
  };
  const members = new Set<string>();
  // `peers` is read in draw loops; rebuild the array on membership change
  // rather than spreading the Set on every read.
  let peerList: string[] = [];
  const refreshPeers = (): void => {
    peerList = [...members];
  };
  const channels = new Map<string, RtcPeer>();
  const messageFns = new Set<(from: string, msg: Msg) => void>();
  const byteFns = new Map<string, Set<(from: string, bytes: Uint8Array) => void>>();
  const joinFns = new Set<(id: string) => void>();
  const leaveFns = new Set<(id: string) => void>();

  const traffic: RoomTraffic = { sent: 0, received: 0, sentBytes: 0, receivedBytes: 0 };
  const hosting = (): boolean => hostId !== null && hostId === myId;

  /** Put a finished frame on the star: as host, to every member but the one it
   *  came from; as guest, to the host, who fans it out. */
  function dispatch(bytes: Uint8Array, reliable: boolean, exceptId: string): void {
    const put = (peer: RtcPeer): void => {
      if ((reliable ? peer.reliable : peer.transport).trySend(bytes)) {
        traffic.sent++;
        traffic.sentBytes += bytes.length;
      }
    };
    if (hosting()) {
      for (const [gid, peer] of channels) if (gid !== exceptId) put(peer);
    } else if (hostId) {
      const peer = channels.get(hostId);
      if (peer) put(peer);
    }
  }

  /** One inbound frame: deliver it locally, then — as host — forward the SAME
   *  bytes to the rest of the room on the lane they arrived on. No decode and
   *  re-encode per recipient. */
  function receive(bytes: Uint8Array, fromPeer: string, reliable: boolean): void {
    traffic.received++;
    traffic.receivedBytes += bytes.length;
    const parsed = unframe(bytes);
    if (!parsed || parsed.from === myId) return; // own broadcast echoed back
    if (parsed.tag === "") {
      try {
        const msg = decode(parsed.payload) as Msg;
        for (const fn of messageFns) fn(parsed.from, msg);
      } catch {
        /* malformed JSON from a peer must not take the room down */
      }
    } else {
      const fns = byteFns.get(parsed.tag);
      if (fns) for (const fn of fns) fn(parsed.from, parsed.payload);
    }
    if (hosting()) dispatch(bytes, reliable, fromPeer);
  }

  function channelFor(peerId: string): RtcPeer {
    let peer = channels.get(peerId);
    if (peer) return peer;
    peer = createPeer(opts);
    channels.set(peerId, peer);
    peer.onSignal = (signal) => {
      // Signaling only works while the relay link is up; a signal produced
      // mid-reconnect is dropped, and `adopt()` re-offers once we're back.
      try {
        ws.sendJson({ type: "signal", to: peerId, signal });
      } catch {
        /* relay down — the post-welcome adopt() starts the handshake over */
      }
    };
    peer.transport.onMessage = (bytes) => receive(bytes, peerId, false);
    peer.reliable.onMessage = (bytes) => receive(bytes, peerId, true);
    peer.transport.onClose = () => {
      if (channels.get(peerId) === peer) channels.delete(peerId);
    };
    return peer;
  }

  /** Close a peer connection and forget it. */
  function dropChannel(peerId: string): void {
    channels.get(peerId)?.close();
    channels.delete(peerId);
  }

  /** Adopt the current topology: as a guest, (re)offer one channel to the
   *  host; as the host, drop nothing and answer offers as they arrive. */
  function adopt(): void {
    if (hosting()) return; // guests offer to us
    // Snapshot the keys: dropChannel mutates the map we are walking.
    for (const pid of Array.from(channels.keys())) if (pid !== hostId) dropChannel(pid);
    if (hostId) channelFor(hostId).connect();
  }

  const room: Room<Msg> = {
    get id() {
      return myId;
    },
    get peers() {
      return peerList;
    },
    get peerCount() {
      return members.size;
    },
    get hostId() {
      return hostId;
    },
    get hosting() {
      return hosting();
    },
    local: false,
    get closed() {
      return closed;
    },
    get status() {
      return status;
    },
    traffic,
    onStatus(fn) {
      statusFns.add(fn);
      return () => statusFns.delete(fn);
    },
    send(msg, sendOpts) {
      dispatch(frame(myId, "", encode(msg)), sendOpts?.reliable ?? true, myId);
    },
    onMessage(fn) {
      messageFns.add(fn);
      return () => messageFns.delete(fn);
    },
    sendBytes(tag, bytes, sendOpts) {
      dispatch(frame(myId, tag, bytes), sendOpts?.reliable ?? false, myId);
    },
    onBytes(tag, fn) {
      let fns = byteFns.get(tag);
      if (!fns) byteFns.set(tag, (fns = new Set()));
      fns.add(fn);
      return () => fns.delete(fn);
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
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      for (const peer of channels.values()) peer.close();
      channels.clear();
      ws.close();
      setStatus("closed");
    },
  };

  const joining = new Promise<Room<Msg>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        room.close();
        reject(new Error("Minimotor.Net: relay never answered"));
      }
    }, opts.timeoutMs ?? 8000);

    // A welcome after a reconnect is a fresh membership list, not the first
    // one: diff it against what we had so the app hears the churn as ordinary
    // join/leave events rather than having to special-case the reconnect.
    const applyWelcome = (msg: Notice & { type: "welcome" }): void => {
      myId = msg.id;
      hostId = msg.host ?? msg.id; // alone: we are the host-in-waiting
      const next = new Set(msg.peers.filter((p) => p !== myId));
      const gone = [...members].filter((id) => !next.has(id));
      const arrived = [...next].filter((id) => !members.has(id));
      for (const id of gone) {
        members.delete(id);
        dropChannel(id);
      }
      for (const id of arrived) members.add(id);
      refreshPeers();
      for (const id of gone) for (const fn of leaveFns) fn(id);
      for (const id of arrived) for (const fn of joinFns) fn(id);
      adopt();
    };

    const scheduleRetry = (): void => {
      if (maxRetries > 0 && attempt >= maxRetries) {
        closed = true;
        setStatus("closed");
        return;
      }
      // Exponential backoff from `retryMs`, capped: a relay that is down stays
      // down for a while, and a roomful of clients shouldn't stampede it.
      const delay = Math.min(maxRetryMs, retryMs * 2 ** attempt);
      attempt++;
      setStatus("reconnecting");
      retryTimer = setTimeout(open, delay);
    };

    const handleClose = (): void => {
      if (closed) return;
      if (!settled) {
        // Never joined: offline is the app's business, not something to retry.
        settled = true;
        clearTimeout(timer);
        setStatus("closed");
        reject(new Error("Minimotor.Net: relay unreachable"));
        return;
      }
      if (!reconnectOn) {
        closed = true;
        setStatus("closed");
        return;
      }
      scheduleRetry();
    };

    function open(): void {
      retryTimer = null;
      ws = connect({ url: full });
      ws.onClose = handleClose;
      ws.onMessage = handleNotice;
    }

    function handleNotice(bytes: Uint8Array): void {
      const msg = decode(bytes) as Notice;
      if (msg.type === "welcome") {
        applyWelcome(msg);
        attempt = 0; // the link is good again; next drop starts the backoff over
        setStatus("connected");
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(room);
        }
      } else if (msg.type === "peer-join") {
        if (msg.id !== myId && !members.has(msg.id)) {
          members.add(msg.id);
          refreshPeers();
          for (const fn of joinFns) fn(msg.id);
        }
      } else if (msg.type === "peer-leave") {
        if (members.delete(msg.id)) {
          refreshPeers();
          // Close AND forget: relying on the channel's own onclose leaks the
          // entry whenever the connection dies without firing it.
          dropChannel(msg.id);
          for (const fn of leaveFns) fn(msg.id);
        }
      } else if (msg.type === "host") {
        hostId = msg.id;
        adopt(); // promotion heals the star — possibly to US
      } else if (msg.type === "signal") {
        // As host we answer any member's offer; as guest only the host's.
        if (hosting() || msg.from === hostId) channelFor(msg.from).applySignal(msg.signal);
      }
    }

    open();
  });
  return opts.fallback === "local" ? joining.catch(() => localRoom<Msg>()) : joining;
}

// ---------- Net.sync: declarative state replication (#49) ----------

const SYNC_KEY = "__mm_sync";

interface SyncEnvelope<T> {
  [SYNC_KEY]: 1;
  s: T;
  /** The SENDER's clock when this snapshot was sampled. The receiver places
   *  snapshots on its timeline by this, not by arrival — see
   *  `Interpolator.push`. Optional so hand-rolled senders still work. */
  t?: number;
}

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
export interface PeerStates<T> extends Iterable<T & { id: string }> {
  /** How many peers currently have a state. */
  readonly size: number;
  /** The ids of those peers. */
  readonly ids: string[];
  /** Latest received state, without render interpolation delay. */
  latest(id: string): (T & { id: string }) | null;
  /** Clear one peer's interpolation buffer so its next snapshot snaps. Use
   * for teleports and respawns. */
  reset(id: string): void;
  /** Stop broadcasting and listening (also stops when the room closes). */
  stop(): void;
}

/** Declarative replication: say WHAT you share and how often; get everyone
 *  else's states back, interpolated and timeout-pruned. Fuses the exported
 *  lower-tier parts (`createInterpolator` + `createRoster` + a send timer). */
export function sync<T>(room: Room<unknown>, opts: SyncOptions<T>): PeerStates<T> {
  const intervalMs = 1000 / (opts.hz ?? 30);
  const roster = createRoster<T>({
    delayMs: opts.delayMs ?? "auto",
    expectedIntervalMs: intervalMs,
    timeoutMs: opts.timeoutMs,
    lerp: opts.lerp,
    extrapolate: opts.extrapolate,
    maxExtrapolationMs: opts.maxExtrapolationMs,
    now: opts.now,
  });

  const isSync = (msg: unknown): msg is SyncEnvelope<T> =>
    typeof msg === "object" && msg !== null && (msg as Record<string, unknown>)[SYNC_KEY] === 1;

  const clock = opts.now ?? (() => performance.now());
  const codec = opts.codec;
  const unsubscribe = codec
    ? room.onBytes(codec.tag, (from, bytes) => {
        const packet = codec.decode(bytes);
        if (packet) roster.update(from, packet.state, clock(), packet.sentAt);
      })
    : room.onMessage((from, msg) => {
        if (isSync(msg)) roster.update(from, msg.s, clock(), msg.t);
      });
  const offLeave = room.onLeave((id) => roster.remove(id));

  /** One broadcast tick. Sampling is skipped outright when we're alone in the
   *  room — `send` would be a no-op anyway, and `opts.state()` is the app's
   *  code, which shouldn't run for nobody. */
  function broadcast(): void {
    if (room.closed) {
      stop();
      return;
    }
    if (room.peerCount === 0) return;
    // Unreliable: a snapshot that needs retransmitting has already been
    // replaced by a newer one, and waiting for it would stall the whole lane.
    const state = opts.state();
    const sentAt = clock();
    if (codec) room.sendBytes(codec.tag, codec.encode(state, sentAt), { reliable: false });
    else {
      (room as Room<SyncEnvelope<T>>).send(
        { [SYNC_KEY]: 1, s: state, t: sentAt } as SyncEnvelope<T>,
        {
          reliable: false,
        },
      );
    }
  }

  // Evenly spaced on a wall clock, independent of frame pacing and of whether
  // the game is paused — see `everyMs`.
  const offTick = everyMs(intervalMs, broadcast);

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    offTick();
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
    latest(id) {
      const state = roster.latest(id);
      return state === null ? null : { ...state, id };
    },
    reset(id) {
      roster.reset(id);
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
