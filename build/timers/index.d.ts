import type { ClockHandle } from "../clock/index.js";
import type { App } from "../engine/app.js";
/** A grace window: `active` for `ms` after the last `charge()`. Coyote time,
 *  "recently damaged" invulnerability, any "still counts for a moment" gate. */
export interface Window {
    /** Refill the window (call while the condition holds — e.g. grounded). */
    charge(): void;
    /** End the window now (e.g. after consuming the grace to act). */
    expire(): void;
    /** True while the window is open. */
    readonly active: boolean;
    /** Milliseconds left (0 when closed). */
    readonly remaining: number;
}
/** Make a grace `Window` of `ms`, deriving from the explicit `clock`.
 *  Starts closed until the first `charge()`. */
export declare function window(ms: number, clock: ClockHandle): Window;
/** A buffered trigger: `trigger()` arms it for `ms`; the next `consume()`
 *  within the window returns true once and clears it. Jump/attack buffering —
 *  an input pressed slightly too early still fires when it becomes possible. */
export interface Buffer {
    /** Arm the buffer (call on the input edge). */
    trigger(): void;
    /** True + clears if armed within the window; false otherwise. */
    consume(): boolean;
    /** Armed right now (peek without consuming). */
    readonly armed: boolean;
}
/** Make a `Buffer` with a `ms` window, deriving from the explicit `clock`.
 * Starts disarmed until the first `trigger()`. */
export declare function buffer(ms: number, clock: ClockHandle): Buffer;
/** A cooldown gate: `ready()` once `ms` have elapsed since the last `use()`. */
export interface Cooldown {
    /** Start the cooldown (call when the action fires). */
    use(): void;
    /** True when the action may fire again. */
    ready(): boolean;
    /** Milliseconds until ready (0 when ready). */
    readonly remaining: number;
}
/** Make a `Cooldown` of `ms`, deriving from the explicit `clock`.
 *  Starts `ready()` until the first `use()`. */
export declare function cooldown(ms: number, clock: ClockHandle): Cooldown;
/** Options for `jumpGate`. */
export interface JumpGateOptions {
    /** Coyote grace after leaving the ground, in ms. Default 100. */
    coyoteMs?: number;
    /** Input buffer before landing, in ms. Default 120. */
    bufferMs?: number;
    /** Clock the grace/buffer derive from. `createTimers(app)` supplies the app's
     * world clock when omitted from the bound API. */
    clock: ClockHandle;
}
/** One `try` per step deciding when a jump fires. */
export interface JumpGate {
    /** Call once per step with this step's jump-press edge and grounded fact.
     *  True on the step the jump should fire (press buffering + coyote grace
     *  folded in) — the jump velocity stays game policy. */
    try(pressed: boolean, grounded: boolean): boolean;
    /** The underlying latches, exposed for HUD/debug or extra rules. */
    readonly coyote: Window;
    /** The jump-press `Buffer` (see `coyote`). */
    readonly buffer: Buffer;
}
/** The canonical forgiving-jump timing, composed from `window` (coyote time)
 *  and `buffer` (jump buffering): a jump still fires just after you run off a
 *  ledge, and a press landed just before touchdown isn't dropped. It decides
 *  *when* to jump; the jump velocity stays game policy.
 *
 *    const Timers = createTimers(app);
 *    const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 130 });
 *    if (gate.try(input.jump.pressed, player.grounded)) player.vel.y = JUMP; */
export declare function jumpGate(opts: JumpGateOptions): JumpGate;
export interface TimersApi {
    window(ms: number, clock?: ClockHandle): Window;
    buffer(ms: number, clock?: ClockHandle): Buffer;
    cooldown(ms: number, clock?: ClockHandle): Cooldown;
    jumpGate(opts?: Omit<JumpGateOptions, "clock"> & {
        clock?: ClockHandle;
    }): JumpGate;
}
/** Timer helpers defaulting explicitly to one app's world clock. */
export declare function createTimers(app: App): TimersApi;
