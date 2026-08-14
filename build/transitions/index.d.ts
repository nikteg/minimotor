import type { Viewport } from "../engine/index.js";
/** Draws the transition overlay. `t` is coverage 0..1 — 0 means the scene is
 *  fully visible, 1 fully covered. Called once per frame while active. */
export type TransitionRender = (ctx: CanvasRenderingContext2D, t: number, vp: Pick<Viewport, "w" | "h">) => void;
/** A scene transition as plain data: total `durationMs` plus how to `render` coverage. */
export interface Transition {
    /** Full duration in ms — half covering, half revealing. */
    durationMs: number;
    /** Draws the coverage overlay at coverage `t` — see `TransitionRender`. */
    render: TransitionRender;
}
/** Lifecycle around a cover → swap → reveal run. Gameplay owns world changes;
 * the visual transition only decides when each phase occurs. */
export interface TransitionPhases {
    beforeCover?(): void;
    swap(): void;
    afterReveal?(): void;
}
/** Classic fade through a solid color. `durationMs` defaults to 400 ms,
 *  `color` to "#000". */
export declare function fade(durationMs?: number, color?: string): Transition;
/** A solid curtain sweeping across the screen. `dir` is the direction the
 *  leading edge travels while covering (default "left"). `durationMs` defaults
 *  to 400 ms, `color` to "#000". */
export declare function wipe(durationMs?: number, dir?: "left" | "right" | "up" | "down", color?: string): Transition;
/** Two solid panels closing toward the middle, then opening again. */
export declare function curtain(durationMs?: number, color?: string): Transition;
/** A live transition being played out. Drive `advance` on the fixed step and
 *  `draw` once per frame (after the scenes have drawn). */
export interface TransitionRun {
    /** Advance by `dtMs`; fires the swap exactly once at the midpoint. */
    advance(dtMs: number): void;
    /** Draw the overlay at the current coverage. */
    draw(ctx: CanvasRenderingContext2D, vp: Pick<Viewport, "w" | "h">): void;
    /** True once the reveal has finished. */
    readonly done: boolean;
}
/** Start a transition: `swap` is called at full coverage (the scene switch the
 *  viewer never sees happen). Pure — no engine dependency. */
export declare function run(spec: Transition, phases: TransitionPhases): TransitionRun;
