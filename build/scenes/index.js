import { createSceneStack } from "./stack.js";
// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./stack.js";
/** Scene factory bound to one app's clocks and viewport. */
export function createScenes(app) {
    return {
        create(map, { clock = app.Clock.world, uiClock = app.Clock.ui, view = app.viewport, ...options } = {}) {
            return createSceneStack(map, {
                ...options,
                clock,
                uiClock,
                view,
            });
        },
    };
}
