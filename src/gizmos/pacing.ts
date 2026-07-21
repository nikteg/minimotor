// ---------- Checkpoints & charge pools ----------
// The stateful members of the pacing family: an ordered checkpoint/lap tracker
// and a regenerating charge meter. (The pure curves — waveScale, dayCycle —
// stay in Goodies.pacing.)

import { clamp } from "../mathf.js";

export interface CheckpointRoute {
  readonly next: number;
  readonly lap: number;
  /** Accept a checkpoint only in order. Returns true when accepted. */
  visit(index: number): boolean;
  reset(): void;
}

/** Ordered checkpoint/lap tracker for racing, tours and multi-step objectives. */
export function checkpointRoute(checkpoints: number): CheckpointRoute {
  if (!Number.isInteger(checkpoints) || checkpoints < 1) {
    throw new RangeError("Gizmos.checkpointRoute: checkpoints must be a positive integer");
  }
  let next = 0;
  let lap = 0;
  return {
    get next() {
      return next;
    },
    get lap() {
      return lap;
    },
    visit(index) {
      if (index !== next) return false;
      next++;
      if (next === checkpoints) {
        next = 0;
        lap++;
      }
      return true;
    },
    reset() {
      next = 0;
      lap = 0;
    },
  };
}

export interface Charges {
  /** Whole charges available right now. */
  readonly count: number;
  readonly max: number;
  /** Progress toward the next charge, 0..1 (1 when full). */
  readonly fraction: number;
  /** Spend `n` (default 1) if available; true when the spend succeeded. */
  use(n?: number): boolean;
  /** Advance the refill timer by `dtMs`. */
  tick(dtMs: number): void;
  /** Instantly refill to full (touching the ground, a big pickup, respawn). */
  refill(): void;
  /** Grant `n` charges without touching refill progress, clamped to `max`. */
  add(n?: number): void;
}

/** A pool of charges that regenerates over time — dashes, an ability meter,
 *  regenerating ammo, hyperspace jumps. `use()` spends, `tick(stepMs)` refills
 *  one charge every `refillMs`, and `refill()` tops it off instantly (e.g. on
 *  landing). `fraction` drives a recharge bar.
 *
 *    const dash = Minimotor.Gizmos.charges({ max: 1, refillMs: 0 }); // ground-only
 *    if (onGround) dash.refill();
 *    if (pressDash && dash.use()) doDash(); */
export function charges(options: { max: number; refillMs: number; start?: number }): Charges {
  const max = Math.max(0, Math.floor(options.max));
  const refillMs = Math.max(1, options.refillMs);
  let count = clamp(Math.floor(options.start ?? max), 0, max);
  let progress = 0;
  return {
    get count() {
      return count;
    },
    get max() {
      return max;
    },
    get fraction() {
      return count >= max ? 1 : progress / refillMs;
    },
    use(n = 1) {
      if (n <= 0) return true;
      if (count >= n) {
        count -= n;
        return true;
      }
      return false;
    },
    tick(dtMs) {
      if (count >= max) {
        progress = 0;
        return;
      }
      progress += dtMs;
      while (progress >= refillMs && count < max) {
        progress -= refillMs;
        count++;
      }
      if (count >= max) progress = 0;
    },
    refill() {
      count = max;
      progress = 0;
    },
    add(n = 1) {
      count = clamp(count + Math.floor(n), 0, max);
    },
  };
}
