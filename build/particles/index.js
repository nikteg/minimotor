import { createParticleSystem } from "./system.js";
// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./system.js";
/** Create particle systems that default to one app's world clock. */
export function createParticles(app) {
    return {
        createSystem({ clock = app.Clock.world, ...options } = {}) {
            return createParticleSystem({ ...options, clock });
        },
    };
}
