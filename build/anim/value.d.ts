import type { ClockHandle } from "../clock/index.js";
/** A live tween handle: `value` and `done` derive from the owning clock on read. */
export interface Motion {
    /** Current animated value — derived from the clock on read. */
    readonly value: number;
    /** True once finished (never while looping). */
    readonly done: boolean;
    /** Restart from the clock's current now. */
    reset(): void;
}
/** Config for `Anim.animate` — a tween from `from` to `to` over `ms`. */
export interface AnimateOptions {
    /** Start value. Default 0. */
    from?: number;
    /** End value. Default 1. */
    to?: number;
    /** Duration in ms (of the owning clock's time). */
    ms: number;
    /** Easing 0..1 → 0..1 (e.g. `Mathf.easeOut`). Default linear. */
    ease?: (t: number) => number;
    /** Wait this long (ms) before starting. Default 0. */
    delay?: number;
    /** Repeat forever. Default false. */
    loop?: boolean;
    /** Reverse each repeat (ping-pong); implies `loop`. Default false. */
    yoyo?: boolean;
    /** The time this motion lives in. `createAnimation(app)` supplies the app's
     * world clock when this is omitted from the bound API. */
    clock: ClockHandle;
}
/** A one-shot (or looping) tween from `from` to `to` over `ms`. */
export declare function animate(opts: AnimateOptions): Motion;
/** One step of a `sequence` — an `AnimateOptions` without clock/looping
 *  (those belong to the sequence as a whole). */
export type SequenceStep = Omit<AnimateOptions, "clock" | "loop" | "yoyo">;
/** Play steps one after another on a single derived timeline. `value`
 *  follows the active step; `done` when the last finishes. */
export declare function sequence(steps: SequenceStep[], opts: {
    clock: ClockHandle;
    loop?: boolean;
}): Motion;
/** A group of motions started together on the same clock. `done` when all
 *  finish; read the individual `tracks` for their values (`value` returns
 *  the first track's). */
export interface Parallel extends Motion {
    /** The member motions, one per spec, in the order given. Read each track's
     *  `value` to drive independent properties (e.g. `x`, `y`, `scale`). */
    readonly tracks: readonly Motion[];
}
/** Start a group of `animate` motions together on one clock. `done` when every
 *  track finishes; `value` returns the first track's — read `tracks` for the
 *  rest. Per-spec clocks are ignored (the group owns the clock). */
export declare function parallel(specs: Omit<AnimateOptions, "clock">[], opts: {
    clock: ClockHandle;
}): Parallel;
