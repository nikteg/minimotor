import type { ClockHandle } from "../clock.js";
import type { App } from "../engine/index.js";
import { createParticleSystem, type ParticleOptions } from "./index.js";

// The subpath entry: the app-bound service plus the pure module it binds.
export * from "./index.js";

/** Create particle systems that default to one app's world clock. */
export function createParticles(app: App) {
  return {
    createSystem(options: Omit<ParticleOptions, "clock"> & { clock?: ClockHandle } = {}) {
      return createParticleSystem({ clock: app.Clock.world, step: app.Loop.step, ...options });
    },
  };
}
