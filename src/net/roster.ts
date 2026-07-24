import { Interpolator, createInterpolator } from "./interpolation.js";

// ---------- Remote-peer roster ----------
// Multiplayer relays send a stream of per-peer state; every game then re-invents
// the same bookkeeping: make an interpolator on first sight, stamp last-seen,
// prune peers that went quiet, and detect joins. `createRoster` is that, once.

/** Options for `createRoster`: interpolation delay, idle timeout, blend, and an
 *  injectable clock. */
export interface RosterOptions<T> {
  /** Interpolation delay passed to each peer's interpolator (see
   *  `createInterpolator`). */
  delayMs?: number;
  /** Drop a peer after this long without an update, in ms. Default 5000. */
  timeoutMs?: number;
  /** Custom blend for interpolation (angles, nested objects). */
  lerp?: (a: T, b: T, t: number) => T;
  /** Millisecond clock — injectable for tests. Default `performance.now`. */
  now?: () => number;
}

/** Tracks remote peers: interpolates each one's state, detects joins, and
 *  prunes any that go quiet. */
export interface Roster<T> {
  /** Feed a state update for peer `id` (creating its interpolator on first
   *  sight and stamping last-seen). `{ isNew }` flags a just-joined peer. */
  update(id: string, state: T, atMs?: number): { isNew: boolean };
  /** Remove a peer explicitly (e.g. on a `bye`). True if it existed. */
  remove(id: string): boolean;
  /** Drop peers unseen for `timeoutMs`; returns the removed ids. Call each
   *  step — it's the cleanup that's easy to forget or get wrong. */
  prune(atMs?: number): string[];
  /** Interpolated `[id, state]` for every peer that has a sample yet. */
  sample(atMs?: number): Array<[string, T]>;
  /** Interpolated state for ONE peer (its own on-demand `sample`), or null if
   *  it isn't tracked or has no sample yet. */
  sampleOne(id: string, atMs?: number): T | null;
  /** Clear a peer's interpolation buffer so its next update SNAPS instead of
   *  sweeping — for a respawn or teleport. Keeps the peer tracked; no-op if the
   *  id is unknown. */
  reset(id: string): void;
  /** The tracked peer ids. */
  readonly ids: string[];
  /** How many peers are tracked. */
  readonly size: number;
  /** Forget every peer. */
  clear(): void;
}

/** Track a set of remote peers, each with its own snapshot interpolator. */
export function createRoster<T>(options: RosterOptions<T> = {}): Roster<T> {
  const timeout = options.timeoutMs ?? 5000;
  const clock = options.now ?? (() => performance.now());
  const peers = new Map<string, { interp: Interpolator<T>; lastSeen: number }>();
  return {
    update(id, state, atMs = clock()) {
      let peer = peers.get(id);
      const isNew = !peer;
      if (!peer) {
        peer = {
          interp: createInterpolator<T>({
            delayMs: options.delayMs,
            lerp: options.lerp,
            now: options.now,
          }),
          lastSeen: atMs,
        };
        peers.set(id, peer);
      }
      peer.lastSeen = atMs;
      peer.interp.push(state, atMs);
      return { isNew };
    },
    remove(id) {
      return peers.delete(id);
    },
    prune(atMs = clock()) {
      const dropped: string[] = [];
      for (const [id, peer] of peers) {
        if (atMs - peer.lastSeen > timeout) {
          peers.delete(id);
          dropped.push(id);
        }
      }
      return dropped;
    },
    sample(atMs = clock()) {
      const out: Array<[string, T]> = [];
      for (const [id, peer] of peers) {
        const s = peer.interp.sample(atMs);
        if (s !== null) out.push([id, s]);
      }
      return out;
    },
    sampleOne(id, atMs = clock()) {
      const peer = peers.get(id);
      return peer ? peer.interp.sample(atMs) : null;
    },
    reset(id) {
      peers.get(id)?.interp.clear();
    },
    get ids() {
      return [...peers.keys()];
    },
    get size() {
      return peers.size;
    },
    clear() {
      peers.clear();
    },
  };
}
