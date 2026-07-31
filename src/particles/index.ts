import type { ClockHandle } from "@src/clock/index.js";
import type { App } from "@src/engine/index.js";
import { createParticleSystem, type ParticleOptions } from "./system.js";

// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./system.js";

/** Create particle systems that default to one app's world clock. */
export function createParticles(app: App) {
  return {
    createSystem({
      clock = app.Clock.world,
      ...options
    }: Omit<ParticleOptions, "clock"> & { clock?: ClockHandle } = {}) {
      return createParticleSystem({ ...options, clock });
    },
  };
}
