import type { ClockHandle } from "../clock/index.js";
import type { App } from "../engine/index.js";
import { type ParticleOptions } from "./system.js";
export * from "./system.js";
/** Create particle systems that default to one app's world clock. */
export declare function createParticles(app: App): {
    createSystem({ clock, ...options }?: Omit<ParticleOptions, "clock"> & {
        clock?: ClockHandle;
    }): import("./system.js").ParticleSystem;
};
