// ---------- Snapshot interpolation ----------
// Remote entities look best rendered a little in the past, blended between two
// *known* states, instead of teleporting to whatever the latest packet said.
// Buffer incoming snapshots with `push`, then `sample()` each frame to get the
// state as of (now − delayMs):
//
//   const remote = Net.createInterpolator<{ x: number; y: number }>();
//   transport.onMessage = (data) => remote.push(decode(data));
//   // in draw():
//   const s = remote.sample();
//   if (s) drawPlayer(s.x, s.y);
//
// Pass the SENDER's timestamp as `push(state, arrivedAt, sentAt)` whenever the
// protocol carries one (`Net.sync` always does). Arrival times measure the
// network; sender timestamps measure the simulation, and only the latter tells
// you how much motion a pair of snapshots actually represents. Placing
// snapshots on the local timeline by arrival makes two packets that left 16 ms
// apart but landed 1 ms apart look like 1 ms of motion, which the blend then
// scales back up — the classic "remote players jitter and rubber-band" bug.

import { lerp } from "../mathf.js";

/** How far past the newest snapshot pair the projection may reach, as a
 *  multiple of the pair's own span. Bounds the overshoot when a gap is much
 *  wider than the snapshot interval. */
const MAX_PROJECTION = 2.5;
/** Per-sample weight for following genuine sender/receiver clock drift, once
 *  the fastest observed packet has set the baseline offset. */
const DRIFT = 0.002;

/** Options for `createInterpolator`: render delay, buffer size, blend, and an
 *  injectable clock. */
export interface InterpolatorOptions<T> {
  /** How far behind real time to render, in ms. Should cover at least one
   *  packet interval plus jitter; default 100. `"auto"` adapts to arrival
   *  jitter, starting at `expectedIntervalMs`. */
  delayMs?: number | "auto";
  /** Initial packet interval for adaptive delay. Default 50 ms. */
  expectedIntervalMs?: number;
  /** Snapshots kept in the buffer (default 32). */
  maxSnapshots?: number;
  /** Blend two states with `t` in 0..1. The default lerps every field that is
   *  numeric in both states and copies the rest from the newer one — supply
   *  your own for angles (wrap-around) or nested objects. */
  lerp?: (a: T, b: T, t: number) => T;
  /** Optional short-horizon projection for when a snapshot is late or lost and
   *  the render target runs past the newest pair. Receives `t > 1`. It covers
   *  gaps; it does not replace the render buffer. */
  extrapolate?: (a: T, b: T, t: number) => T;
  /** Projection cap in milliseconds. Default 0 (disabled). */
  maxExtrapolationMs?: number;
  /** Millisecond clock — injectable for tests. Default `performance.now`. */
  now?: () => number;
}

/** A snapshot buffer that renders remote state a fixed delay in the past,
 *  blended between the two surrounding snapshots. */
export interface Interpolator<T> {
  /** Record a snapshot. `atMs` defaults to arrival time. Pass the sender's
   *  clock as `sentAt` when the protocol carries one: snapshots are then placed
   *  on a de-jittered timeline, and duplicates/reordered packets (unreliable
   *  channels) are dropped by their stamp rather than by arrival order. */
  push(state: T, atMs?: number, sentAt?: number): void;
  /** The state as of (now − delayMs). Interpolated between the two surrounding
   *  snapshots; clamps to the oldest/newest when the target time falls outside
   *  the buffer, unless `extrapolate` is set to cover the gap. Null until the
   *  first push. */
  sample(atMs?: number): T | null;
  /** Buffered snapshot count. */
  readonly size: number;
  /** Current fixed or adaptive render delay. */
  readonly delayMs: number;
  /** Estimated one-way arrival jitter in ms (0 without sender timestamps). */
  readonly jitterMs: number;
  /** Drop all snapshots (e.g. on respawn/teleport, to avoid a visible sweep). */
  clear(): void;
}

function defaultLerp<T>(a: T, b: T, t: number): T {
  if (typeof a === "number" && typeof b === "number") {
    return lerp(a, b, t) as T;
  }
  const out = { ...(b as object) } as Record<string, unknown>;
  const from = a as Record<string, unknown>;
  for (const k in from) {
    const av = from[k];
    const bv = out[k];
    if (typeof av === "number" && typeof bv === "number") out[k] = lerp(av, bv, t);
  }
  return out as T;
}

