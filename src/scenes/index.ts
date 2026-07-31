import type { App } from "@src/engine/index.js";
import { createSceneStack, type SceneSpec, type SceneStackOptions } from "./stack.js";

// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./stack.js";

/** Scene factory bound to one app's clocks and viewport. */
export function createScenes(app: App) {
  return {
    create<K extends string>(
      map: Record<K, SceneSpec>,
      {
        clock = app.Clock.world,
        uiClock = app.Clock.ui,
        view = app.viewport,
        ...options
      }: Partial<SceneStackOptions> = {},
    ) {
      return createSceneStack(map, {
        ...options,
        clock,
        uiClock,
        view,
      });
    },
  };
}
