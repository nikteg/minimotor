// ---------- Checkpoints & charge pools ----------
// The stateful members of the pacing family: an ordered checkpoint/lap tracker
// and a regenerating charge meter. (The pure curves — waveScale, dayCycle —
// stay in Goodies.pacing.)

import { clamp } from "../mathf.js";
import type { ClockHandle } from "../clock.js";

/** An in-order checkpoint/lap tracker, returned by `checkpointRoute()`. */
export interface CheckpointRoute {
  /** Index of the next checkpoint expected (0-based; wraps to `0` each lap). */
  readonly next: number;
  /** Laps completed so far. */
  readonly lap: number;
  /** Accept a checkpoint only in order. Returns true when accepted. */
  visit(index: number): boolean;
  /** Reset to lap `0`, next checkpoint `0`. */
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

/** A time-regenerating pool of charges, returned by `charges()`. */
export interface Charges {
  /** Whole charges available right now. */
  readonly count: number;
  /** Capacity — `count` and `add`/`refill` never exceed this. */
  readonly max: number;
  /** Progress toward the next charge, 0..1 (1 when full). */
  readonly fraction: number;
  /** Spend `n` (default 1) if available; true when the spend succeeded. */
  use(n?: number): boolean;
  /** Instantly refill to full (touching the ground, a big pickup, respawn). */
  refill(): void;
  /** Grant `n` charges without touching refill progress, clamped to `max`. */
  add(n?: number): void;
}

/** A pool of charges that regenerates over time — dashes, an ability meter,
 *  regenerating ammo, hyperspace jumps. `use()` spends, regen adds one charge
 *  every `refillMs` (derived from the clock — no tick), and `refill()` tops it
 *  off instantly (e.g. on landing). `fraction` drives a recharge bar. Regen
 *  freezes when its clock is held.
 *
 *    const dash = Minimotor.Gizmos.charges({ max: 1, refillMs: 0 }); // ground-only
 *    if (onGround) dash.refill();
 *    if (pressDash && dash.use()) doDash(); */
export function charges(options: {
  max: number;
  refillMs: number;
  start?: number;
  clock: ClockHandle;
}): Charges {
  const max = Math.max(0, Math.floor(options.max));
  const refillMs = Math.max(1, options.refillMs);
  const clock = options.clock;
  let count = clamp(Math.floor(options.start ?? max), 0, max);
  let accrueSince = clock.now; // when the current partial charge began

  // Lazy fold: bank whole charges accrued since `accrueSince`, on every read
  // or mutation. At full, the accrual clock parks at "now".
  const settle = () => {
    if (count >= max) {
      accrueSince = clock.now;
      return;
    }
    const gained = Math.floor((clock.now - accrueSince) / refillMs);
    if (gained > 0) {
      count = Math.min(max, count + gained);
      accrueSince += gained * refillMs;
      if (count >= max) accrueSince = clock.now;
    }
  };

  return {
    get count() {
      settle();
      return count;
    },
    get max() {
      return max;
    },
    get fraction() {
      settle();
      return count >= max ? 1 : (clock.now - accrueSince) / refillMs;
    },
    use(n = 1) {
      settle();
      if (n <= 0) return true;
      if (count >= n) {
        const wasFull = count >= max;
        count -= n;
        if (wasFull) accrueSince = clock.now; // spend restarts the regen timer
        return true;
      }
      return false;
    },
    refill() {
      count = max;
      accrueSince = clock.now;
    },
    add(n = 1) {
      settle();
      count = clamp(count + Math.floor(n), 0, max);
      if (count >= max) accrueSince = clock.now;
    },
  };
}