/** Create a snapshot interpolator for a remote entity: `push` incoming states,
 *  `sample()` each frame to read the blended state as of (now − `delayMs`). The
 *  default `lerp` blends numeric fields and copies the rest; see
 *  `InterpolatorOptions` to tune `delayMs`/`maxSnapshots`/`lerp`. */
export function createInterpolator<T>(opts: InterpolatorOptions<T> = {}): Interpolator<T> {
  const fixedDelay = typeof opts.delayMs === "number" ? Math.max(0, opts.delayMs) : null;
  const adaptive = opts.delayMs === "auto";
  const initialInterval = Math.max(1, opts.expectedIntervalMs ?? 50);
  const maxExtrapolation = Math.max(0, opts.maxExtrapolationMs ?? 0);
  const projects = !!opts.extrapolate && maxExtrapolation > 0;
  const max = opts.maxSnapshots ?? 32;
  const now = opts.now ?? (() => performance.now());
  const blend = opts.lerp ?? defaultLerp<T>;

  let interval = initialInterval;
  let jitter = 0;
  // Local-clock → sender-clock mapping. The FASTEST packet observed carries the
  // least queueing delay, so it is the best estimate of the true offset; slower
  // ones only pull it back at `DRIFT` so real clock drift is still followed.
  // Snapshots are BUFFERED IN SENDER UNITS and the render target is converted
  // into them at sample time, so improving the estimate slides the whole
  // timeline at once instead of leaving old snapshots mapped by a stale offset.
  let clockOffset = 0;
  let stamped = false;

  const times: number[] = [];
  const states: T[] = [];

  const delay = (): number => fixedDelay ?? (adaptive ? Math.min(250, interval + jitter * 2) : 100);

  return {
    push(state, atMs = now(), sentAt) {
      if (sentAt !== undefined) {
        const offset = atMs - sentAt;
        if (!stamped || offset < clockOffset) clockOffset = offset;
        else clockOffset += (offset - clockOffset) * DRIFT;
        // Jitter is how far this packet ran behind the fastest path — the
        // depth the buffer has to cover.
        if (adaptive && stamped) jitter += (Math.abs(offset - clockOffset) - jitter) * 0.1;
        stamped = true;
      } else if (stamped) {
        // Mixed sender: place it on the same timeline as its stamped siblings.
        sentAt = atMs - clockOffset;
      }
      // A monotonic sender stamp IS the sequence number: anything at or before
      // the newest one is a duplicate or a reordered straggler. Without stamps,
      // arrival order says the same thing about a late packet.
      const time = sentAt ?? atMs;
      if (times.length && time <= times[times.length - 1]) return;
      // The interval is the sender's own cadence when stamps are available, and
      // only then; arrival gaps measure the network, not the simulation.
      if (adaptive && times.length) {
        const gap = time - times[times.length - 1];
        jitter = stamped ? jitter : jitter + (Math.abs(gap - interval) - jitter) * 0.1;
        interval += (gap - interval) * 0.1;
      }
      times.push(time);
      states.push(state);
      if (times.length > max) {
        times.shift();
        states.shift();
      }
    },

    sample(atMs = now()) {
      const last = times.length - 1;
      if (last < 0) return null;
      // Into the buffer's units: sender time when stamps are in play.
      const target = atMs - delay() - clockOffset;
      if (target <= times[0]) return states[0];
      if (target >= times[last]) {
        if (!projects || last === 0) return states[last];
        // Floor the span: a pair that arrived closer together than the sender
        // could have produced it would otherwise divide the projection into a
        // wild overshoot. Cap the result for the same reason.
        const span = Math.max(times[last] - times[last - 1], interval * 0.5, 1);
        const ahead = Math.min(target - times[last], maxExtrapolation);
        const t = Math.min(1 + ahead / span, MAX_PROJECTION);
        return opts.extrapolate!(states[last - 1], states[last], t);
      }
      // The target sits near the tail — scan back from the end.
      let i = last;
      while (times[i - 1] > target) i--;
      const t = (target - times[i - 1]) / (times[i] - times[i - 1]);
      return blend(states[i - 1], states[i], t);
    },

    get size() {
      return times.length;
    },
    get delayMs() {
      return delay();
    },
    get jitterMs() {
      return jitter;
    },

    clear() {
      times.length = 0;
      states.length = 0;
      interval = initialInterval;
      jitter = 0;
      // The clock mapping is re-learned from the very next stamped snapshot,
      // so there is nothing worth carrying across a teleport.
      stamped = false;
      clockOffset = 0;
    },
  };
}
