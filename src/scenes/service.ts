import type { App } from "../engine/index.js";
import { createSceneStack, type SceneSpec, type SceneStackOptions } from "./index.js";

// The subpath entry: the app-bound service plus the pure module it binds.
export * from "./index.js";

/** Scene factory bound to one app's clocks and viewport. */
export function createScenes(app: App) {
  return {
    create<K extends string>(map: Record<K, SceneSpec>, options: Partial<SceneStackOptions> = {}) {
      return createSceneStack(map, {
        clock: app.Clock.world,
        uiClock: app.Clock.ui,
        view: app.viewport,
        ...options,
      });
    },
  };
}
