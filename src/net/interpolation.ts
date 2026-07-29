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

import { lerp } from "../mathf.js";

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
  /** Optional short-horizon projection when the render target is newer than
   * the latest snapshot. Receives `t > 1` over the latest snapshot pair. */
  extrapolate?: (a: T, b: T, t: number) => T;
  /** Projection cap in milliseconds. Default 0 (disabled). */
  maxExtrapolationMs?: number;
  /** Millisecond clock — injectable for tests. Default `performance.now`. */
  now?: () => number;
}

/** A snapshot buffer that renders remote state a fixed delay in the past,
 *  blended between the two surrounding snapshots. */
export interface Interpolator<T> {
  /** Record a snapshot. `atMs` defaults to arrival time; pass the sender's
   *  timestamp when the protocol carries one (steadier under receive jitter).
   *  Out-of-order snapshots (unreliable channels) are dropped. */
  push(state: T, atMs?: number): void;
  /** The state as of (now − delayMs). Interpolated between the two surrounding
   *  snapshots; clamps to the oldest/newest when the target time falls outside
   *  the buffer (no extrapolation). Null until the first push. */
  sample(atMs?: number): T | null;
  /** Buffered snapshot count. */
  readonly size: number;
  /** Current fixed or adaptive render delay. */
  readonly delayMs: number;
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
  const initialInterval = Math.max(1, opts.expectedIntervalMs ?? 50);
  const maxExtrapolation = Math.max(0, opts.maxExtrapolationMs ?? 0);
  const projects = !!opts.extrapolate && maxExtrapolation > 0;
  let interval = initialInterval;
  let jitter = 0;
  let adaptiveDelay = projects ? 0 : interval;
  let lastArrival: number | null = null;
  const max = opts.maxSnapshots ?? 32;
  const now = opts.now ?? (() => performance.now());
  const blend = opts.lerp ?? defaultLerp<T>;

  const times: number[] = [];
  const states: T[] = [];

  return {
    push(state, atMs = now()) {
      // The buffer must stay time-ordered for sampling; late packets from an
      // unreliable channel are stale by definition — drop them.
      if (times.length && atMs <= times[times.length - 1]) return;
      if (fixedDelay === null && opts.delayMs === "auto" && lastArrival !== null) {
        const gap = atMs - lastArrival;
        const error = Math.abs(gap - interval);
        interval += (gap - interval) * 0.1;
        jitter += (error - jitter) * 0.1;
        adaptiveDelay = Math.min(250, (projects ? 0 : interval) + jitter * 2);
      }
      lastArrival = atMs;
      times.push(atMs);
      states.push(state);
      if (times.length > max) {
        times.shift();
        states.shift();
      }
    },

    sample(atMs = now()) {
      const last = times.length - 1;
      if (last < 0) return null;
      const target = atMs - (fixedDelay ?? (opts.delayMs === "auto" ? adaptiveDelay : 100));
      if (target <= times[0]) return states[0];
      if (target >= times[last]) {
        if (!projects || last === 0) return states[last];
        const span = times[last] - times[last - 1];
        const ahead = Math.min(target - times[last], maxExtrapolation);
        return opts.extrapolate!(states[last - 1], states[last], 1 + ahead / span);
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
      return fixedDelay ?? (opts.delayMs === "auto" ? adaptiveDelay : 100);
    },

    clear() {
      times.length = 0;
      states.length = 0;
      interval = initialInterval;
      jitter = 0;
      adaptiveDelay = projects ? 0 : interval;
      lastArrival = null;
    },
  };
}
