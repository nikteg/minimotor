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
   *  packet interval plus jitter; default 100 (two packets at 20 Hz). */
  delayMs?: number;
  /** Snapshots kept in the buffer (default 32). */
  maxSnapshots?: number;
  /** Blend two states with `t` in 0..1. The default lerps every field that is
   *  numeric in both states and copies the rest from the newer one — supply
   *  your own for angles (wrap-around) or nested objects. */
  lerp?: (a: T, b: T, t: number) => T;
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
  const delay = opts.delayMs ?? 100;
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
      const target = atMs - delay;
      if (target <= times[0]) return states[0];
      if (target >= times[last]) return states[last]; // buffer ran dry: hold
      // The target sits near the tail — scan back from the end.
      let i = last;
      while (times[i - 1] > target) i--;
      const t = (target - times[i - 1]) / (times[i] - times[i - 1]);
      return blend(states[i - 1], states[i], t);
    },

    get size() {
      return times.length;
    },

    clear() {
      times.length = 0;
      states.length = 0;
    },
  };
}
