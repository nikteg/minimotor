import type { Runtime } from "../engine/app.js";
import { type AnimateOptions, type Motion } from "../anim/value.js";
/** A running timer; call to cancel early. */
export type Cancel = () => void;
/** A timeline: `now` derives from the fixed-step counter, and it's holdable,
 *  scalable, and can schedule timers/motions in its own time. */
export interface ClockHandle {
    /** Milliseconds represented by one step of the clock's source. */
    readonly step: number;
    /** Milliseconds elapsed on THIS clock (frozen while held, bent by scale). */
    readonly now: number;
    /** True while the clock is frozen by `hold()`. */
    readonly held: boolean;
    /** Time multiplier: 0.5 = slow motion, 2 = fast forward. Rebases cleanly —
     *  changing it never jumps `now`. */
    scale: number;
    /** Freeze the clock (idempotent). Every derived value freezes with it. */
    hold(): void;
    /** Resume from a hold (idempotent). */
    release(): void;
    /** Run `fn` once after `ms` (in this clock's time). Returns a canceler. */
    after(ms: number, fn: () => void): Cancel;
    /** Run `fn` every `ms` (in this clock's time). Returns a canceler. */
    every(ms: number, fn: () => void): Cancel;
    /** A Motion in this clock's time — see `Anim.animate`. */
    animate(opts: Omit<AnimateOptions, "clock">): Motion;
}
/** Drive timer firing manually — for tests without a running loop. */
export declare function _driveClocks(): void;
/** Build a clock over a fixed-step source (injectable for tests). */
export declare function createClockHandle(stepMs: number, steps?: () => number, register?: (fire: () => boolean) => void): ClockHandle;
export interface ClockApi {
    readonly world: ClockHandle;
    readonly ui: ClockHandle;
    create(): ClockHandle;
}
/** Create world/UI/custom clocks permanently driven by one app. */
export declare function createClockApi(app: Pick<Runtime, "steps" | "onStep" | "step">): ClockApi;
