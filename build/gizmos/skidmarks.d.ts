/** A tyre's mounting point in car-local space, relative to the car centre. */
export interface Wheel {
    /** Distance forward (+) / back (−) of centre, px. */
    along: number;
    /** Distance right (+) / left (−) of centre, px. */
    across: number;
}
/** Tuning for `skidmarks()`: mark lifetime, density, wheel layout and stroke. */
export interface SkidmarksOptions {
    /** Seconds a mark lives before fully fading. `Infinity` = permanent. Default 9. */
    life?: number;
    /** Fade-out window at the end of life, seconds (ignored when permanent). Default 2. */
    fade?: number;
    /** Hard cap on stored segments (oldest drop first). Default 700. */
    max?: number;
    /** Minimum seconds between emissions — throttles density. Default 0.025. */
    emitEvery?: number;
    /** Tyre positions in car-local space. Default: two rear wheels derived from
     *  `rearAxle` / `wheelSpread`. Provide this for any other layout. */
    wheels?: Wheel[];
    /** Convenience for the DEFAULT two rear wheels: axle distance behind centre, px. Default 21. */
    rearAxle?: number;
    /** Convenience for the DEFAULT two rear wheels: half-track offset, px. Default 11. */
    wheelSpread?: number;
    /** Rubber colour. Default "#080c0d". */
    color?: string;
    /** Stroke width, px. Default 3. */
    width?: number;
}
/** Per-step input to `Skidmarks.trace()`: whether the tyres are scrubbing and how dark. */
export interface TraceInput {
    /** Are the tyres scrubbing this step? (No mark laid when false.) */
    marking: boolean;
    /** Darkness 0..1 of fresh rubber (e.g. from slip). Default 0.45. */
    alpha?: number;
}
/** A skid-mark gadget returned by `skidmarks()`: `trace()` each step, `draw()` under the car. */
export interface Skidmarks {
    /** Advance the marks by `dt`, and — if `marking` — lay a segment under each
     *  tyre from its previous position. Call once per fixed step. */
    trace(x: number, y: number, angle: number, input: TraceInput, dt: number): void;
    /** Stroke all live marks (newest darkest). Call in world space, under the car. */
    draw(ctx: CanvasRenderingContext2D): void;
    /** Drop every mark (e.g. on a race restart). */
    clear(): void;
    /** How many segments are currently stored. */
    readonly count: number;
}
/** Create a skid-mark gadget. `trace()` it each step with the car's pose and
 *  whether the tyres are scrubbing; `draw()` it under the car in world space. */
export declare function skidmarks(options?: SkidmarksOptions): Skidmarks;
