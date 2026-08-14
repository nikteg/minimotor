import type { ClockHandle } from "../clock/index.js";
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
export declare function checkpointRoute(checkpoints: number): CheckpointRoute;
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
 *    const dash = Gizmos.charges({ max: 1, refillMs: 0 }); // ground-only
 *    if (onGround) dash.refill();
 *    if (pressDash && dash.use()) doDash(); */
export declare function charges(options: {
    max: number;
    refillMs: number;
    start?: number;
    clock: ClockHandle;
}): Charges;
