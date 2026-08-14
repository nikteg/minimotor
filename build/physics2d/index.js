import { Phys, attach, world } from "./world.js";
// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./world.js";
export function createPhysics2D(app) {
    const worlds = new Set();
    const automatic = new Set();
    const unsubscribe = app.Loop.onStep(() => {
        for (const physics of automatic)
            physics.step(app.Loop.step);
    });
    const api = {
        Phys,
        attach(ecs, physics, { stepMs = app.Loop.step, ...options } = {}) {
            attach(ecs, physics, { ...options, stepMs });
        },
        world({ autoStep = true, ...physicsOptions } = {}) {
            const physics = world(physicsOptions);
            worlds.add(physics);
            if (autoStep)
                automatic.add(physics);
            return physics;
        },
    };
    app.onDestroy(() => {
        unsubscribe();
        for (const physics of worlds)
            physics.destroy();
        worlds.clear();
        automatic.clear();
    });
    return api;
}
