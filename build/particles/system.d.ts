import type { ClockHandle } from "../clock/index.js";
/** A `number` (fixed) or an inclusive `[min, max]` range to sample from —
 *  tuples mean randomness, engine-wide. */
export type Range = number | [number, number];
/** Options for a `burst`. All optional except `at` — defaults give a small
 *  round puff. */
export interface BurstOptions {
    /** Emission point — anything with x/y (a coin's component data, a body). */
    at: {
        x: number;
        y: number;
    };
    /** How many particles to emit (default 12). */
    count?: number;
    /** Emission direction in radians (default 0 = +x). */
    angle?: number;
    /** Angular spread around `angle`, radians (default 2π = all directions). */
    spread?: number;
    /** Initial speed, px/step (default `[0.7, 2]`). */
    speed?: Range;
    /** Radius, px (default `[2, 4]`). */
    size?: Range;
    /** Lifetime, ms (default 600). */
    life?: Range;
    /** Downward acceleration, px/step² (default 0). */
    gravity?: number;
    /** Fill color(s); one is picked per particle (default `"#fff"`). Dots are
     *  baked and cached per color STRING in a small LRU — per-frame-computed
     *  colors (e.g. `hsl(${t}…)`) churn the cache into constant re-bakes, so
     *  use a fixed set. */
    color?: string | string[];
}
/** Options for immediate-mode `emit` — call it EVERY step the effect should
 *  burn (from inside your `ecs.each` — the loop IS the attachment); `chance`
 *  gates stateless probabilistic emission. */
export interface EmitOptions extends Omit<BurstOptions, "count"> {
    /** Probability 0..1 of emitting one particle this call (default 1). */
    chance?: number;
}
/** A particle system: emit with `burst`/`emit`, render via
 *  `Draw.particles(sys)`. Simulation is pull-derived from the clock. */
export interface ParticleSystem {
    /** Emit a one-shot puff of `opts.count` particles at once (impacts, coin
     *  pickups, death bursts). See `BurstOptions` for shape/spread/color. */
    burst(opts: BurstOptions): void;
    /** Immediate-mode emission: call EVERY step the effect should burn (e.g. from
     *  inside `ecs.each`). `opts.chance` gates stateless probabilistic emission of
     *  one particle per call. */
    emit(opts: EmitOptions): void;
    /** Remove all particles (round reset). */
    clear(): void;
    /** Live particle count. */
    readonly count: number;
    /** Renderer channel — call `Draw.particles(sys)` instead of this. */
    render(ctx: CanvasRenderingContext2D): void;
}
/** Config for a particle system — the clock it lives in and (test) RNG source. */
export interface ParticleOptions {
    /** The time this system lives in. */
    clock: ClockHandle;
    /** Random source — injectable for tests. */
    rng?: () => number;
}
/** Create a standalone particle system. Its simulation is pull-derived from
 * `options.clock`; pass `options.rng` to make emission deterministic in tests.
 * App code normally uses `createParticles(app).createSystem()`. */
export declare function createParticleSystem(options: ParticleOptions): ParticleSystem;
