import type { App } from "../engine/app.js";
import { Phys, attach, world, type Physics2DOptions, type Physics2DWorld } from "./index.js";

// The subpath entry: the app-bound service plus the pure module it binds.
export * from "./index.js";

/** Namespace-style export, matching `Minimotor.*` ergonomics:
 *  `import { Physics2D } from "minimotor/physics2d"` → `Physics2D.world()`. */
export interface Physics2DFeatureOptions extends Physics2DOptions {
  /** Advance automatically on this app's fixed loop. Default true. */
  autoStep?: boolean;
}

export interface Physics2DApi {
  readonly Phys: typeof Phys;
  world(options?: Physics2DFeatureOptions): Physics2DWorld;
  attach: typeof attach;
}

export function createPhysics2D(app: App): Physics2DApi {
  const worlds = new Set<Physics2DWorld>();
  const automatic = new Set<Physics2DWorld>();
  const unsubscribe = app.Loop.onStep(() => {
    for (const physics of automatic) physics.step(app.Loop.step);
  });
  const api: Physics2DApi = {
    Phys,
    attach,
    world(options = {}) {
      const { autoStep = true, ...physicsOptions } = options;
      const physics = world(physicsOptions);
      worlds.add(physics);
      if (autoStep) automatic.add(physics);
      return physics;
    },
  };
  app.onDestroy(() => {
    unsubscribe();
    for (const physics of worlds) physics.destroy();
    worlds.clear();
    automatic.clear();
  });
  return api;
}
